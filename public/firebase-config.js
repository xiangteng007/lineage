/* ── Firebase Web App Config ─────────────────────
   Project: lineage-b0156
   App:     Lineage AI Web
   ─────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyCjF_cuGR2obzunvMJgShz8nmqveZTZLbk",
  authDomain:        "lineage-b0156.firebaseapp.com",
  projectId:         "lineage-b0156",
  storageBucket:     "lineage-b0156.firebasestorage.app",
  messagingSenderId: "100077284718",
  appId:             "1:100077284718:web:2e84704056911a02b8e57f",
  measurementId:     "G-PGFK6RERQW"
};

// ── Initialize (compat mode for CDN usage) ───────
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const db   = firebase.firestore();

// ── Firestore settings ────────────────────────────
db.settings({ ignoreUndefinedProperties: true });

// ── Export for use in other scripts ──────────────
window._firebaseAuth = fbAuth;
window._firebaseDb   = db;

console.log('[Firebase] ✅ Initialized — project:', firebaseConfig.projectId);
