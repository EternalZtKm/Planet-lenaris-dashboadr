const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'planet_lenaris_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Role Configurations
const MANAGEMENT_ROLES = ['1425632069479960686', '1425618591637835797'];
const STAFF_ROLE = '1427083014147407995';

// In-Memory Storage
let punishmentLogs = [];
let activeShifts = [];

// Helper: Fetch Discord User Roles
async function fetchUserRoles(accessToken) {
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        if (!guildId) return [];

        const response = await axios.get(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        return response.data.roles || [];
    } catch (err) {
        console.error("Error fetching Discord member roles:", err.response?.data || err.message);
        return [];
    }
}

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------

// Redirect to Discord OAuth
app.get('/api/auth/discord/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    const scope = encodeURIComponent('identify guilds.members.read');

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    res.redirect(discordAuthUrl);
});

// Discord OAuth Callback
app.get('/api/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=NoCode');

    try {
        // Exchange code for Access Token
        const tokenParams = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI
        });

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', tokenParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenRes.data.access_token;

        // Get Discord User Profile
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const userData = userRes.data;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` 
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        // Check Discord Roles
        const roles = await fetchUserRoles(accessToken);
        const isManager = roles.some(roleId => MANAGEMENT_ROLES.includes(roleId));
        const isStaff = isManager || roles.includes(STAFF_ROLE);

        // Store User Session
        req.session.user = {
            id: userData.id,
            username: `${userData.username}`,
            avatar: avatarUrl,
            roles: roles,
            isManager: isManager,
            verifiedRole: isStaff,
            accessToken: accessToken
        };

        res.redirect('/');
    } catch (err) {
        console.error("OAuth Callback Error:", err.response?.data || err.message);
        res.redirect('/?error=AuthFailed');
    }
});

// Fetch Current User
app.get('/api/auth/user', async (req, res) => {
    if (!req.session.user) {
        return res.json({ success: false, discordConnected: false });
    }

    // Refresh user roles on API check
    if (req.session.user.accessToken) {
        const roles = await fetchUserRoles(req.session.user.accessToken);
        req.session.user.roles = roles;
        req.session.user.isManager = roles.some(roleId => MANAGEMENT_ROLES.includes(roleId));
        req.session.user.verifiedRole = req.session.user.isManager || roles.includes(STAFF_ROLE);
    }

    res.json({
        success: true,
        discordConnected: true,
        user: req.session.user
    });
});

// Verify Roles Manually Route
app.post('/api/auth/verify-role', async (req, res) => {
    if (!req.session.user || !req.session.user.accessToken) {
        return res.status(401).json({ success: false, error: "Not logged in with Discord." });
    }

    const roles = await fetchUserRoles(req.session.user.accessToken);
    const isManager = roles.some(roleId => MANAGEMENT_ROLES.includes(roleId));
    const isStaff = isManager || roles.includes(STAFF_ROLE);

    req.session.user.roles = roles;
    req.session.user.isManager = isManager;
    req.session.user.verifiedRole = isStaff;

    if (isStaff) {
        return res.json({ success: true, isManager, isStaff });
    } else {
        return res.status(403).json({ 
            success: false, 
            error: `Role Check Failed: Missing Role (${STAFF_ROLE}).` 
        });
    }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// -------------------------------------------------------------
// ER:LC API & DASHBOARD ROUTES
// -------------------------------------------------------------

// Fetch ER:LC Players
app.get('/api/erlc/server-info', async (req, res) => {
    try {
        const apiKey = process.env.ERLC_API_KEY;
        if (!apiKey) {
            return res.json({ success: true, players: [] });
        }

        const response = await axios.get('https://api.policeroleplay.community/v1/server/players', {
            headers: { 'Server-Key': apiKey }
        });

        res.json({ success: true, players: response.data || [] });
    } catch (err) {
        res.json({ success: true, players: [] });
    }
});

// Fetch ER:LC Command/Activity Logs
app.get('/api/erlc/activity', async (req, res) => {
    try {
        const apiKey = process.env.ERLC_API_KEY;
        if (!apiKey) {
            return res.json({ success: true, logs: [] });
        }

        const response = await axios.get('https://api.policeroleplay.community/v1/server/commandlogs', {
            headers: { 'Server-Key': apiKey }
        });

        res.json({ success: true, logs: response.data || [] });
    } catch (err) {
        res.json({ success: true, logs: [] });
    }
});

// Run ER:LC Command
app.post('/api/erlc/command', async (req, res) => {
    if (!req.session.user || !req.session.user.verifiedRole) {
        return res.status(403).json({ success: false, error: 'Unauthorized staff action.' });
    }

    const { command } = req.body;
    try {
        const apiKey = process.env.ERLC_API_KEY;
        if (apiKey) {
            await axios.post('https://api.policeroleplay.community/v1/server/command', 
                { command }, 
                { headers: { 'Server-Key': apiKey } }
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to execute command.' });
    }
});

// -------------------------------------------------------------
// SHIFT MANAGEMENT
// -------------------------------------------------------------

app.get('/api/shifts/active', (req, res) => {
    const isManager = req.session.user?.isManager || false;
    res.json({ success: true, activeShifts, isManager });
});

app.post('/api/shifts/toggle', (req, res) => {
    if (!req.session.user || !req.session.user.verifiedRole) {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const userId = req.session.user.id;
    const { action, department } = req.body;

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => s.userId !== userId);
        activeShifts.push({
            userId,
            robloxName: req.session.user.username,
            department: department || 'Staff Moderation',
            startTime: new Date(),
            duration: 'Just Started'
        });
    } else {
        activeShifts = activeShifts.filter(s => s.userId !== userId);
    }

    res.json({ success: true });
});

app.post('/api/shifts/force-end', (req, res) => {
    if (!req.session.user || (!req.session.user.isManager && req.body.targetUserId !== req.session.user.id)) {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const { targetUserId } = req.body;
    activeShifts = activeShifts.filter(s => s.userId !== targetUserId);
    res.json({ success: true });
});

// -------------------------------------------------------------
// PUNISHMENT LOGS
// -------------------------------------------------------------

app.get('/api/punishments/list', (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

app.post('/api/punishments/create', (req, res) => {
    if (!req.session.user || !req.session.user.verifiedRole) {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const { targetUser, robloxId, punishmentType, reason } = req.body;
    const newLog = {
        id: Date.now(),
        targetUser,
        robloxId: robloxId || 'N/A',
        punishmentType,
        reason,
        staffName: req.session.user.username,
        removed: false,
        createdAt: new Date().toISOString()
    };

    punishmentLogs.unshift(newLog);
    res.json({ success: true });
});

app.post('/api/punishments/remove-warning', (req, res) => {
    if (!req.session.user || !req.session.user.verifiedRole) {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const { logId } = req.body;
    const log = punishmentLogs.find(l => l.id === logId);
    if (log && log.punishmentType === 'Warning') {
        log.removed = true;
    }

    res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Planet Lenaris Server listening on port ${PORT}`);
});
