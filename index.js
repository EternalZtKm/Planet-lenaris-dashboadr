const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const REQUIRED_ROLE_ID = "1427083014147407995";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://planet-lenaris-dashboard.onrender.com/api/auth/discord/callback";

const DISCORD_WEBHOOK = "https://discord.com/api/v10/webhooks/1521283484021162146/4M4gKnNPOUGKL-d-FEE02pbnno3PwkKWvUgIs0LODYxOVwSx6uZ6Qfk-K641-SmDhApg";
const ERLC_API_KEY = process.env.ERLC_API_KEY || "";
const DISCORD_BOT_API_KEY = process.env.DISCORD_BOT_API_KEY || "lenaris-secret-bot-key";

// Role IDs allowed to force-end other staff members' shifts
const MANAGER_ROLE_IDS = [
    "1425618356912001135",
    "1425618591637835797",
    "1425632069479960686"
];

let punishmentLogs = [];
let activeShifts = []; // [{ userId, username, robloxName, startTime, department }]

// Automated Daily Reset at 12:00 AM Midnight
function scheduleMidnightReset() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 0
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        console.log("🕛 Midnight reached! Clearing daily punishment logs...");
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

// Helper: Live Role & Nickname Check
async function verifyUserRoleLive(userId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        if (!memberRes.ok) return false;

        const memberData = await memberRes.json();
        const userRoles = memberData.roles || [];
        
        const hasStaffRole = userRoles.includes(REQUIRED_ROLE_ID);
        const isManager = userRoles.some(r => MANAGER_ROLE_IDS.includes(r));

        return {
            hasRole: hasStaffRole,
            isManager: isManager,
            roles: userRoles,
            nickname: memberData.nick || null
        };
    } catch (err) {
        console.error("Live role check error:", err);
        return false;
    }
}

// Middleware: Live Role Check
async function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: "Unauthorized: Please log in with Discord." });
    }

    const check = await verifyUserRoleLive(req.session.user.id);

    if (!check || !check.hasRole) {
        req.session.verifiedRole = false;
        return res.status(403).json({ 
            success: false, 
            error: "Access Denied: You do not currently possess the required Staff Role in Discord!" 
        });
    }

    if (check.nickname) req.session.user.displayName = check.nickname;
    req.session.user.isManager = check.isManager;

    next();
}

// Auth Routes
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
        return res.status(403).json({ 
            success: false, 
            error: `Role Check Failed: Your Discord profile is missing Staff Role ID (${REQUIRED_ROLE_ID}) or you are not in the server.` 
        });
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
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// --- SHIFT CONTROL ENDPOINTS ---

// Get all active shifts
app.get('/api/shifts/active', requireStaffAuth, (req, res) => {
    const formattedShifts = activeShifts.map(s => {
        const durationMs = Date.now() - s.startTime;
        const totalMinutes = Math.floor(durationMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        return {
            ...s,
            duration: durationStr,
            durationMs
        };
    });

    res.json({ success: true, activeShifts: formattedShifts, isManager: req.session.user.isManager });
});

// Toggle Start/End Shift
app.post('/api/shifts/toggle', requireStaffAuth, async (req, res) => {
    try {
        const { action, department } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        const timestamp = new Date().toLocaleString();

        if (action === 'CLOCK_IN') {
            // Remove existing shift if present
            activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
            activeShifts.push({
                userId: discordUser.id,
                username: discordUser.username,
                robloxName: staffRobloxName,
                avatar: discordUser.avatar,
                startTime: Date.now(),
                department: department || "General Staff"
            });
        } else {
            activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
        }

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // or application/json
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: action === 'CLOCK_IN' ? "🟢 Shift Started" : "🔴 Shift Ended",
                    color: action === 'CLOCK_IN' ? 5763719 : 15548997,
                    fields: [
                        { name: "Staff Member", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true },
                        { name: "Department", value: department || "General Staff", inline: true },
                        { name: "Time", value: timestamp, inline: false }
                    ],
                    footer: { text: "Lenaris Staff Dashboard • Planet Lenaris" }
                }]
            })
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Force End Another Staff Member's Shift (Managers Only)
app.post('/api/shifts/force-end', requireStaffAuth, async (req, res) => {
    try {
        const { targetUserId } = req.body || {};

        if (!req.session.user.isManager) {
            return res.status(403).json({ 
                success: false, 
                error: "Access Denied: You must possess a Higher-Up / Manager role to end another staff member's shift." 
            });
        }

        const targetShift = activeShifts.find(s => s.userId === targetUserId);
        if (!targetShift) {
            return res.status(404).json({ success: false, error: "Staff member is not on an active shift." });
        }

        activeShifts = activeShifts.filter(s => s.userId !== targetUserId);

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: "🛑 Shift Forceibly Ended",
                    color: 15548997,
                    fields: [
                        { name: "Staff Member", value: `${targetShift.robloxName} (<@${targetShift.userId}>)`, inline: true },
                        { name: "Ended By Manager", value: `${req.session.user.displayName} (<@${req.session.user.id}>)`, inline: true },
                        { name: "Timestamp", value: new Date().toLocaleString(), inline: false }
                    ],
                    footer: { text: "Lenaris Staff Dashboard • Management Action" }
                }]
            })
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Request Higher Up Assistance Webhook
app.post('/api/assistance/request', requireStaffAuth, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: "@everyone 🚨 **HIGHER-UP ASSISTANCE REQUESTED!**",
                embeds: [{
                    title: "🚨 Staff Assistance Requested",
                    color: 15548997,
                    fields: [
                        { name: "Requested By", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true },
                        { name: "Reason / Situation", value: reason || "Immediate higher-up assistance needed in-game/discord.", inline: false }
                    ],
                    footer: { text: "Lenaris Staff Dashboard • Emergency System" }
                }]
            })
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create Punishment Log
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

        if (punishmentType === 'Warning' && ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} You have received a warning, you now have ${currentWarningCount} warnings. If you receive 3 warnings you will be kicked. Reason: ${reason} Staff: ${staffRobloxName}`;

            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(err => console.error("Failed to send warning PM:", err));
        }

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: `⚠️ New Punishment Logged: ${logEntry.punishmentType}`,
                    color: logEntry.punishmentType === 'Ban' ? 15548997 : (logEntry.punishmentType === 'Kick' ? 16744192 : 16776960),
                    fields: [
                        { name: "Target User", value: targetUser, inline: true },
                        { name: "Roblox ID", value: logEntry.robloxId, inline: true },
                        { name: "Punishment Type", value: logEntry.punishmentType, inline: true },
                        { name: "Active Warning Count", value: `${currentWarningCount}/3`, inline: true },
                        { name: "Reason", value: reason, inline: false },
                        { name: "Logged By Staff", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true },
                        { name: "Timestamp", value: logEntry.createdAt, inline: true }
                    ],
                    footer: { text: "Lenaris Punishment System • Planet Lenaris" }
                }]
            })
        });

        res.json({ success: true, log: logEntry });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Remove Warning Endpoint
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
        if (logIndex === -1) {
            return res.status(404).json({ success: false, error: "Warning log not found." });
        }

        punishmentLogs[logIndex].removed = true;
        const targetUser = punishmentLogs[logIndex].targetUser;

        const remainingWarnings = punishmentLogs.filter(
            log => log.targetUser.toLowerCase() === targetUser.toLowerCase() && log.punishmentType === 'Warning' && !log.removed
        ).length;

        if (ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} A warning has been removed from your record by Staff: ${staffRobloxName}. You now have ${remainingWarnings} warning(s).`;
            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(() => {});
        }

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: `🟢 Warning Removed`,
                    color: 5763719,
                    fields: [
                        { name: "Target User", value: targetUser, inline: true },
                        { name: "New Active Warning Count", value: `${remainingWarnings}/3`, inline: true },
                        { name: "Removed By Staff", value: `${staffRobloxName} (<@${discordUser.id}>)`, inline: true }
                    ],
                    footer: { text: "Lenaris Punishment System • Planet Lenaris" }
                }]
            })
        });

        res.json({ success: true, remainingWarnings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/punishments/list', requireStaffAuth, (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

// ER:LC Command Endpoint
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
            res.status(500).json({ success: false, error: errData.message || "Failed to execute ER:LC command." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Server Info
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

// Activity Feed
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

// --- DISCORD BOT BOT INTEGRATION API (FOR DISCORD COMMANDS) ---
app.post('/api/discord/bot-action', async (req, res) => {
    const apiKey = req.headers['x-bot-key'];
    if (apiKey !== DISCORD_BOT_API_KEY) {
        return res.status(401).json({ success: false, error: "Invalid Bot API Key" });
    }

    const { action, userId, robloxName, department, command, targetUser, reason } = req.body || {};

    try {
        if (action === 'ACTIVE_SHIFTS') {
            return res.json({ success: true, activeShifts });
        }

        if (action === 'CLOCK_IN') {
            activeShifts = activeShifts.filter(s => s.userId !== userId);
            activeShifts.push({
                userId,
                username: robloxName,
                robloxName,
                startTime: Date.now(),
                department: department || "General Staff"
            });
            return res.json({ success: true, message: `Clocked in ${robloxName}` });
        }

        if (action === 'CLOCK_OUT') {
            activeShifts = activeShifts.filter(s => s.userId !== userId);
            return res.json({ success: true, message: `Clocked out ${robloxName}` });
        }

        if (action === 'RUN_COMMAND' && command) {
            const response = await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
            });
            return res.json({ success: response.ok });
        }

        res.status(400).json({ success: false, error: "Unknown action" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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

app.listen(PORT, () => {
    console.log(`Lenaris Staff Dashboard running on port ${PORT}`);
});
