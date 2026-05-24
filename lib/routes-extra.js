// ── lib/routes-extra.js ──────────────────────────────────────────────────
// Additive, read-only endpoints (Sprint A: A2 + parts of A3). Registered
// before the SPA catch-all. All endpoints are purely additive — they do not
// alter or shadow any existing route, so the current front-end is unaffected.
'use strict';

module.exports = function registerExtraRoutes(app, firebase, agg, httpx) {

    // ── /api/overview — single-call dashboard aggregation ────────────────
    app.get('/api/overview', async (req, res) => {
        try {
            const [members, battles, sieges, alliances, transactions] = await Promise.all([
                firebase.getAllData('Members'),
                firebase.getAllData('Battles'),
                firebase.getAllData('Sieges'),
                firebase.getAllData('Alliances'),
                firebase.getAllData('Transactions'),
            ]);
            const limit = parseInt(req.query.limit, 10) || 10;
            const data = agg.buildOverview({ members, battles, sieges, alliances, transactions, now: new Date(), limit });
            return httpx.ok(res, data);
        } catch (e) {
            return httpx.fail(res, 500, 'INTERNAL', e.message);
        }
    });

    // ── /api/stats/* ─────────────────────────────────────────────────────
    app.get('/api/stats/class-distribution', async (req, res) => {
        const members = await firebase.getAllData('Members');
        return httpx.ok(res, agg.classDistribution(members));
    });

    app.get('/api/stats/attendance-leaderboard', async (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 10;
        const [battles, sieges, members] = await Promise.all([
            firebase.getAllData('Battles'),
            firebase.getAllData('Sieges'),
            firebase.getAllData('Members'),
        ]);
        return httpx.ok(res, agg.attendanceLeaderboard(battles, sieges, members, limit));
    });

    app.get('/api/stats/treasury-trend', async (req, res) => {
        const months = parseInt(req.query.months, 10) || 6;
        const transactions = await firebase.getAllData('Transactions');
        return httpx.ok(res, agg.treasuryTrend(transactions, months, new Date()));
    });

    // ── /api/treasury/stats — trend + category breakdown ─────────────────
    app.get('/api/treasury/stats', async (req, res) => {
        const months = parseInt(req.query.months, 10) || 6;
        const transactions = await firebase.getAllData('Transactions');
        const now = new Date();
        return httpx.ok(res, {
            balance: agg.computeBalance(transactions),
            thisMonth: agg.monthlyTotals(transactions, now),
            trend: agg.treasuryTrend(transactions, months, now),
            categoryBreakdown: agg.categoryBreakdown(transactions),
            txCount: transactions.length,
        });
    });

    // ── /api/activity-feed — recent global activity ──────────────────────
    app.get('/api/activity-feed', async (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 20;
        let log = await firebase.getAllData('activityLog');
        log.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return httpx.ok(res, log.slice(0, limit));
    });

    // ── /api/members/:id — single member detail ──────────────────────────
    app.get('/api/members/:id', async (req, res) => {
        const member = await firebase.getDocument('Members', req.params.id);
        if (!member) return httpx.fail(res, 404, 'NOT_FOUND', '找不到該成員');
        const [battles, sieges] = await Promise.all([
            firebase.getAllData('Battles'),
            firebase.getAllData('Sieges'),
        ]);
        const id = member.ID || member.id;
        const battleCount = battles.filter(b => agg.parseArray(b.attendance).includes(id)).length;
        const siegeCount = sieges.filter(s => agg.parseArray(s.attendance).includes(id)).length;
        return httpx.ok(res, { ...member, battleCount, siegeCount, lineBound: !!member.lineUserId });
    });

    // ── /api/members/:id/attendance-history — battles + sieges attended ──
    app.get('/api/members/:id/attendance-history', async (req, res) => {
        const id = req.params.id;
        const [battles, sieges] = await Promise.all([
            firebase.getAllData('Battles'),
            firebase.getAllData('Sieges'),
        ]);
        const out = [];
        for (const b of battles) if (agg.parseArray(b.attendance).includes(id))
            out.push({ type: 'battle', id: b.ID || b.id, name: b.bossName || '首領戰', date: b.time || b.createdAt });
        for (const s of sieges) if (agg.parseArray(s.attendance).includes(id))
            out.push({ type: 'siege', id: s.ID || s.id, name: s.castle || '攻城戰', date: s.date || s.createdAt });
        out.sort((a, b) => new Date(b.date) - new Date(a.date));
        return httpx.ok(res, out);
    });

    // ── /api/members/:id/battle-history — boss battles attended only ─────
    app.get('/api/members/:id/battle-history', async (req, res) => {
        const id = req.params.id;
        const battles = await firebase.getAllData('Battles');
        const out = battles
            .filter(b => agg.parseArray(b.attendance).includes(id))
            .map(b => ({ id: b.ID || b.id, bossName: b.bossName || '未知', date: b.time || b.createdAt, status: b.status, dividend: Number(b.revenuePerPerson || b.dividendPerPerson || 0) }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        return httpx.ok(res, out);
    });

    // ── /api/members/:id/level-history — from sub-collection (if any) ────
    app.get('/api/members/:id/level-history', async (req, res) => {
        try {
            const db = firebase.getDb();
            if (!db) return httpx.ok(res, []);
            const snap = await db.collection(firebase.resolveCollection('members'))
                .doc(String(req.params.id)).collection('levelHistory')
                .orderBy('changedAt', 'desc').limit(100).get();
            return httpx.ok(res, snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            return httpx.ok(res, []); // sub-collection / index may not exist yet
        }
    });
};
