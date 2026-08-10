'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  store-firestore.js — 舊版 Firestore 資料層（保留作為「匯出舊資料」用途）
//
//  預設情況下 firebase.js 會載入 store-postgres（本地 NAS）。
//  只有在 STORAGE_DRIVER=firestore 時才會載入這支，用途：
//    • scripts/export-firestore.js 把雲端資料倒出來
//    • 萬一需要臨時切回雲端比對
//  完成遷移、確認無虞後，可連同 firebase-admin 套件一併移除。
// ═══════════════════════════════════════════════════════════════════════════
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── Firebase Init ──────────────────────────────────────────────────────
let db = null;

function initializeFirebase() {
    if (admin.apps.length > 0) { db = admin.firestore(); return; }
    try {
        // 檔案搬到 lib/ 之後，serviceAccountKey.json 仍在專案根目錄
        const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
        if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            console.log('Firebase initialized using FIREBASE_SERVICE_ACCOUNT_JSON');
            db = admin.firestore();
        } else if (fs.existsSync(keyPath)) {
            const serviceAccount = require(keyPath);
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            console.log('Firebase initialized using local serviceAccountKey.json');
            db = admin.firestore();
        } else if (process.env.FIREBASE_PROJECT_ID) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                })
            });
            console.log('Firebase initialized using environment variables');
            db = admin.firestore();
        } else {
            console.error('No Firebase credentials found. Running in degraded mode.');
        }
    } catch (error) {
        console.error('Error initializing Firebase:', error.message);
    }
}

initializeFirebase();

// ── Collection name resolution (config-driven; legacy by default) ───────
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

// ── Public API ─────────────────────────────────────────────────────────

function getStorageMode() {
    return 'firebase';
}

function getDb() {
    return db;
}

async function getAllData(collectionName) {
    try {
        if (!db) return [];
        const snapshot = await db.collection(resolveCollection(collectionName)).get();
        if (snapshot.empty) return [];
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error(`Firestore error (${collectionName}):`, error.message);
        return [];
    }
}

async function queryCollection(collectionName, opts = {}) {
    try {
        if (!db) return [];
        let ref = db.collection(resolveCollection(collectionName));
        for (const w of (opts.where || [])) {
            if (Array.isArray(w) && w.length === 3 && w[2] !== undefined && w[2] !== null && w[2] !== '') {
                ref = ref.where(w[0], w[1], w[2]);
            }
        }
        for (const o of (opts.orderBy || [])) {
            ref = ref.orderBy(o[0], o[1] || 'asc');
        }
        if (opts.offset) ref = ref.offset(opts.offset);
        if (opts.startAfter !== undefined && opts.startAfter !== null) ref = ref.startAfter(opts.startAfter);
        if (opts.limit) ref = ref.limit(opts.limit);
        const snapshot = await ref.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error(`Firestore query error (${collectionName}):`, error.message);
        return [];
    }
}

async function countCollection(collectionName, opts = {}) {
    try {
        if (!db) return 0;
        let ref = db.collection(resolveCollection(collectionName));
        for (const w of (opts.where || [])) {
            if (Array.isArray(w) && w.length === 3 && w[2] !== undefined && w[2] !== null && w[2] !== '') {
                ref = ref.where(w[0], w[1], w[2]);
            }
        }
        try {
            const agg = await ref.count().get();
            return agg.data().count;
        } catch (e) {
            const snap = await ref.get();
            return snap.size;
        }
    } catch (error) {
        console.error(`Firestore count error (${collectionName}):`, error.message);
        return 0;
    }
}

async function getDocument(collectionName, docId) {
    try {
        if (!db) return null;
        const doc = await db.collection(resolveCollection(collectionName)).doc(String(docId)).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error(`Firestore getDoc error:`, error.message);
        return null;
    }
}

async function addData(collectionName, data) {
    try {
        if (!db) return null;
        const physical = resolveCollection(collectionName);
        let docRef;
        if (data.ID) {
            docRef = db.collection(physical).doc(String(data.ID));
            await docRef.set(data);
        } else {
            docRef = await db.collection(physical).add(data);
            data.ID = docRef.id;
            await docRef.update({ ID: docRef.id });
        }
        return data;
    } catch (error) {
        console.error(`Firestore addData error:`, error.message);
        return null;
    }
}

async function updateData(collectionName, docId, data) {
    try {
        if (!db) return false;
        await db.collection(resolveCollection(collectionName)).doc(String(docId)).update(data);
        return true;
    } catch (error) {
        console.error(`Firestore updateData error:`, error.message);
        return false;
    }
}

/** Upsert with merge — 等同 Firestore set(data, { merge: true })（不存在則建立）。 */
async function upsertData(collectionName, docId, data) {
    try {
        if (!db) return false;
        await db.collection(resolveCollection(collectionName)).doc(String(docId)).set(data, { merge: true });
        return true;
    } catch (error) {
        console.error(`Firestore upsertData error:`, error.message);
        return false;
    }
}

async function deleteData(collectionName, docId) {
    try {
        if (!db) return false;
        await db.collection(resolveCollection(collectionName)).doc(String(docId)).delete();
        return true;
    } catch (error) {
        console.error(`Firestore deleteData error:`, error.message);
        return false;
    }
}

module.exports = {
    db,
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
};
