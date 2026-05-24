// ── lib/routes-sprint-bcd.js ─────────────────────────────────────────────
// Additive read-only statistics endpoints for Sprint B/C/D. Registered before
// the SPA catch-all. None shadow or alter existing routes.
'use strict';

module.exports = function registerSprintBcdRoutes(app, firebase, agg, httpx) {

    // ── B3: 金庫類別分布 ─────────────────────────────────────────────────
    app.get('/api/treasury/category-breakdown', async (req, res) => {
        const transactions = await firebase.getAllData('Transactions');
        return httpx.ok(res, agg.categoryBreakdown(transactions));
    });

    // ── C2: 首領戰統計 + 擊殺排行 ────────────────────────────────────────
    app.get('/api/battles/stats', async (req, res) => {
        const battles = await firebase.getAllData('Battles');
        return httpx.ok(res, agg.battleStats(battles));
    });

    app.get('/api/battles/kill-leaderboard', async (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 10;
        const [battles, members] = await Promise.all([
            firebase.getAllData('Battles'),
            firebase.getAllData('Members'),
        ]);
        return httpx.ok(res, agg.battleKillLeaderboard(battles, members, limit));
    });

    // ── C4: 攻城戰統計 + 城堡持有狀態 ────────────────────────────────────
    app.get('/api/sieges/stats', async (req, res) => {
        const sieges = await firebase.getAllData('Sieges');
        return httpx.ok(res, agg.siegeStats(sieges));
    });

    app.get('/api/sieges/castle-status', async (req, res) => {
        const sieges = await firebase.getAllData('Sieges');
        return httpx.ok(res, agg.castleStatus(sieges));
    });

    // ── D1: 外交統計 ─────────────────────────────────────────────────────
    app.get('/api/alliances/stats', async (req, res) => {
        const alliances = await firebase.getAllData('Alliances');
        return httpx.ok(res, agg.allianceStats(alliances, new Date()));
    });

    // ── D2: 公會設定（讀取） ─────────────────────────────────────────────
    app.get('/api/settings', async (req, res) => {
        const [guild, roles, modules] = await Promise.all([
            firebase.getDocument('settings', 'guild'),
            firebase.getDocument('settings', 'roles'),
            firebase.getDocument('settings', 'modules'),
        ]);
        return httpx.ok(res, {
            guild: guild || null,
            roles: roles || null,
            modules: modules || null,
        });
    });
};
