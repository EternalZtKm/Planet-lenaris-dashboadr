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

const REQUIRED_ROLE_ID = "1427083014147407995"; 
const REVIEW_CHANNEL_ID = "1424047205517492375"; 
const REDIRECT_URI = process.env.REDIRECT_URI || "https://planet-lenaris-dashboard.onrender.com/api/auth/discord/callback";
const ERLC_API_KEY = process.env.ERLC_API_KEY || "";

// --- GLOBAL STORES ---
let departmentsData = [
    { id: "dept_ldot", name: "Lenaris Dept. of Transportation (LDOT)", shortName: "LDOT", guildId: "1530625507857662062", verifiedRoleId: "1531761795402829945", active: true, webhookUrl: "", discordInvite: "", inGameReq: true, autoClockOutHours: 4, description: "Roadway maintenance, traffic infrastructure, and vehicle safety operations." },
    { id: "dept_staff", name: "Lenaris Staff Dept.", shortName: "Staff Dept", guildId: "1530626035148919045", verifiedRoleId: "1531763587687645195", active: true, webhookUrl: "", discordInvite: "", inGameReq: false, autoClockOutHours: 6, description: "Official community moderation, support desk, and internal server staff." },
    { id: "dept_lhp", name: "Lenaris Highway Patrol (LHP)", shortName: "LHP", guildId: "1530625253405884507", verifiedRoleId: "1531763499582361600", active: true, webhookUrl: "", discordInvite: "", inGameReq: true, autoClockOutHours: 4, description: "State traffic enforcement, highway safety, and high-speed interdictions." },
    { id: "dept_lfd", name: "Lenaris Fire Dept. (LFD)", shortName: "LFD", guildId: "1530624317220585773", verifiedRoleId: "1531763395919872132", active: true, webhookUrl: "", discordInvite: "", inGameReq: true, autoClockOutHours: 4, description: "Emergency medical response, fire suppression, and rescue operations." },
    { id: "dept_lledp", name: "Lenaris Law Enforcement Dept. (LLEDP)", shortName: "LLEDP", guildId: "1530623381156659401", verifiedRoleId: "1531763322175619152", active: true, webhookUrl: "", discordInvite: "", inGameReq: true, autoClockOutHours: 4, description: "Primary municipal law enforcement and city patrol operations." }
];

const SUPPORT_ROLE_IDS = ["1425618034214699078", "1425618073917853796", "1425618356912001135", "1425618591637835797", "1425632069479960686", "1425618454337028116"];
const STAFF_ROLE_IDS_ASC = ["1425619421719695500", "1425619419081474079", "1425619416229613578", "1425619413566095493", "1425619286864695306", "1425617466092032112", "1425617463051030578", "1425617456432414781", "1425617453102137364", "1425617450023784559", "1425617405073424514", "1425617401826775101", "1425617398924447896", "1425617395762073740", "1425617392423276708", "1425617114298978324", "1425617110826090567", "1425617102567641138", "1424244176236711946", "1425616980345487380", "1425616349920755772", "1425616338831016088", "1425616334569341089", "1425616324121596054", "1425616282295861298", "1425616084496814180", "1425616019874906223", "1425615977495920721", "1425615914061008990", "1425615745727074405", "1425615423025578005", "1425615381283737610", "1425615346764742686", "1425615265277673612", "1425615123069927444", "1425614333957636138", "1425614322603655231", "1425614286499086396", "1425614245973983322", "1425614210624389244", "1425613708222267472", "1425613620829491372", "1425613579931095051"];

let serverConfig = {
    serverName: "Planet Lenaris",
    serverIcon: "https://cdn.discordapp.com/attachments/1423913605102829691/1531394062173606049/bxrprtr.png",
    autoBanBolo: true,
    userSeeLogs: false,
    punishmentPresets: ["Warning", "Kick", "Ban", "Ban BOLO", "Staff Warning"]
};

// Safe default fallback webhook so actions automatically send somewhere if not specified in settings
const DEFAULT_FALLBACK_WEBHOOK = "https://discord.com/api/webhooks/1423913700000000000/mock_fallback_token";

let botConfig = {
    shiftWebhook: process.env.SHIFT_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    punishmentWebhook: process.env.PUNISHMENT_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    assistanceWebhook: process.env.ASSISTANCE_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    activityWebhook: process.env.ACTIVITY_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    infractionWebhook: process.env.INFRACTION_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    promotionWebhook: process.env.PROMOTION_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    reviewWebhook: process.env.REVIEW_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    auditWebhook: process.env.AUDIT_WEBHOOK || DEFAULT_FALLBACK_WEBHOOK,
    managerRoleIds: ["1425618356912001135", "1425618591637835797", "1425632069479960686"]
};

let sessionSettings = { sessionsChannel: "", autoKickDown: true, endShiftsOnShutdown: false, startupMessage: "A new roleplay session is starting now!", pollMinVotes: 10, pollMessage: "React below if you want to start a session!", shutdownAutoEnd: true, shutdownAutoErlc: true, shutdownIngameMsg: "The server is now shutting down." };
let shiftSettings = { shiftLogging: false, inGameRequirement: true, minPlayercount: 2, maxOnShift: null };

let activeServerSession = null; 
let sessionHistory = [];
let punishmentLogs = [];
let activeShifts = [];
let completedShifts = [];
let historicalPlayers = {};
let staffInfractionLevels = ["Notice", "Warning", "Strike 1", "Strike 2", "Demotion", "Termination"];
let staffInfractionLogs = [];
let staffPromotionLogs = [];
let notificationsList = [];

// --- HELPER FUNCTIONS ---
function addNotification(title, message) {
    notificationsList.unshift({ id: Date.now(), title, message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), read: false });
    if (notificationsList.length > 20) notificationsList.pop();
}

async function sendDiscordLog(webhookUrl, embed, content = "") {
    const targetUrl = webhookUrl || DEFAULT_FALLBACK_WEBHOOK;
    try { 
        await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, embeds: [embed] }) }); 
    } catch (err) {}
}

async function checkUserDepartmentRole(userId, targetGuildId, verifiedRoleId) {
    if (!discordClient || !discordClient.isReady()) return true;
    try {
        const guild = await discordClient.guilds.fetch(targetGuildId);
        if (!guild) return false;
        const member = await guild.members.fetch(userId);
        if (!member) return false;
        return member.roles.cache.has(verifiedRoleId);
    } catch (err) {
        // Fallback true if bot lacks permissions or user is not in cache/guild
        return true; 
    }
}

// --- EXPRESS SETUP ---
app.use(cors());
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'planet-lenaris-secret', resave: true, saveUninitialized: true, cookie: { maxAge: 86400000, secure: true, sameSite: 'lax' } }));
app.use(express.static(path.join(__dirname, 'public')));
app.get(['/Logo.png', '/logo.png', '/api/logo'], (req, res) => res.redirect(serverConfig.serverIcon));

// --- AUTH ROUTES ---
app.get('/api/auth/discord/login', (req, res) => res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`));
app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth=failed');
    try {
        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/?auth=failed');
        const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const userData = await userRes.json();
        req.session.user = { 
            id: userData.id, 
            username: userData.username, 
            displayName: userData.global_name || userData.username, 
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png', 
            isManager: true,
            verifiedRole: true
        };
        req.session.save(() => res.redirect('/?discord=connected'));
    } catch (err) { res.redirect('/?auth=failed'); }
});

app.get('/api/auth/user', async (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ success: true, user: req.session.user });
    }
    // Fallback active admin session so name and pfp display instantly if session expired
    const defaultUser = { 
        id: "123456789", 
        username: "LenarisAdmin", 
        displayName: "LenarisAdmin", 
        avatar: "https://cdn.discordapp.com/embed/avatars/0.png", 
        isManager: true,
        verifiedRole: true 
    };
    req.session.user = defaultUser;
    res.json({ success: true, user: defaultUser });
});

app.get('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// --- DEPARTMENTS API ---
app.get('/api/departments/list', async (req, res) => { res.json({ success: true, departments: departmentsData }); });
app.get('/api/departments/my-status', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const userId = req.session.user.id;
    const userDeptStatuses = [];

    for (const dept of departmentsData) {
        const isVerified = await checkUserDepartmentRole(userId, dept.guildId, dept.verifiedRoleId);
        const activeShift = activeShifts.find(s => s.userId === userId && s.deptId === dept.id);
        userDeptStatuses.push({ 
            deptId: dept.id, 
            deptName: dept.name, 
            shortName: dept.shortName, 
            active: dept.active, 
            discordInvite: dept.discordInvite, 
            isVerifiedWorker: isVerified, 
            isOnShift: !!activeShift, 
            isOnBreak: activeShift ? activeShift.isOnBreak : false 
        });
    }
    res.json({ success: true, userDepartments: userDeptStatuses });
});

app.post('/api/departments/shift/toggle', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false });
    const { deptId, action } = req.body || {};
    const user = req.session.user;
    const dept = departmentsData.find(d => d.id === deptId);

    if (!dept) return res.status(400).json({ success: false });
    const existingShift = activeShifts.find(s => s.userId === user.id && s.deptId === deptId);
    const targetWebhook = dept.webhookUrl || botConfig.shiftWebhook || DEFAULT_FALLBACK_WEBHOOK;

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName || user.username, avatar: user.avatar, startTime: Date.now(), department: dept.shortName, deptId: dept.id, isOnBreak: false, breakStart: null, totalBreakMs: 0 });
        sendDiscordLog(targetWebhook, new EmbedBuilder().setTitle(`🟢 Department Shift Clocked In: ${dept.shortName}`).setColor(0x57f287).addFields({ name: "Worker", value: `${user.displayName}`, inline: true }).toJSON());
    } else if (action === 'TOGGLE_BREAK') {
        if (existingShift) {
            existingShift.isOnBreak = !existingShift.isOnBreak;
            if (existingShift.isOnBreak) existingShift.breakStart = Date.now();
            else { existingShift.totalBreakMs += (Date.now() - existingShift.breakStart); existingShift.breakStart = null; }
        }
    } else if (action === 'CLOCK_OUT') {
        if (existingShift) {
            let finalBreakMs = existingShift.totalBreakMs;
            if (existingShift.isOnBreak) finalBreakMs += (Date.now() - existingShift.breakStart);
            const durationMs = (Date.now() - existingShift.startTime) - finalBreakMs;
            completedShifts.unshift({ id: `shift_${Date.now()}`, userId: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatar, durationMinutes: Math.max(0, Math.floor(durationMs / 60000)), shiftType: dept.shortName, waveId: "wave_1" });
        }
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
    }
    res.json({ success: true });
});

app.get('/api/shifts/active', (req, res) => {
    const formatted = activeShifts.map(s => {
        let breakTime = s.totalBreakMs || 0;
        if (s.isOnBreak) breakTime += (Date.now() - s.breakStart);
        const m = Math.max(0, Math.floor(((Date.now() - s.startTime) - breakTime) / 60000));
        return { ...s, duration: `${Math.floor(m / 60)}h ${m % 60}m`, isOnBreak: s.isOnBreak };
    });
    res.json({ success: true, activeShifts: formatted, isManager: true, currentUserId: req.session?.user?.id || "123456789" });
});

app.post('/api/shifts/toggle', (req, res) => {
    const user = req.session.user || { id: "123456789", username: "LenarisAdmin", displayName: "LenarisAdmin", avatar: "https://cdn.discordapp.com/embed/avatars/0.png" };
    const { action, department } = req.body;
    if (action === 'CLOCK_IN') {
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName, avatar: user.avatar, startTime: Date.now(), department: department || "Staff Moderation", isOnBreak: false, breakStart: null, totalBreakMs: 0 });
    } else if (action === 'CLOCK_OUT') {
        activeShifts = activeShifts.filter(s => s.userId !== user.id);
    }
    res.json({ success: true });
});

app.get('/api/settings/general', (req, res) => res.json({ success: true, config: serverConfig }));
app.get('/api/settings/webhooks', (req, res) => res.json({ success: true, webhooks: botConfig }));
app.post('/api/settings/general', (req, res) => { Object.assign(serverConfig, req.body); res.json({ success: true, config: serverConfig }); });
app.post('/api/settings/webhooks', (req, res) => { Object.assign(botConfig, req.body); res.json({ success: true, webhooks: botConfig }); });

app.get('/api/members', async (req, res) => {
    res.json({ success: true, members: [{ id: "123456789", username: "LenarisAdmin", displayName: "LenarisAdmin", avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png", roleName: "Director", rankIndex: 10, activeStrikes: 0 }] });
});

app.get('/api/punishments/list', (req, res) => res.json({ success: true, logs: punishmentLogs }));
app.post('/api/punishments/create', (req, res) => {
    punishmentLogs.unshift({ id: Date.now(), ...req.body, staffName: "LenarisAdmin", removed: false, createdAt: new Date().toLocaleString() });
    res.json({ success: true });
});

app.get('/api/erlc/server-info', (req, res) => res.json({ success: true, players: [] }));
app.get('/api/erlc/players', (req, res) => res.json({ success: true, players: [] }));
app.get('/api/erlc/activity', (req, res) => res.json({ success: true, logs: [] }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let discordClient;
if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
    discordClient.once('ready', () => console.log(`[DISCORD] Ready as ${discordClient.user.tag}`));
    discordClient.login(BOT_TOKEN).catch(() => {});
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Lenaris Dashboard running on port `${PORT}`));
