const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Discord Webhook URL
const DISCORD_WEBHOOK = "https://discord.com/api/v10/webhooks/1521283484021162146/4M4gKnNPOUGKL-d-FEE02pbnno3PwkKWvUgIs0LODYxOVwSx6uZ6Qfk-K641-SmDhApg";

// In-Memory Infraction Storage
const punishmentLogs = [];

// ER:LC API Key from Render Environment Settings
const ERLC_API_KEY = process.env.ERLC_API_KEY || "";
const erlcHeaders = {
    'Server-Key': ERLC_API_KEY,
    'Content-Type': 'application/json'
};

// 1. Shift Tracker Endpoint
app.post('/api/shifts/toggle', async (req, res) => {
    try {
        const { staffName, action, department } = req.body || {};
        if (!staffName) return res.status(400).json({ success: false, error: "Staff name is required." });

        const timestamp = new Date().toLocaleString();

        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: action === 'CLOCK_IN' ? "🟢 Shift Started" : "🔴 Shift Ended",
                    color: action === 'CLOCK_IN' ? 5763719 : 15548997,
                    fields: [
                        { name: "Staff Member", value: staffName, inline: true },
                        { name: "Department", value: department || "General Staff", inline: true },
                        { name: "Time", value: timestamp, inline: false }
                    ],
                    footer: { text: "Melonly Staff Panel • Planet Lenaris" }
                }]
            })
        }).catch(err => console.error("Webhook Error:", err));

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Punishment Log Endpoint
app.post('/api/punishments/create', async (req, res) => {
    try {
        const { targetUser, robloxId, punishmentType, reason, staffName } = req.body || {};

        if (!targetUser || !reason || !staffName) {
            return res.status(400).json({ success: false, error: "Target User, Reason, and Staff Name are required!" });
        }

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

        // Send to Discord
        await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: ⚠️ New Punishment Logged: ${logEntry.punishmentType}`,
                    color: logEntry.punishmentType === 'Ban' ? 15548997 : (logEntry.punishmentType === 'Kick' ? 16744192 : 16776960),
                    fields: [
                        { name: "Target User", value: targetUser, inline: true },
                        { name: "Roblox ID", value: logEntry.robloxId, inline: true },
                        { name: "Punishment Type", value: logEntry.punishmentType, inline: true },
                        { name: "Reason", value: reason, inline: false },
                        { name: "Logged By Staff", value: staffName, inline: true },
                        { name: "Timestamp", value: logEntry.createdAt, inline: true }
                    ],
                    footer: { text: "Melonly Punishment System • Planet Lenaris" }
                }]
            })
        }).catch(err => console.error("Webhook Error:", err));

        res.json({ success: true, log: logEntry });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Get Punishment Logs List
app.get('/api/punishments/list', (req, res) => {
    res.json({ success: true, logs: punishmentLogs });
});

// 4. ER:LC Command Sender (:pm, :hint, :m)
app.post('/api/erlc/command', async (req, res) => {
    try {
        const { command } = req.body || {};
        if (!command) return res.status(400).json({ success: false, error: "Command required!" });

        if (!ERLC_API_KEY) {
            return res.status(500).json({ success: false, error: "ERLC_API_KEY missing in Render environment variables." });
        }

        const response = await fetch('https://api.policeroleplay.community/v1/server/command', {
            method: 'POST',
            headers: erlcHeaders,
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

// 5. ER:LC Command Logs Feed
app.get('/api/erlc/logs', async (req, res) => {
    try {
        if (!ERLC_API_KEY) {
            return res.status(200).json({ success: false, data: [], error: "ERLC_API_KEY not set." });
        }

        const response = await fetch('https://api.policeroleplay.community/v1/server/commandlogs', {
            headers: erlcHeaders
        });
        
        if (!response.ok) {
            return res.status(200).json({ success: false, data: [] });
        }

        const data = await response.json();
        res.json({ success: true, data: data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Serve frontend SPA for all remaining routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Melonly Staff Panel running on port ${PORT}`);
});