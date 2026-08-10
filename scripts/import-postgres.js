#!/usr/bin/env node
/**
 * scripts/import-postgres.js
 * ---------------------------------------------------------------------------
 * 把 scripts/export-firestore.js 產出的 firestore-export/*.json
 * 灌進本地 PostgreSQL 的 documents 表。
 *
 * collection 名稱沿用匯出時的實體名稱（Members / Battles / ...），
 * 搭配 COLLECTION_MODE=legacy（預設）即可與 app 對齊。
 *
 * 用法（需先設定 PG* 或 DATABASE_URL）：
 *   node scripts/import-postgres.js
 *   node scripts/import-postgres.js --truncate   # 匯入前先清空 documents 表
 * ---------------------------------------------------------------------------
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('../lib/store-postgres');

const TRUNCATE = process.argv.slice(2).includes('--truncate');

(async () => {
  const dir = path.join(__dirname, '..', 'firestore-export');
  if (!fs.existsSync(dir)) {
    console.error('❌ 找不到 firestore-export/，請先執行  npm run export-firestore');
    process.exit(1);
  }
  await store.ensureSchema();
  const pool = store.getPool();

  if (TRUNCATE) {
    await pool.query('TRUNCATE documents');
    console.log('🧹 已清空 documents 表');
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  if (!files.length) { console.error('❌ firestore-export/ 內沒有 JSON 檔。'); process.exit(1); }

  let total = 0;
  for (const f of files) {
    const collection = f.replace(/\.json$/, '');
    let docs;
    try { docs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { console.warn(`  ⚠️ 略過 ${f}（JSON 解析失敗：${e.message}）`); continue; }
    if (!Array.isArray(docs)) continue;
    for (const d of docs) {
      const id = String(d.id);
      const data = (d && d.data && typeof d.data === 'object') ? d.data : {};
      await pool.query(
        `INSERT INTO documents (collection, doc_id, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (collection, doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [collection, id, JSON.stringify(data)]
      );
      total++;
    }
    console.log(`  ✅ ${collection.padEnd(16)} ${docs.length} 筆`);
  }
  console.log(`\n完成，共匯入 ${total} 筆文件。`);
  await store.close();
  process.exit(0);
})().catch(e => { console.error('匯入失敗：', e); process.exit(1); });
