require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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

// Staff Hierarchy Role IDs (Ordered from LEAST to GREATEST authority)
const STAFF_ROLE_IDS_ASC = [
    "1425619421719695500", "1425619419081474079", "1425619416229613578", "1425619413566095493",
    "1425619286864695306", "1425617466092032112", "1425617463051030578", "1425617456432414781",
    "1425617453102137364", "1425617450023784559", "1425617405073424514", "1425617401826775101",
    "1425617398924447896", "1425617395762073740", "1425617392423276708", "1425617114298978324",
    "1425617110826090567", "1425617102567641138", "1424244176236711946", "1425616980345487380",
    "1425616349920755772", "1425616338831016088", "1425616334569341089", "1425616324121596054",
    "1425616282295861298", "1425616084496814180", "1425616019874906223", "1425615977495920721",
    "1425615914061008990", "1425615745727074405", "1425615423025578005", "1425615381283737610",
    "1425615346764742686", "1425615265277673612", "1425615123069927444", "1425614333957636138",
    "1425614322603655231", "1425614286499086396", "1425614245973983322", "1425614210624389244",
    "1425613708222267472", "1425613620829491372", "1425613579931095051"
];

// Custom Activity Requirements Role IDs
const CUSTOM_ACTIVITY_ROLE_IDS = [
    "1521303992875880578",
    "1425617979315585216",
    "1425618034214699078",
    "1425618073917853796",
    "1425618278226722867",
    "1425618356912001135",
    "1425618454337028116",
    "1425618591637835797",
    "1425632069479960686"
];

// Server Configuration
let serverConfig = {
    serverName: "Planet Lenaris",
    serverIcon: "https://cdn.discordapp.com/attachments/1423913605102829691/1531394062173606049/bxrprtr.png?ex=6a690d5c&is=6a67bbdc&hm=037a4139f745e4f4814981e12642ac81316d80934ebf660dcb2bade9c68ed6b2&animated=true",
    autoBanBolo: true,
    userSeeLogs: false,
    punishmentPresets: ["Warning", "Kick", "Ban", "Ban BOLO", "Staff Warning"]
};

// Webhook & Bot Config
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

// --- DATA STORES ---
let punishmentLogs = [];
let activeShifts = [];
let completedShifts = [
    {
        id: "shift_101",
        userId: "1001",
        username: "bloog8037",
        displayName: "Bloog10",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
        startTime: new Date("2026-07-26T00:19:00Z").getTime(),
        endTime: new Date("2026-07-26T11:50:00Z").getTime(),
        durationMinutes: 691,
        breakTimeMs: 0,
        shiftType: "Default",
        waveId: "wave_1",
        logs: { total: 0, warns: 0, kicks: 0, bans: 0, banBolos: 0, notes: 0 },
        job: { actionsExecuted: 0, priorityApproved: 0, priorityDenied: 0, modcallsClaimed: 0, memberChecks: 0, vehicleChecks: 0 }
    },
    {
        id: "shift_102",
        userId: "1002",
        username: "eternalztkm",
        displayName: "EternalZtKm",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png",
        startTime: new Date("2026-07-25T22:26:00Z").getTime(),
        endTime: new Date("2026-07-26T01:32:00Z").getTime(),
        durationMinutes: 186,
        breakTimeMs: 0,
        shiftType: "Default",
        waveId: "wave_1",
        logs: { total: 5, warns: 3, kicks: 1, bans: 0, banBolos: 1, notes: 0 },
        job: { actionsExecuted: 0, priorityApproved: 0, priorityDenied: 0, modcallsClaimed: 16, memberChecks: 0, vehicleChecks: 0 }
    }
];

let activityWaves = [
    {
        id: "wave_1",
        number: 1,
        active: true,
        startDate: "July 1, 2026 6:31 PM",
        endDate: null,
        durationDays: null
    }
];

let customActivityRequirements = {};
CUSTOM_ACTIVITY_ROLE_IDS.forEach(id => { customActivityRequirements[id] = 0; });

let shiftSettings = {
    shiftLogging: false,
    inGameRequirement: true,
    minPlayercount: 2,
    maxOnShift: null,
    shiftTypes: ["Default", "Patrol", "Training", "Event"],
    defaultReportForm: "Default Form"
};

let notificationsList = [
    {
        id: 1,
        title: "Planet Lenaris Hub",
        message: "Welcome to the official staff and community dashboard!",
        time: "Just now",
        read: false
    }
];

// Helper Functions
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

function scheduleMidnightReset() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        punishmentLogs = punishmentLogs.filter(log => log.punishmentType === 'Ban BOLO');
        scheduleMidnightReset();
    }, msToMidnight);
}
scheduleMidnightReset();

// Middleware & Express Config
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

// Logo Route
app.get(['/Logo.png', '/logo.png', '/server-logo.png', '/api/logo'], (req, res) => {
    if (serverConfig.serverIcon) {
        return res.redirect(serverConfig.serverIcon);
    }
    const publicDir = path.join(__dirname, 'public');
    if (fs.existsSync(publicDir)) {
        const files = fs.readdirSync(publicDir);
        const logoFile = files.find(f => f.toLowerCase().includes('logo') || f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.jpg'));
        if (logoFile) return res.sendFile(path.join(publicDir, logoFile));
    }
    res.status(404).send('Logo file not found');
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Verification Helper
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
            nickname: memberData.nick || null,
            joinedAt: memberData.joined_at || null
        };
    } catch (err) {
        return false;
    }
}

// Middleware Guards
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

// --- AUTH ENDPOINTS ---
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
            username: userData.username,
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

// --- STAFF MEMBERS DIRECTORY ENDPOINT ---
app.get('/api/members', async (req, res) => {
    try {
        if (!discordClient || !discordClient.isReady()) {
            return res.status(503).json({ success: false, error: "Discord client is not ready." });
        }

        const guild = await discordClient.guilds.fetch(GUILD_ID);
        if (!guild) return res.status(500).json({ success: false, error: "Guild not found." });

        const members = await guild.members.fetch();
        const staffMembers = [];

        members.forEach((member) => {
            if (member.user.bot) return;

            const userStaffRoleIndexes = member.roles.cache
                .map((role) => STAFF_ROLE_IDS_ASC.indexOf(role.id))
                .filter((index) => index !== -1);

            if (userStaffRoleIndexes.length > 0) {
                const highestRankIndex = Math.max(...userStaffRoleIndexes);
                const highestRoleId = STAFF_ROLE_IDS_ASC[highestRankIndex];
                const highestRole = guild.roles.cache.get(highestRoleId);

                staffMembers.push({
                    id: member.id,
                    username: member.user.username,
                    displayName: member.displayName || member.user.username,
                    avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
                    roleName: highestRole ? highestRole.name : "Staff Member",
                    roleId: highestRoleId,
                    rankIndex: highestRankIndex,
                    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null
                });
            }
        });

        staffMembers.sort((a, b) => b.rankIndex - a.rankIndex);
        res.json({ success: true, members: staffMembers });
    } catch (err) {
        console.error("Error fetching staff members:", err);
        res.status(500).json({ success: false, error: "Failed to fetch staff members." });
    }
});

// --- ACTIVITY ENDPOINTS ---

// 1. WAVES API
app.get('/api/activity/waves', (req, res) => {
    const enrichedWaves = activityWaves.map(wave => {
        const waveShifts = completedShifts.filter(s => s.waveId === wave.id);
        const totalMinutes = waveShifts.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;

        return {
            ...wave,
            totalShifts: waveShifts.length,
            onlineTimeFormatted: `${hours} hours ${mins} minutes`,
            breakTimeFormatted: "0 seconds"
        };
    });

    res.json({ success: true, waves: enrichedWaves });
});

app.get('/api/activity/custom-requirements', requireManagerAuth, async (req, res) => {
    try {
        if (!discordClient || !discordClient.isReady()) {
            return res.status(503).json({ success: false, error: "Discord bot not ready." });
        }
        const guild = await discordClient.guilds.fetch(GUILD_ID);
        
        const roleData = CUSTOM_ACTIVITY_ROLE_IDS.map(roleId => {
            const role = guild.roles.cache.get(roleId);
            return {
                id: roleId,
                name: role ? role.name : `Role (${roleId})`,
                requiredHours: customActivityRequirements[roleId] || 0
            };
        });

        res.json({ success: true, roles: roleData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/activity/custom-requirements', requireManagerAuth, (req, res) => {
    const { requirements } = req.body || {};
    if (requirements && typeof requirements === 'object') {
        Object.keys(requirements).forEach(roleId => {
            if (CUSTOM_ACTIVITY_ROLE_IDS.includes(roleId)) {
                customActivityRequirements[roleId] = parseInt(requirements[roleId]) || 0;
            }
        });
        addNotification("Activity Settings Updated", "Custom activity requirements updated by Management.");
        return res.json({ success: true, requirements: customActivityRequirements });
    }
    res.status(400).json({ success: false, error: "Invalid payload" });
});

// 2. SHIFTS API
app.get('/api/shifts/all', (req, res) => {
    const { waveId, shiftType } = req.query;
    let filtered = [...completedShifts];

    if (waveId) filtered = filtered.filter(s => s.waveId === waveId);
    if (shiftType) filtered = filtered.filter(s => s.shiftType === shiftType);

    res.json({ success: true, shifts: filtered });
});

app.get('/api/shifts/settings', (req, res) => {
    res.json({ success: true, settings: shiftSettings });
});

app.post('/api/shifts/settings', requireManagerAuth, (req, res) => {
    const { shiftLogging, inGameRequirement, minPlayercount, maxOnShift, defaultReportForm } = req.body || {};
    
    if (shiftLogging !== undefined) shiftSettings.shiftLogging = !!shiftLogging;
    if (inGameRequirement !== undefined) shiftSettings.inGameRequirement = !!inGameRequirement;
    if (minPlayercount !== undefined) shiftSettings.minPlayercount = parseInt(minPlayercount) || 0;
    if (maxOnShift !== undefined) shiftSettings.maxOnShift = maxOnShift ? parseInt(maxOnShift) : null;
    if (defaultReportForm) shiftSettings.defaultReportForm = defaultReportForm;

    res.json({ success: true, settings: shiftSettings });
});

app.post('/api/shifts/update', requireStaffAuth, (req, res) => {
    const { shiftId, hours, minutes, shiftType } = req.body || {};
    const shift = completedShifts.find(s => s.id === shiftId);

    if (!shift) return res.status(404).json({ success: false, error: "Shift not found." });

    if (hours !== undefined && minutes !== undefined) {
        shift.durationMinutes = (parseInt(hours) * 60) + parseInt(minutes);
    }
    if (shiftType) shift.shiftType = shiftType;

    res.json({ success: true, shift });
});

app.post('/api/shifts/delete', requireManagerAuth, (req, res) => {
    const { shiftId } = req.body || {};
    completedShifts = completedShifts.filter(s => s.id !== shiftId);
    res.json({ success: true });
});

// 3. MEMBER ACTIVITY STATS API
app.get('/api/activity/member-stats', async (req, res) => {
    const { userId, waveId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: "Missing userId" });

    let userShifts = completedShifts.filter(s => s.userId === userId);
    if (waveId) userShifts = userShifts.filter(s => s.waveId === waveId);

    const totalMinutes = userShifts.reduce((acc, s) => acc + s.durationMinutes, 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    let userLogs = { total: 0, warns: 0, kicks: 0, bans: 0, banBolos: 0, notes: 0 };
    let userJob = { actionsExecuted: 0, priorityApproved: 0, priorityDenied: 0, modcallsClaimed: 0, memberChecks: 0, vehicleChecks: 0 };

    userShifts.forEach(s => {
        if (s.logs) {
            userLogs.total += s.logs.total || 0;
            userLogs.warns += s.logs.warns || 0;
            userLogs.kicks += s.logs.kicks || 0;
            userLogs.bans += s.logs.bans || 0;
            userLogs.banBolos += s.logs.banBolos || 0;
            userLogs.notes += s.logs.notes || 0;
        }
        if (s.job) {
            userJob.actionsExecuted += s.job.actionsExecuted || 0;
            userJob.priorityApproved += s.job.priorityApproved || 0;
            userJob.priorityDenied += s.job.priorityDenied || 0;
            userJob.modcallsClaimed += s.job.modcallsClaimed || 0;
            userJob.memberChecks += s.job.memberChecks || 0;
            userJob.vehicleChecks += s.job.vehicleChecks || 0;
        }
    });

    res.json({
        success: true,
        stats: {
            totalShifts: userShifts.length,
            timeOnlineFormatted: `${hours} hours ${mins} minutes`,
            timeOnBreakFormatted: "0 seconds",
            logs: userLogs,
            job: userJob,
            shifts: userShifts
        }
    });
});

// 4. LEADERBOARD API
app.get('/api/activity/leaderboard', async (req, res) => {
    const { waveId, shiftType } = req.query;
    let filteredShifts = [...completedShifts];

    if (waveId) filteredShifts = filteredShifts.filter(s => s.waveId === waveId);
    if (shiftType) filteredShifts = filteredShifts.filter(s => s.shiftType === shiftType);

    const userTotals = {};
    filteredShifts.forEach(s => {
        if (!userTotals[s.userId]) {
            userTotals[s.userId] = {
                userId: s.userId,
                username: s.username,
                displayName: s.displayName,
                avatarUrl: s.avatarUrl,
                totalMinutes: 0
            };
        }
        userTotals[s.userId].totalMinutes += s.durationMinutes;
    });

    const leaderboard = Object.values(userTotals).map(u => {
        const hours = Math.floor(u.totalMinutes / 60);
        const mins = u.totalMinutes % 60;
        return {
            ...u,
            activityTimeFormatted: `${hours} hours ${mins} minutes`
        };
    }).sort((a, b) => b.totalMinutes - a.totalMinutes);

    res.json({ success: true, leaderboard });
});

// --- GENERAL SETTINGS & WEBHOOKS ---
app.get('/api/settings/general', (req, res) => {
    res.json({ success: true, config: serverConfig });
});

app.post('/api/settings/general', requireManagerAuth, (req, res) => {
    const { serverName, serverIcon, autoBanBolo, userSeeLogs, punishmentPresets } = req.body || {};

    if (serverName && serverName.trim()) serverConfig.serverName = serverName.trim();
    if (serverIcon !== undefined) serverConfig.serverIcon = serverIcon.trim();
    if (autoBanBolo !== undefined) serverConfig.autoBanBolo = autoBanBolo;
    if (userSeeLogs !== undefined) serverConfig.userSeeLogs = userSeeLogs;
    if (Array.isArray(punishmentPresets)) serverConfig.punishmentPresets = punishmentPresets;

    addNotification("Settings Updated", "Server configuration updated by Management.");
    res.json({ success: true, config: serverConfig });
});

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

// --- SUPPORT & NOTIFICATIONS ---
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
            footer: { text: `${serverConfig.serverName} Support Desk` }
        }, `📩 **NEW SUPPORT TICKET SUBMITTED**\n${supportPingContent}`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/notifications/list', (req, res) => {
    res.json({ success: true, notifications: notificationsList });
});

app.post('/api/notifications/read', (req, res) => {
    notificationsList.forEach(n => n.read = true);
    res.json({ success: true });
});

// --- SHIFTS & PUNISHMENTS DASHBOARD ---
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
            const existing = activeShifts.find(s => s.userId === discordUser.id);
            if (existing) {
                const durationMinutes = Math.floor((Date.now() - existing.startTime) / 60000);
                completedShifts.unshift({
                    id: `shift_${Date.now()}`,
                    userId: discordUser.id,
                    username: discordUser.username,
                    displayName: discordUser.displayName,
                    avatarUrl: discordUser.avatar,
                    startTime: existing.startTime,
                    endTime: Date.now(),
                    durationMinutes,
                    breakTimeMs: 0,
                    shiftType: "Default",
                    waveId: "wave_1",
                    logs: { total: 0, warns: 0, kicks: 0, bans: 0, banBolos: 0, notes: 0 },
                    job: { actionsExecuted: 0, priorityApproved: 0, priorityDenied: 0, modcallsClaimed: 0, memberChecks: 0, vehicleChecks: 0 }
                });
            }
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
            footer: { text: `${serverConfig.serverName} Dashboard Logging` }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/shifts/force-end', requireStaffAuth, async (req, res) => {
    try {
        const { targetUserId } = req.body || {};
        if (!req.session.user.isManager) return res.status(403).json({ success: false, error: "Access Denied" });

        const targetShift = activeShifts.find(s => s.userId === targetUserId);
        if (!targetShift) return res.status(404).json({ success: false, error: "Staff member not on shift." });

        activeShifts = activeShifts.filter(s => s.userId !== targetUserId);
        addNotification("Shift Alert", `${targetShift.robloxName}'s shift was force-ended by management.`);

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
            footer: { text: `${serverConfig.serverName} Staff Desk` }
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

        if ((punishmentType === 'Ban' || punishmentType === 'Ban BOLO') && ERLC_API_KEY) {
            const banCommand = `:ban ${targetUser} Active ${punishmentType}. Reason: ${reason}`;
            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: banCommand })
            }).catch(() => {});
        }

        res.json({ success: true, log: logEntry });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/punishments/remove-warning', requireStaffAuth, async (req, res) => {
    try {
        const { logId } = req.body || {};
        const logIndex = punishmentLogs.findIndex(l => l.id === logId);
        if (logIndex === -1) return res.status(404).json({ success: false, error: "Warning log not found." });

        punishmentLogs[logIndex].removed = true;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/punishments/list', requireStaffAuth, (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

// --- ERLC ENDPOINTS ---
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

        res.json({ success: true, server: serverData, players: Array.isArray(playersData) ? playersData : [] });
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- DISCORD BOT BOT INITIALIZATION ---
let discordClient;

if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    discordClient = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    discordClient.once('ready', () => {
        console.log(`[DISCORD] Bot logged in as ${discordClient.user.tag}`);
    });

    discordClient.login(BOT_TOKEN);
}

app.listen(PORT, () => {
    console.log(`Lenaris Staff Dashboard running on port ${PORT}`);
});
