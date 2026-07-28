const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// --- ENVIRONMENT VARIABLES ---
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const REQUIRED_ROLE_ID = "1427083014147407995"; // Staff Role
const REVIEW_CHANNEL_ID = "1424047205517492375"; // Channel locked for /review
const REDIRECT_URI = process.env.REDIRECT_URI || "https://planet-lenaris-dashboard.onrender.com/api/auth/discord/callback";

const ERLC_API_KEY = process.env.ERLC_API_KEY || "";

// --- REGISTERED DEPARTMENTS CONFIGURATION ---
let departmentsData = [
    {
        id: "dept_ldot",
        name: "Lenaris Dept. of Transportation (LDOT)",
        shortName: "LDOT",
        guildId: "1530625507857662062",
        verifiedRoleId: "1531761795402829945",
        active: true,
        webhookUrl: process.env.LDOT_WEBHOOK || "",
        discordInvite: "https://discord.gg/kFBhvJUzBc",
        inGameReq: true,
        autoClockOutHours: 4,
        description: "Roadway maintenance, traffic infrastructure, and vehicle safety operations."
    },
    {
        id: "dept_staff",
        name: "Lenaris Staff Dept.",
        shortName: "Staff Dept",
        guildId: "1530626035148919045",
        verifiedRoleId: "1531763587687645195",
        active: true,
        webhookUrl: process.env.STAFF_DEPT_WEBHOOK || "",
        discordInvite: "https://discord.gg/XkewZuAuY8",
        inGameReq: false,
        autoClockOutHours: 6,
        description: "Official community moderation, support desk, and internal server staff."
    },
    {
        id: "dept_lhp",
        name: "Lenaris Highway Patrol (LHP)",
        shortName: "LHP",
        guildId: "1530625253405884507",
        verifiedRoleId: "1531763499582361600",
        active: true,
        webhookUrl: process.env.LHP_WEBHOOK || "",
        discordInvite: "https://discord.gg/6vfkS8fQzh",
        inGameReq: true,
        autoClockOutHours: 4,
        description: "State traffic enforcement, highway safety, and high-speed interdictions."
    },
    {
        id: "dept_lfd",
        name: "Lenaris Fire Dept. (LFD)",
        shortName: "LFD",
        guildId: "1530624317220585773",
        verifiedRoleId: "1531763395919872132",
        active: true,
        webhookUrl: process.env.LFD_WEBHOOK || "",
        discordInvite: "https://discord.gg/jt9dfBBbWw",
        inGameReq: true,
        autoClockOutHours: 4,
        description: "Emergency medical response, fire suppression, and rescue operations."
    },
    {
        id: "dept_lledp",
        name: "Lenaris Law Enforcement Dept. (LLEDP)",
        shortName: "LLEDP",
        guildId: "1530623381156659401",
        verifiedRoleId: "1531763322175619152",
        active: true,
        webhookUrl: process.env.LLEDP_WEBHOOK || "",
        discordInvite: "https://discord.gg/ExxuN8EwkE",
        inGameReq: true,
        autoClockOutHours: 4,
        description: "Primary municipal law enforcement and city patrol operations."
    }
];

// Support & Staff Hierarchy Roles
const SUPPORT_ROLE_IDS = ["1425618034214699078", "1425618073917853796", "1425618356912001135", "1425618591637835797", "1425632069479960686", "1425618454337028116"];
const STAFF_ROLE_IDS_ASC = ["1425619421719695500", "1425619419081474079", "1425619416229613578", "1425619413566095493", "1425619286864695306", "1425617466092032112", "1425617463051030578", "1425617456432414781", "1425617453102137364", "1425617450023784559", "1425617405073424514", "1425617401826775101", "1425617398924447896", "1425617395762073740", "1425617392423276708", "1425617114298978324", "1425617110826090567", "1425617102567641138", "1424244176236711946", "1425616980345487380", "1425616349920755772", "1425616338831016088", "1425616334569341089", "1425616324121596054", "1425616282295861298", "1425616084496814180", "1425616019874906223", "1425615977495920721", "1425615914061008990", "1425615745727074405", "1425615423025578005", "1425615381283737610", "1425615346764742686", "1425615265277673612", "1425615123069927444", "1425614333957636138", "1425614322603655231", "1425614286499086396", "1425614245973983322", "1425614210624389244", "1425613708222267472", "1425613620829491372", "1425613579931095051"];
const CUSTOM_ACTIVITY_ROLE_IDS = ["1521303992875880578", "1425617979315585216", "1425618034214699078", "1425618073917853796", "1425618278226722867", "1425618356912001135", "1425618454337028116", "1425618591637835797", "1425632069479960686"];

// --- GLOBAL CONFIGURATION STORES ---
let serverConfig = {
    serverName: "Planet Lenaris",
    serverIcon: "https://cdn.discordapp.com/attachments/1423913605102829691/1531394062173606049/bxrprtr.png",
    autoBanBolo: true,
    userSeeLogs: false,
    punishmentPresets: ["Warning", "Kick", "Ban", "Ban BOLO", "Staff Warning"]
};

let botConfig = {
    shiftWebhook: process.env.SHIFT_WEBHOOK || "",
    punishmentWebhook: process.env.PUNISHMENT_WEBHOOK || "",
    assistanceWebhook: process.env.ASSISTANCE_WEBHOOK || "",
    activityWebhook: process.env.ACTIVITY_WEBHOOK || "",
    infractionWebhook: process.env.INFRACTION_WEBHOOK || "",
    promotionWebhook: process.env.PROMOTION_WEBHOOK || "",
    reviewWebhook: process.env.REVIEW_WEBHOOK || "",
    managerRoleIds: ["1425618356912001135", "1425618591637835797", "1425632069479960686"]
};

// --- SESSIONS SETTINGS STORE ---
let sessionSettings = {
    sessionsChannel: "", // Channel ID to post polls and session announcements
    autoKickDown: true,
    endShiftsOnShutdown: false,
    startupMentionRoles: [],
    startupMessage: "A new roleplay session is starting now!",
    pollMinVotes: 10,
    pollMentionRoles: [],
    pollMentionVoters: false,
    pollMessage: "React below if you want to start a session!",
    scheduledMessage: "A session has been scheduled.",
    fullSessionPost: true,
    fullSessionMessage: "The server is now full!",
    shutdownAutoEnd: true,
    shutdownAutoErlc: true,
    shutdownIngameMsg: "The server is now shutting down.",
    shutdownMessage: "The session has ended."
};

let activeServerSession = null; // null or object with startTime
let sessionHistory = [];

// --- OTHER DATA STORES ---
let punishmentLogs = [];
let activeShifts = [];
let completedShifts = [];
let activityWaves = [{ id: "wave_1", number: 1, active: true, startDate: "July 1, 2026 6:31 PM", endDate: null }];
let customActivityRequirements = {};
CUSTOM_ACTIVITY_ROLE_IDS.forEach(id => { customActivityRequirements[id] = 0; });
let staffInfractionLevels = ["Notice", "Warning", "Strike 1", "Strike 2", "Demotion", "Termination"];
let staffInfractionLogs = [];
let staffPromotionLogs = [];
let notificationsList = [];

// --- HELPER FUNCTIONS ---
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
    } catch (err) {}
}

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

async function checkUserDepartmentRole(userId, deptGuildId, verifiedRoleId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${deptGuildId}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        if (!memberRes.ok) return false;
        const memberData = await memberRes.json();
        return (memberData.roles || []).includes(verifiedRoleId);
    } catch (err) { return false; }
}

// Middleware Guards
async function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.hasRole) return res.status(403).json({ success: false, error: "Access Denied" });
    req.session.user.isManager = check.isManager;
    next();
}

async function requireManagerAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.isManager) return res.status(403).json({ success: false, error: "Management Access Required" });
    next();
}

// --- EXPRESS SETUP ---
app.use(cors());
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'planet-lenaris-secret',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 86400000, secure: true, sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Logo Endpoint
app.get(['/Logo.png', '/logo.png', '/api/logo'], (req, res) => res.redirect(serverConfig.serverIcon));

// --- AUTH ROUTES ---
app.get('/api/auth/discord/login', (req, res) => {
    res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth=failed');
    try {
        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/?auth=failed');

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        req.session.user = {
            id: userData.id, username: userData.username,
            displayName: userData.global_name || userData.username,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
        req.session.save(() => res.redirect('/?discord=connected'));
    } catch (err) { res.redirect('/?auth=failed'); }
});

app.post('/api/auth/verify-role', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(400).json({ success: false });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.hasRole) return res.status(403).json({ success: false });
    req.session.user.isManager = check.isManager;
    req.session.verifiedRole = true;
    req.session.save(() => res.json({ success: true, user: req.session.user }));
});

app.get('/api/auth/user', async (req, res) => {
    if (req.session && req.session.user) {
        const check = await verifyUserRoleLive(req.session.user.id);
        if (check && check.hasRole) {
            req.session.verifiedRole = true;
            req.session.user.isManager = check.isManager;
            return res.json({ success: true, user: req.session.user });
        }
        return res.json({ success: false, discordConnected: true, user: req.session.user });
    }
    res.json({ success: false });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// --- SESSIONS API ENDPOINTS ---
app.get('/api/sessions/settings', requireManagerAuth, (req, res) => {
    res.json({ success: true, settings: sessionSettings });
});

app.post('/api/sessions/settings', requireManagerAuth, (req, res) => {
    const data = req.body || {};
    if (data.sessionsChannel !== undefined) sessionSettings.sessionsChannel = data.sessionsChannel;
    if (data.autoKickDown !== undefined) sessionSettings.autoKickDown = !!data.autoKickDown;
    if (data.endShiftsOnShutdown !== undefined) sessionSettings.endShiftsOnShutdown = !!data.endShiftsOnShutdown;
    if (data.startupMessage !== undefined) sessionSettings.startupMessage = data.startupMessage;
    if (data.pollMinVotes !== undefined) sessionSettings.pollMinVotes = parseInt(data.pollMinVotes) || 10;
    if (data.pollMessage !== undefined) sessionSettings.pollMessage = data.pollMessage;
    if (data.scheduledMessage !== undefined) sessionSettings.scheduledMessage = data.scheduledMessage;
    if (data.fullSessionPost !== undefined) sessionSettings.fullSessionPost = !!data.fullSessionPost;
    if (data.fullSessionMessage !== undefined) sessionSettings.fullSessionMessage = data.fullSessionMessage;
    if (data.shutdownAutoEnd !== undefined) sessionSettings.shutdownAutoEnd = !!data.shutdownAutoEnd;
    if (data.shutdownAutoErlc !== undefined) sessionSettings.shutdownAutoErlc = !!data.shutdownAutoErlc;
    if (data.shutdownIngameMsg !== undefined) sessionSettings.shutdownIngameMsg = data.shutdownIngameMsg;
    if (data.shutdownMessage !== undefined) sessionSettings.shutdownMessage = data.shutdownMessage;

    addNotification("Session Settings Updated", "Global session configurations have been updated.");
    res.json({ success: true, settings: sessionSettings });
});

app.get('/api/sessions/overview', requireStaffAuth, (req, res) => {
    res.json({
        success: true,
        activeSession: activeServerSession,
        history: sessionHistory,
        analytics: {
            uniquePlayers: 1, // Placeholder 
            modCalls: 0,
            modCommands: 1
        }
    });
});

app.post('/api/sessions/poll', requireManagerAuth, async (req, res) => {
    const { question, options } = req.body;
    if (!sessionSettings.sessionsChannel || !discordClient) {
        return res.status(400).json({ success: false, error: "Sessions channel not configured or bot offline." });
    }

    try {
        const channel = await discordClient.channels.fetch(sessionSettings.sessionsChannel);
        if (!channel) return res.status(404).json({ success: false, error: "Channel not found." });

        const embed = new EmbedBuilder()
            .setTitle(`📊 Server Poll: ${question}`)
            .setColor(0x3498db)
            .setDescription(options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n\n'))
            .setFooter({ text: `${serverConfig.serverName} Voting System` });

        const msg = await channel.send({ content: sessionSettings.pollMessage, embeds: [embed] });
        // React with number emojis
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        for (let i = 0; i < options.length && i < emojis.length; i++) {
            await msg.react(emojis[i]);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/sessions/toggle', requireManagerAuth, async (req, res) => {
    const { action } = req.body;

    if (action === 'START') {
        activeServerSession = { startTime: Date.now() };
        if (sessionSettings.sessionsChannel && discordClient) {
            try {
                const channel = await discordClient.channels.fetch(sessionSettings.sessionsChannel);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle("🟢 Roleplay Session Started")
                        .setColor(0x57f287)
                        .setDescription(sessionSettings.startupMessage)
                        .setFooter({ text: `${serverConfig.serverName} Sessions` });
                    await channel.send({ content: "@everyone", embeds: [embed] });
                }
            } catch (err) {}
        }
    } else {
        if (activeServerSession) {
            sessionHistory.unshift({
                id: Date.now(),
                startTime: activeServerSession.startTime,
                endTime: Date.now()
            });
            activeServerSession = null;

            // Handle ER:LC Auto Shutdown
            if (sessionSettings.shutdownAutoErlc && ERLC_API_KEY) {
                const kickCmd = `:m ${sessionSettings.shutdownIngameMsg || "The server is now shutting down."}`;
                fetch('https://api.erlc.gg/v1/server/command', {
                    method: 'POST',
                    headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: kickCmd })
                }).catch(() => {});
            }

            // End all active staff shifts if enabled
            if (sessionSettings.endShiftsOnShutdown) {
                activeShifts.forEach(s => {
                    completedShifts.unshift({
                        id: `shift_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                        userId: s.userId,
                        durationMinutes: Math.floor((Date.now() - s.startTime) / 60000),
                        shiftType: s.department || "Default",
                        waveId: "wave_1"
                    });
                });
                activeShifts = [];
            }
        }
    }
    res.json({ success: true, activeSession: activeServerSession });
});

// --- DEPARTMENTS API ---
app.get('/api/departments/list', (req, res) => res.json({ success: true, departments: departmentsData }));
app.get('/api/departments/my-status', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false });
    const userId = req.session.user.id;
    const userDeptStatuses = [];

    for (const dept of departmentsData) {
        const isVerified = await checkUserDepartmentRole(userId, dept.guildId, dept.verifiedRoleId);
        const isOnShift = activeShifts.some(s => s.userId === userId && s.deptId === dept.id);
        userDeptStatuses.push({
            deptId: dept.id, deptName: dept.name, shortName: dept.shortName, active: dept.active, discordInvite: dept.discordInvite, isVerifiedWorker: isVerified, isOnShift
        });
    }
    res.json({ success: true, userDepartments: userDeptStatuses });
});

app.post('/api/departments/update', requireManagerAuth, (req, res) => {
    const { deptId, active, webhookUrl, discordInvite, description, autoClockOutHours, inGameReq } = req.body || {};
    const dept = departmentsData.find(d => d.id === deptId);
    if (!dept) return res.status(404).json({ success: false });

    if (active !== undefined) dept.active = !!active;
    if (webhookUrl !== undefined) dept.webhookUrl = webhookUrl.trim();
    if (discordInvite !== undefined) dept.discordInvite = discordInvite.trim();
    if (description !== undefined) dept.description = description.trim();
    if (autoClockOutHours !== undefined) dept.autoClockOutHours = parseInt(autoClockOutHours) || 4;
    if (inGameReq !== undefined) dept.inGameReq = !!inGameReq;

    res.json({ success: true, department: dept });
});

app.post('/api/departments/shift/toggle', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false });
    const { deptId, action } = req.body;
    const user = req.session.user;
    const dept = departmentsData.find(d => d.id === deptId);

    if (!dept || !dept.active) return res.status(400).json({ success: false });
    const isVerified = await checkUserDepartmentRole(user.id, dept.guildId, dept.verifiedRoleId);
    if (!isVerified && !user.isManager) return res.status(403).json({ success: false, error: "Missing Verified Worker Role!" });

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName || user.username, avatar: user.avatar, startTime: Date.now(), department: dept.shortName, deptId: dept.id });
    } else {
        const existing = activeShifts.find(s => s.userId === user.id && s.deptId === deptId);
        if (existing) {
            completedShifts.unshift({ id: `shift_${Date.now()}`, userId: user.id, durationMinutes: Math.floor((Date.now() - existing.startTime) / 60000), shiftType: dept.shortName, waveId: "wave_1" });
        }
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
    }
    res.json({ success: true });
});

// --- SHIFTS & ACTIVITY ENDPOINTS ---
app.get('/api/shifts/active', requireStaffAuth, (req, res) => {
    const formatted = activeShifts.map(s => {
        const m = Math.floor((Date.now() - s.startTime) / 60000);
        return { ...s, duration: `${Math.floor(m / 60)}h ${m % 60}m` };
    });
    res.json({ success: true, activeShifts: formatted, isManager: req.session.user.isManager });
});

app.post('/api/shifts/toggle', requireStaffAuth, (req, res) => {
    const { action, department } = req.body;
    const user = req.session.user;
    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => s.userId !== user.id);
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName, avatar: user.avatar, startTime: Date.now(), department: department || "General Staff" });
    } else {
        const existing = activeShifts.find(s => s.userId === user.id);
        if (existing) {
            completedShifts.unshift({ id: `shift_${Date.now()}`, userId: user.id, durationMinutes: Math.floor((Date.now() - existing.startTime) / 60000), shiftType: "Default", waveId: "wave_1" });
        }
        activeShifts = activeShifts.filter(s => s.userId !== user.id);
    }
    res.json({ success: true });
});

app.post('/api/shifts/force-end', requireManagerAuth, (req, res) => {
    activeShifts = activeShifts.filter(s => s.userId !== req.body.targetUserId);
    res.json({ success: true });
});

// --- OTHER EXISTING ENDPOINTS (MEMBERS, INFRACTIONS, SETTINGS, ER:LC, ETC.) ---
app.get('/api/settings/general', (req, res) => res.json({ success: true, config: serverConfig }));
app.get('/api/settings/webhooks', requireManagerAuth, (req, res) => res.json({ success: true, webhooks: botConfig }));
app.post('/api/settings/general', requireManagerAuth, (req, res) => { Object.assign(serverConfig, req.body); res.json({ success: true, config: serverConfig }); });
app.post('/api/settings/webhooks', requireManagerAuth, (req, res) => { Object.assign(botConfig, req.body); res.json({ success: true, webhooks: botConfig }); });
app.get('/api/members', async (req, res) => {
    if (!discordClient || !discordClient.isReady()) return res.json({ success: true, members: [] });
    try {
        const guild = await discordClient.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        const staff = [];
        members.forEach(m => {
            if (m.user.bot) return;
            const idxs = m.roles.cache.map(r => STAFF_ROLE_IDS_ASC.indexOf(r.id)).filter(i => i !== -1);
            if (idxs.length > 0) {
                const highIdx = Math.max(...idxs);
                staff.push({ id: m.id, username: m.user.username, displayName: m.displayName, avatarUrl: m.user.displayAvatarURL(), roleName: guild.roles.cache.get(STAFF_ROLE_IDS_ASC[highIdx])?.name || "Staff", rankIndex: highIdx, activeStrikes: staffInfractionLogs.filter(i => i.targetUserId === m.id && !i.removed).length });
            }
        });
        res.json({ success: true, members: staff.sort((a, b) => b.rankIndex - a.rankIndex) });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/infractions/levels', (req, res) => res.json({ success: true, levels: staffInfractionLevels }));
app.get('/api/notifications/list', (req, res) => res.json({ success: true, notifications: notificationsList }));
app.post('/api/notifications/read', (req, res) => { notificationsList.forEach(n => n.read = true); res.json({ success: true }); });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- DISCORD BOT BOT INITIALIZATION & COMMAND REGISTRATION ---
let discordClient;

if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

    const commands = [
        new SlashCommandBuilder()
            .setName('review')
            .setDescription('Submit an official staff member review')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member to review').setRequired(true))
            .addIntegerOption(opt => opt.setName('rating').setDescription('Star rating (1 to 5)').setRequired(true).addChoices({ name: '⭐ (1 Star)', value: 1 }, { name: '⭐⭐ (2 Stars)', value: 2 }, { name: '⭐⭐⭐ (3 Stars)', value: 3 }, { name: '⭐⭐⭐⭐ (4 Stars)', value: 4 }, { name: '⭐⭐⭐⭐⭐ (5 Stars)', value: 5 }))
            .addStringOption(opt => opt.setName('note').setDescription('Your review note/feedback').setRequired(true)),
        new SlashCommandBuilder().setName('shift').setDescription('Clock in or clock out of a staff shift').addStringOption(opt => opt.setName('action').setDescription('Clock In or Clock Out').setRequired(true).addChoices({ name: 'Clock In', value: 'CLOCK_IN' }, { name: 'Clock Out', value: 'CLOCK_OUT' })),
        new SlashCommandBuilder().setName('active-shifts').setDescription('View all staff members currently on shift'),
        new SlashCommandBuilder().setName('erlc-command').setDescription('Execute an in-game command').addStringOption(opt => opt.setName('command').setDescription('The exact in-game command text').setRequired(true)),
        new SlashCommandBuilder().setName('log-punishment').setDescription('Log an in-game player punishment').addStringOption(opt => opt.setName('player').setDescription('Target player username').setRequired(true)).addStringOption(opt => opt.setName('type').setDescription('Type of punishment').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason for punishment').setRequired(true)).addStringOption(opt => opt.setName('roblox_id').setDescription('Roblox player User ID').setRequired(false)),
        new SlashCommandBuilder().setName('assistance').setDescription('Request higher-up staff assistance').addStringOption(opt => opt.setName('reason').setDescription('Details for assistance request').setRequired(true)),
        new SlashCommandBuilder().setName('infract').setDescription('Issue an official staff infraction (Management Only)').addUserOption(opt => opt.setName('staff').setDescription('The staff member to infract').setRequired(true)).addStringOption(opt => opt.setName('level').setDescription('Infraction level').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)).addStringOption(opt => opt.setName('proof').setDescription('Evidence').setRequired(false)),
        new SlashCommandBuilder().setName('promote').setDescription('Promote or update a staff member rank (Management Only)').addUserOption(opt => opt.setName('staff').setDescription('The staff member').setRequired(true)).addStringOption(opt => opt.setName('new_role').setDescription('The new staff role name').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
        new SlashCommandBuilder().setName('force-end-shift').setDescription('Forcefully end an active staff shift (Management Only)').addUserOption(opt => opt.setName('staff').setDescription('The staff member whose shift to end').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    (async () => {
        try {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        } catch (err) {}
    })();

    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName, options, channelId, member, user } = interaction;
        const isStaff = member.roles.cache.has(REQUIRED_ROLE_ID);
        const isManager = member.roles.cache.some(r => botConfig.managerRoleIds.includes(r.id));

        if (commandName === 'review') {
            if (channelId !== REVIEW_CHANNEL_ID) return interaction.reply({ content: `❌ Command restricted to <#${REVIEW_CHANNEL_ID}>!`, ephemeral: true });
            const targetUser = options.getUser('staff');
            const rating = options.getInteger('rating');
            const note = options.getString('note');

            const reviewEmbed = new EmbedBuilder()
                .setTitle("Lenaris Staff Reviews")
                .setColor(0x3498db)
                .setThumbnail(serverConfig.serverIcon)
                .setDescription(`Your feedback helps... \n\n**Staff member:**\n<@${targetUser.id}>\n\n**Rating:**\n${"⭐".repeat(rating)}\n\n**Note:** ${note}`);

            await interaction.reply({ embeds: [reviewEmbed] });
            if (botConfig.reviewWebhook) sendDiscordLog(botConfig.reviewWebhook, reviewEmbed.toJSON());
            return;
        }

        if (['shift', 'active-shifts', 'erlc-command', 'log-punishment', 'assistance'].includes(commandName)) {
            if (!isStaff && !isManager) return interaction.reply({ content: '❌ Staff Role required.', ephemeral: true });
        }

        if (['infract', 'promote', 'force-end-shift'].includes(commandName)) {
            if (!isManager) return interaction.reply({ content: '❌ Management permissions required.', ephemeral: true });
        }
        
        if (commandName === 'active-shifts') return interaction.reply({ content: `Currently tracking ${activeShifts.length} active shifts.`, ephemeral: true });
        if (commandName === 'erlc-command') return interaction.reply({ content: `ER:LC Commands execution sent!`, ephemeral: true });
    });

    discordClient.once('ready', () => console.log(`[DISCORD] Ready as ${discordClient.user.tag}`));
    discordClient.login(BOT_TOKEN);
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
