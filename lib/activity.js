// ── lib/activity.js ──────────────────────────────────────────────────────
// Best-effort global activity log. Writes to the `activityLog` collection so
// the Overview "Activity Feed" (and future onSnapshot listeners) have data.
// Never throws — logging failures must not break the originating request.
'use strict';

/**
 * @param {object} firebase  the ./firebase module (uses addData)
 * @param {object} evt { action, module, actor, target, detail }
 */
async function logActivity(firebase, evt = {}) {
    try {
        if (!firebase || typeof firebase.addData !== 'function') return;
        const entry = {
            action: evt.action || 'unknown',
            module: evt.module || 'system',
            actor: evt.actor || 'system',
            target: evt.target || '',
            detail: evt.detail || '',
            createdAt: new Date().toISOString(),
        };
        await firebase.addData('activityLog', entry);
    } catch (e) {
        console.error('logActivity failed:', e && e.message);
    }
}

module.exports = { logActivity };
