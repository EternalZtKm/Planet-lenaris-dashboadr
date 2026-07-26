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

// Middleware
function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.user || !req.session.verifiedRole) {
        return res.status(401).json({ success: false, error: "Unauthorized: Please verify your staff role first." });
    }
    next();
}

// 1. Step 1: Redirect to Discord Login
app.get('/api/auth/discord/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

// 2. Step 2: Discord OAuth Callback
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

// 3. Step 3: Explicit Manual Role Verification
app.post('/api/auth/verify-role', async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(400).json({ success: false, error: "Please connect your Discord account first." });
    }

    try {
        const userId = req.session.user.id;

        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        if (!memberRes.ok) {
            return res.status(403).json({ 
                success: false, 
                error: "You are not in the Planet Lenaris Discord server, or the Bot cannot see you!" 
            });
        }

        const memberData = await memberRes.json();
        const hasRole = memberData.roles && memberData.roles.includes(REQUIRED_ROLE_ID);

        if (!hasRole) {
            return res.status(403).json({ 
                success: false, 
                error: `Role Check Failed: Your Discord profile is missing Staff Role ID (${REQUIRED_ROLE_ID}).` 
            });
        }

        req.session.verifiedRole = true;
        req.session.save(() => {
            res.json({ success: true, user: req.session.user });
        });

    } catch (err) {
        res.status(500).json({ success: false, error: "Internal error checking role: " + err.message });
    }
});

// 4. Session Check Endpoint
app.get('/api/auth/user', (req, res) => {
    if (req.session && req.session.user && req.session.verifiedRole) {
        return res.json({ success: true, user: req.session.user });
    } else if (req.session && req.session.user) {
        return res.json({ success: false, discordConnected: true, user: req.session.user });
    }
    res.json({ success: false });
});

// 5. Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// --- PROTECTED DASHBOARD ENDPOINTS ---

app.post('/api/shifts/toggle', requireStaffAuth, async (req, res) => {
    try {
        const { action, department } = req.body || {};
        const staffName = req.session.user.username;
        const timestamp = new Date().toLocaleString();

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: action === 'CLOCK_IN' ? "🟢 Shift Started" : "🔴 Shift Ended",
                    color: action === 'CLOCK_IN' ? 5763719 : 15548997,
                    fields: [
                        { name: "Staff Member", value: `${staffName} (<@${req.session.user.id}>)`, inline: true },
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

app.post('/api/punishments/create', requireStaffAuth, async (req, res) => {
    try {
        const { targetUser, robloxId, punishmentType, reason } = req.body || {};
        const staffName = req.session.user.username;

        const logEntry = {
            id: punishmentLogs.length + 1,
            targetUser,
            robloxId: robloxId || 'N/A',
            punishmentType: punishmentType || 'Warning',
            reason,
            staffName,
            createdAt: new Date().toLocaleString()
        };

        punishmentLogs.unshift(logEntry);

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
                        { name: "Reason", value: reason, inline: false },
                        { name: "Logged By Staff", value: `${staffName} (<@${req.session.user.id}>)`, inline: true },
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

app.get('/api/punishments/list', requireStaffAuth, (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

app.post('/api/erlc/command', requireStaffAuth, async (req, res) => {
    try {
        const { command } = req.body || {};
        if (!ERLC_API_KEY) return res.status(500).json({ success: false, error: "ERLC_API_KEY missing." });

        const response = await fetch('https://api.policeroleplay.community/v1/server/command', {
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Lenaris Staff Dashboard running on port ${PORT}`);
});
