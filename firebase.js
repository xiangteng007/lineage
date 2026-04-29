const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── Firebase Init ──────────────────────────────────────────────────────
let db = null;

function initializeFirebase() {
    if (admin.apps.length > 0) return;
    try {
        const keyPath = path.join(__dirname, 'serviceAccountKey.json');
        if (fs.existsSync(keyPath)) {
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
            console.error('❌ No Firebase credentials found. Running in degraded mode. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
        }
    } catch (error) {
        console.error('Error initializing Firebase:', error.message);
    }
}

initializeFirebase();

// ── Public API ─────────────────────────────────────────────────────────

/** Returns whether the system is using Firestore or local JSON */
function getStorageMode() {
    return 'firebase';
}

/** Get all documents from a collection */
async function getAllData(collectionName) {
    try {
        if (!db) return [];
        const snapshot = await db.collection(collectionName).get();
        if (snapshot.empty) return [];
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error(`Firestore error (${collectionName}):`, error.message);
        return [];
    }
}

/** Get a specific document by ID */
async function getDocument(collectionName, docId) {
    try {
        if (!db) return null;
        const doc = await db.collection(collectionName).doc(String(docId)).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error(`Firestore getDoc error:`, error.message);
        return null;
    }
}

/** Add a new document */
async function addData(collectionName, data) {
    try {
        if (!db) return null;
        let docRef;
        if (data.ID) {
            docRef = db.collection(collectionName).doc(String(data.ID));
            await docRef.set(data);
        } else {
            docRef = await db.collection(collectionName).add(data);
            data.ID = docRef.id;
            await docRef.update({ ID: docRef.id });
        }
        return data;
    } catch (error) {
        console.error(`Firestore addData error:`, error.message);
        return null;
    }
}

/** Update an existing document */
async function updateData(collectionName, docId, data) {
    try {
        if (!db) return false;
        await db.collection(collectionName).doc(String(docId)).update(data);
        return true;
    } catch (error) {
        console.error(`Firestore updateData error:`, error.message);
        return false;
    }
}

/** Delete a document */
async function deleteData(collectionName, docId) {
    try {
        if (!db) return false;
        await db.collection(collectionName).doc(String(docId)).delete();
        return true;
    } catch (error) {
        console.error(`Firestore deleteData error:`, error.message);
        return false;
    }
}

module.exports = { db, getAllData, getDocument, addData, updateData, deleteData, getStorageMode };
