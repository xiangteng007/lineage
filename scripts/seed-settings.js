#!/usr/bin/env node
/**
 * scripts/seed-settings.js
 * ---------------------------------------------------------------------------
 * Initialise the `settings/*` documents needed for go-live:
 *   settings/permissions  — configurable action thresholds (income/expense/...)
 *   settings/modules      — per-module read/write minimum roleLevel
 *   settings/roles        — 5-tier role definitions (names + colors)
 *   settings/guild        — basic guild info
 *
 * SAFETY:
 *   • DRY-RUN by default (no writes). Use --commit to write.
 *   • Idempotent: existing docs are NOT overwritten unless --force is given.
 *
 * USAGE:
 *   node scripts/seed-settings.js              # preview
 *   node scripts/seed-settings.js --commit     # create missing docs
 *   node scripts/seed-settings.js --commit --force   # overwrite with defaults
 * ---------------------------------------------------------------------------
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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
    console.error('❌ No Firebase credentials found.'); process.exit(1);
  }
  return admin.firestore();
}

(async () => {
  const db = initFirebase();
  console.log('\n=== Seed settings ===');
  console.log(`mode: ${COMMIT ? (FORCE ? 'COMMIT --force' : 'COMMIT') : 'DRY-RUN (no writes)'}\n`);
  for (const [docId, data] of Object.entries(SEED)) {
    const ref = db.collection('settings').doc(docId);
    const snap = await ref.get();
    const exists = snap.exists;
    if (!COMMIT) {
      console.log(`  [dry-run] settings/${docId.padEnd(12)} ${exists ? 'EXISTS (would skip)' : 'would CREATE'}`);
      continue;
    }
    if (exists && !FORCE) { console.log(`  ⏭  settings/${docId} exists — skipped (use --force to overwrite)`); continue; }
    await ref.set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
    console.log(`  ✅ settings/${docId} ${exists ? 'updated' : 'created'}`);
  }
  console.log(`\nDone. ${COMMIT ? '' : 'Re-run with --commit to write.'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
