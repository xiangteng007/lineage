#!/usr/bin/env node
// Read-only inspection of LINE-related Firestore data.
// Usage: node scripts/inspect-line-data.js
'use strict';

const path = require('path');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  const sa = require(path.join(__dirname, '..', 'serviceAccountKey.json'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

function maskUid(id) {
  if (!id) return '(none)';
  return id.length > 8 ? id.slice(0, 4) + '…' + id.slice(-4) : id;
}

async function main() {
  console.log('═══ Members with lineUserId ═══');
  const memberSnap = await db.collection('Members').get();
  let bound = 0, unbound = 0;
  memberSnap.docs.forEach(doc => {
    const m = doc.data();
    if (m.lineUserId) {
      bound++;
      console.log(`  ✓ ${m.name || m.Name || '(no name)'} | tier=${m.tier || '?'} | job=${m.job || '?'} | uid=${maskUid(m.lineUserId)}`);
    } else {
      unbound++;
    }
  });
  console.log(`  total members: ${memberSnap.size} | with lineUserId: ${bound} | without: ${unbound}`);

  console.log('');
  console.log('═══ adminLineBinds (Google admin → LINE) ═══');
  const adminSnap = await db.collection('adminLineBinds').get();
  if (adminSnap.empty) {
    console.log('  (empty — no admin has linked their LINE yet)');
  } else {
    adminSnap.docs.forEach(doc => {
      const a = doc.data();
      console.log(`  ✓ ${doc.id} | displayName=${a.displayName || '(none)'} | uid=${maskUid(a.lineUserId)} | boundAt=${a.boundAt ? a.boundAt.toDate().toISOString() : '?'}`);
    });
  }

  console.log('');
  console.log('═══ bindCodes (pending binding codes) ═══');
  const codeSnap = await db.collection('bindCodes').where('used', '==', false).get();
  if (codeSnap.empty) {
    console.log('  (no unused codes)');
  } else {
    codeSnap.docs.forEach(doc => {
      const c = doc.data();
      const isAdmin = !!c.adminEmail;
      const exp = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate() : (c.expiresAt ? new Date(c.expiresAt) : null);
      console.log(`  ✓ ${doc.id} | ${isAdmin ? 'ADMIN' : 'MEMBER'} | createdBy=${c.createdBy || '?'} | expires=${exp ? exp.toISOString() : '?'}`);
    });
  }

  console.log('');
  console.log('═══ Firebase Auth users (LINE-derived) ═══');
  let pageToken;
  let total = 0;
  const lineUsers = [];
  do {
    const list = await admin.auth().listUsers(1000, pageToken);
    list.users.forEach(u => {
      // Custom-token LINE logins set uid = LINE userId (starts with 'U' + 32 hex)
      if (/^U[a-f0-9]{32}$/.test(u.uid)) {
        lineUsers.push(u);
      }
      total++;
    });
    pageToken = list.pageToken;
  } while (pageToken);
  console.log(`  total Auth users: ${total} | LINE-derived: ${lineUsers.length}`);
  lineUsers.slice(0, 10).forEach(u => {
    console.log(`  ✓ uid=${maskUid(u.uid)} | created=${u.metadata.creationTime} | lastSignIn=${u.metadata.lastSignInTime || '(never)'}`);
  });
  if (lineUsers.length > 10) console.log(`  ... and ${lineUsers.length - 10} more`);

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
