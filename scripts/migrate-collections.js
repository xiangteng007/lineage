#!/usr/bin/env node
/**
 * scripts/migrate-collections.js
 * ---------------------------------------------------------------------------
 * Safely copy documents from the legacy PascalCase collections to the new
 * canonical lowercase collections. Mirrors firebase.js COLLECTION_MAP.
 *
 *   Members      -> members
 *   Battles      -> bossBattles
 *   Sieges       -> sieges
 *   Alliances    -> alliances
 *   Treasury     -> treasury
 *   Transactions -> transactions
 *
 * SAFETY:
 *   • Default mode is a DRY-RUN — nothing is written.
 *   • --commit performs the copy. Source collections are NEVER deleted, so a
 *     rollback is simply: keep COLLECTION_MODE=legacy (or delete the new ones).
 *   • Document IDs are preserved.
 *   • By default it refuses to write into a non-empty target (use --force to
 *     overwrite/merge).
 *
 * USAGE:
 *   node scripts/migrate-collections.js              # dry-run (preview counts)
 *   node scripts/migrate-collections.js --commit     # copy (safe, keeps source)
 *   node scripts/migrate-collections.js --commit --force   # also write into non-empty targets
 *   node scripts/migrate-collections.js --only members,treasury   # subset
 *
 * After verifying, set COLLECTION_MODE=canonical in .env to switch the app.
 * ---------------------------------------------------------------------------
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').split('=')[1]
    || (args.includes('--only') ? args[args.indexOf('--only') + 1] : '');
const ONLY = onlyArg ? onlyArg.split(',').map(s => s.trim()).filter(Boolean) : null;

const PAIRS = [
    ['Members', 'members'],
    ['Battles', 'bossBattles'],
    ['Sieges', 'sieges'],
    ['Alliances', 'alliances'],
    ['Treasury', 'treasury'],
    ['Transactions', 'transactions'],
];

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
        console.error('❌ No Firebase credentials found (serviceAccountKey.json or env).');
        process.exit(1);
    }
    return admin.firestore();
}

async function copyCollection(db, src, dst) {
    const srcSnap = await db.collection(src).get();
    const dstSnap = await db.collection(dst).limit(1).get();
    const srcCount = srcSnap.size;
    const dstExisting = !dstSnap.empty;

    if (!COMMIT) {
        console.log(`  [dry-run] ${src.padEnd(13)} -> ${dst.padEnd(13)}  ${srcCount} docs${dstExisting ? '  (target NOT empty)' : ''}`);
        return { src, dst, srcCount, copied: 0, skipped: true };
    }
    if (dstExisting && !FORCE) {
        console.log(`  ⚠️  SKIP ${src} -> ${dst}: target not empty (use --force to merge). ${srcCount} docs not copied.`);
        return { src, dst, srcCount, copied: 0, skipped: true };
    }

    let copied = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const doc of srcSnap.docs) {
        batch.set(db.collection(dst).doc(doc.id), doc.data(), { merge: true });
        inBatch++; copied++;
        if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();

    const verify = await db.collection(dst).get();
    console.log(`  ✅ ${src.padEnd(13)} -> ${dst.padEnd(13)}  copied ${copied}, target now ${verify.size}`);
    return { src, dst, srcCount, copied, targetCount: verify.size, skipped: false };
}

(async () => {
    const db = initFirebase();
    const pairs = ONLY ? PAIRS.filter(([, dst]) => ONLY.includes(dst) || ONLY.includes(dst.toLowerCase())) : PAIRS;
    console.log('\n=== Collection Migration ===');
    console.log(`mode: ${COMMIT ? (FORCE ? 'COMMIT --force' : 'COMMIT') : 'DRY-RUN (no writes)'}`);
    console.log(`pairs: ${pairs.map(p => p.join('→')).join(', ')}\n`);

    const results = [];
    for (const [src, dst] of pairs) {
        try { results.push(await copyCollection(db, src, dst)); }
        catch (e) { console.error(`  ❌ ${src} -> ${dst} FAILED:`, e.message); }
    }

    const total = results.reduce((s, r) => s + (r.copied || 0), 0);
    console.log(`\nDone. ${COMMIT ? `copied ${total} docs total.` : 'No data written (dry-run).'}`);
    if (!COMMIT) console.log('Re-run with --commit to perform the copy.');
    else console.log('Source collections were preserved. Verify, then set COLLECTION_MODE=canonical in .env.');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
