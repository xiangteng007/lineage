const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin
function initializeFirebase() {
    if (admin.apps.length > 0) return;

    try {
        // Option 1: Look for a local serviceAccountKey.json file
        const keyPath = path.join(__dirname, 'serviceAccountKey.json');
        
        if (fs.existsSync(keyPath)) {
            const serviceAccount = require(keyPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase initialized using local serviceAccountKey.json');
        } 
        // Option 2: Use environment variables (good for Vercel)
        else if (process.env.FIREBASE_PROJECT_ID) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    // Handle newlines in the private key
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                })
            });
            console.log('Firebase initialized using environment variables');
        } else {
            console.warn('⚠️ No Firebase credentials found. Please add serviceAccountKey.json or set FIREBASE_* env vars.');
            // We initialize with default app to prevent immediate crashes, but db operations will fail
            admin.initializeApp();
        }
    } catch (error) {
        console.error('Error initializing Firebase:', error);
    }
}

initializeFirebase();
const db = admin.firestore();

/**
 * Get all documents from a collection
 * @param {string} collectionName 
 * @returns {Promise<Array>}
 */
async function getAllData(collectionName) {
    try {
        const snapshot = await db.collection(collectionName).get();
        if (snapshot.empty) return [];
        
        const data = [];
        snapshot.forEach(doc => {
            data.push({ id: doc.id, ...doc.data() });
        });
        return data;
    } catch (error) {
        console.error(`Error getting data from ${collectionName}:`, error);
        return [];
    }
}

/**
 * Get a specific document by ID
 */
async function getDocument(collectionName, docId) {
    try {
        const docRef = db.collection(collectionName).doc(docId);
        const doc = await docRef.get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error(`Error getting doc ${docId} from ${collectionName}:`, error);
        return null;
    }
}

/**
 * Add a new document (auto-generates ID if not provided inside data)
 */
async function addData(collectionName, data) {
    try {
        // If data has an ID, use it, otherwise let Firestore generate one
        let docRef;
        if (data.ID) {
            docRef = db.collection(collectionName).doc(String(data.ID));
            await docRef.set(data);
        } else {
            docRef = await db.collection(collectionName).add(data);
            data.ID = docRef.id; // Assign generated ID back to object
            await docRef.update({ ID: docRef.id });
        }
        return data;
    } catch (error) {
        console.error(`Error adding data to ${collectionName}:`, error);
        throw error;
    }
}

/**
 * Update an existing document
 */
async function updateData(collectionName, docId, data) {
    try {
        const docRef = db.collection(collectionName).doc(String(docId));
        await docRef.update(data);
        return true;
    } catch (error) {
        console.error(`Error updating data in ${collectionName}:`, error);
        throw error;
    }
}

/**
 * Delete a document
 */
async function deleteData(collectionName, docId) {
    try {
        const docRef = db.collection(collectionName).doc(String(docId));
        await docRef.delete();
        return true;
    } catch (error) {
        console.error(`Error deleting data from ${collectionName}:`, error);
        throw error;
    }
}

module.exports = {
    db,
    getAllData,
    getDocument,
    addData,
    updateData,
    deleteData
};
