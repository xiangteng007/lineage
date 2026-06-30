'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  auth-tokens.js — 本地 JWT 簽發 / 驗證（取代 Firebase Auth）
//
//  取代的東西：
//    admin.auth().createCustomToken(lineUserId)  → issueMemberToken(lineUserId)
//    admin.auth().verifyIdToken(token)           → verify(token)
//
//  Token payload：
//    成員（LINE）: { uid: <lineUserId>, provider: 'line', displayName? }
//    公主（本地）: { uid: <username>,   provider: 'local', role: <roleLevel> }
//
//  前端拿到 token 後存 localStorage，之後 API 以 header `x-auth-token` 帶上。
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-insecure-secret-change-me');

if (!SECRET) {
    console.error('[auth] ⚠️  JWT_SECRET 未設定！正式環境的 token 認證將失敗。請在 .env 設定 JWT_SECRET。');
}

const TTL = process.env.JWT_TTL || '30d';

/** 簽發 LINE 成員 token（uid = lineUserId）。 */
function issueMemberToken(lineUserId, claims = {}) {
    return jwt.sign({ uid: String(lineUserId), provider: 'line', ...claims }, SECRET, { expiresIn: TTL });
}

/** 簽發公主（本地管理員）token。 */
function issueOwnerToken(username, roleLevel = 5) {
    return jwt.sign({ uid: String(username), role: roleLevel, provider: 'local' }, SECRET, { expiresIn: TTL });
}

/** 驗證 token；成功回傳 payload，失敗丟出例外。 */
function verify(token) {
    return jwt.verify(token, SECRET);
}

module.exports = { issueMemberToken, issueOwnerToken, verify };
