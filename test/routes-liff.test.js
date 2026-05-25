'use strict';
// ── lib/routes-liff.js — unit tests ─────────────────────────────────────
// Covers internal helpers (pickPerson / parseAttendance / checkRateLimit /
// envFlag) and the four exposed endpoints (config / profile / attend /
// status) via a stub Express app + mocked firebase + mocked global fetch.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const liff = require('../lib/routes-liff');
const { pickPerson, parseAttendance, checkRateLimit, envFlag, _rateBuckets } = liff._internal;

// ────────────────────────────────────────────────────────────────────────
// Test doubles
// ────────────────────────────────────────────────────────────────────────

function makeApp() {
    const routes = { get: {}, post: {} };
    return {
        get(path, handler) { routes.get[path] = handler; },
        post(path, handler) { routes.post[path] = handler; },
        _routes: routes,
    };
}

function makeReq(body = {}) { return { body }; }

function makeRes() {
    const res = {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

function makeFirebase(data = {}) {
    const members = data.Members || [];
    const alliances = data.Alliances || [];
    const battles = data.Battles || {};
    const sieges = data.Sieges || {};
    const log = [];
    return {
        async getAllData(name) {
            if (name === 'Members') return members.slice();
            if (name === 'Alliances') return alliances.slice();
            if (name === 'Battles') return Object.values(battles);
            if (name === 'Sieges') return Object.values(sieges);
            return [];
        },
        async getDocument(name, id) {
            if (name === 'Battles') return battles[id] || null;
            if (name === 'Sieges') return sieges[id] || null;
            return null;
        },
        async updateData(name, id, patch) {
            const target = name === 'Battles' ? battles[id] : sieges[id];
            if (!target) return false;
            Object.assign(target, patch);
            return true;
        },
        async addData(name, entry) { log.push({ name, entry }); return entry; },
        _log: log,
    };
}

// Reset rate limit + env between tests so order doesn't matter.
beforeEach(() => {
    _rateBuckets.clear();
    delete process.env.LINE_LIFF_ID;
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

// ────────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────────

test('pickPerson: finds member by lineUserId', () => {
    const m = { ID: 'm1', name: 'Alice', lineUserId: 'U_alice' };
    const a = { ID: 'a1', name: 'AllyClan', lineUserId: 'U_ally' };
    assert.deepStrictEqual(pickPerson([m], [a], 'U_alice'), m);
    assert.deepStrictEqual(pickPerson([m], [a], 'U_ally'), a);
    assert.strictEqual(pickPerson([m], [a], 'U_unknown'), null);
});

test('parseAttendance: handles string / array / missing / malformed', () => {
    assert.deepStrictEqual(parseAttendance({ attendance: '["m1","m2"]' }), ['m1', 'm2']);
    assert.deepStrictEqual(parseAttendance({ attendance: ['m1'] }), ['m1']);
    assert.deepStrictEqual(parseAttendance({}), []);
    assert.deepStrictEqual(parseAttendance({ attendance: 'not-json' }), []);
});

test('checkRateLimit: allows up to 10/min then blocks; per-user buckets', () => {
    for (let i = 0; i < 10; i++) {
        assert.strictEqual(checkRateLimit('U_a').ok, true, `hit ${i + 1} should pass`);
    }
    const blocked = checkRateLimit('U_a');
    assert.strictEqual(blocked.ok, false);
    assert.ok(blocked.retryAfterMs > 0);
    // Other user unaffected
    assert.strictEqual(checkRateLimit('U_b').ok, true);
});

test('checkRateLimit: no userId → always ok', () => {
    assert.strictEqual(checkRateLimit(null).ok, true);
    assert.strictEqual(checkRateLimit('').ok, true);
});

test('envFlag: rejects empty / DUMMY_* sentinels', () => {
    process.env.X = '';
    assert.strictEqual(envFlag('X'), false);
    process.env.X = 'DUMMY_SECRET';
    assert.strictEqual(envFlag('X'), false);
    process.env.X = 'DUMMY_TOKEN';
    assert.strictEqual(envFlag('X'), false);
    process.env.X = 'real-value';
    assert.strictEqual(envFlag('X'), true);
    delete process.env.X;
});

// ────────────────────────────────────────────────────────────────────────
// Endpoints
// ────────────────────────────────────────────────────────────────────────

test('GET /api/liff/config: reports configured when LINE_LIFF_ID set', () => {
    const app = makeApp();
    liff(app, makeFirebase());

    process.env.LINE_LIFF_ID = '1234-abcd';
    const res = makeRes();
    app._routes.get['/api/liff/config']({}, res);
    assert.deepStrictEqual(res.body, { liffId: '1234-abcd', configured: true });

    delete process.env.LINE_LIFF_ID;
    const res2 = makeRes();
    app._routes.get['/api/liff/config']({}, res2);
    assert.deepStrictEqual(res2.body, { liffId: '', configured: false });
});

test('GET /api/line/status: returns booleans only, never leaks secrets', () => {
    const app = makeApp();
    liff(app, makeFirebase());

    process.env.LINE_CHANNEL_SECRET = 'supersecret';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'topsecret';
    process.env.LINE_LIFF_ID = 'liff-id';

    const res = makeRes();
    app._routes.get['/api/line/status']({}, res);
    assert.deepStrictEqual(res.body, {
        ok: true,
        channelSecretConfigured: true,
        channelAccessTokenConfigured: true,
        liffConfigured: true,
        webhookPath: '/webhook/line',
    });
    // Defensive: ensure secrets never appear in the response
    const flat = JSON.stringify(res.body);
    assert.ok(!flat.includes('supersecret'));
    assert.ok(!flat.includes('topsecret'));
});

test('POST /api/liff/profile: 400 when accessToken missing', async () => {
    const app = makeApp();
    liff(app, makeFirebase());
    const res = makeRes();
    await app._routes.post['/api/liff/profile'](makeReq({}), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.ok, false);
});

test('POST /api/liff/profile: 401 when LINE rejects the token', async () => {
    const app = makeApp();
    liff(app, makeFirebase());
    const orig = global.fetch;
    global.fetch = async () => ({ ok: false, status: 401, async json() { return {}; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/profile'](makeReq({ accessToken: 'bad' }), res);
        assert.strictEqual(res.statusCode, 401);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/profile: returns isBound=true when lineUserId matches a member', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice', tier: '核心', job: '騎士', level: 87 }],
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({
        ok: true,
        async json() { return { userId: 'U_alice', displayName: 'Alice', pictureUrl: 'http://x' }; },
    });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/profile'](makeReq({ accessToken: 'good' }), res);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.isBound, true);
        assert.deepStrictEqual(res.body.boundMember, {
            id: 'm1', name: 'Alice', tier: '核心', job: '騎士', level: 87,
        });
    } finally { global.fetch = orig; }
});

test('POST /api/liff/profile: returns isBound=false for an unbound LINE user', async () => {
    const firebase = makeFirebase({ Members: [] });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_ghost', displayName: 'Ghost' }; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/profile'](makeReq({ accessToken: 'good' }), res);
        assert.strictEqual(res.body.isBound, false);
        assert.strictEqual(res.body.boundMember, null);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: success path writes attendance + audit log', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice' }],
        Battles: { b1: { ID: 'b1', bossName: 'Antharas', attendance: '[]' } },
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_alice' }; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'good', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.alreadyConfirmed, false);
        assert.strictEqual(res.body.memberName, 'Alice');
        // Audit log written
        assert.strictEqual(firebase._log.length, 1);
        assert.strictEqual(firebase._log[0].entry.action, 'attend');
        assert.strictEqual(firebase._log[0].entry.target, 'Antharas');
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: idempotent — second call returns alreadyConfirmed', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice' }],
        Battles: { b1: { ID: 'b1', bossName: 'Antharas', attendance: '["m1"]' } },
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_alice' }; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'good', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.body.alreadyConfirmed, true);
        assert.strictEqual(firebase._log.length, 0, 'idempotent call must not double-log');
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: 403 when LINE user is not bound to any member', async () => {
    const firebase = makeFirebase({
        Members: [],
        Battles: { b1: { ID: 'b1', bossName: 'X', attendance: '[]' } },
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_ghost' }; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'good', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.statusCode, 403);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: 404 when the record id does not exist', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice' }],
        Battles: {},
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_alice' }; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'good', recordId: 'missing', type: 'battle' }), res);
        assert.strictEqual(res.statusCode, 404);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: 401 when accessToken fails LINE verification', async () => {
    const app = makeApp();
    liff(app, makeFirebase());
    const orig = global.fetch;
    global.fetch = async () => ({ ok: false, status: 401, async json() { return {}; } });
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'bad', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.statusCode, 401);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: rate limit kicks in after 10 hits / minute', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice' }],
        Battles: { b1: { ID: 'b1', bossName: 'X', attendance: '["m1"]' } },
    });
    const app = makeApp();
    liff(app, firebase);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: true, async json() { return { userId: 'U_alice' }; } });
    try {
        for (let i = 0; i < 10; i++) {
            const res = makeRes();
            await app._routes.post['/api/liff/attend'](
                makeReq({ accessToken: 'good', recordId: 'b1', type: 'battle' }), res);
            assert.strictEqual(res.statusCode, 200, `hit ${i + 1} should pass`);
        }
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ accessToken: 'good', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.statusCode, 429);
    } finally { global.fetch = orig; }
});

test('POST /api/liff/attend: legacy lineUserId path still works (deprecated)', async () => {
    const firebase = makeFirebase({
        Members: [{ ID: 'm1', name: 'Alice', lineUserId: 'U_alice' }],
        Battles: { b1: { ID: 'b1', bossName: 'X', attendance: '[]' } },
    });
    const app = makeApp();
    liff(app, firebase);
    const origWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
        const res = makeRes();
        await app._routes.post['/api/liff/attend'](
            makeReq({ lineUserId: 'U_alice', recordId: 'b1', type: 'battle' }), res);
        assert.strictEqual(res.body.ok, true);
        assert.ok(warned, 'legacy path should emit a deprecation warning');
    } finally { console.warn = origWarn; }
});
