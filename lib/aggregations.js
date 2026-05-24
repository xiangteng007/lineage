// ── lib/aggregations.js ──────────────────────────────────────────────────
// Pure, side-effect-free aggregation helpers for server-side dashboard stats.
// All functions take already-fetched plain arrays so they are fully unit
// testable without Firestore. Field names follow the ACTUAL data schema
// (name/job/tier, JSON-string attendance, type/amount transactions).

'use strict';

/** Safely parse a value that may be a JSON-string array or already an array. */
function parseArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try { const v = JSON.parse(val); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }
    return [];
}

function memberId(p) { return p.ID || p.id; }
function memberName(p) { return p.name || p.Name || '未知'; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** balance = SUM(income) - SUM(expense) over all transactions. */
function computeBalance(transactions = []) {
    let income = 0, expense = 0;
    for (const t of transactions) {
        const amt = toNum(t.amount);
        if (t.type === 'income') income += amt;
        else if (t.type === 'expense') expense += amt;
    }
    return income - expense;
}

/** YYYY-MM key from a date-ish value; '' if unparseable. */
function monthKey(dateish) {
    if (!dateish) return '';
    const d = new Date(dateish);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Income/expense/net totals for the month containing `ref` (default: now). */
function monthlyTotals(transactions = [], ref = new Date()) {
    const key = monthKey(ref);
    let income = 0, expense = 0;
    for (const t of transactions) {
        if (monthKey(t.createdAt || t.date) !== key) continue;
        const amt = toNum(t.amount);
        if (t.type === 'income') income += amt;
        else if (t.type === 'expense') expense += amt;
    }
    return { month: key, income, expense, net: income - expense };
}

/** Percentage change prev -> curr, rounded int. Safe when prev === 0. */
function pctChange(curr, prev) {
    curr = toNum(curr); prev = toNum(prev);
    if (prev === 0) return curr === 0 ? 0 : 100;
    return Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

/** Trend of the last `months` months ending at `now`, missing months zero-filled. */
function treasuryTrend(transactions = [], months = 6, now = new Date()) {
    const buckets = [];
    const index = {};
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const b = { month: key, income: 0, expense: 0, net: 0 };
        buckets.push(b); index[key] = b;
    }
    for (const t of transactions) {
        const key = monthKey(t.createdAt || t.date);
        const b = index[key];
        if (!b) continue;
        const amt = toNum(t.amount);
        if (t.type === 'income') b.income += amt;
        else if (t.type === 'expense') b.expense += amt;
    }
    for (const b of buckets) b.net = b.income - b.expense;
    return buckets;
}

/** Income/expense totals grouped by category, sorted by total desc. */
function categoryBreakdown(transactions = []) {
    const map = {};
    for (const t of transactions) {
        const cat = t.category || '其他';
        if (!map[cat]) map[cat] = { category: cat, income: 0, expense: 0 };
        const amt = toNum(t.amount);
        if (t.type === 'income') map[cat].income += amt;
        else if (t.type === 'expense') map[cat].expense += amt;
    }
    return Object.values(map).sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
}

/** Member counts grouped by job/class, sorted desc. Unknown -> '其他'. */
function classDistribution(members = []) {
    const map = {};
    for (const m of members) {
        const cls = m.job || m.class || '其他';
        map[cls] = (map[cls] || 0) + 1;
    }
    return Object.entries(map)
        .map(([cls, count]) => ({ class: cls, count }))
        .sort((a, b) => b.count - a.count);
}

/** Attendance leaderboard across battles + sieges, top `limit`. */
function attendanceLeaderboard(battles = [], sieges = [], members = [], limit = 10) {
    const tally = {};
    const addAll = (records) => {
        for (const r of records) {
            for (const id of parseArray(r.attendance)) tally[id] = (tally[id] || 0) + 1;
        }
    };
    addAll(battles); addAll(sieges);
    const nameById = {};
    for (const m of members) nameById[memberId(m)] = memberName(m);
    return Object.entries(tally)
        .map(([id, count]) => ({ memberId: id, name: nameById[id] || id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

/** Number of boss encounters recorded (each battle = one boss fought). */
function bossKillCount(battles = []) {
    return battles.length;
}

/** Count of active alliances (endDate null/empty or isActive !== false). */
function activeAllianceCount(alliances = []) {
    return alliances.filter(a => {
        if (a.isActive === false) return false;
        if (a.endDate) return false;
        return true;
    }).length;
}

/** Assemble the full /api/overview payload from raw collections. */
function buildOverview({ members = [], battles = [], sieges = [], alliances = [], transactions = [], now = new Date(), limit = 10 } = {}) {
    const balance = computeBalance(transactions);
    const thisMonth = monthlyTotals(transactions, now);
    const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonth = monthlyTotals(transactions, prevRef);
    return {
        kpi: {
            memberCount: members.length,
            treasuryBalance: balance,
            bossKills: bossKillCount(battles),
            allianceCount: activeAllianceCount(alliances),
            monthIncome: thisMonth.income,
            monthExpense: thisMonth.expense,
            monthNet: thisMonth.net,
            momIncomePct: pctChange(thisMonth.income, lastMonth.income),
            momExpensePct: pctChange(thisMonth.expense, lastMonth.expense),
        },
        classDistribution: classDistribution(members),
        attendanceLeaderboard: attendanceLeaderboard(battles, sieges, members, limit),
        treasuryTrend: treasuryTrend(transactions, 6, now),
        generatedAt: new Date().toISOString(),
    };
}

module.exports = {
    parseArray, computeBalance, monthKey, monthlyTotals, pctChange,
    treasuryTrend, categoryBreakdown, classDistribution,
    attendanceLeaderboard, bossKillCount, activeAllianceCount, buildOverview,
};

// ── Sprint B/C/D extensions ──────────────────────────────────────────────

/** Boss battle statistics: totals, win rate, per-boss counts, monthly timeline. */
function battleStats(battles = []) {
    const total = battles.length;
    const settled = battles.filter(b => b.status === 'settled').length;
    const wins = battles.filter(b => (b.result || b.status) === 'success' || b.result === 'victory').length;
    const byBossMap = {};
    const byMonthMap = {};
    for (const b of battles) {
        const boss = b.bossName || b.boss || '未知';
        byBossMap[boss] = (byBossMap[boss] || 0) + 1;
        const mk = monthKey(b.time || b.createdAt);
        if (mk) byMonthMap[mk] = (byMonthMap[mk] || 0) + 1;
    }
    return {
        total, settled, wins,
        winRate: total ? Math.round((wins / total) * 100) : 0,
        byBoss: Object.entries(byBossMap).map(([boss, count]) => ({ boss, count })).sort((a, b) => b.count - a.count),
        timeline: Object.entries(byMonthMap).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    };
}

/** Members ranked by boss-battle attendance (kills participated). Adds medal tier. */
function battleKillLeaderboard(battles = [], members = [], limit = 10) {
    const tally = {};
    for (const b of battles) for (const id of parseArray(b.attendance)) tally[id] = (tally[id] || 0) + 1;
    const nameById = {}; const jobById = {};
    for (const m of members) { nameById[memberId(m)] = memberName(m); jobById[memberId(m)] = m.job || m.class || ''; }
    const medal = (c) => c >= 20 ? 'gold' : c >= 10 ? 'silver' : c >= 5 ? 'bronze' : null;
    return Object.entries(tally)
        .map(([id, count]) => ({ memberId: id, name: nameById[id] || id, job: jobById[id] || '', count, medal: medal(count) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

/** Siege statistics: totals, win rate, attack/defend split, average attendance. */
function siegeStats(sieges = []) {
    const total = sieges.length;
    const wins = sieges.filter(s => (s.result || s.status) === 'success' || s.result === 'victory').length;
    const losses = sieges.filter(s => s.result === 'defeat' || s.result === 'fail').length;
    const attack = sieges.filter(s => (s.siegeType || s.type) === 'attack').length;
    const defend = sieges.filter(s => (s.siegeType || s.type) === 'defend').length;
    let attSum = 0;
    for (const s of sieges) attSum += parseArray(s.attendance).length;
    return {
        total, wins, losses,
        winRate: total ? Math.round((wins / total) * 100) : 0,
        attack, defend,
        avgAttendance: total ? Math.round(attSum / total) : 0,
    };
}

const DEFAULT_CASTLES = ['銀月城', '肯特城', '圭爾丁城', '奧瑞城', '狄亞德城', '亞丁城'];

/** Per-castle holding status derived from each castle's most recent siege. */
function castleStatus(sieges = [], castles = DEFAULT_CASTLES) {
    const names = new Set(castles);
    for (const s of sieges) { const c = s.castle || s.castleName; if (c) names.add(c); }
    const out = [];
    for (const castle of names) {
        const list = sieges
            .filter(s => (s.castle || s.castleName) === castle)
            .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
        const last = list[0] || null;
        const wins = list.filter(s => (s.result || s.status) === 'success' || s.result === 'victory').length;
        const lastWin = last ? ((last.result || last.status) === 'success' || last.result === 'victory') : false;
        out.push({
            castle, total: list.length, wins,
            lastResult: last ? (last.result || last.status || null) : null,
            lastDate: last ? (last.date || last.createdAt || null) : null,
            held: lastWin,
        });
    }
    return out;
}

/** Alliance statistics: distribution by type, active/ended counts, longest-standing ally. */
function allianceStats(alliances = [], now = new Date()) {
    const byTypeMap = {};
    let active = 0, ended = 0, longest = null;
    for (const a of alliances) {
        const type = a.type || 'neutral';
        byTypeMap[type] = (byTypeMap[type] || 0) + 1;
        const isEnded = !!a.endDate || a.isActive === false;
        if (isEnded) ended++; else active++;
        if (!isEnded && (a.type === 'ally')) {
            const start = new Date(a.startDate || a.createdAt || now);
            const days = Math.max(0, Math.floor((now - start) / 86400000));
            if (!longest || days > longest.days) longest = { guildName: a.guildName || a.name || '?', days };
        }
    }
    return {
        byType: Object.entries(byTypeMap).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        active, ended, total: alliances.length,
        longestAlly: longest,
    };
}

Object.assign(module.exports, {
    battleStats, battleKillLeaderboard, siegeStats, castleStatus, allianceStats, DEFAULT_CASTLES,
});
