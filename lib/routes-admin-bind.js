// ── lib/routes-admin-bind.js ─────────────────────────────────────────────
// Admin LINE binding endpoints. Lets the authenticated owner link a LINE
// userId so they receive /api/line/broadcast messages alongside guild members.
//
// Schema:
//   bindCodes/{code}        → reused. When the doc carries an `adminEmail`
//                             field the LINE bot recognises it as an admin
//                             bind and writes adminLineBinds/{email}
//                             instead of running the member-onboarding flow.
//   adminLineBinds/{email}  → { email, lineUserId, displayName, boundAt }
//
// Endpoints (all gated by the requireAdmin middleware passed in by server.js):
//   GET    /api/admin/line-bind        → current admin's bind state
//   POST   /api/admin/line-bind/code   → generate a 6-digit code valid 24 h
//   DELETE /api/admin/line-bind        → unbind the admin's LINE account
//
'use strict';

const { logActivity } = require('./activity');

function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function adminEmailFromReq(req) {
    // 本地管理員以 username 作為識別（取代原本的 Google email）
    return (req.adminEmail || req.userEmail || '').toLowerCase();
}

module.exports = function registerAdminBindRoutes(app, firebase, requireAdmin) {

    // GET /api/admin/line-bind ────────────────────────────────────────
    app.get('/api/admin/line-bind', requireAdmin, async (req, res) => {
        try {
            const email = adminEmailFromReq(req);
            if (!email) return res.status(400).json({ ok: false, error: '缺少 admin 識別' });
            const data = await firebase.getDocument('adminLineBinds', email);
            if (!data) return res.json({ ok: true, bound: false, email });
            return res.json({
                ok: true,
                bound: true,
                email,
                lineUserId: data.lineUserId,
                displayName: data.displayName || '',
                boundAt: data.boundAt || null,
            });
        } catch (e) {
            console.error('[admin-bind] status error:', e.message);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // POST /api/admin/line-bind/code ──────────────────────────────────
    app.post('/api/admin/line-bind/code', requireAdmin, async (req, res) => {
        try {
            const email = adminEmailFromReq(req);
            if (!email) return res.status(400).json({ ok: false, error: '缺少 admin 識別' });

            const code = genCode();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await firebase.addData('bindCodes', {
                ID: code,
                code,
                adminEmail: email,             // ← marks this code as admin-binding
                createdBy: email,
                createdAt: new Date().toISOString(),
                expiresAt: expiresAt.toISOString(),
                used: false,
            });
            logActivity(firebase, {
                action: 'generate-bind-code',
                module: 'admin',
                actor: email,
                target: code,
                detail: '管理員產生 LINE 綁定碼',
            });
            return res.json({ ok: true, code, expiresAt: expiresAt.toISOString() });
        } catch (e) {
            console.error('[admin-bind] code generation error:', e.message);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // DELETE /api/admin/line-bind ─────────────────────────────────────
    app.delete('/api/admin/line-bind', requireAdmin, async (req, res) => {
        try {
            const email = adminEmailFromReq(req);
            if (!email) return res.status(400).json({ ok: false, error: '缺少 admin 識別' });

            const data = await firebase.getDocument('adminLineBinds', email);
            if (!data) return res.json({ ok: true, alreadyUnbound: true });

            await firebase.deleteData('adminLineBinds', email);
            logActivity(firebase, {
                action: 'unbind',
                module: 'admin',
                actor: email,
                target: email,
                detail: '管理員解除 LINE 綁定',
            });
            return res.json({ ok: true });
        } catch (e) {
            console.error('[admin-bind] unbind error:', e.message);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });
};
