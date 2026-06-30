'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  store-postgres.js — PostgreSQL 資料層（取代 Firestore）
//
//  對外 API 與舊 firebase.js 完全一致：
//    getAllData / queryCollection / countCollection / getDocument /
//    addData / updateData / upsertData / deleteData /
//    resolveCollection / COL / COLLECTION_MODE / getStorageMode / getDb
//  因此 server.js、linebot.js、lib/routes-* 幾乎不需改動既有呼叫。
//
//  文件統一存在 documents(collection, doc_id, data jsonb)。
//  查詢（where/orderBy/limit）在 JS 端套用，以「位元級」對齊 Firestore 的寬鬆語意，
//  資料量（單一血盟）很小，效能綽綽有餘。
//
//  另提供 admin_users 表的存取（getAdminUser/createAdminUser/countAdminUsers），
//  供 lib/routes-local-auth.js 的公主本地登入使用。
// ═══════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const crypto = require('crypto');

// ── Collection 命名解析（與 store-firestore 相同；保留 legacy/canonical 切換）──
const COLLECTION_MAP = {
    members:      { legacy: 'Members',      canonical: 'members' },
    bossBattles:  { legacy: 'Battles',      canonical: 'bossBattles' },
    sieges:       { legacy: 'Sieges',       canonical: 'sieges' },
    alliances:    { legacy: 'Alliances',    canonical: 'alliances' },
    treasury:     { legacy: 'Treasury',     canonical: 'treasury' },
    transactions: { legacy: 'Transactions', canonical: 'transactions' },
    activityLog:  { legacy: 'activityLog',  canonical: 'activityLog' },
};
const ALIASES = {
    Members: 'members', members: 'members',
    Battles: 'bossBattles', battles: 'bossBattles', bossBattles: 'bossBattles', bossbattles: 'bossBattles',
    Sieges: 'sieges', sieges: 'sieges',
    Alliances: 'alliances', alliances: 'alliances',
    Treasury: 'treasury', treasury: 'treasury',
    Transactions: 'transactions', transactions: 'transactions',
    activityLog: 'activityLog', activitylog: 'activityLog',
};
const MODE = String(process.env.COLLECTION_MODE || 'legacy').toLowerCase() === 'canonical'
    ? 'canonical' : 'legacy';

function resolveCollection(name) {
    const logical = ALIASES[name] || name;
    const entry = COLLECTION_MAP[logical];
    return entry ? entry[MODE] : name;
}
const COL = Object.keys(COLLECTION_MAP).reduce((acc, k) => {
    acc[k] = COLLECTION_MAP[k][MODE]; return acc;
}, {});

// ── 連線池（lazy）──────────────────────────────────────────────────────
let pool = null;
function getPool() {
    if (pool) return pool;
    const base = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST || 'localhost',
            port: parseInt(process.env.PGPORT || '5432', 10),
            user: process.env.PGUSER || 'lineage',
            password: process.env.PGPASSWORD || 'lineage',
            database: process.env.PGDATABASE || 'lineage',
        };
    pool = new Pool({ ...base, max: parseInt(process.env.PG_POOL_MAX || '10', 10) });
    pool.on('error', (e) => console.error('[pg] idle client error:', e.message));
    return pool;
}

// ── Schema 自我修復（冪等，只跑一次）──────────────────────────────────
let _ready = null;
function ensureSchema() {
    if (_ready) return _ready;
    _ready = (async () => {
        const p = getPool();
        await p.query(`CREATE TABLE IF NOT EXISTS documents (
            collection TEXT NOT NULL,
            doc_id     TEXT NOT NULL,
            data       JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (collection, doc_id)
        )`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection)`);
        await p.query(`CREATE TABLE IF NOT EXISTS admin_users (
            username      TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role_level    INTEGER NOT NULL DEFAULT 5,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    })().catch((e) => { _ready = null; throw e; });
    return _ready;
}

async function q(text, params) {
    await ensureSchema();
    return getPool().query(text, params);
}

// ── 產生 Firestore 風格的 20 字元文件 ID ───────────────────────────────
function genId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(20);
    let s = '';
    for (let i = 0; i < 20; i++) s += chars[bytes[i] % chars.length];
    return s;
}

// ── 查詢輔助：JS 端套用 where / orderBy，對齊 Firestore 語意 ────────────
function matchWhere(doc, where) {
    return (where || []).every((w) => {
        if (!Array.isArray(w) || w.length !== 3) return true;
        const [field, op, val] = w;
        // 與舊 firebase.js 一致：空值的 where 條件視為「不過濾」
        if (val === undefined || val === null || val === '') return true;
        const dv = doc[field];
        switch (op) {
            case '==':  return dv === val || String(dv) === String(val);
            case '!=':  return !(dv === val || String(dv) === String(val));
            case '>':   return dv > val;
            case '>=':  return dv >= val;
            case '<':   return dv < val;
            case '<=':  return dv <= val;
            case 'in':  return Array.isArray(val) && val.includes(dv);
            case 'array-contains': return Array.isArray(dv) && dv.includes(val);
            default:    return true;
        }
    });
}

function applyOrder(rows, orderBy) {
    if (!orderBy || !orderBy.length) return rows;
    return rows.slice().sort((a, b) => {
        for (const o of orderBy) {
            const field = o[0];
            const mul = (o[1] || 'asc') === 'desc' ? -1 : 1;
            let av = a[field], bv = b[field];
            if (av === bv) continue;
            if (av === undefined || av === null) return 1;
            if (bv === undefined || bv === null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
            av = String(av); bv = String(bv);
            if (av < bv) return -1 * mul;
            if (av > bv) return 1 * mul;
        }
        return 0;
    });
}

// ── Public API ─────────────────────────────────────────────────────────

function getStorageMode() { return 'postgres'; }

/** Postgres 模式沒有 Firestore handle；回傳 null，呼叫端皆已優雅降級。 */
function getDb() { return null; }

async function getAllData(collectionName) {
    try {
        const r = await q('SELECT doc_id, data FROM documents WHERE collection = $1', [resolveCollection(collectionName)]);
        return r.rows.map((row) => ({ id: row.doc_id, ...row.data }));
    } catch (error) {
        console.error(`[pg] getAllData(${collectionName}):`, error.message);
        return [];
    }
}

async function queryCollection(collectionName, opts = {}) {
    try {
        let rows = await getAllData(collectionName);
        rows = rows.filter((doc) => matchWhere(doc, opts.where));
        rows = applyOrder(rows, opts.orderBy);
        if (opts.startAfter !== undefined && opts.startAfter !== null && opts.orderBy && opts.orderBy.length) {
            const field = opts.orderBy[0][0];
            const idx = rows.findIndex((r) => r[field] === opts.startAfter);
            if (idx >= 0) rows = rows.slice(idx + 1);
        }
        if (opts.offset) rows = rows.slice(opts.offset);
        if (opts.limit) rows = rows.slice(0, opts.limit);
        return rows;
    } catch (error) {
        console.error(`[pg] queryCollection(${collectionName}):`, error.message);
        return [];
    }
}

async function countCollection(collectionName, opts = {}) {
    try {
        if (!opts.where || !opts.where.length) {
            const r = await q('SELECT count(*)::int AS n FROM documents WHERE collection = $1', [resolveCollection(collectionName)]);
            return r.rows[0].n;
        }
        const rows = (await getAllData(collectionName)).filter((doc) => matchWhere(doc, opts.where));
        return rows.length;
    } catch (error) {
        console.error(`[pg] countCollection(${collectionName}):`, error.message);
        return 0;
    }
}

async function getDocument(collectionName, docId) {
    try {
        const r = await q('SELECT doc_id, data FROM documents WHERE collection = $1 AND doc_id = $2',
            [resolveCollection(collectionName), String(docId)]);
        if (!r.rows.length) return null;
        return { id: r.rows[0].doc_id, ...r.rows[0].data };
    } catch (error) {
        console.error(`[pg] getDocument(${collectionName}):`, error.message);
        return null;
    }
}

/** 新增/覆寫文件。有 data.ID 則用它當 doc_id（覆寫）；否則自動產生 ID。 */
async function addData(collectionName, data) {
    try {
        const physical = resolveCollection(collectionName);
        let id;
        if (data.ID) {
            id = String(data.ID);
        } else {
            id = genId();
            data.ID = id;
        }
        await q(
            `INSERT INTO documents (collection, doc_id, data) VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (collection, doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [physical, id, JSON.stringify(data)]
        );
        return data;
    } catch (error) {
        console.error(`[pg] addData(${collectionName}):`, error.message);
        return null;
    }
}

/** 部分更新（淺層 merge）。文件不存在則回 false，對齊 Firestore .update()。 */
async function updateData(collectionName, docId, data) {
    try {
        const r = await q(
            `UPDATE documents SET data = data || $3::jsonb, updated_at = now()
             WHERE collection = $1 AND doc_id = $2`,
            [resolveCollection(collectionName), String(docId), JSON.stringify(data)]
        );
        return r.rowCount > 0;
    } catch (error) {
        console.error(`[pg] updateData(${collectionName}):`, error.message);
        return false;
    }
}

/** Upsert with merge — 等同 Firestore set(data, { merge: true })（不存在則建立）。 */
async function upsertData(collectionName, docId, data) {
    try {
        await q(
            `INSERT INTO documents (collection, doc_id, data) VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (collection, doc_id) DO UPDATE SET data = documents.data || EXCLUDED.data, updated_at = now()`,
            [resolveCollection(collectionName), String(docId), JSON.stringify(data)]
        );
        return true;
    } catch (error) {
        console.error(`[pg] upsertData(${collectionName}):`, error.message);
        return false;
    }
}

async function deleteData(collectionName, docId) {
    try {
        await q('DELETE FROM documents WHERE collection = $1 AND doc_id = $2',
            [resolveCollection(collectionName), String(docId)]);
        return true;
    } catch (error) {
        console.error(`[pg] deleteData(${collectionName}):`, error.message);
        return false;
    }
}

// ── 管理員帳號（公主本地登入用）────────────────────────────────────────
async function getAdminUser(username) {
    const r = await q('SELECT username, password_hash, role_level FROM admin_users WHERE username = $1', [String(username)]);
    return r.rows[0] || null;
}
async function createAdminUser(username, passwordHash, roleLevel = 5) {
    await q(
        `INSERT INTO admin_users (username, password_hash, role_level) VALUES ($1, $2, $3)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role_level = EXCLUDED.role_level`,
        [String(username), passwordHash, roleLevel]
    );
    return true;
}
async function countAdminUsers() {
    const r = await q('SELECT count(*)::int AS n FROM admin_users');
    return r.rows[0].n;
}

// ── 收尾（測試/腳本用）──────────────────────────────────────────────────
async function close() { if (pool) { await pool.end(); pool = null; } }

module.exports = {
    getDb,
    getAllData,
    queryCollection,
    countCollection,
    getDocument,
    addData,
    updateData,
    upsertData,
    deleteData,
    getStorageMode,
    resolveCollection,
    COL,
    COLLECTION_MODE: MODE,
    // Postgres 專屬（供 local-auth / 腳本使用）
    getPool,
    ensureSchema,
    getAdminUser,
    createAdminUser,
    countAdminUsers,
    close,
};
