#!/usr/bin/env node
/**
 * scripts/seed-settings.js
 * ---------------------------------------------------------------------------
 * 初始化 go-live 需要的 settings/* 文件：
 *   settings/permissions  — 可設定的 action 門檻（收入/支出/...）
 *   settings/modules      — 各模組讀寫最低 roleLevel
 *   settings/roles        — 5 階階級定義（名稱 + 顏色）
 *   settings/guild        — 基本公會資訊
 *
 * 走 lib 的 store 選擇器（預設 PostgreSQL；STORAGE_DRIVER=firestore 可指回雲端）。
 *
 * 安全機制：
 *   • 預設 DRY-RUN（不寫入）。加 --commit 才寫。
 *   • 冪等：既有文件不覆寫，除非加 --force。
 *
 * 用法：
 *   node scripts/seed-settings.js              # 預覽
 *   node scripts/seed-settings.js --commit     # 建立缺少的文件
 *   node scripts/seed-settings.js --commit --force   # 以預設值覆寫
 * ---------------------------------------------------------------------------
 */
require('dotenv').config();
const store = require('../firebase');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');

const SEED = {
  permissions: {
    treasuryView: 3, treasuryIncome: 3, treasuryExpense: 4, treasuryCastleTax: 3,
    memberCreate: 3, memberDelete: 5, battleDelete: 4, siegeDelete: 4, lineBroadcast: 3,
  },
  modules: {
    modulePermissions: {
      myprofile: { minRead: 1, minWrite: 1 },
      overview:  { minRead: 1, minWrite: 5 },
      members:   { minRead: 2, minWrite: 3 },
      bossBattles:{ minRead: 1, minWrite: 3 },
      sieges:    { minRead: 1, minWrite: 3 },
      treasury:  { minRead: 3, minWrite: 4 },
      alliances: { minRead: 2, minWrite: 3 },
      settings:  { minRead: 4, minWrite: 5 },
    },
  },
  roles: {
    roleDefinitions: [
      { level: 5, name: '會主', color: '#F59E0B' },
      { level: 4, name: '元帥', color: '#D97706' },
      { level: 3, name: '幹部', color: '#B87333' },
      { level: 2, name: '成員', color: '#A8A49C' },
      { level: 1, name: '新人', color: '#706C61' },
    ],
  },
  guild: {
    guildName: '長途夜車', serverName: '水蛇', castles: [], announcement: '',
  },
};

(async () => {
  console.log(`\n=== Seed settings (driver: ${store.getStorageMode()}) ===`);
  console.log(`mode: ${COMMIT ? (FORCE ? 'COMMIT --force' : 'COMMIT') : 'DRY-RUN (no writes)'}\n`);
  for (const [docId, data] of Object.entries(SEED)) {
    const existing = await store.getDocument('settings', docId);
    const exists = !!existing;
    if (!COMMIT) {
      console.log(`  [dry-run] settings/${docId.padEnd(12)} ${exists ? 'EXISTS (would skip)' : 'would CREATE'}`);
      continue;
    }
    if (exists && !FORCE) { console.log(`  ⏭  settings/${docId} exists — skipped (use --force to overwrite)`); continue; }
    await store.upsertData('settings', docId, { ...data, updatedAt: new Date().toISOString() });
    console.log(`  ✅ settings/${docId} ${exists ? 'updated' : 'created'}`);
  }
  console.log(`\nDone. ${COMMIT ? '' : 'Re-run with --commit to write.'}`);
  if (store.close) await store.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
