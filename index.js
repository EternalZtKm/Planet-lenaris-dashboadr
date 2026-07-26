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

const punishmentLogs = [];

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

// Helper: Live Role Check
async function verifyUserRoleLive(userId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        if (!memberRes.ok) return false;

        const memberData = await memberRes.json();
        return {
            hasRole: memberData.roles && memberData.roles.includes(REQUIRED_ROLE_ID),
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

    if (check.nickname) {
        req.session.user.displayName = check.nickname;
    }

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

    if (check.nickname) {
        req.session.user.displayName = check.nickname;
    }

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

// Dashboard Endpoints
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

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
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

// Create Punishment / Warning
app.post('/api/punishments/create', requireStaffAuth, async (req, res) => {
    try {
        const { targetUser, robloxId, punishmentType, reason } = req.body || {};
        const discordUser = req.session.user;

        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim();
        }

        // Count active warnings for target user
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

        // Send Formatted Warning PM to Player
        if (punishmentType === 'Warning' && ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} You have received a warning, you now have ${currentWarningCount} warnings. If you receive 3 warnings you will be kicked. Reason: ${reason} Staff: ${staffRobloxName}`;

            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(err => console.error("Failed to send warning PM:", err));
        }

        // Discord Webhook
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

        // Recalculate remaining active warnings
        const remainingWarnings = punishmentLogs.filter(
            log => log.targetUser.toLowerCase() === targetUser.toLowerCase() && log.punishmentType === 'Warning' && !log.removed
        ).length;

        // Send PM in-game notifying of warning removal
        if (ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} A warning has been removed from your record by Staff: ${staffRobloxName}. You now have ${remainingWarnings} warning(s).`;
            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(() => {});
        }

        // Webhook notification for removal
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

app.get('/api/erlc/players', requireStaffAuth, async (req, res) => {
    try {
        if (!ERLC_API_KEY) return res.json({ success: false, players: [] });

        const response = await fetch('https://api.erlc.gg/v1/server/players', {
            headers: { 'Server-Key': ERLC_API_KEY }
        });

        if (!response.ok) return res.json({ success: false, players: [] });

        const players = await response.json();
        res.json({ success: true, players: Array.isArray(players) ? players : [] });
    } catch (err) {
        res.json({ success: false, players: [] });
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
