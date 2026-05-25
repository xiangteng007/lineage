// ── lib/routes-liff.js ───────────────────────────────────────────────────
// LIFF (LINE Front-end Framework) bridge endpoints used by public/liff/attend.html
// and the admin "LINE 健康狀態" panel.
//
// All endpoints are additive and do NOT shadow any existing route.
//
//   GET  /api/liff/config   → { liffId, configured }
//   POST /api/liff/profile  → verifies LIFF access token via LINE /v2/profile,
//                             returns profile + member binding state
//   POST /api/liff/attend   → adds the bound member into a Battle/Siege attendance
//                             list (idempotent — same member confirms once)
//   GET  /api/line/status   → minimal health check of LINE channel / LIFF / webhook
//                             configuration (no secrets returned)
'use strict';

const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

function envFlag(name) {
    const v = (process.env[name] || '').trim();
    return Boolean(v) && v !== 'DUMMY_SECRET' && v !== 'DUMMY_TOKEN';
}

function pickPerson(members, alliances, lineUserId) {
    return [...members, ...alliances].find(p => p && p.lineUserId === lineUserId) || null;
}

function parseAttendance(record) {
    try {
        return typeof record.attendance === 'string'
            ? JSON.parse(record.attendance)
            : (record.attendance || []);
    } catch (e) {
        return [];
    }
}

module.exports = function registerLiffRoutes(app, firebase) {

    // ── GET /api/liff/config ────────────────────────────────────────────
    // Public — attend.html calls this before liff.init().
    app.get('/api/liff/config', (req, res) => {
        const liffId = (process.env.LINE_LIFF_ID || '').trim();
        res.json({
            liffId,
            configured: Boolean(liffId),
        });
    });

    // ── POST /api/liff/profile ──────────────────────────────────────────
    // Body: { accessToken }
    // Verifies the LIFF access token by calling LINE /v2/profile, then looks up
    // the member binding via lineUserId.
    app.post('/api/liff/profile', async (req, res) => {
        const accessToken = req.body && req.body.accessToken;
        if (!accessToken) {
            return res.status(400).json({ ok: false, error: '缺少 accessToken' });
        }

        let profile;
        try {
            const r = await fetch(LINE_PROFILE_URL, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!r.ok) {
                return res.status(401).json({ ok: false, error: 'LINE access token 無效或已過期' });
            }
            profile = await r.json();
        } catch (e) {
            console.error('[liff/profile] LINE API error:', e.message);
            return res.status(502).json({ ok: false, error: '無法連線 LINE 驗證服務' });
        }

        const [members, alliances] = await Promise.all([
            firebase.getAllData('Members'),
            firebase.getAllData('Alliances'),
        ]);
        const person = pickPerson(members, alliances, profile.userId);

        if (!person) {
            return res.json({
                ok: true,
                profile,
                isBound: false,
                boundMember: null,
            });
        }

        return res.json({
            ok: true,
            profile,
            isBound: true,
            boundMember: {
                id: person.ID || person.id,
                name: person.name || person.Name || '',
                tier: person.tier || '',
                job: person.job || '',
                level: person.level || null,
            },
        });
    });

    // ── POST /api/liff/attend ───────────────────────────────────────────
    // Body: { lineUserId, recordId, type: 'battle' | 'siege' }
    // Adds the bound member into the record's attendance array (idempotent).
    app.post('/api/liff/attend', async (req, res) => {
        const { lineUserId, recordId, type } = req.body || {};
        if (!lineUserId || !recordId) {
            return res.status(400).json({ ok: false, error: '缺少必要參數' });
        }

        const collection = type === 'siege' ? 'Sieges' : 'Battles';

        const [members, alliances, record] = await Promise.all([
            firebase.getAllData('Members'),
            firebase.getAllData('Alliances'),
            firebase.getDocument(collection, recordId),
        ]);

        const person = pickPerson(members, alliances, lineUserId);
        if (!person) {
            return res.status(403).json({ ok: false, error: '此 LINE 帳號尚未綁定血盟成員' });
        }
        if (!record) {
            return res.status(404).json({ ok: false, error: '找不到對應的戰役紀錄' });
        }

        const attendance = parseAttendance(record);
        const memberId = person.ID || person.id;
        const memberName = person.name || person.Name || '未知';

        if (attendance.includes(memberId)) {
            return res.json({
                ok: true,
                alreadyConfirmed: true,
                memberName,
            });
        }

        attendance.push(memberId);
        const updated = await firebase.updateData(collection, recordId, {
            attendance: JSON.stringify(attendance),
        });
        if (!updated) {
            return res.status(500).json({ ok: false, error: '寫入失敗，請稍後再試' });
        }

        return res.json({
            ok: true,
            alreadyConfirmed: false,
            memberName,
        });
    });

    // ── GET /api/line/status ────────────────────────────────────────────
    // Health check for the LINE channel / LIFF / webhook wiring. Returns only
    // booleans — never the underlying secrets.
    app.get('/api/line/status', (req, res) => {
        res.json({
            ok: true,
            channelSecretConfigured: envFlag('LINE_CHANNEL_SECRET'),
            channelAccessTokenConfigured: envFlag('LINE_CHANNEL_ACCESS_TOKEN'),
            liffConfigured: envFlag('LINE_LIFF_ID'),
            webhookPath: '/webhook/line',
        });
    });
};
