'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  routes-local-auth.js — 公主（最高管理員）本地帳號登入
//  取代 Google 登入。帳密以 bcrypt 雜湊存於 PostgreSQL 的 admin_users 表。
//
//  端點：
//    GET  /api/admin/setup-status  → { hasAdmin }  （前端判斷是否走首次建立流程）
//    POST /api/admin/setup         → 首次建立公主帳號（系統尚無任何管理員時才允許）
//    POST /api/admin/login         → { token, username, roleLevel }
// ═══════════════════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const store = require('./store-postgres');
const authTokens = require('./auth-tokens');

module.exports = function registerLocalAuthRoutes(app) {
    // 是否已有管理員（首次部署引導用）
    app.get('/api/admin/setup-status', async (req, res) => {
        try {
            const n = await store.countAdminUsers();
            res.json({ ok: true, hasAdmin: n > 0 });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 首次建立公主帳號 —— 僅在系統還沒有任何管理員時開放，避免被任意覆寫。
    app.post('/api/admin/setup', async (req, res) => {
        try {
            const n = await store.countAdminUsers();
            if (n > 0) {
                return res.status(409).json({ ok: false, code: 'ALREADY_SETUP', error: '管理員已存在，請改用登入' });
            }
            const { username, password } = req.body || {};
            if (!username || !password || String(password).length < 8) {
                return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: '帳號必填、密碼至少 8 碼' });
            }
            const hash = await bcrypt.hash(String(password), 10);
            const uname = String(username).trim();
            await store.createAdminUser(uname, hash, 5);
            const token = authTokens.issueOwnerToken(uname, 5);
            res.json({ ok: true, token, username: uname, roleLevel: 5 });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 登入
    app.post('/api/admin/login', async (req, res) => {
        try {
            const { username, password } = req.body || {};
            if (!username || !password) {
                return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: '缺少帳號或密碼' });
            }
            const u = await store.getAdminUser(String(username).trim());
            if (!u) return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '帳號或密碼錯誤' });
            const ok = await bcrypt.compare(String(password), u.password_hash);
            if (!ok) return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '帳號或密碼錯誤' });
            const token = authTokens.issueOwnerToken(u.username, u.role_level);
            res.json({ ok: true, token, username: u.username, roleLevel: u.role_level });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
};
