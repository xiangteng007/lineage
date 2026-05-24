'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const agg = require('../lib/aggregations');

const tx = [
    { type: 'income',  amount: 100, category: '城堡稅收', createdAt: '2026-05-10T00:00:00Z' },
    { type: 'income',  amount: 50,  category: '首領掉寶', createdAt: '2026-05-20T00:00:00Z' },
    { type: 'expense', amount: 30,  category: '攻城戰薪津', createdAt: '2026-05-21T00:00:00Z' },
    { type: 'income',  amount: 200, category: '城堡稅收', createdAt: '2026-04-15T00:00:00Z' },
    { type: 'expense', amount: 70,  category: '裝備',     createdAt: '2026-03-01T00:00:00Z' },
];

test('computeBalance = SUM(income) - SUM(expense)', () => {
    assert.strictEqual(agg.computeBalance(tx), 100 + 50 - 30 + 200 - 70); // 250
});
test('computeBalance handles empty / non-numeric', () => {
    assert.strictEqual(agg.computeBalance([]), 0);
    assert.strictEqual(agg.computeBalance([{ type: 'income', amount: 'x' }]), 0);
});

test('monthlyTotals for May 2026', () => {
    const m = agg.monthlyTotals(tx, new Date('2026-05-24T00:00:00Z'));
    assert.deepStrictEqual(m, { month: '2026-05', income: 150, expense: 30, net: 120 });
});

test('pctChange is safe when prev is 0', () => {
    assert.strictEqual(agg.pctChange(150, 200), -25);
    assert.strictEqual(agg.pctChange(150, 0), 100);
    assert.strictEqual(agg.pctChange(0, 0), 0);
});

test('treasuryTrend zero-fills missing months and slices last N', () => {
    const trend = agg.treasuryTrend(tx, 3, new Date('2026-05-24T00:00:00Z'));
    assert.strictEqual(trend.length, 3);
    assert.deepStrictEqual(trend.map(t => t.month), ['2026-03', '2026-04', '2026-05']);
    assert.strictEqual(trend[0].expense, 70);   // March
    assert.strictEqual(trend[1].income, 200);   // April
    assert.strictEqual(trend[2].net, 120);      // May
});

test('categoryBreakdown groups by category', () => {
    const cb = agg.categoryBreakdown(tx);
    const tax = cb.find(c => c.category === '城堡稅收');
    assert.strictEqual(tax.income, 300);
    assert.strictEqual(tax.expense, 0);
});

test('classDistribution uses job field, unknown -> 其他, sorted desc', () => {
    const members = [
        { name: 'a', job: '法師' }, { name: 'b', job: '法師' },
        { name: 'c', job: '騎士' }, { name: 'd' },
    ];
    const cd = agg.classDistribution(members);
    assert.strictEqual(cd[0].class, '法師');
    assert.strictEqual(cd[0].count, 2);
    assert.ok(cd.find(c => c.class === '其他' && c.count === 1));
});

test('attendanceLeaderboard parses JSON-string attendance and maps names', () => {
    const members = [{ ID: 'm1', name: '夜刃' }, { ID: 'm2', name: '蒼月' }];
    const battles = [{ attendance: JSON.stringify(['m1', 'm2']) }, { attendance: '["m1"]' }];
    const sieges  = [{ attendance: ['m1'] }];
    const lb = agg.attendanceLeaderboard(battles, sieges, members, 10);
    assert.strictEqual(lb[0].memberId, 'm1');
    assert.strictEqual(lb[0].name, '夜刃');
    assert.strictEqual(lb[0].count, 3);
    assert.strictEqual(lb[1].count, 1);
});

test('parseArray tolerates bad input', () => {
    assert.deepStrictEqual(agg.parseArray('not json'), []);
    assert.deepStrictEqual(agg.parseArray(null), []);
    assert.deepStrictEqual(agg.parseArray(['a']), ['a']);
});

test('activeAllianceCount excludes ended / inactive', () => {
    const a = [{ isActive: true }, { endDate: '2026-01-01' }, { isActive: false }, {}];
    assert.strictEqual(agg.activeAllianceCount(a), 2);
});

test('buildOverview assembles a complete payload', () => {
    const members = [{ ID: 'm1', name: '夜刃', job: '法師' }];
    const battles = [{ attendance: '["m1"]', bossName: '巨蟻女王' }];
    const data = agg.buildOverview({ members, battles, sieges: [], alliances: [{ isActive: true }], transactions: tx, now: new Date('2026-05-24T00:00:00Z') });
    assert.strictEqual(data.kpi.memberCount, 1);
    assert.strictEqual(data.kpi.treasuryBalance, 250);
    assert.strictEqual(data.kpi.bossKills, 1);
    assert.strictEqual(data.kpi.allianceCount, 1);
    assert.strictEqual(data.kpi.monthIncome, 150);
    assert.strictEqual(data.classDistribution[0].class, '法師');
    assert.strictEqual(data.attendanceLeaderboard[0].name, '夜刃');
    assert.strictEqual(data.treasuryTrend.length, 6);
    assert.ok(data.generatedAt);
});

// ── Sprint B/C/D aggregation tests ───────────────────────────────────────
const battlesFx = [
    { bossName: '巨蟻女王', status: 'settled', result: 'success', attendance: '["m1","m2"]', time: '2026-05-01' },
    { bossName: '巨蟻女王', status: 'pending', attendance: '["m1"]', time: '2026-05-10' },
    { bossName: '猎人', status: 'settled', result: 'defeat', attendance: '["m2"]', time: '2026-04-02' },
];
const membersFx = [{ ID: 'm1', name: '夜刃', job: '法師' }, { ID: 'm2', name: '蒼月', job: '騎士' }];

test('battleStats: totals, winRate, byBoss, timeline', () => {
    const s = agg.battleStats(battlesFx);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.settled, 2);
    assert.strictEqual(s.wins, 1);
    assert.strictEqual(s.winRate, 33);
    assert.strictEqual(s.byBoss[0].boss, '巨蟻女王');
    assert.strictEqual(s.byBoss[0].count, 2);
    assert.deepStrictEqual(s.timeline.map(t => t.month), ['2026-04', '2026-05']);
});

test('battleKillLeaderboard: counts + medal tiers', () => {
    const lb = agg.battleKillLeaderboard(battlesFx, membersFx, 10);
    assert.strictEqual(lb[0].memberId, 'm1');
    assert.strictEqual(lb[0].count, 2);
    assert.strictEqual(lb[0].name, '夜刃');
    assert.strictEqual(lb[0].medal, null); // < 5
});

test('siegeStats: win rate + attack/defend + avg attendance', () => {
    const sieges = [
        { siegeType: 'attack', result: 'success', attendance: '["a","b","c"]' },
        { siegeType: 'defend', result: 'defeat', attendance: '["a"]' },
    ];
    const s = agg.siegeStats(sieges);
    assert.strictEqual(s.total, 2);
    assert.strictEqual(s.wins, 1);
    assert.strictEqual(s.attack, 1);
    assert.strictEqual(s.defend, 1);
    assert.strictEqual(s.winRate, 50);
    assert.strictEqual(s.avgAttendance, 2); // (3+1)/2
});

test('castleStatus: derives held from latest siege', () => {
    const sieges = [
        { castle: '銀月城', result: 'success', date: '2026-05-20' },
        { castle: '銀月城', result: 'defeat', date: '2026-04-01' },
    ];
    const cs = agg.castleStatus(sieges, ['銀月城']);
    const sm = cs.find(c => c.castle === '銀月城');
    assert.strictEqual(sm.total, 2);
    assert.strictEqual(sm.held, true);       // latest (May) was a win
    assert.strictEqual(sm.lastResult, 'success');
});

test('allianceStats: type distribution + longest ally', () => {
    const now = new Date('2026-05-24');
    const alliances = [
        { type: 'ally', guildName: '同盟A', startDate: '2026-01-01' },
        { type: 'ally', guildName: '同盟B', startDate: '2026-05-01' },
        { type: 'enemy', guildName: '敵對C', endDate: '2026-03-01' },
    ];
    const s = agg.allianceStats(alliances, now);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.active, 2);
    assert.strictEqual(s.ended, 1);
    assert.strictEqual(s.longestAlly.guildName, '同盟A');
    assert.ok(s.longestAlly.days > 100);
});
