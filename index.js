const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Discord Application Details (from Render Env Variables)
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Your Discord Server ID
const REQUIRED_ROLE_ID = "1427083014147407995";
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:3000/api/auth/discord/callback";

const DISCORD_WEBHOOK = "https://discord.com/api/v10/webhooks/1521283484021162146/4M4gKnNPOUGKL-d-FEE02pbnno3PwkKWvUgIs0LODYxOVwSx6uZ6Qfk-K641-SmDhApg";
const ERLC_API_KEY = process.env.ERLC_API_KEY || "";

const punishmentLogs = [];

app.use(cors());
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'planet-lenaris-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 } // 24 Hours
}));

app.use(express.static(path.join(__dirname, 'public')));

// Middleware to protect API endpoints
function requireStaffAuth(req, res, next) {
    if (!req.session.user || !req.session.hasRole) {
        return res.status(401).json({ success: false, error: "Unauthorized: You must log in with Discord and hold the required staff role." });
    }
    next();
}

// 1. Redirect to Discord OAuth2 Login
app.get('/api/auth/discord/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// 2. Discord OAuth2 Callback Handler
app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=NoCode');

    try {
        // Exchange Code for Access Token
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
        if (!tokenData.access_token) return res.redirect('/?error=TokenExchangeFailed');

        // Get Discord User Profile
        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        // Check if user has required Role ID in Guild using Bot Token
        const guildMemberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userData.id}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });

        if (!guildMemberRes.ok) {
            return res.redirect('/?error=NotInServer');
        }

        const memberData = await guildMemberRes.json();
        const hasRole = memberData.roles && memberData.roles.includes(REQUIRED_ROLE_ID);

        if (!hasRole) {
            return res.redirect('/?error=MissingStaffRole');
        }

        // Save session
        req.session.user = {
            id: userData.id,
            username: userData.global_name || userData.username,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
        req.session.hasRole = true;

        res.redirect('/');
    } catch (err) {
        console.error("OAuth Error:", err);
        res.redirect('/?error=AuthError');
    }
});

// 3. Get Current Logged-In User Status
app.get('/api/auth/user', (req, res) => {
    if (req.session.user && req.session.hasRole) {
        return res.json({ success: true, user: req.session.user });
    }
    res.json({ success: false });
});

// 4. Logout Route
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- PROTECTED ROUTES ---

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
                    footer: { text: "Melonly Staff Panel • Planet Lenaris" }
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
                    footer: { text: "Melonly Punishment System • Planet Lenaris" }
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
    console.log(`Melonly Staff Panel running on port ${PORT}`);
});
