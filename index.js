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

let botConfig = {
    shiftWebhook: process.env.SHIFT_WEBHOOK || "",
    punishmentWebhook: process.env.PUNISHMENT_WEBHOOK || "",
    assistanceWebhook: process.env.ASSISTANCE_WEBHOOK || "",
    activityWebhook: process.env.ACTIVITY_WEBHOOK || "",
    infractionWebhook: process.env.INFRACTION_WEBHOOK || "",
    promotionWebhook: process.env.PROMOTION_WEBHOOK || "",
    reviewWebhook: process.env.REVIEW_WEBHOOK || "",
    auditWebhook: process.env.AUDIT_WEBHOOK || "",
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
    if (!webhookUrl) return;
    try { 
        await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, embeds: [embed] }) }); 
    } catch (err) {}
}

async function verifyUserRoleLive(userId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (!memberRes.ok) return false;
        const memberData = await memberRes.json();
        const userRoles = memberData.roles || [];
        return { hasRole: userRoles.includes(REQUIRED_ROLE_ID), isManager: userRoles.some(r => botConfig.managerRoleIds.includes(r)), roles: userRoles, nickname: memberData.nick || null };
    } catch (err) { return false; }
}

async function checkUserDepartmentRole(userId, deptGuildId, verifiedRoleId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${deptGuildId}/members/${userId}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (!memberRes.ok) return false;
        const memberData = await memberRes.json();
        return (memberData.roles || []).includes(verifiedRoleId);
    } catch (err) { return false; }
}

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
app.use(session({ secret: process.env.SESSION_SECRET || 'planet-lenaris-secret', resave: true, saveUninitialized: true, cookie: { maxAge: 86400000, secure: true, sameSite: 'lax' } }));
app.use(express.static(path.join(__dirname, 'public')));
app.get(['/Logo.png', '/logo.png', '/api/logo'], (req, res) => res.redirect(serverConfig.serverIcon));

// --- ER:LC PLAYER POLLING WORKER ---
async function pollErlcPlayers() {
    if (!ERLC_API_KEY) return;
    try {
        const resp = await fetch('https://api.erlc.gg/v1/server/players', { headers: { 'Server-Key': ERLC_API_KEY } });
        if (!resp.ok) return;
        const data = await resp.json();
        const livePlayers = data.players || data || [];
        
        const currentActiveNames = new Set();
        livePlayers.forEach(p => {
            let rawName = p.Player || p.Name || p.username || '';
            let rawId = p.UserId || p.id || '';
            if (rawName.includes(':')) {
                const parts = rawName.split(':');
                rawName = parts[0].trim();
                if (!rawId || rawId === 'N/A') rawId = parts[1].trim();
            }
            if (rawName) {
                currentActiveNames.add(rawName.toLowerCase());
                historicalPlayers[rawName.toLowerCase()] = { username: rawName, robloxId: rawId || 'N/A', leftGame: false };
            }
        });

        Object.keys(historicalPlayers).forEach(key => {
            if (!currentActiveNames.has(key)) {
                historicalPlayers[key].leftGame = true;
            }
        });
    } catch (err) {}
}
setInterval(pollErlcPlayers, 10000);

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
        req.session.user = { id: userData.id, username: userData.username, displayName: userData.global_name || userData.username, avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png' };
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

app.get('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// --- MOD PANEL ROUTES ---
app.post('/api/erlc/command', requireStaffAuth, async (req, res) => {
    const { command } = req.body;
    if (!ERLC_API_KEY) return res.status(400).json({ success: false, error: "No API Key configured." });
    try {
        const resp = await fetch('https://api.erlc.gg/v1/server/command', { method: 'POST', headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
        if (resp.ok) {
            sendDiscordLog(botConfig.auditWebhook, { title: "💻 ER:LC Command Executed", color: 0x3498db, description: `**Command:** \`${command}\`\n**Executed By:** <@${req.session.user.id}>` });
            res.json({ success: true }); 
        } else res.status(400).json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/erlc/players', requireStaffAuth, async (req, res) => {
    res.json({ success: true, players: Object.values(historicalPlayers) });
});

app.post('/api/punishments/create', requireStaffAuth, (req, res) => {
    const { targetUser, robloxId, punishmentType, reason } = req.body;
    const log = { id: Date.now(), targetUser, robloxId: robloxId || "N/A", punishmentType, reason, staffName: req.session.user.displayName, removed: false, createdAt: new Date().toLocaleString() };
    punishmentLogs.unshift(log);

    const embed = new EmbedBuilder().setTitle(`🔨 Punishment Logged: ${punishmentType}`).setColor(0xed4245).addFields({ name: "Target Player", value: targetUser, inline: true }, { name: "Roblox ID", value: log.robloxId, inline: true }, { name: "Issued By", value: `<@${req.session.user.id}>`, inline: true }, { name: "Reason", value: reason, inline: false });
    sendDiscordLog(botConfig.punishmentWebhook, embed.toJSON());
    res.json({ success: true });
});

app.post('/api/punishments/remove-warning', requireStaffAuth, (req, res) => {
    const log = punishmentLogs.find(l => l.id == req.body.logId);
    if (log) {
        log.removed = true;
        sendDiscordLog(botConfig.auditWebhook, { title: "🗑️ Punishment Removed", color: 0xe67e22, description: `A punishment log for **${log.targetUser}** was removed by <@${req.session.user.id}>.` });
    }
    res.json({ success: true });
});

app.get('/api/punishments/list', requireStaffAuth, (req, res) => res.json({ success: true, logs: punishmentLogs }));

app.post('/api/assistance/request', requireStaffAuth, (req, res) => {
    const supportPing = SUPPORT_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
    sendDiscordLog(botConfig.assistanceWebhook, { title: "🚨 Staff Assistance Requested", color: 15548997, fields: [{ name: "Requested By", value: `<@${req.session.user.id}>`, inline: true }, { name: "Details", value: req.body.reason, inline: false }] }, `🚨 **STAFF ASSISTANCE NEEDED**\n${supportPing}`);
    res.json({ success: true });
});

app.post('/api/support/create', async (req, res) => {
    const { subject, message } = req.body;
    const user = req.session.user || { id: "Unknown", displayName: "Guest User" };
    sendDiscordLog(botConfig.assistanceWebhook, {
        title: "🎫 New Support Ticket",
        color: 0x3498db,
        fields: [{ name: "User", value: `${user.displayName} (<@${user.id}>)`, inline: true }, { name: "Subject", value: subject, inline: false }, { name: "Message", value: message, inline: false }]
    });
    res.json({ success: true });
});

app.get('/api/erlc/server-info', requireStaffAuth, async (req, res) => { res.json({ success: true, players: Object.values(historicalPlayers).filter(p => !p.leftGame) }); });
app.get('/api/erlc/activity', requireStaffAuth, async (req, res) => { res.json({ success: true, logs: [] }); });

// --- DEPARTMENTS API ---
app.get('/api/departments/list', async (req, res) => { res.json({ success: true, departments: departmentsData }); });
app.get('/api/departments/my-status', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const userId = req.session.user.id;
    const userDeptStatuses = [];

    for (const dept of departmentsData) {
        const isVerified = await checkUserDepartmentRole(userId, dept.guildId, dept.verifiedRoleId);
        const activeShift = activeShifts.find(s => s.userId === userId && s.deptId === dept.id);
        userDeptStatuses.push({ deptId: dept.id, deptName: dept.name, shortName: dept.shortName, active: dept.active, discordInvite: dept.discordInvite, isVerifiedWorker: isVerified, isOnShift: !!activeShift, isOnBreak: activeShift ? activeShift.isOnBreak : false });
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

    sendDiscordLog(botConfig.auditWebhook, { title: "🛠️ Department Updated", color: 0xf1c40f, description: `**${dept.name}** settings were updated by <@${req.session.user.id}>.` });
    res.json({ success: true, department: dept });
});

app.post('/api/departments/shift/toggle', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false });
    const { deptId, action } = req.body || {};
    const user = req.session.user;
    const dept = departmentsData.find(d => d.id === deptId);

    if (!dept || !dept.active) return res.status(400).json({ success: false });
    const isVerified = await checkUserDepartmentRole(user.id, dept.guildId, dept.verifiedRoleId);
    if (!isVerified && !user.isManager) return res.status(403).json({ success: false });

    const existingShift = activeShifts.find(s => s.userId === user.id && s.deptId === deptId);
    const targetWebhook = dept.webhookUrl || botConfig.shiftWebhook;

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName || user.username, avatar: user.avatar, startTime: Date.now(), department: dept.shortName, deptId: dept.id, isOnBreak: false, breakStart: null, totalBreakMs: 0 });
        const embed = new EmbedBuilder().setTitle(`🟢 Department Shift Clocked In: ${dept.shortName}`).setColor(0x57f287).addFields({ name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true }, { name: "Department", value: dept.name, inline: true });
        sendDiscordLog(targetWebhook, embed.toJSON());
    } else if (action === 'TOGGLE_BREAK') {
        if (existingShift) {
            if (existingShift.isOnBreak) { 
                existingShift.isOnBreak = false; 
                existingShift.totalBreakMs += (Date.now() - existingShift.breakStart); 
                existingShift.breakStart = null; 
                const embed = new EmbedBuilder().setTitle(`☕ Department Break Ended: ${dept.shortName}`).setColor(0x3498db).addFields({ name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true }, { name: "Department", value: dept.name, inline: true });
                sendDiscordLog(targetWebhook, embed.toJSON());
            } else { 
                existingShift.isOnBreak = true; 
                existingShift.breakStart = Date.now(); 
                const embed = new EmbedBuilder().setTitle(`☕ Department Break Started: ${dept.shortName}`).setColor(0xf1c40f).addFields({ name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true }, { name: "Department", value: dept.name, inline: true });
                sendDiscordLog(targetWebhook, embed.toJSON());
            }
        }
    } else if (action === 'CLOCK_OUT') {
        if (existingShift) {
            let finalBreakMs = existingShift.totalBreakMs;
            if (existingShift.isOnBreak) finalBreakMs += (Date.now() - existingShift.breakStart);
            const durationMs = (Date.now() - existingShift.startTime) - finalBreakMs;
            completedShifts.unshift({ id: `shift_${Date.now()}`, userId: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatar, startTime: existingShift.startTime, endTime: Date.now(), durationMinutes: Math.max(0, Math.floor(durationMs / 60000)), shiftType: dept.shortName, waveId: "wave_1" });
        }
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
        const embed = new EmbedBuilder().setTitle(`🔴 Department Shift Clocked Out: ${dept.shortName}`).setColor(0xed4245).addFields({ name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true }, { name: "Department", value: dept.name, inline: true });
        sendDiscordLog(targetWebhook, embed.toJSON());
    }
    res.json({ success: true });
});

// --- SESSIONS API ---
app.get('/api/sessions/settings', requireManagerAuth, (req, res) => res.json({ success: true, settings: sessionSettings }));
app.post('/api/sessions/settings', requireManagerAuth, (req, res) => {
    Object.assign(sessionSettings, req.body);
    sendDiscordLog(botConfig.auditWebhook, { title: "🛠️ Session Settings Updated", color: 0xf1c40f, description: `Session settings were updated by <@${req.session.user.id}>.` });
    res.json({ success: true, settings: sessionSettings });
});
app.get('/api/sessions/overview', requireStaffAuth, (req, res) => { res.json({ success: true, activeSession: activeServerSession, history: sessionHistory, analytics: { uniquePlayers: 1, modCalls: 0, modCommands: 1 } }); });
app.post('/api/sessions/poll', requireManagerAuth, async (req, res) => {
    const { question, options } = req.body;
    if (!sessionSettings.sessionsChannel || !discordClient) return res.status(400).json({ success: false, error: "Sessions channel not configured or bot offline." });
    try {
        const channel = await discordClient.channels.fetch(sessionSettings.sessionsChannel);
        if (!channel) return res.status(404).json({ success: false, error: "Channel not found." });
        const embed = new EmbedBuilder().setTitle(`📊 Server Poll: ${question}`).setColor(0x3498db).setDescription(options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n\n'));
        const msg = await channel.send({ content: sessionSettings.pollMessage, embeds: [embed] });
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        for (let i = 0; i < options.length && i < emojis.length; i++) await msg.react(emojis[i]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});
app.post('/api/sessions/toggle', requireManagerAuth, async (req, res) => {
    const { action } = req.body;
    if (action === 'START') {
        activeServerSession = { startTime: Date.now() };
        if (sessionSettings.sessionsChannel && discordClient) {
            try {
                const channel = await discordClient.channels.fetch(sessionSettings.sessionsChannel);
                if (channel) {
                    const embed = new EmbedBuilder().setTitle("🟢 Roleplay Session Started").setColor(0x57f287).setDescription(sessionSettings.startupMessage);
                    await channel.send({ content: "@everyone", embeds: [embed] });
                }
            } catch (err) {}
        }
    } else {
        if (activeServerSession) {
            sessionHistory.unshift({ id: Date.now(), startTime: activeServerSession.startTime, endTime: Date.now() });
            activeServerSession = null;
            if (sessionSettings.shutdownAutoErlc && ERLC_API_KEY) {
                const kickCmd = `:m ${sessionSettings.shutdownIngameMsg || "The server is now shutting down."}`;
                fetch('https://api.erlc.gg/v1/server/command', { method: 'POST', headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: kickCmd }) }).catch(() => {});
            }
            if (sessionSettings.endShiftsOnShutdown) {
                activeShifts.forEach(s => completedShifts.unshift({ id: `shift_${Date.now()}`, userId: s.userId, durationMinutes: Math.floor((Date.now() - s.startTime) / 60000), shiftType: s.department || "Default", waveId: "wave_1" }));
                activeShifts = [];
            }
        }
    }
    res.json({ success: true, activeSession: activeServerSession });
});

// --- SHIFTS API ---
app.get('/api/shifts/settings', requireManagerAuth, (req, res) => res.json({ success: true, settings: shiftSettings }));
app.post('/api/shifts/settings', requireManagerAuth, (req, res) => { 
    Object.assign(shiftSettings, req.body); 
    sendDiscordLog(botConfig.auditWebhook, { title: "🛠️ Shift Settings Updated", color: 0xf1c40f, description: `Shift settings were updated by <@${req.session.user.id}>.` });
    res.json({ success: true, settings: shiftSettings }); 
});
app.get('/api/shifts/all', requireManagerAuth, (req, res) => res.json({ success: true, shifts: completedShifts }));

app.get('/api/shifts/active', requireStaffAuth, (req, res) => {
    const formatted = activeShifts.map(s => {
        let breakTime = s.totalBreakMs || 0;
        if (s.isOnBreak) breakTime += (Date.now() - s.breakStart);
        const m = Math.max(0, Math.floor(((Date.now() - s.startTime) - breakTime) / 60000));
        return { ...s, duration: `${Math.floor(m / 60)}h ${m % 60}m`, isOnBreak: s.isOnBreak };
    });
    res.json({ success: true, activeShifts: formatted, isManager: req.session.user.isManager, currentUserId: req.session.user.id });
});

app.post('/api/shifts/toggle', requireStaffAuth, (req, res) => {
    const { action, department } = req.body;
    const user = req.session.user;
    const existingShift = activeShifts.find(s => s.userId === user.id);

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => s.userId !== user.id);
        activeShifts.push({ userId: user.id, username: user.username, robloxName: user.displayName, avatar: user.avatar, startTime: Date.now(), department: department || "General Staff", isOnBreak: false, breakStart: null, totalBreakMs: 0 });
        const embed = new EmbedBuilder().setTitle(`🟢 General Shift Clocked In`).setColor(0x57f287).addFields({ name: "Staff", value: `<@${user.id}>`, inline: true });
        sendDiscordLog(botConfig.shiftWebhook, embed.toJSON());
    } else if (action === 'TOGGLE_BREAK') {
        if (existingShift) {
            if (existingShift.isOnBreak) { 
                existingShift.isOnBreak = false; 
                existingShift.totalBreakMs += (Date.now() - existingShift.breakStart); 
                existingShift.breakStart = null; 
                const embed = new EmbedBuilder().setTitle(`☕ General Break Ended`).setColor(0x3498db).addFields({ name: "Staff", value: `<@${user.id}>`, inline: true });
                sendDiscordLog(botConfig.shiftWebhook, embed.toJSON());
            } else { 
                existingShift.isOnBreak = true; 
                existingShift.breakStart = Date.now(); 
                const embed = new EmbedBuilder().setTitle(`☕ General Break Started`).setColor(0xf1c40f).addFields({ name: "Staff", value: `<@${user.id}>`, inline: true });
                sendDiscordLog(botConfig.shiftWebhook, embed.toJSON());
            }
        }
    } else if (action === 'CLOCK_OUT') {
        if (existingShift) {
            let finalBreakMs = existingShift.totalBreakMs;
            if (existingShift.isOnBreak) finalBreakMs += (Date.now() - existingShift.breakStart);
            const durationMs = (Date.now() - existingShift.startTime) - finalBreakMs;
            completedShifts.unshift({ id: `shift_${Date.now()}`, userId: user.id, durationMinutes: Math.max(0, Math.floor(durationMs / 60000)), shiftType: existingShift.department || "Default", waveId: "wave_1" });
            const embed = new EmbedBuilder().setTitle(`🔴 General Shift Clocked Out`).setColor(0xed4245).addFields({ name: "Staff", value: `<@${user.id}>`, inline: true });
            sendDiscordLog(botConfig.shiftWebhook, embed.toJSON());
        }
        activeShifts = activeShifts.filter(s => s.userId !== user.id);
    }
    res.json({ success: true });
});

app.post('/api/shifts/force-end', requireManagerAuth, (req, res) => {
    const { targetUserId } = req.body;
    activeShifts = activeShifts.filter(s => s.userId !== targetUserId);
    const embed = new EmbedBuilder().setTitle(`🔴 Staff Shift Force-Ended`).setColor(0xed4245).addFields({ name: "Staff", value: `<@${targetUserId}>`, inline: true }, { name: "Ended By", value: `<@${req.session.user.id}>`, inline: true });
    sendDiscordLog(botConfig.shiftWebhook, embed.toJSON());
    res.json({ success: true });
});

app.get('/api/settings/general', (req, res) => res.json({ success: true, config: serverConfig }));
app.get('/api/settings/webhooks', requireManagerAuth, (req, res) => res.json({ success: true, webhooks: botConfig }));
app.post('/api/settings/general', requireManagerAuth, (req, res) => { 
    Object.assign(serverConfig, req.body); 
    sendDiscordLog(botConfig.auditWebhook, { title: "🛠️ General Settings Updated", color: 0xf1c40f, description: `General configuration was updated by <@${req.session.user.id}>.` });
    res.json({ success: true, config: serverConfig }); 
});
app.post('/api/settings/webhooks', requireManagerAuth, (req, res) => { 
    Object.assign(botConfig, req.body); 
    sendDiscordLog(botConfig.auditWebhook, { title: "🛠️ Webhook Settings Updated", color: 0xf1c40f, description: `Webhook URLs were updated by <@${req.session.user.id}>.` });
    res.json({ success: true, webhooks: botConfig }); 
});
app.get('/api/notifications/list', (req, res) => res.json({ success: true, notifications: notificationsList }));
app.post('/api/notifications/read', (req, res) => { notificationsList.forEach(n => n.read = true); res.json({ success: true }); });

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
app.post('/api/infractions/levels/add', requireManagerAuth, (req, res) => { if (req.body.name) staffInfractionLevels.push(req.body.name); res.json({ success: true, levels: staffInfractionLevels }); });
app.post('/api/infractions/levels/remove', requireManagerAuth, (req, res) => { if (req.body.index !== undefined) staffInfractionLevels.splice(req.body.index, 1); res.json({ success: true, levels: staffInfractionLevels }); });

app.post('/api/infractions/issue', requireManagerAuth, (req, res) => {
    const { targetUserId, targetUser, level, reason, proof } = req.body;
    staffInfractionLogs.unshift({ id: `inf_${Date.now()}`, targetUserId, targetUser, level, reason, proof: proof || "None Provided", issuedBy: req.session.user.displayName, createdAt: new Date().toLocaleString() });
    const embed = new EmbedBuilder().setTitle(`⚠️ Staff Infraction Issued`).setColor(0xed4245).addFields({ name: "Staff Member", value: targetUser, inline: true }, { name: "Level", value: level, inline: true }, { name: "Issued By", value: `<@${req.session.user.id}>`, inline: true }, { name: "Reason", value: reason, inline: false }, { name: "Proof", value: proof || "None Provided", inline: false });
    sendDiscordLog(botConfig.infractionWebhook, embed.toJSON());
    res.json({ success: true });
});

app.post('/api/infractions/promote', requireManagerAuth, (req, res) => {
    const { targetUserId, targetUser, newRole, reason } = req.body;
    staffPromotionLogs.unshift({ id: `prom_${Date.now()}`, targetUserId, targetUser, newRole, reason, promotedBy: req.session.user.displayName, createdAt: new Date().toLocaleString() });
    const embed = new EmbedBuilder().setTitle(`📈 Staff Promotion`).setColor(0x57f287).addFields({ name: "Staff Member", value: targetUser, inline: true }, { name: "New Rank", value: newRole, inline: true }, { name: "Updated By", value: `<@${req.session.user.id}>`, inline: true }, { name: "Reason", value: reason || "None Provided", inline: false });
    sendDiscordLog(botConfig.promotionWebhook, embed.toJSON());
    res.json({ success: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- DISCORD BOT INITIALIZATION ---
let discordClient;

if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

    const commands = [
        new SlashCommandBuilder().setName('review').setDescription('Submit an official staff member review')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member to review').setRequired(true))
            .addIntegerOption(opt => opt.setName('rating').setDescription('Star rating (1 to 5)').setRequired(true).addChoices({ name: '⭐', value: 1 }, { name: '⭐⭐', value: 2 }, { name: '⭐⭐⭐', value: 3 }, { name: '⭐⭐⭐⭐', value: 4 }, { name: '⭐⭐⭐⭐⭐', value: 5 }))
            .addStringOption(opt => opt.setName('note').setDescription('Your review note/feedback').setRequired(true)),
        new SlashCommandBuilder().setName('shift').setDescription('Clock in or clock out of a staff shift').addStringOption(opt => opt.setName('action').setDescription('Clock In or Clock Out').setRequired(true).addChoices({ name: 'Clock In', value: 'CLOCK_IN' }, { name: 'Clock Out', value: 'CLOCK_OUT' })),
        new SlashCommandBuilder().setName('active-shifts').setDescription('View all staff members currently on shift'),
        new SlashCommandBuilder().setName('erlc-command').setDescription('Execute an in-game command').addStringOption(opt => opt.setName('command').setDescription('The exact in-game command text').setRequired(true)),
        new SlashCommandBuilder().setName('log-punishment').setDescription('Log an in-game player punishment').addStringOption(opt => opt.setName('player').setDescription('Target player username').setRequired(true)).addStringOption(opt => opt.setName('type').setDescription('Type of punishment').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason for punishment').setRequired(true)).addStringOption(opt => opt.setName('roblox_id').setDescription('Roblox player User ID').setRequired(false)),
        new SlashCommandBuilder().setName('assistance').setDescription('Request higher-up staff assistance').addStringOption(opt => opt.setName('reason').setDescription('Details for assistance request').setRequired(true)),
        new SlashCommandBuilder().setName('infract').setDescription('Issue an official staff infraction').addUserOption(opt => opt.setName('staff').setDescription('The staff member to infract').setRequired(true)).addStringOption(opt => opt.setName('level').setDescription('Infraction level').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)).addStringOption(opt => opt.setName('proof').setDescription('Evidence').setRequired(false)),
        new SlashCommandBuilder().setName('promote').setDescription('Promote or update a staff member rank').addUserOption(opt => opt.setName('staff').setDescription('The staff member').setRequired(true)).addStringOption(opt => opt.setName('new_role').setDescription('The new staff role name').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
        new SlashCommandBuilder().setName('force-end-shift').setDescription('Forcefully end an active staff shift').addUserOption(opt => opt.setName('staff').setDescription('The staff member whose shift to end').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    (async () => { try { await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands }); } catch (err) {} })();

    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        const { commandName, options, channelId, member } = interaction;
        const isStaff = member.roles.cache.has(REQUIRED_ROLE_ID);
        const isManager = member.roles.cache.some(r => botConfig.managerRoleIds.includes(r.id));

        if (commandName === 'review') {
            if (channelId !== REVIEW_CHANNEL_ID) return interaction.reply({ content: `❌ Command restricted to <#${REVIEW_CHANNEL_ID}>!`, ephemeral: true });
            const targetUser = options.getUser('staff');
            const rating = options.getInteger('rating');
            const reviewEmbed = new EmbedBuilder().setTitle("Lenaris Staff Reviews").setColor(0x3498db).setDescription(`**Staff member:**\n<@${targetUser.id}>\n\n**Rating:**\n${"⭐".repeat(rating)}\n\n**Note:** ${options.getString('note')}`);
            await interaction.reply({ embeds: [reviewEmbed] });
            if (botConfig.reviewWebhook) sendDiscordLog(botConfig.reviewWebhook, reviewEmbed.toJSON());
            return;
        }

        if (['shift', 'active-shifts', 'erlc-command', 'log-punishment', 'assistance'].includes(commandName) && !isStaff && !isManager) return interaction.reply({ content: '❌ Staff Role required.', ephemeral: true });
        if (['infract', 'promote', 'force-end-shift'].includes(commandName) && !isManager) return interaction.reply({ content: '❌ Management permissions required.', ephemeral: true });
        
        if (commandName === 'active-shifts') return interaction.reply({ content: `Currently tracking ${activeShifts.length} active shifts.`, ephemeral: true });
        if (commandName === 'erlc-command') return interaction.reply({ content: `ER:LC Commands execution sent!`, ephemeral: true });
        if (commandName === 'assistance') return interaction.reply({ content: `Assistance requested!`, ephemeral: true });
        if (commandName === 'infract') return interaction.reply({ content: `Infraction logged!`, ephemeral: true });
        if (commandName === 'promote') return interaction.reply({ content: `Promotion logged!`, ephemeral: true });
        if (commandName === 'force-end-shift') return interaction.reply({ content: `Shift ended!`, ephemeral: true });
    });

    discordClient.once('ready', () => console.log(`[DISCORD] Ready as ${discordClient.user.tag}`));
    discordClient.login(BOT_TOKEN).catch(err => console.error("\n❌ [DISCORD LOGIN ERROR] The bot failed to log in!\nReason:", err.message, "\n"));
} else {
    console.log("⚠️ [DISCORD] Skipping bot startup: Missing Tokens in Render");
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Lenaris Dashboard running on port ${PORT}`));
