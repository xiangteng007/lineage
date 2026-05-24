// ── lib/routes-auth.js ───────────────────────────────────────────────────
// Member identity + permissions endpoint for LINE (LIFF) logins.
// GET /api/me — identify the logged-in LINE member and return their profile,
// resolved roleLevel and per-module permission map for UI gating.
//
// Identity source (in priority order):
//   1. x-firebase-token header  -> verified, uid === lineUserId (secure)
//   2. ?lineUserId= query param -> open-mode fallback (matches existing GETs)
'use strict';

const perms = require('./permissions');

module.exports = function registerAuthRoutes(app, firebase, agg) {
    app.get('/api/me', async (req, res) => {
        try {
            let lineUserId = req.query.lineUserId || null;

            // Prefer a verified Firebase ID token when provided
            const token = req.headers['x-firebase-token'];
            if (token) {
                try {
                    const admin = require('firebase-admin');
                    const decoded = await admin.auth().verifyIdToken(token);
                    lineUserId = decoded.uid || lineUserId; // custom token uses lineUserId as uid
                } catch (e) {
                    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '無效的登入憑證' });
                }
            }

            if (!lineUserId) return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: '缺少 lineUserId' });

            const members = await firebase.getAllData('Members');
            const member = members.find(m => m.lineUserId === lineUserId) || null;
            const actionCfg = (await firebase.getDocument('settings', 'permissions')) || {};

            if (!member) {
                // Bound LINE account not yet paired to a member record -> guest
                return res.json({
                    ok: true,
                    data: { bound: false, lineUserId, roleLevel: 0, role: perms.roleName(0), permissions: perms.buildPermissions(0), actionPerms: perms.buildActionPermissions(0, actionCfg) },
                });
            }

            const roleLevel = perms.resolveRoleLevel(member, false);
            const [battles, sieges] = await Promise.all([
                firebase.getAllData('Battles'),
                firebase.getAllData('Sieges'),
            ]);
            const id = member.ID || member.id;
            const battleCount = battles.filter(b => agg.parseArray(b.attendance).includes(id)).length;
            const siegeCount = sieges.filter(s => agg.parseArray(s.attendance).includes(id)).length;

            return res.json({
                ok: true,
                data: {
                    bound: true,
                    member,
                    memberId: id,
                    roleLevel,
                    role: perms.roleName(roleLevel),
                    permissions: perms.buildPermissions(roleLevel),
                    actionPerms: perms.buildActionPermissions(roleLevel, actionCfg),
                    battleCount,
                    siegeCount,
                    lineBound: true,
                },
            });
        } catch (e) {
            return res.status(500).json({ ok: false, code: 'INTERNAL', error: e.message });
        }
    });
};
