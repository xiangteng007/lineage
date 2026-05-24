// ── lib/permissions.js ───────────────────────────────────────────────────
// Rank-based access control (RBAC). Shared by server (/api/me) and exposed to
// the client so nav items / sections / edit buttons can be gated by rank.
//
// roleLevel scale (5 = highest):
//   5 會主/公主  Guild Master  — full control
//   4 元帥       Elder         — manage members/treasury/sieges/battles
//   3 幹部       Officer       — manage battles/sieges, edit member ranks
//   2 成員       Member        — view most, edit self
//   1 新人       Recruit       — limited view + own profile
'use strict';

const ROLE_NAMES = { 5: '會主', 4: '元帥', 3: '幹部', 2: '成員', 1: '新人', 0: '訪客' };

// Per-module minimum roleLevel to view (minRead) and to edit (minWrite).
const DEFAULT_MODULE_PERMS = {
    myprofile: { minRead: 1, minWrite: 1 },  // own profile — every logged-in member
    overview:  { minRead: 1, minWrite: 5 },
    members:   { minRead: 2, minWrite: 3 },  // recruits can't browse roster; officers edit (incl. tier)
    battles:   { minRead: 1, minWrite: 3 },
    sieges:    { minRead: 1, minWrite: 3 },
    alliances: { minRead: 2, minWrite: 3 },
    treasury:  { minRead: 3, minWrite: 4 },  // only officers+ see the vault
    settings:  { minRead: 4, minWrite: 5 },
};

// Member `tier` (actual data) -> default roleLevel when no explicit roleLevel set.
const TIER_TO_ROLE_LEVEL = {
    核心: 3, // core members act as officers by default
    一般: 2,
    外交: 2,
    試煉: 1,
    預備: 1,
};

/** Resolve a member's effective roleLevel. Admin (Google owner) is always 5. */
function resolveRoleLevel(member, isAdmin) {
    if (isAdmin) return 5;
    if (!member) return 0; // guest / unbound
    if (Number.isFinite(Number(member.roleLevel)) && Number(member.roleLevel) > 0) {
        return Math.max(1, Math.min(5, Number(member.roleLevel)));
    }
    return TIER_TO_ROLE_LEVEL[member.tier] || 1;
}

function _perms(custom) { return custom && typeof custom === 'object' ? { ...DEFAULT_MODULE_PERMS, ...custom } : DEFAULT_MODULE_PERMS; }

/** Can this roleLevel view the module? */
function canView(roleLevel, module, customPerms) {
    const p = _perms(customPerms)[module];
    if (!p) return roleLevel >= 1;
    return roleLevel >= p.minRead;
}

/** Can this roleLevel edit the module? */
function canEdit(roleLevel, module, customPerms) {
    const p = _perms(customPerms)[module];
    if (!p) return false;
    return roleLevel >= p.minWrite;
}

/** Build a { module: { view, edit } } map for the client to gate the UI. */
function buildPermissions(roleLevel, customPerms) {
    const perms = _perms(customPerms);
    const out = {};
    for (const mod of Object.keys(perms)) {
        out[mod] = { view: canView(roleLevel, mod, perms), edit: canEdit(roleLevel, mod, perms) };
    }
    return out;
}

function roleName(level) { return ROLE_NAMES[level] || ROLE_NAMES[0]; }

// ── Configurable action permissions (treasury income/expense separated) ──
// Owner can override these via settings/permissions; defaults below.
const DEFAULT_ACTION_PERMS = {
    treasuryView:      3,  // see balance + transactions
    treasuryIncome:    3,  // record income
    treasuryExpense:   4,  // record expense (default stricter than income)
    treasuryCastleTax: 3,  // batch-record castle tax (income)
    memberCreate:      3,  // add a member
    memberDelete:      5,  // delete a member (owner only by default)
    battleDelete:      4,  // delete a boss battle record
    siegeDelete:       4,  // delete a siege record
    lineBroadcast:     3,  // send LINE muster / broadcast
};

function mergeActionPerms(custom) {
    return (custom && typeof custom === 'object') ? { ...DEFAULT_ACTION_PERMS, ...custom } : { ...DEFAULT_ACTION_PERMS };
}
/** Can roleLevel perform a configurable action? */
function canDoAction(roleLevel, action, customActionPerms) {
    const t = mergeActionPerms(customActionPerms)[action];
    if (t == null) return false;
    return roleLevel >= t;
}
/** Build a { action: bool } map for the client. */
function buildActionPermissions(roleLevel, customActionPerms) {
    const m = mergeActionPerms(customActionPerms);
    const out = {};
    for (const k of Object.keys(m)) out[k] = roleLevel >= m[k];
    return out;
}

module.exports = {
    ROLE_NAMES, DEFAULT_MODULE_PERMS, TIER_TO_ROLE_LEVEL,
    resolveRoleLevel, canView, canEdit, buildPermissions, roleName,
    DEFAULT_ACTION_PERMS, mergeActionPerms, canDoAction, buildActionPermissions,
};
