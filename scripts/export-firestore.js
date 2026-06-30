#!/usr/bin/env node
/**
 * scripts/export-firestore.js
 * ---------------------------------------------------------------------------
 * 一次性：趁 GCP / Firestore 還在線上，把所有 collection 倒成 JSON 檔，
 * 之後用 scripts/import-postgres.js 灌進本地 PostgreSQL。
 *
 * 需要：firebase-admin（devDependency，已隨 npm install 安裝）+ Firebase 憑證。
 * 憑證來源（擇一）：
 *   • 專案根目錄 serviceAccountKey.json
 *   • 環境變數 FIREBASE_SERVICE_ACCOUNT_JSON
 *   • 環境變數 FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 *
 * 用法：
 *   node scripts/export-firestore.js
 * 輸出：firestore-export/<collection>.json + _manifest.json
 * ---------------------------------------------------------------------------
 */
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function initFirebase() {
  if (admin.apps.length) return admin.firestore();
  const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
  } else if (fs.existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  } else if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({ credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }) });
  } else {
    console.error('❌ 找不到 Firebase 憑證（serviceAccountKey.json 或 FIREBASE_* 環境變數）。');
    process.exit(1);
  }
  return admin.firestore();
}

// Firestore Timestamp / 巢狀物件 → 純 JSON（Timestamp 轉 ISO 字串）
function normalize(v) {
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (_) { return null; } }
    if (Array.isArray(v)) return v.map(normalize);
    const o = {};
    for (const k of Object.keys(v)) o[k] = normalize(v[k]);
    return o;
  }
  return v;
}

(async () => {
  const db = initFirebase();
  const outDir = path.join(__dirname, '..', 'firestore-export');
  fs.mkdirSync(outDir, { recursive: true });

  const cols = await db.listCollections();
  if (!cols.length) { console.warn('⚠️ 沒有發現任何 collection。'); }
  const manifest = [];
  for (const c of cols) {
    const snap = await c.get();
    const docs = snap.docs.map(d => ({ id: d.id, data: normalize(d.data()) }));
    fs.writeFileSync(path.join(outDir, `${c.id}.json`), JSON.stringify(docs, null, 2));
    manifest.push({ collection: c.id, count: docs.length });
    console.log(`  ✅ ${c.id.padEnd(16)} ${docs.length} 筆`);
  }
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), collections: manifest }, null, 2));
  console.log(`\n完成 → ${outDir}`);
  console.log('下一步：設定好 PostgreSQL 後執行  npm run import-postgres');
  process.exit(0);
})().catch(e => { console.error('匯出失敗：', e); process.exit(1); });
