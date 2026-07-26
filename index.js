app.post('/api/punishments/create', requireStaffAuth, async (req, res) => {
    try {
        const { targetUser, robloxId, punishmentType, reason } = req.body || {};
        const discordUser = req.session.user;

        // 1. Get Staff Roblox Username from Discord Display Name (extracts text after "|")
        let staffRobloxName = discordUser.username;
        if (discordUser.displayName && discordUser.displayName.includes('|')) {
            const parts = discordUser.displayName.split('|');
            staffRobloxName = parts[parts.length - 1].trim(); // Takes the username after the |
        }

        // 2. Count existing warnings for this specific target player
        const existingWarnings = punishmentLogs.filter(
            log => log.targetUser.toLowerCase() === targetUser.toLowerCase() && log.punishmentType === 'Warning'
        ).length;

        const currentWarningCount = existingWarnings + 1;
        const warningsLeft = Math.max(0, 3 - currentWarningCount);

        // 3. Create Log Entry
        const logEntry = {
            id: punishmentLogs.length + 1,
            targetUser,
            robloxId: robloxId || 'N/A',
            punishmentType: punishmentType || 'Warning',
            reason,
            staffName: staffRobloxName,
            createdAt: new Date().toLocaleString()
        };

        punishmentLogs.unshift(logEntry);

        // 4. Send In-Game PM if the punishment is a Warning
        if (punishmentType === 'Warning' && ERLC_API_KEY) {
            const pmCommand = `:pm ${targetUser} You have ${currentWarningCount} warning(s). You have ${warningsLeft} warning(s) left until 3 warnings, if you get 3 warnings in total you will automatically be kicked. Reason: ${reason} | Staff: ${staffRobloxName}`;

            await fetch('https://api.erlc.gg/v1/server/command', {
                method: 'POST',
                headers: { 'Server-Key': ERLC_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: pmCommand })
            }).catch(err => console.error("Failed to send in-game warning PM:", err));
        }

        // 5. Send Discord Webhook Notification
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
                        { name: "Warning Count", value: `${currentWarningCount}/3`, inline: true },
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
