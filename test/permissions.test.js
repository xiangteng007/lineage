'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('../lib/permissions');

test('resolveRoleLevel: admin always 5', () => {
    assert.strictEqual(p.resolveRoleLevel(null, true), 5);
    assert.strictEqual(p.resolveRoleLevel({ tier: '試煉' }, true), 5);
});
test('resolveRoleLevel: unbound guest = 0', () => {
    assert.strictEqual(p.resolveRoleLevel(null, false), 0);
});
test('resolveRoleLevel: explicit roleLevel wins, clamped 1-5', () => {
    assert.strictEqual(p.resolveRoleLevel({ roleLevel: 4 }, false), 4);
    assert.strictEqual(p.resolveRoleLevel({ roleLevel: 9 }, false), 5);
});
test('resolveRoleLevel: tier mapping fallback', () => {
    assert.strictEqual(p.resolveRoleLevel({ tier: '核心' }, false), 3);
    assert.strictEqual(p.resolveRoleLevel({ tier: '一般' }, false), 2);
    assert.strictEqual(p.resolveRoleLevel({ tier: '試煉' }, false), 1);
    assert.strictEqual(p.resolveRoleLevel({ tier: '無此階' }, false), 1);
});
test('canView/canEdit: treasury visible only to officers+ (>=3 read, >=4 write)', () => {
    assert.strictEqual(p.canView(2, 'treasury'), false);
    assert.strictEqual(p.canView(3, 'treasury'), true);
    assert.strictEqual(p.canEdit(3, 'treasury'), false);
    assert.strictEqual(p.canEdit(4, 'treasury'), true);
});
test('canView: recruit cannot browse member roster but sees overview + own profile', () => {
    assert.strictEqual(p.canView(1, 'members'), false);
    assert.strictEqual(p.canView(1, 'overview'), true);
    assert.strictEqual(p.canView(1, 'myprofile'), true);
});
test('canEdit: officer (3) can edit members (tier), recruit cannot', () => {
    assert.strictEqual(p.canEdit(3, 'members'), true);
    assert.strictEqual(p.canEdit(2, 'members'), false);
});
test('buildPermissions: returns view/edit per module', () => {
    const owner = p.buildPermissions(5);
    assert.strictEqual(owner.settings.edit, true);
    assert.strictEqual(owner.treasury.view, true);
    const recruit = p.buildPermissions(1);
    assert.strictEqual(recruit.members.view, false);
    assert.strictEqual(recruit.myprofile.view, true);
    assert.strictEqual(recruit.settings.edit, false);
});
test('custom perms override defaults', () => {
    const custom = { treasury: { minRead: 1, minWrite: 1 } };
    assert.strictEqual(p.canView(1, 'treasury', custom), true);
});

// ── Configurable action permissions ──────────────────────────────────────
test('canDoAction: income vs expense are separate (defaults 3 vs 4)', () => {
    assert.strictEqual(p.canDoAction(3, 'treasuryIncome'), true);
    assert.strictEqual(p.canDoAction(3, 'treasuryExpense'), false);
    assert.strictEqual(p.canDoAction(4, 'treasuryExpense'), true);
});
test('canDoAction: owner custom config can open expense to officers', () => {
    assert.strictEqual(p.canDoAction(3, 'treasuryExpense', { treasuryExpense: 3 }), true);
    assert.strictEqual(p.canDoAction(2, 'treasuryIncome', { treasuryIncome: 2 }), true);
});
test('buildActionPermissions reflects role + custom', () => {
    const m = p.buildActionPermissions(3, { treasuryExpense: 3 });
    assert.strictEqual(m.treasuryIncome, true);
    assert.strictEqual(m.treasuryExpense, true);
    const def = p.buildActionPermissions(3);
    assert.strictEqual(def.treasuryExpense, false);
});

// ── Extended action permissions (other modules) ──────────────────────────
test('extended actions: sensible defaults', () => {
    assert.strictEqual(p.canDoAction(5, 'memberDelete'), true);   // owner only
    assert.strictEqual(p.canDoAction(4, 'memberDelete'), false);
    assert.strictEqual(p.canDoAction(3, 'memberCreate'), true);
    assert.strictEqual(p.canDoAction(3, 'battleDelete'), false);  // default 4
    assert.strictEqual(p.canDoAction(4, 'battleDelete'), true);
    assert.strictEqual(p.canDoAction(3, 'lineBroadcast'), true);
});
test('extended actions: owner config can open battle delete to officers', () => {
    assert.strictEqual(p.canDoAction(3, 'battleDelete', { battleDelete: 3 }), true);
});
test('buildActionPermissions includes extended actions', () => {
    const m = p.buildActionPermissions(4);
    assert.strictEqual(m.battleDelete, true);
    assert.strictEqual(m.memberDelete, false);
    assert.strictEqual(m.lineBroadcast, true);
});
