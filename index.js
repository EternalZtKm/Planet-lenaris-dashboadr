const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// --- ENVIRONMENT VARIABLES ---
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const REQUIRED_ROLE_ID = "1427083014147407995";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://planet-lenaris-dashboard.onrender.com/api/auth/discord/callback";

const ERLC_API_KEY = process.env.ERLC_API_KEY || "";

// Support Role IDs for Webhook Notifications
const SUPPORT_ROLE_IDS = [
    "1425618034214699078",
    "1425618073917853796",
    "1425618356912001135",
    "1425618591637835797",
    "1425632069479960686",
    "1425618454337028116"
];

// Custom Webhook Configuration (Modifiable by Managers)
let botConfig = {
    shiftWebhook: process.env.SHIFT_WEBHOOK || "",
    punishmentWebhook: process.env.PUNISHMENT_WEBHOOK || "",
    assistanceWebhook: process.env.ASSISTANCE_WEBHOOK || "",
    activityWebhook: process.env.ACTIVITY_WEBHOOK || "",
    managerRoleIds: [
        "1425618356912001135",
        "1425618591637835797",
        "1425632069479960686"
    ]
};

let punishmentLogs = [];
let activeShifts = [];

// In-Memory Notification System
let notificationsList = [
    {
        id: 1,
        title: "Planet Lenaris Hub",
        message: "Welcome to the official staff and community dashboard!",
        time: "Just now",
        read: false
    }
];

function addNotification(title, message) {
    notificationsList.unshift({
        id: Date.now(),
        title,
        message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        read: false
    });
    if (notificationsList.length > 20) notificationsList.pop();
}

// Helper to send Discord Webhooks with Content / Role Pings
async function sendDiscordLog(webhookUrl, embed, content = "") {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, embeds: [embed] })
        });
    } catch (err) {
        console.error("Webhook Send Error:", err.message);
    }
}

// Automated Daily Reset at Midnight
function scheduleMidnightReset() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        punishmentLogs = [];
        scheduleMidnightReset();
    }, msToMidnight);
}
scheduleMidnightReset();

app.use(cors());
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'planet-lenaris-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 86400000,
        secure: true,
        sameSite: 'lax'
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Live Role Verification Helper
async function verifyUserRoleLive(userId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        if (!memberRes.ok) return false;

        const memberData = await memberRes.json();
        const userRoles = memberData.roles || [];
        
        return {
            hasRole: userRoles.includes(REQUIRED_ROLE_ID),
            isManager: userRoles.some(r => botConfig.managerRoleIds.includes(r)),
            roles: userRoles,
            nickname: memberData.nick || null
        };
    } catch (err) {
        return false;
    }
}

// Middleware
async function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const check = await verifyUserRoleLive(req.session.user.id);

    if (!check || !check.hasRole) {
        req.session.verifiedRole = false;
        return res.status(403).json({ success: false, error: "Access Denied: Missing Staff Role" });
    }

    if (check.nickname) req.session.user.displayName = check.nickname;
    req.session.user.isManager = check.isManager;

    next();
}

async function requireManagerAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const check = await verifyUserRoleLive(req.session.user.id);

    if (!check || !check.isManager) {
        return res.status(403).json({ success: false, error: "Access Denied: Management Role Required" });
    }

    next();
}

// --- AUTH ROUTES ---
app.get('/api/auth/discord/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth=failed&reason=NoCode');

    try {
        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/?auth=failed&reason=TokenError');

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        req.session.user = {
            id: userData.id,
            username: userData.global_name || userData.username,
            displayName: userData.global_name || userData.username,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
        req.session.verifiedRole = false;

        req.session.save(() => {
            res.redirect('/?discord=connected');
        });

    } catch (err) {
        res.redirect('/?auth=failed&reason=Exception');
    }
});

app.post('/api/auth/verify-role', async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(400).json({ success: false, error: "Please connect your Discord account first." });
    }

    const check = await verifyUserRoleLive(req.session.user.id);

    if (!check || !check.hasRole) {
        return res.status(403).json({ success: false, error: `Role Check Failed: Missing Role (${REQUIRED_ROLE_ID}).` });
    }

    if (check.nickname) req.session.user.displayName = check.nickname;
    req.session.user.isManager = check.isManager;

    req.session.verifiedRole = true;
    req.session.save(() => {
        res.json({ success: true, user: req.session.user });
    });
});

app.get('/api/auth/user', async (req, res) => {
    if (req.session && req.session.user) {
        const check = await verifyUserRoleLive(req.session.user.id);
        if (check && check.hasRole) {
            req.session.verifiedRole = true;
            if (check.nickname) req.session.user.displayName = check.nickname;
            req.session.user.isManager = check.isManager;
            return res.json({ success: true, user: req.session.user });
        }
    }
    
    if (req.session && req.session.user) {
        return res.json({ success: false, discordConnected: true, user: req.session.user });
    }

    res.json({ success: false });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// --- WEBHOOK & SETTINGS ENDPOINTS ---
app.get('/api/settings/webhooks', requireManagerAuth, (req, res) => {
    res.json({
        success: true,
        webhooks: {
            shiftWebhook: botConfig.shiftWebhook,
            punishmentWebhook: botConfig.punishmentWebhook,
            assistanceWebhook: botConfig.assistanceWebhook,
            activityWebhook: botConfig.activityWebhook
        }
    });
});

app.post('/api/settings/webhooks', requireManagerAuth, (req, res) => {
    const { shiftWebhook, punishmentWebhook, assistanceWebhook, activityWebhook } = req.body || {};
    
    if (shiftWebhook !== undefined) botConfig.shiftWebhook = shiftWebhook.trim();
    if (punishmentWebhook !== undefined) botConfig.punishmentWebhook = punishmentWebhook.trim();
    if (assistanceWebhook !== undefined) botConfig.assistanceWebhook = assistanceWebhook.trim();
    if (activityWebhook !== undefined) botConfig.activityWebhook = activityWebhook.trim();

    addNotification("Settings Updated", "Discord webhook configuration updated by Management.");
    res.json({ success: true, webhooks: botConfig });
});

// --- SUPPORT TICKET ENDPOINT (AVAILABLE TO ALL LOGGED IN USERS) ---
app.post('/api/support/create', async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: "Please log in with Discord first." });
    }

    try {
        const { subject, message } = req.body || {};
        const discordUser = req.session.user;

        const supportPingContent = SUPPORT_ROLE_IDS.map(id => `<@&${id}>`).join(' ');

        addNotification("Support Ticket Created", `Submitted by ${discordUser.username}: ${subject}`);

        sendDiscordLog(botConfig.assistanceWebhook, {
            title: `🎧 Support Ticket: ${subject || "General Inquiry"}`,
            color: 5814783,
            fields: [
                { name: "Submitted By User", value: `${discordUser.displayName || discordUser.username} (<@${discordUser.id}>)`, inline: true },
                { name: "Discord Account", value: `@${discordUser.username}`, inline: true },
                { name: "User ID", value: `${discordUser.id}`, inline: true },
                { name: "Subject", value: subject || "No Subject Specified", inline: false },
                { name: "Message Details", value: message || "No Details Provided", inline: false }
            ],
            footer: { text: "Planet Lenaris Support Desk" }
        }, `📩 **NEW SUPPORT TICKET SUBMITTED**\n${supportPingContent}`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- NOTIFICATION ENDPOINTS ---
app.get('/api/notifications/list', (req, res) => {
    res.json({ success: true, notifications: notificationsList });
});

app.post('/api/notifications/read', (req, res) => {
    notificationsList.forEach(n => n.read = true);
    res.json({ success: true });
});

// --- DASHBOARD ENDPOINTS ---
app.get('/api/shifts/active', requireStaffAuth, (req, res) => {
    const formattedShifts = activeShifts.map(s => {
        const durationMs = Date.now() - s.startTime;
        const totalMinutes = Math.floor(durationMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return { ...s, duration: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`, durationMs };
    });

    res.json({ success: true, activeShifts: formattedShifts, isManager: req.session.user.isManager });
});

app.post('/api/shifts/toggle', requireStaffAuth, async (req, res) => {
    try {
        const { action, department } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        if (action === 'CLOCK_IN') {
            activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
            activeShifts.push({
                userId: discordUser.id,
                username: discordUser.username,
                robloxName: staffRobloxName,
                avatar: discordUser.avatar,
                startTime: Date.now(),
                department: department || "General Staff"
            });
            addNotification("Shift Update", `${staffRobloxName} clocked in for ${department || "General Staff"}.`);
        } else {
            activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
            addNotification("Shift Update", `${staffRobloxName} clocked out.`);
        }

        sendDiscordLog(botConfig.shiftWebhook, {
            title: action === 'CLOCK_IN' ? "🟢 Shift Clocked In" : "🔴 Shift Clocked Out",
            color: action === 'CLOCK_IN' ? 5763719 : 15548997,
            fields: [
                { name: "Staff Member", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true },
                { name: "Department", value: department || "General Staff", inline: true },
                { name: "Time", value: new Date().toLocaleString(), inline: false }
            ],
            footer: { text: "Lenaris Dashboard Logging" }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/shifts/force-end', requireStaffAuth, async (req, res) => {
    try {
        const { targetUserId } = req.body || {};

        if (!req.session.user.isManager) {
            return res.status(403).json({ success: false, error: "Access Denied" });
        }

        const targetShift = activeShifts.find(s => s.userId === targetUserId);
        if (!targetShift) return res.status(404).json({ success: false, error: "Staff member not on shift." });

        activeShifts = activeShifts.filter(s => s.userId !== targetUserId);
        addNotification("Shift Alert", `${targetShift.robloxName}'s shift was force-ended by management.`);

        sendDiscordLog(botConfig.shiftWebhook, {
            title: "🛑 Shift Forceibly Ended",
            color: 15548997,
            fields: [
                { name: "Staff Member", value: `${targetShift.robloxName} (<@${targetShift.userId}>)`, inline: true },
                { name: "Ended By Manager", value: `${req.session.user.displayName} (<@${req.session.user.id}>)`, inline: true }
            ],
            footer: { text: "Lenaris Management Controls" }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/assistance/request', requireStaffAuth, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        addNotification("Higher-Up Request", `${staffRobloxName} requested staff assistance: ${reason || 'Help needed'}`);

        sendDiscordLog(botConfig.assistanceWebhook, {
            title: "🚨 Staff Assistance Requested",
            color: 15548997,
            fields: [
                { name: "Requested By Staff", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true },
                { name: "Details / Reason", value: reason || "Higher-up assistance requested.", inline: false }
            ],
            footer: { text: "Planet Lenaris Staff Desk" }
        }, `🚨 **STAFF ASSISTANCE NEEDED** <@&${REQUIRED_ROLE_ID}>`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/punishments/create', requireStaffAuth, async (req, res) => {
    try {
        const { targetUser, robloxId, punishmentType, reason } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        const existingWarnings = punishmentLogs.filter(
            log => log.targetUser.toLowerCase() === targetUser.toLowerCase() && log.punishmentType === 'Warning' && !log.removed
        ).length;

        const currentWarningCount = existingWarnings + 1;

        const logEntry = {
            id: punishmentLogs.length + 1,
            targetUser,
            robloxId: robloxId || 'N/A',
            punishmentType: punishmentType || 'Warning',
            reason,
            staffName: staffRobloxName,
            removed: false,
            createdAt: new Date().toLocaleString()
        };

        punishmentLogs.unshift(logEntry);
        addNotification("Punishment Logged", `${punishmentType} issued to ${targetUser} by ${staffRobloxName}.`);

        if (punishmentType === 'Warning' && ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} You have received a warning, you now have ${currentWarningCount} warnings. If you receive 3 warnings you will be kicked. Reason: ${reason} Staff: ${staffRobloxName}`;

            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(() => {});
        }

        sendDiscordLog(botConfig.punishmentWebhook, {
            title: `⚠️ New Punishment Logged: ${logEntry.punishmentType}`,
            color: logEntry.punishmentType === 'Ban' ? 15548997 : (logEntry.punishmentType === 'Kick' ? 16744192 : 16776960),
            fields: [
                { name: "Target User", value: targetUser, inline: true },
                { name: "Roblox ID", value: logEntry.robloxId, inline: true },
                { name: "Punishment Type", value: logEntry.punishmentType, inline: true },
                { name: "Active Warning Count", value: `${currentWarningCount}/3`, inline: true },
                { name: "Reason", value: reason, inline: false },
                { name: "Logged By Staff", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true }
            ],
            footer: { text: "Lenaris Staff Moderation Logs" }
        });

        res.json({ success: true, log: logEntry });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/punishments/remove-warning', requireStaffAuth, async (req, res) => {
    try {
        const { logId } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        const logIndex = punishmentLogs.findIndex(l => l.id === logId);
        if (logIndex === -1) return res.status(404).json({ success: false, error: "Warning log not found." });

        punishmentLogs[logIndex].removed = true;
        const targetUser = punishmentLogs[logIndex].targetUser;

        const remainingWarnings = punishmentLogs.filter(
            log => log.targetUser.toLowerCase() === targetUser.toLowerCase() && log.punishmentType === 'Warning' && !log.removed
        ).length;

        addNotification("Warning Removed", `Warning for ${targetUser} removed by ${staffRobloxName}.`);

        if (ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} A warning has been removed by Staff: ${staffRobloxName}. You now have ${remainingWarnings} warning(s).`;
            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(() => {});
        }

        sendDiscordLog(botConfig.punishmentWebhook, {
            title: `🟢 Warning Removed`,
            color: 5763719,
            fields: [
                { name: "Target User", value: targetUser, inline: true },
                { name: "New Warning Count", value: `${remainingWarnings}/3`, inline: true },
                { name: "Removed By Staff", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true }
            ],
            footer: { text: "Lenaris Moderation System" }
        });

        res.json({ success: true, remainingWarnings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/punishments/list', requireStaffAuth, (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

app.post('/api/erlc/command', requireStaffAuth, async (req, res) => {
    try {
        const { command } = req.body || {};
        if (!ERLC_API_KEY) return res.status(500).json({ success: false, error: "ERLC_API_KEY missing." });

        const response = await fetch('https://api.erlc.gg/v1/server/command', {
            method: 'POST',
            headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });

        if (response.ok) {
            sendDiscordLog(botConfig.activityWebhook, {
                title: "⚡ Dashboard In-Game Command Executed",
                color: 16738740,
                fields: [
                    { name: "Executed Command", value: `\`${command}\``, inline: true },
                    { name: "Executed By", value: `${req.session.user.username} (<@${req.session.user.id}>)`, inline: true }
                ]
            });
            res.json({ success: true, message: `Command sent: ${command}` });
        } else {
            const errData = await response.json().catch(() => ({}));
            res.status(500).json({ success: false, error: errData.message || "Failed command." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/erlc/server-info', requireStaffAuth, async (req, res) => {
    try {
        if (!ERLC_API_KEY) return res.json({ success: false });

        const [serverRes, playersRes] = await Promise.all([
            fetch('https://api.erlc.gg/v1/server', { headers: { 'Server-Key': ERLC_API_KEY } }),
            fetch('https://api.erlc.gg/v1/server/players', { headers: { 'Server-Key': ERLC_API_KEY } })
        ]);

        const serverData = serverRes.ok ? await serverRes.json() : {};
        const playersData = playersRes.ok ? await playersRes.json() : [];

        res.json({
            success: true,
            server: serverData,
            players: Array.isArray(playersData) ? playersData : []
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/erlc/activity', requireStaffAuth, async (req, res) => {
    try {
        if (!ERLC_API_KEY) return res.json({ success: false, logs: [] });

        const resLogs = await fetch('https://api.erlc.gg/v1/server/commandlogs', {
            headers: { 'Server-Key': ERLC_API_KEY }
        });

        if (!resLogs.ok) return res.json({ success: false, logs: [] });

        const logs = await resLogs.json();
        res.json({ success: true, logs: Array.isArray(logs) ? logs : [] });
    } catch (err) {
        res.json({ success: false, logs: [] });
    }
});

app.get('/api/get-ip', async (req, res) => {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        res.json({ ip: data.ip });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- DISCORD BOT LOGIC EMBEDDED DIRECTLY ---
if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    const discordClient = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    const botCommands = [
        new SlashCommandBuilder()
            .setName('shift')
            .setDescription('Clock in or out of your shift')
            .addStringOption(option => 
                option.setName('action')
                    .setDescription('Start or End shift')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Start (Clock In)', value: 'CLOCK_IN' },
                        { name: 'End (Clock Out)', value: 'CLOCK_OUT' }
                    )
            ),
        new SlashCommandBuilder()
            .setName('active-shifts')
            .setDescription('View all currently clocked-in staff members'),
        new SlashCommandBuilder()
            .setName('set-webhook')
            .setDescription('Change log webhook channels')
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('Which webhook to update')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Shifts', value: 'shift' },
                        { name: 'Punishments', value: 'punishment' },
                        { name: 'Assistance Requests', value: 'assistance' },
                        { name: 'In-Game Activity', value: 'activity' }
                    )
            )
            .addStringOption(option =>
                option.setName('url')
                    .setDescription('The new Discord Webhook URL')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('erlc-command')
            .setDescription('Run an ER:LC in-game command')
            .addStringOption(option =>
                option.setName('command')
                    .setDescription('e.g., :pm Username Message')
                    .setRequired(true)
            )
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    (async () => {
        try {
            console.log('Registering Discord slash commands...');
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: botCommands });
            console.log('Discord slash commands registered!');
        } catch (err) {
            console.error('Error registering commands:', err);
        }
    })();

    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName, options, user, member } = interaction;

        const hasStaffRole = member.roles.cache.has(REQUIRED_ROLE_ID);
        if (!hasStaffRole) {
            return interaction.reply({ content: '❌ You do not have staff permissions.', ephemeral: true });
        }

        let robloxName = user.username;
        if (member.nickname && member.nickname.includes('|')) {
            const parts = member.nickname.split('|');
            robloxName = parts[parts.length - 1].trim();
        }

        if (commandName === 'shift') {
            const action = options.getString('action');
            await interaction.deferReply({ ephemeral: true });

            if (action === 'CLOCK_IN') {
                activeShifts = activeShifts.filter(s => s.userId !== user.id);
                activeShifts.push({ userId: user.id, username: user.username, robloxName, startTime: Date.now(), department: "General Staff" });
                addNotification("Shift Update", `${robloxName} clocked in via Discord command.`);
            } else {
                activeShifts = activeShifts.filter(s => s.userId !== user.id);
                addNotification("Shift Update", `${robloxName} clocked out via Discord command.`);
            }

            sendDiscordLog(botConfig.shiftWebhook, {
                title: action === 'CLOCK_IN' ? "🟢 Shift Started (Via Discord)" : "🔴 Shift Ended (Via Discord)",
                color: action === 'CLOCK_IN' ? 5763719 : 15548997,
                fields: [
                    { name: "Staff Member", value: `${robloxName} (<@${user.id}>)`, inline: true },
                    { name: "Time", value: new Date().toLocaleString(), inline: false }
                ]
            });

            interaction.editReply(`✅ Shift ${action === 'CLOCK_IN' ? 'Started' : 'Ended'} for **${robloxName}**!`);
        }

        if (commandName === 'active-shifts') {
            await interaction.deferReply();
            if (activeShifts.length > 0) {
                const list = activeShifts.map(s => {
                    const durationMs = Date.now() - s.startTime;
                    const mins = Math.floor(durationMs / 60000);
                    return `• **${s.robloxName}** (<@${s.userId}>) - On for ${mins}m`;
                }).join('\n');
                interaction.editReply(`🟢 **Current Active Staff on Shift:**\n${list}`);
            } else {
                interaction.editReply('🟢 **Active Staff:** No staff members are currently clocked in.');
            }
        }

        if (commandName === 'set-webhook') {
            const type = options.getString('type');
            const url = options.getString('url');
            
            if (type === 'shift') botConfig.shiftWebhook = url;
            if (type === 'punishment') botConfig.punishmentWebhook = url;
            if (type === 'assistance') botConfig.assistanceWebhook = url;
            if (type === 'activity') botConfig.activityWebhook = url;

            interaction.reply({ content: `✅ Updated **${type}** webhook URL!`, ephemeral: true });
        }

        if (commandName === 'erlc-command') {
            const cmd = options.getString('command');
            await interaction.deferReply({ ephemeral: true });

            if (!ERLC_API_KEY) {
                return interaction.editReply('❌ ERLC_API_KEY missing.');
            }

            const res = await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
            });

            if (res.ok) {
                interaction.editReply(`⚡ Executed in-game command: \`${cmd}\``);
            } else {
                interaction.editReply('❌ Failed to execute command in ER:LC.');
            }
        }
    });

    discordClient.login(BOT_TOKEN);
}

app.listen(PORT, () => {
    console.log(`Lenaris Staff Dashboard & Discord Bot running on port ${PORT}`);
});
