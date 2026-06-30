/* ── DEPRECATED ───────────────────────────────────────────────────────────
   本檔已停用。前端不再使用 Firebase（已改為本地 JWT + REST 輪詢）。
   index.html 已移除對它的 <script> 引用，保留此檔僅為避免舊快取 404。
   ───────────────────────────────────────────────────────────────────────── */
window._firebaseAuth = null;
window._firebaseDb = null;
console.log('[firebase-config] 已停用（本地模式，無 Firebase）');
