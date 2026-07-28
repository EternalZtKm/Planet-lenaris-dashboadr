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
        inGameReq: true,
        autoClockOutHours: 4,
        description: "Primary municipal law enforcement and city patrol operations."
    }
];

// Support Role IDs
const SUPPORT_ROLE_IDS = [
    "1425618034214699078",
    "1425618073917853796",
    "1425618356912001135",
    "1425618591637835797",
    "1425632069479960686",
    "1425618454337028116"
];

// Staff Hierarchy Role IDs (Least to Greatest Authority)
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

// Custom Activity Role IDs
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

// Global Webhooks Config
let botConfig = {
    shiftWebhook: process.env.SHIFT_WEBHOOK || "",
    punishmentWebhook: process.env.PUNISHMENT_WEBHOOK || "",
    assistanceWebhook: process.env.ASSISTANCE_WEBHOOK || "",
    activityWebhook: process.env.ACTIVITY_WEBHOOK || "",
    infractionWebhook: process.env.INFRACTION_WEBHOOK || "",
    promotionWebhook: process.env.PROMOTION_WEBHOOK || "",
    reviewWebhook: process.env.REVIEW_WEBHOOK || "",
    managerRoleIds: [
        "1425618356912001135",
        "1425618591637835797",
        "1425632069479960686"
    ]
};

// Stores
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
        console.error("Webhook Error:", err.message);
    }
}

app.use(cors());
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'planet-lenaris-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 86400000, secure: true, sameSite: 'lax' }
}));

// Logo Endpoint
app.get(['/Logo.png', '/logo.png', '/server-logo.png', '/api/logo'], (req, res) => {
    if (serverConfig.serverIcon) return res.redirect(serverConfig.serverIcon);
    const publicDir = path.join(__dirname, 'public');
    if (fs.existsSync(publicDir)) {
        const files = fs.readdirSync(publicDir);
        const logoFile = files.find(f => f.toLowerCase().includes('logo') || f.toLowerCase().endsWith('.png'));
        if (logoFile) return res.sendFile(path.join(publicDir, logoFile));
    }
    res.status(404).send('Logo file not found');
});

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
            nickname: memberData.nick || null
        };
    } catch (err) {
        return false;
    }
}

// Check worker role in a specific department Discord server
async function checkUserDepartmentRole(userId, deptGuildId, verifiedRoleId) {
    try {
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${deptGuildId}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        if (!memberRes.ok) return false;
        const memberData = await memberRes.json();
        return (memberData.roles || []).includes(verifiedRoleId);
    } catch (err) {
        return false;
    }
}

// Middleware Guards
async function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.hasRole) return res.status(403).json({ success: false, error: "Access Denied" });
    if (check.nickname) req.session.user.displayName = check.nickname;
    req.session.user.isManager = check.isManager;
    next();
}

async function requireManagerAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.isManager) return res.status(403).json({ success: false, error: "Management Access Required" });
    next();
}

// --- AUTH ROUTES ---
app.get('/api/auth/discord/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth=failed');

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
        if (!tokenData.access_token) return res.redirect('/?auth=failed');

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

        req.session.save(() => res.redirect('/?discord=connected'));
    } catch (err) {
        res.redirect('/?auth=failed');
    }
});

app.post('/api/auth/verify-role', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(400).json({ success: false, error: "Not logged in." });
    const check = await verifyUserRoleLive(req.session.user.id);
    if (!check || !check.hasRole) return res.status(403).json({ success: false, error: "Role verification failed." });
    
    if (check.nickname) req.session.user.displayName = check.nickname;
    req.session.user.isManager = check.isManager;
    req.session.verifiedRole = true;
    req.session.save(() => res.json({ success: true, user: req.session.user }));
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
        return res.json({ success: false, discordConnected: true, user: req.session.user });
    }
    res.json({ success: false });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// --- DEPARTMENTS API ENDPOINTS ---
app.get('/api/departments/list', async (req, res) => {
    res.json({ success: true, departments: departmentsData });
});

app.get('/api/departments/my-status', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });

    const userId = req.session.user.id;
    const userDeptStatuses = [];

    for (const dept of departmentsData) {
        const isVerified = await checkUserDepartmentRole(userId, dept.guildId, dept.verifiedRoleId);
        const isOnShift = activeShifts.some(s => s.userId === userId && s.deptId === dept.id);

        userDeptStatuses.push({
            deptId: dept.id,
            deptName: dept.name,
            shortName: dept.shortName,
            active: dept.active,
            isVerifiedWorker: isVerified,
            isOnShift
        });
    }

    res.json({ success: true, userDepartments: userDeptStatuses });
});

app.post('/api/departments/update', requireManagerAuth, (req, res) => {
    const { deptId, active, webhookUrl, description, autoClockOutHours, inGameReq } = req.body || {};
    const dept = departmentsData.find(d => d.id === deptId);

    if (!dept) return res.status(404).json({ success: false, error: "Department not found" });

    if (active !== undefined) dept.active = !!active;
    if (webhookUrl !== undefined) dept.webhookUrl = webhookUrl.trim();
    if (description !== undefined) dept.description = description.trim();
    if (autoClockOutHours !== undefined) dept.autoClockOutHours = parseInt(autoClockOutHours) || 4;
    if (inGameReq !== undefined) dept.inGameReq = !!inGameReq;

    addNotification("Department Updated", `${dept.shortName} settings updated by Management.`);
    res.json({ success: true, department: dept });
});

app.post('/api/departments/shift/toggle', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { deptId, action } = req.body || {};
    const user = req.session.user;

    const dept = departmentsData.find(d => d.id === deptId);
    if (!dept || !dept.active) return res.status(400).json({ success: false, error: "Department is inactive or invalid." });

    const isVerified = await checkUserDepartmentRole(user.id, dept.guildId, dept.verifiedRoleId);
    if (!isVerified && !user.isManager) {
        return res.status(403).json({ success: false, error: "Missing Verified Worker Role for this Department Server!" });
    }

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));
        activeShifts.push({
            userId: user.id,
            username: user.username,
            robloxName: user.displayName || user.username,
            avatar: user.avatar,
            startTime: Date.now(),
            department: dept.shortName,
            deptId: dept.id
        });

        const logEmbed = new EmbedBuilder()
            .setTitle(`🟢 Department Shift Clocked In: ${dept.shortName}`)
            .setColor(0x57f287)
            .addFields(
                { name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true },
                { name: "Department", value: dept.name, inline: true },
                { name: "Clock-In Time", value: new Date().toLocaleString(), inline: false }
            )
            .setFooter({ text: `${serverConfig.serverName} Department Duty System` });

        // Send to Department Specific Webhook AND General Shift Webhook
        if (dept.webhookUrl) sendDiscordLog(dept.webhookUrl, logEmbed.toJSON());
        if (botConfig.shiftWebhook) sendDiscordLog(botConfig.shiftWebhook, logEmbed.toJSON());

    } else {
        const existing = activeShifts.find(s => s.userId === user.id && s.deptId === deptId);
        if (existing) {
            completedShifts.unshift({
                id: `shift_${Date.now()}`,
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatar,
                startTime: existing.startTime,
                endTime: Date.now(),
                durationMinutes: Math.floor((Date.now() - existing.startTime) / 60000),
                shiftType: dept.shortName,
                waveId: "wave_1"
            });
        }
        activeShifts = activeShifts.filter(s => !(s.userId === user.id && s.deptId === deptId));

        const logEmbed = new EmbedBuilder()
            .setTitle(`🔴 Department Shift Clocked Out: ${dept.shortName}`)
            .setColor(0xed4245)
            .addFields(
                { name: "Worker", value: `${user.displayName} (<@${user.id}>)`, inline: true },
                { name: "Department", value: dept.name, inline: true },
                { name: "Clock-Out Time", value: new Date().toLocaleString(), inline: false }
            )
            .setFooter({ text: `${serverConfig.serverName} Department Duty System` });

        if (dept.webhookUrl) sendDiscordLog(dept.webhookUrl, logEmbed.toJSON());
        if (botConfig.shiftWebhook) sendDiscordLog(botConfig.shiftWebhook, logEmbed.toJSON());
    }

    res.json({ success: true });
});

// --- MEMBERS DIRECTORY ---
app.get('/api/members', async (req, res) => {
    try {
        if (!discordClient || !discordClient.isReady()) return res.status(503).json({ success: false, error: "Bot not ready" });

        const guild = await discordClient.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        const staffMembers = [];

        members.forEach(member => {
            if (member.user.bot) return;

            const userStaffRoleIndexes = member.roles.cache
                .map(role => STAFF_ROLE_IDS_ASC.indexOf(role.id))
                .filter(idx => idx !== -1);

            if (userStaffRoleIndexes.length > 0) {
                const highestIndex = Math.max(...userStaffRoleIndexes);
                const highestRoleId = STAFF_ROLE_IDS_ASC[highestIndex];
                const highestRole = guild.roles.cache.get(highestRoleId);
                const activeStrikes = staffInfractionLogs.filter(i => i.targetUserId === member.id && !i.removed).length;

                staffMembers.push({
                    id: member.id,
                    username: member.user.username,
                    displayName: member.displayName || member.user.username,
                    avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
                    roleName: highestRole ? highestRole.name : "Staff Member",
                    roleId: highestRoleId,
                    rankIndex: highestIndex,
                    activeStrikes
                });
            }
        });

        staffMembers.sort((a, b) => b.rankIndex - a.rankIndex);
        res.json({ success: true, members: staffMembers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- ACTIVITY & SHIFTS ENDPOINTS ---
app.get('/api/activity/waves', (req, res) => {
    const enriched = activityWaves.map(wave => {
        const waveShifts = completedShifts.filter(s => s.waveId === wave.id);
        const totalMins = waveShifts.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
        return {
            ...wave,
            totalShifts: waveShifts.length,
            onlineTimeFormatted: `${Math.floor(totalMins / 60)} hours ${totalMins % 60} minutes`,
            breakTimeFormatted: "0 seconds"
        };
    });
    res.json({ success: true, waves: enriched });
});

app.get('/api/activity/custom-requirements', requireManagerAuth, async (req, res) => {
    try {
        const guild = await discordClient.guilds.fetch(GUILD_ID);
        const roles = CUSTOM_ACTIVITY_ROLE_IDS.map(roleId => {
            const role = guild.roles.cache.get(roleId);
            return { id: roleId, name: role ? role.name : `Role (${roleId})`, requiredHours: customActivityRequirements[roleId] || 0 };
        });
        res.json({ success: true, roles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/activity/custom-requirements', requireManagerAuth, (req, res) => {
    const { requirements } = req.body || {};
    if (requirements) {
        Object.keys(requirements).forEach(id => {
            if (CUSTOM_ACTIVITY_ROLE_IDS.includes(id)) customActivityRequirements[id] = parseInt(requirements[id]) || 0;
        });
        return res.json({ success: true });
    }
    res.status(400).json({ success: false });
});

app.get('/api/shifts/active', requireStaffAuth, (req, res) => {
    const formatted = activeShifts.map(s => {
        const durationMs = Date.now() - s.startTime;
        const totalMins = Math.floor(durationMs / 60000);
        return { ...s, duration: `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` };
    });
    res.json({ success: true, activeShifts: formatted, isManager: req.session.user.isManager });
});

app.post('/api/shifts/toggle', requireStaffAuth, async (req, res) => {
    const { action, department } = req.body || {};
    const discordUser = req.session.user;

    if (action === 'CLOCK_IN') {
        activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
        activeShifts.push({
            userId: discordUser.id,
            username: discordUser.username,
            robloxName: discordUser.displayName || discordUser.username,
            avatar: discordUser.avatar,
            startTime: Date.now(),
            department: department || "General Staff"
        });
    } else {
        const existing = activeShifts.find(s => s.userId === discordUser.id);
        if (existing) {
            completedShifts.unshift({
                id: `shift_${Date.now()}`,
                userId: discordUser.id,
                username: discordUser.username,
                displayName: discordUser.displayName,
                avatarUrl: discordUser.avatar,
                startTime: existing.startTime,
                endTime: Date.now(),
                durationMinutes: Math.floor((Date.now() - existing.startTime) / 60000),
                shiftType: "Default",
                waveId: "wave_1"
            });
        }
        activeShifts = activeShifts.filter(s => s.userId !== discordUser.id);
    }
    res.json({ success: true });
});

app.post('/api/shifts/force-end', requireManagerAuth, (req, res) => {
    const { targetUserId } = req.body || {};
    activeShifts = activeShifts.filter(s => s.userId !== targetUserId);
    res.json({ success: true });
});

// --- INFRACTIONS & PROMOTIONS ENDPOINTS ---
app.get('/api/infractions/levels', (req, res) => {
    res.json({ success: true, levels: staffInfractionLevels });
});

app.post('/api/infractions/levels/add', requireManagerAuth, (req, res) => {
    const { name } = req.body || {};
    if (name && !staffInfractionLevels.includes(name.trim())) staffInfractionLevels.push(name.trim());
    res.json({ success: true, levels: staffInfractionLevels });
});

app.post('/api/infractions/levels/remove', requireManagerAuth, (req, res) => {
    const { index } = req.body || {};
    if (index !== undefined && staffInfractionLevels[index]) staffInfractionLevels.splice(index, 1);
    res.json({ success: true, levels: staffInfractionLevels });
});

app.post('/api/infractions/issue', requireManagerAuth, async (req, res) => {
    const { targetUserId, targetUser, level, reason, proof } = req.body || {};
    const staff = req.session.user;

    const log = {
        id: `inf_${Date.now()}`,
        targetUserId,
        targetUser,
        level: level || "Warning",
        reason,
        proof: proof || "None Provided",
        issuedBy: staff.displayName || staff.username,
        createdAt: new Date().toLocaleString()
    };

    staffInfractionLogs.unshift(log);

    sendDiscordLog(botConfig.infractionWebhook, {
        title: `⚠️ Staff Infraction Issued: ${level}`,
        color: 15548997,
        fields: [
            { name: "Target Staff Member", value: `${targetUser} (<@${targetUserId}>)`, inline: true },
            { name: "Infraction Level", value: level, inline: true },
            { name: "Issued By", value: `${staff.displayName} (<@${staff.id}>)`, inline: true },
            { name: "Reason", value: reason || "No reason specified", inline: false },
            { name: "Proof / Evidence", value: proof || "None Provided", inline: false }
        ],
        footer: { text: `${serverConfig.serverName} Staff System` }
    });

    res.json({ success: true, log });
});

app.post('/api/infractions/promote', requireManagerAuth, async (req, res) => {
    const { targetUserId, targetUser, newRole, reason } = req.body || {};
    const staff = req.session.user;

    const log = {
        id: `prom_${Date.now()}`,
        targetUserId,
        targetUser,
        newRole,
        reason,
        promotedBy: staff.displayName || staff.username,
        createdAt: new Date().toLocaleString()
    };

    staffPromotionLogs.unshift(log);

    sendDiscordLog(botConfig.promotionWebhook, {
        title: `🎉 Staff Promotion / Rank Update`,
        color: 5763719,
        fields: [
            { name: "Staff Member", value: `${targetUser} (<@${targetUserId}>)`, inline: true },
            { name: "New Rank / Role", value: newRole, inline: true },
            { name: "Promoted By", value: `${staff.displayName} (<@${staff.id}>)`, inline: true },
            { name: "Reason / Notes", value: reason || "No reason specified", inline: false }
        ],
        footer: { text: `${serverConfig.serverName} Staff System` }
    });

    res.json({ success: true, log });
});

// --- SETTINGS & WEBHOOKS ENDPOINTS ---
app.get('/api/settings/general', (req, res) => res.json({ success: true, config: serverConfig }));

app.post('/api/settings/general', requireManagerAuth, (req, res) => {
    const { serverName, serverIcon, autoBanBolo, userSeeLogs, punishmentPresets } = req.body || {};
    if (serverName) serverConfig.serverName = serverName.trim();
    if (serverIcon !== undefined) serverConfig.serverIcon = serverIcon.trim();
    if (autoBanBolo !== undefined) serverConfig.autoBanBolo = autoBanBolo;
    if (userSeeLogs !== undefined) serverConfig.userSeeLogs = userSeeLogs;
    if (Array.isArray(punishmentPresets)) serverConfig.punishmentPresets = punishmentPresets;
    res.json({ success: true, config: serverConfig });
});

app.get('/api/settings/webhooks', requireManagerAuth, (req, res) => {
    res.json({ success: true, webhooks: botConfig });
});

app.post('/api/settings/webhooks', requireManagerAuth, (req, res) => {
    const { shiftWebhook, punishmentWebhook, assistanceWebhook, activityWebhook, infractionWebhook, promotionWebhook, reviewWebhook } = req.body || {};
    if (shiftWebhook !== undefined) botConfig.shiftWebhook = shiftWebhook.trim();
    if (punishmentWebhook !== undefined) botConfig.punishmentWebhook = punishmentWebhook.trim();
    if (assistanceWebhook !== undefined) botConfig.assistanceWebhook = assistanceWebhook.trim();
    if (activityWebhook !== undefined) botConfig.activityWebhook = activityWebhook.trim();
    if (infractionWebhook !== undefined) botConfig.infractionWebhook = infractionWebhook.trim();
    if (promotionWebhook !== undefined) botConfig.promotionWebhook = promotionWebhook.trim();
    if (reviewWebhook !== undefined) botConfig.reviewWebhook = reviewWebhook.trim();
    res.json({ success: true, webhooks: botConfig });
});

app.get('/api/notifications/list', (req, res) => res.json({ success: true, notifications: notificationsList }));
app.post('/api/notifications/read', (req, res) => {
    notificationsList.forEach(n => n.read = true);
    res.json({ success: true });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- DISCORD BOT BOT INITIALIZATION & COMMAND REGISTRATION ---
let discordClient;

if (BOT_TOKEN && CLIENT_ID && GUILD_ID) {
    discordClient = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    const commands = [
        new SlashCommandBuilder()
            .setName('review')
            .setDescription('Submit an official staff member review')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member to review').setRequired(true))
            .addIntegerOption(opt => 
                opt.setName('rating')
                   .setDescription('Star rating (1 to 5)')
                   .setRequired(true)
                   .addChoices(
                       { name: '⭐ (1 Star)', value: 1 },
                       { name: '⭐⭐ (2 Stars)', value: 2 },
                       { name: '⭐⭐⭐ (3 Stars)', value: 3 },
                       { name: '⭐⭐⭐⭐ (4 Stars)', value: 4 },
                       { name: '⭐⭐⭐⭐⭐ (5 Stars)', value: 5 }
                   )
            )
            .addStringOption(opt => opt.setName('note').setDescription('Your review note/feedback').setRequired(true)),

        new SlashCommandBuilder()
            .setName('shift')
            .setDescription('Clock in or clock out of a staff shift')
            .addStringOption(opt => 
                opt.setName('action')
                   .setDescription('Clock In or Clock Out')
                   .setRequired(true)
                   .addChoices(
                       { name: 'Clock In', value: 'CLOCK_IN' },
                       { name: 'Clock Out', value: 'CLOCK_OUT' }
                   )
            ),

        new SlashCommandBuilder()
            .setName('active-shifts')
            .setDescription('View all staff members currently on shift'),

        new SlashCommandBuilder()
            .setName('erlc-command')
            .setDescription('Execute an in-game command (e.g. :pm, :kick, :ban)')
            .addStringOption(opt => opt.setName('command').setDescription('The exact in-game command text').setRequired(true)),

        new SlashCommandBuilder()
            .setName('log-punishment')
            .setDescription('Log an in-game player punishment')
            .addStringOption(opt => opt.setName('player').setDescription('Target player username').setRequired(true))
            .addStringOption(opt => opt.setName('type').setDescription('Type of punishment (Warning, Kick, Ban, Ban BOLO)').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for punishment').setRequired(true))
            .addStringOption(opt => opt.setName('roblox_id').setDescription('Roblox player User ID').setRequired(false)),

        new SlashCommandBuilder()
            .setName('assistance')
            .setDescription('Request higher-up staff assistance')
            .addStringOption(opt => opt.setName('reason').setDescription('Details for assistance request').setRequired(true)),

        new SlashCommandBuilder()
            .setName('infract')
            .setDescription('Issue an official staff infraction (Management Only)')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member to infract').setRequired(true))
            .addStringOption(opt => opt.setName('level').setDescription('Infraction level (e.g. Warning, Strike 1)').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for the infraction').setRequired(true))
            .addStringOption(opt => opt.setName('proof').setDescription('Evidence/Proof Link').setRequired(false)),

        new SlashCommandBuilder()
            .setName('promote')
            .setDescription('Promote or update a staff member rank (Management Only)')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member').setRequired(true))
            .addStringOption(opt => opt.setName('new_role').setDescription('The new staff role name').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for promotion/rank change').setRequired(true)),

        new SlashCommandBuilder()
            .setName('force-end-shift')
            .setDescription('Forcefully end an active staff shift (Management Only)')
            .addUserOption(opt => opt.setName('staff').setDescription('The staff member whose shift to end').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    (async () => {
        try {
            console.log('Registering Slash Commands...');
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('All Slash Commands Registered Successfully!');
        } catch (err) {
            console.error('Command Registration Error:', err);
        }
    })();

    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName, options, channelId, member, user } = interaction;

        const isStaff = member.roles.cache.has(REQUIRED_ROLE_ID);
        const isManager = member.roles.cache.some(r => botConfig.managerRoleIds.includes(r.id));

        if (commandName === 'review') {
            if (channelId !== REVIEW_CHANNEL_ID) {
                return interaction.reply({
                    content: `❌ The \`/review\` command can only be used in <#${REVIEW_CHANNEL_ID}>!`,
                    ephemeral: true
                });
            }

            const targetUser = options.getUser('staff');
            const rating = options.getInteger('rating');
            const note = options.getString('note');

            const guildMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const targetIsStaff = guildMember && guildMember.roles.cache.has(REQUIRED_ROLE_ID);

            if (!targetIsStaff) {
                return interaction.reply({
                    content: `❌ You can only review official staff members who possess the Staff Role!`,
                    ephemeral: true
                });
            }

            const starEmojis = "⭐".repeat(rating);

            const reviewEmbed = new EmbedBuilder()
                .setTitle("Lenaris Staff Reviews")
                .setColor(0x3498db)
                .setThumbnail(serverConfig.serverIcon)
                .setDescription(
                    `Your feedback helps the Aerisgidian Government and the Lenaris Government improve our community and roleplay experience.\n\n` +
                    `If you have enjoyed your time here—or have suggestions for improvement—we encourage you to leave an honest review.\n\n` +
                    `Every review is read by the Lenaris Government.\n\n` +
                    `Glory to Aerisgard!\n` +
                    `-------------------------\n` +
                    `**Staff member:**\n<@${targetUser.id}>\n` +
                    `-------------------------\n` +
                    `**Rating:**\n${starEmojis}\n` +
                    `-------------------------\n` +
                    `**Note:** ${note}`
                );

            await interaction.reply({ embeds: [reviewEmbed] });

            if (botConfig.reviewWebhook) {
                sendDiscordLog(botConfig.reviewWebhook, reviewEmbed.toJSON());
            }
            return;
        }

        if (['shift', 'active-shifts', 'erlc-command', 'log-punishment', 'assistance'].includes(commandName)) {
            if (!isStaff && !isManager) {
                return interaction.reply({ content: '❌ Access Denied: You must possess the Staff Role to use this command.', ephemeral: true });
            }
        }

        if (commandName === 'shift') {
            const action = options.getString('action');
            if (action === 'CLOCK_IN') {
                activeShifts = activeShifts.filter(s => s.userId !== user.id);
                activeShifts.push({
                    userId: user.id,
                    username: user.username,
                    robloxName: member.displayName || user.username,
                    avatar: user.displayAvatarURL(),
                    startTime: Date.now(),
                    department: "Staff Moderation"
                });
                await interaction.reply({ content: `🟢 **Clocked In** for shift!`, ephemeral: true });
            } else {
                activeShifts = activeShifts.filter(s => s.userId !== user.id);
                await interaction.reply({ content: `🔴 **Clocked Out** of shift!`, ephemeral: true });
            }

            sendDiscordLog(botConfig.shiftWebhook, {
                title: action === 'CLOCK_IN' ? "🟢 Shift Clocked In" : "🔴 Shift Clocked Out",
                color: action === 'CLOCK_IN' ? 5763719 : 15548997,
                fields: [
                    { name: "Staff Member", value: `<@${user.id}>`, inline: true },
                    { name: "Time", value: new Date().toLocaleString(), inline: false }
                ]
            });
            return;
        }

        if (commandName === 'active-shifts') {
            if (activeShifts.length === 0) {
                return interaction.reply({ content: 'ℹ️ No staff members are currently on shift.', ephemeral: true });
            }

            const list = activeShifts.map(s => `<@${s.userId}> (${Math.floor((Date.now() - s.startTime) / 60000)}m)`).join('\n');
            return interaction.reply({
                embeds: [new EmbedBuilder().setTitle("Active Staff On Shift").setColor(0x57f287).setDescription(list)],
                ephemeral: true
            });
        }

        if (commandName === 'erlc-command') {
            const cmd = options.getString('command');
            if (!ERLC_API_KEY) return interaction.reply({ content: '❌ ER:LC API Key is not configured.', ephemeral: true });

            try {
                const res = await fetch('https://api.erlc.gg/v1/server/command', {
                    method: 'POST',
                    headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: cmd })
                });

                if (res.ok) {
                    interaction.reply({ content: `✅ Command sent to ER:LC server: \`${cmd}\``, ephemeral: true });
                } else {
                    interaction.reply({ content: `❌ Failed to execute command.`, ephemeral: true });
                }
            } catch (err) {
                interaction.reply({ content: `❌ Connection error.`, ephemeral: true });
            }
            return;
        }

        if (commandName === 'log-punishment') {
            const targetPlayer = options.getString('player');
            const type = options.getString('type');
            const reason = options.getString('reason');
            const rId = options.getString('roblox_id') || 'N/A';

            punishmentLogs.unshift({
                id: punishmentLogs.length + 1,
                targetUser: targetPlayer,
                robloxId: rId,
                punishmentType: type,
                reason,
                staffName: user.username,
                removed: false,
                createdAt: new Date().toLocaleString()
            });

            const embed = new EmbedBuilder()
                .setTitle(`🔨 Punishment Logged: ${type}`)
                .setColor(0xed4245)
                .addFields(
                    { name: "Target Player", value: targetPlayer, inline: true },
                    { name: "Roblox ID", value: rId, inline: true },
                    { name: "Issued By", value: `<@${user.id}>`, inline: true },
                    { name: "Reason", value: reason, inline: false }
                );

            await interaction.reply({ content: `✅ Punishment logged for **${targetPlayer}**!`, ephemeral: true });
            sendDiscordLog(botConfig.punishmentWebhook, embed.toJSON());
            return;
        }

        if (commandName === 'assistance') {
            const reason = options.getString('reason');
            const supportPing = SUPPORT_ROLE_IDS.map(id => `<@&${id}>`).join(' ');

            sendDiscordLog(botConfig.assistanceWebhook, {
                title: "🚨 Staff Assistance Requested",
                color: 15548997,
                fields: [
                    { name: "Requested By", value: `<@${user.id}>`, inline: true },
                    { name: "Details", value: reason, inline: false }
                ]
            }, `🚨 **STAFF ASSISTANCE NEEDED**\n${supportPing}`);

            return interaction.reply({ content: '🚨 Assistance request sent to higher-ups!', ephemeral: true });
        }

        if (['infract', 'promote', 'force-end-shift'].includes(commandName)) {
            if (!isManager) {
                return interaction.reply({ content: '❌ Access Denied: Management permissions required.', ephemeral: true });
            }
        }

        if (commandName === 'infract') {
            const targetUser = options.getUser('staff');
            const level = options.getString('level');
            const reason = options.getString('reason');
            const proof = options.getString('proof') || "None Provided";

            staffInfractionLogs.unshift({
                id: `inf_${Date.now()}`,
                targetUserId: targetUser.id,
                targetUser: targetUser.username,
                level,
                reason,
                proof,
                issuedBy: user.username,
                createdAt: new Date().toLocaleString()
            });

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Staff Infraction Issued: ${level}`)
                .setColor(0xed4245)
                .addFields(
                    { name: "Staff Member", value: `<@${targetUser.id}>`, inline: true },
                    { name: "Infraction Level", value: level, inline: true },
                    { name: "Issued By", value: `<@${user.id}>`, inline: true },
                    { name: "Reason", value: reason, inline: false },
                    { name: "Proof / Evidence", value: proof, inline: false }
                )
                .setFooter({ text: `${serverConfig.serverName} Staff System` });

            await interaction.reply({ content: `✅ Issued **${level}** to <@${targetUser.id}>!`, ephemeral: true });
            sendDiscordLog(botConfig.infractionWebhook, embed.toJSON());
            return;
        }

        if (commandName === 'promote') {
            const targetUser = options.getUser('staff');
            const newRole = options.getString('new_role');
            const reason = options.getString('reason');

            staffPromotionLogs.unshift({
                id: `prom_${Date.now()}`,
                targetUserId: targetUser.id,
                targetUser: targetUser.username,
                newRole,
                reason,
                promotedBy: user.username,
                createdAt: new Date().toLocaleString()
            });

            const embed = new EmbedBuilder()
                .setTitle(`🎉 Staff Promotion / Rank Update`)
                .setColor(0x57f287)
                .addFields(
                    { name: "Staff Member", value: `<@${targetUser.id}>`, inline: true },
                    { name: "New Rank / Role", value: newRole, inline: true },
                    { name: "Promoted By", value: `<@${user.id}>`, inline: true },
                    { name: "Reason / Notes", value: reason, inline: false }
                )
                .setFooter({ text: `${serverConfig.serverName} Staff System` });

            await interaction.reply({ content: `✅ Updated rank for <@${targetUser.id}> to **${newRole}**!`, ephemeral: true });
            sendDiscordLog(botConfig.promotionWebhook, embed.toJSON());
            return;
        }

        if (commandName === 'force-end-shift') {
            const targetUser = options.getUser('staff');
            activeShifts = activeShifts.filter(s => s.userId !== targetUser.id);
            return interaction.reply({ content: `🛑 Ended active shift for <@${targetUser.id}>.`, ephemeral: true });
        }
    });

    discordClient.once('ready', () => {
        console.log(`[DISCORD] Logged in as ${discordClient.user.tag}`);
    });

    discordClient.login(BOT_TOKEN);
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
