'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  firebase.js — 資料層選擇器（driver seam）
//
//  歷史因素檔名仍叫 firebase.js，但它現在只是個轉接器：
//    STORAGE_DRIVER=postgres（預設）→ lib/store-postgres.js（本地 NAS）
//    STORAGE_DRIVER=firestore        → lib/store-firestore.js（舊雲端，僅匯出用）
//
//  全專案 require('./firebase') 的程式碼都不需改動 —— 兩個 driver 對外 API 一致。
// ═══════════════════════════════════════════════════════════════════════════
const driver = String(process.env.STORAGE_DRIVER || 'postgres').toLowerCase();

if (driver === 'firestore') {
    console.log('[store] 使用 Firestore driver（STORAGE_DRIVER=firestore）');
    module.exports = require('./lib/store-firestore');
} else {
    console.log('[store] 使用 PostgreSQL driver');
    module.exports = require('./lib/store-postgres');
}
