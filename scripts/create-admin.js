#!/usr/bin/env node
/**
 * scripts/create-admin.js
 * ---------------------------------------------------------------------------
 * 建立 / 更新「公主」（最高管理員，roleLevel 5）本地登入帳號。
 * 密碼以 bcrypt 雜湊存入 PostgreSQL 的 admin_users 表。
 *
 * 用法：
 *   node scripts/create-admin.js <帳號> <密碼>
 *   ADMIN_USERNAME=xiang ADMIN_PASSWORD=secret12 node scripts/create-admin.js
 *   （docker）docker compose run --rm app node scripts/create-admin.js <帳號> <密碼>
 * ---------------------------------------------------------------------------
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const store = require('../lib/store-postgres');

(async () => {
  const username = (process.argv[2] || process.env.ADMIN_USERNAME || '').trim();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || '';
  if (!username || !password) {
    console.error('用法：node scripts/create-admin.js <帳號> <密碼>（或設 ADMIN_USERNAME / ADMIN_PASSWORD）');
    process.exit(1);
  }
  if (String(password).length < 8) {
    console.error('❌ 密碼至少 8 碼。');
    process.exit(1);
  }
  await store.ensureSchema();
  const existed = await store.getAdminUser(username);
  const hash = await bcrypt.hash(String(password), 10);
  await store.createAdminUser(username, hash, 5);
  console.log(`✅ 已${existed ? '更新' : '建立'}公主帳號：${username}（roleLevel 5）`);
  await store.close();
  process.exit(0);
})().catch(e => { console.error('建立失敗：', e); process.exit(1); });
