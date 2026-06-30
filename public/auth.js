'use strict';

// ══════════════════════════════════════════════
//  auth.js — 認證、成員系統、分級權限
//  Lineage AI Command Center · Plan E × S1
// ══════════════════════════════════════════════

// ── 階級定義 ──────────────────────────────────
/** @type {Array<{level:number, id:string, name:string, nameEn:string, color:string}>} */
const DEFAULT_ROLES = [
  { level: 5, id: 'master',  name: '公主',  nameEn: 'GUILD MASTER', color: '#FFD700' },
  { level: 4, id: 'elder',   name: '元帥',  nameEn: 'ELDER',        color: '#EF9F27' },
  { level: 3, id: 'officer', name: '幹部',  nameEn: 'OFFICER',      color: '#C68B2F' },
  { level: 2, id: 'member',  name: '成員',  nameEn: 'MEMBER',       color: '#8B7355' },
  { level: 1, id: 'recruit', name: '新人',  nameEn: 'RECRUIT',      color: '#6B6B6B' },
];

// ── 模組權限矩陣（預設值，公會主可在 /settings/guild 覆寫）──
/**
 * key = module name
 * value = { read: minLevel, write: minLevel, [action]: minLevel }
 * @type {Object.<string, Object.<string, number>>}
 */
const DEFAULT_MODULE_PERMISSIONS = {
  overview:   { read: 1, write: 3 },
  members:    { read: 2, write: 4 },
  bossBattle: { read: 1, write: 3, settle: 3, preRegister: 2 },
  siege:      { read: 1, write: 3, settle: 3, preRegister: 2 },
  treasury:   { read: 3, write: 4 },
  alliance:   { read: 2, write: 4 },
  settings:   { read: 5, write: 5 },
};

// ── 全域狀態 ──────────────────────────────────
/** @type {{uid:string|null, displayName:string|null, lineUserId:string|null, role:string|null, roleLevel:number, guildCharacters:Array, permissions:Object, roles:Array, modulePermissions:Object}|null} */
window.currentUser = null;

/** 目前生效的模組權限（合併 Firestore 覆寫與預設值） */
let _modulePermissions = { ...DEFAULT_MODULE_PERMISSIONS };

/** 目前生效的階級設定（合併 Firestore 覆寫與預設值） */
let _roles = DEFAULT_ROLES.slice();

// ══════════════════════════════════════════════
//  1. LINE Login / LIFF 初始化
// ══════════════════════════════════════════════

/**
 * 初始化 LIFF SDK，完成後以 LINE userId 換取 Firebase Custom Token。
 * 若非 LINE 環境（桌機直開）則略過 LIFF，不阻斷 Firebase onAuthStateChanged。
 * @param {string} liffId - LIFF App ID（需在 LINE Developers Console 設定）
 */
async function initLiff(liffId) {
  if (typeof liff === 'undefined') {
    console.info('[auth] LIFF SDK not loaded — skipping LINE login');
    return;
  }
  try {
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      // 非 LIFF 環境內嵌時 redirect 到 LINE 登入
      if (liff.isInClient()) {
        liff.login();
      }
      return;
    }
    const profile = await liff.getProfile();
    const lineUserId = profile.userId;
    const displayName = profile.displayName;
    console.info('[auth] LINE profile:', displayName, lineUserId);
    await _signInWithLine(lineUserId, displayName);
  } catch (err) {
    console.error('[auth] LIFF init error:', err);
    showToast('LINE 登入失敗：' + (err.message || err), 'error');
  }
}

/**
 * 以 LINE userId + displayName 向後端 /api/line-auth 換取 Firebase Custom Token，
 * 再用 signInWithCustomToken 完成 Firebase 登入。
 * @param {string} lineUserId
 * @param {string} displayName
 */
async function _signInWithLine(lineUserId, displayName) {
  try {
    const resp = await fetch('/api/line-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId, displayName }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const token = data.token || data.customToken;
    if (token) localStorage.setItem('authToken', token);   // 本地 JWT
    await _loadCurrentUser();
    console.info('[auth] 本地 token 登入 OK');
  } catch (err) {
    console.error('[auth] _signInWithLine error:', err);
    showToast('登入失敗：' + (err.message || err), 'error');
  }
}

// ══════════════════════════════════════════════
//  2. Firebase Auth 狀態監聽
// ══════════════════════════════════════════════

/**
 * 啟動 onAuthStateChanged 監聽。
 * 登入後從 Firestore /users/{uid} 讀取 role, roleLevel, guildCharacters, permissions。
 * 同時載入 /settings/guild 取得公會主自訂的階級與模組權限覆寫。
 */
function initAuthListener() {
  // 取代 Firebase onAuthStateChanged：改以本地 token + /api/me 載入身分。
  _loadCurrentUser();
}

async function _loadCurrentUser() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    window.currentUser = null;
    updateHeaderAuth(null);
    window.dispatchEvent(new CustomEvent('authReady', { detail: null }));
    return;
  }
  try {
    await _loadGuildSettings();
    const resp = await fetch('/api/me', { headers: { 'x-auth-token': token } });
    const j = resp.ok ? await resp.json() : null;
    const d = (j && j.data) || {};
    const member = d.member || {};
    window.currentUser = {
      uid:              d.lineUserId || null,
      displayName:      member.displayName || member.name || member.Name || '未知成員',
      lineUserId:       d.lineUserId || null,
      role:             d.role || 'recruit',
      roleLevel:        d.roleLevel || 0,
      guildCharacters:  member.characters || [],
      permissions:      d.permissions || {},
      roles:            _roles,
      modulePermissions: _modulePermissions,
    };
    updateHeaderAuth(window.currentUser);
    console.info('[auth] user loaded:', window.currentUser.displayName, '/ level', window.currentUser.roleLevel);
    window.dispatchEvent(new CustomEvent('authReady', { detail: window.currentUser }));
  } catch (err) {
    console.error('[auth] user load error:', err);
  }
}

/**
 * 從 Firestore /settings/guild 載入公會自訂階級名稱與模組權限覆寫。
 * 若文件不存在則保留預設值。
 */
async function _loadGuildSettings() {
  try {
    const resp = await fetch('/api/settings');
    if (!resp.ok) return; // 端點不存在或無資料 → 保留預設值
    const j = await resp.json();
    const data = (j && (j.guild || j.data || j)) || {};
    if (Array.isArray(data.roles) && data.roles.length === 5) {
      _roles = data.roles;
    }
    if (data.modulePermissions && typeof data.modulePermissions === 'object') {
      _modulePermissions = { ...DEFAULT_MODULE_PERMISSIONS, ...data.modulePermissions };
    }
  } catch (err) {
    console.warn('[auth] _loadGuildSettings:', err);
  }
}

// ══════════════════════════════════════════════
//  3. 權限判斷函數
// ══════════════════════════════════════════════

/**
 * 判斷目前使用者是否可執行指定模組的某個動作。
 * @param {string} module - 模組 key，對應 DEFAULT_MODULE_PERMISSIONS
 * @param {string} [action='read'] - 動作 key，預設 'read'
 * @returns {boolean}
 */
function canAccess(module, action = 'read') {
  if (!window.currentUser) return false;
  const level    = window.currentUser.roleLevel || 0;
  const modPerms = _modulePermissions[module];
  if (!modPerms) return false;
  const minLevel = modPerms[action];
  if (minLevel === undefined) return false;
  return level >= minLevel;
}

/**
 * 判斷目前使用者是否達到最低階級要求。
 * @param {number} minLevel - 最低 roleLevel
 * @returns {boolean}
 */
function hasMinLevel(minLevel) {
  if (!window.currentUser) return false;
  return (window.currentUser.roleLevel || 0) >= minLevel;
}

/**
 * 取得指定 roleLevel 的階級物件。
 * @param {number} level
 * @returns {{level:number, id:string, name:string, nameEn:string, color:string}|null}
 */
function getRoleByLevel(level) {
  return _roles.find(r => r.level === level) || null;
}

// ══════════════════════════════════════════════
//  4. UI 函數 — Header 更新
// ══════════════════════════════════════════════

/**
 * 更新 header 右側的登入狀態顯示。
 * 已登入：顯示 userInfo 區塊（名稱 + roleLevel badge），隱藏 loginBtn。
 * 未登入：顯示 loginBtn，隱藏 userInfo。
 * @param {Object|null} user - window.currentUser 或 null
 */
function updateHeaderAuth(user) {
  const userInfoEl  = document.getElementById('userInfo');
  const loginBtnEl  = document.getElementById('loginBtn');
  const userNameEl  = document.getElementById('userName');
  const adminBadge  = document.getElementById('adminBadge');
  const userAvatar  = document.getElementById('userAvatar');

  if (user) {
    if (userInfoEl)  userInfoEl.style.display  = 'flex';
    if (loginBtnEl)  loginBtnEl.style.display  = 'none';
    if (userNameEl)  userNameEl.textContent     = user.displayName;

    // 替換 avatar 為帳號初始字母（無大頭照設計）
    if (userAvatar) {
      const initial = (user.displayName || '?').charAt(0).toUpperCase();
      userAvatar.style.display = 'none'; // 不顯示 img
      // 若有初始字母 div 則更新，否則建立
      let initialsEl = document.getElementById('authInitials');
      if (!initialsEl) {
        initialsEl = document.createElement('div');
        initialsEl.id = 'authInitials';
        initialsEl.style.cssText = [
          'width:30px', 'height:30px',
          'border:2px solid var(--or2)',
          'background:var(--or3)',
          'color:var(--or)',
          'font-size:13px', 'font-weight:900',
          'display:flex', 'align-items:center', 'justify-content:center',
          'cursor:pointer', 'font-family:monospace',
          'text-transform:uppercase', 'letter-spacing:0.04em',
        ].join(';');
        initialsEl.onclick = () => openProfileModal();
        if (userAvatar.parentNode) {
          userAvatar.parentNode.insertBefore(initialsEl, userAvatar);
        }
      }
      initialsEl.textContent = initial;
    }

    // Role badge（admin badge 欄位重用）
    if (adminBadge) {
      const role = getRoleByLevel(user.roleLevel);
      adminBadge.textContent = role ? `${role.name} · Lv${role.level}` : `Lv${user.roleLevel}`;
      adminBadge.style.color = role ? role.color : 'var(--or)';
      adminBadge.style.display = 'block';
    }
  } else {
    if (userInfoEl)  userInfoEl.style.display  = 'none';
    if (loginBtnEl)  loginBtnEl.style.display  = 'inline-flex';
    const initialsEl = document.getElementById('authInitials');
    if (initialsEl)  initialsEl.remove();
    if (adminBadge)  adminBadge.style.display  = 'none';
  }
}

// ══════════════════════════════════════════════
//  5. UI 函數 — 個人檔案 Modal
// ══════════════════════════════════════════════

/**
 * 開啟個人檔案 modal。
 * HTML 片段從 profile-modal.html inject 到 #profileModalContainer。
 * 若已存在則直接顯示。
 */
async function openProfileModal() {
  if (!window.currentUser) {
    showToast('請先登入', 'error');
    return;
  }
  let container = document.getElementById('profileModalContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'profileModalContainer';
    document.body.appendChild(container);
  }
  // 若 modal HTML 尚未載入則 fetch inject
  if (!container.dataset.loaded) {
    try {
      const html = await fetch('profile-modal.html').then(r => r.text());
      container.innerHTML = html;
      container.dataset.loaded = '1';
    } catch (err) {
      console.error('[auth] profile-modal load error:', err);
      showToast('個人檔案載入失敗', 'error');
      return;
    }
  }
  _populateProfileModal(window.currentUser);
  const modal = document.getElementById('profileModal');
  if (modal) modal.style.display = 'flex';
}

/**
 * 關閉個人檔案 modal。
 */
function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 將使用者資料填入個人檔案 modal 各欄位。
 * @param {Object} user - window.currentUser
 */
function _populateProfileModal(user) {
  const role = getRoleByLevel(user.roleLevel);

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('profileName',      user.displayName);
  setEl('profileRoleLevel', role ? `Lv${role.level}` : `Lv${user.roleLevel}`);
  setEl('profileRoleName',  role ? `${role.name} · ${role.nameEn}` : user.role);

  // roleLevel badge 顏色
  const badgeEl = document.getElementById('profileRoleBadge');
  if (badgeEl && role) {
    badgeEl.style.color       = role.color;
    badgeEl.style.borderColor = role.color + '99';
    badgeEl.style.background  = role.color + '14';
  }

  // 遊戲角色清單
  const charList = document.getElementById('profileCharList');
  if (charList) {
    if (!user.guildCharacters || user.guildCharacters.length === 0) {
      charList.innerHTML = '<div style="color:var(--tx2);font-size:12px;padding:8px 0;">尚未綁定遊戲角色</div>';
    } else {
      charList.innerHTML = user.guildCharacters.map(ch => `
        <div class="card-row profile-char-card" style="margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--or);text-transform:uppercase;
              letter-spacing:0.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              >${_esc(ch.name || '—')}</div>
            <div style="font-size:11px;color:var(--tx2);margin-top:2px;">
              <span class="job-${_esc(ch.job)}">${_esc(ch.job || '—')}</span>
              <span style="margin:0 5px;opacity:0.4;">·</span>
              <span>Lv ${ch.level || '?'}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="tier-badge" style="color:var(--tx2);font-size:9px;">${_esc(ch.server || 'SV')}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

/** 簡易 HTML 轉義 */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════
//  6. UI 函數 — 管理員 Modal
// ══════════════════════════════════════════════

/**
 * 開啟管理員角色 / 模組權限設定 modal（roleLevel >= 5 才能打開）。
 */
async function openAdminRolesModal() {
  if (!hasMinLevel(5)) {
    showToast('權限不足：需要公主階級', 'error');
    return;
  }
  let container = document.getElementById('adminRolesModalContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminRolesModalContainer';
    document.body.appendChild(container);
  }
  if (!container.dataset.loaded) {
    try {
      const html = await fetch('admin-roles.html').then(r => r.text());
      container.innerHTML = html;
      container.dataset.loaded = '1';
    } catch (err) {
      console.error('[auth] admin-roles load error:', err);
      showToast('管理介面載入失敗', 'error');
      return;
    }
  }
  _populateAdminModal();
  const modal = document.getElementById('adminRolesModal');
  if (modal) modal.style.display = 'flex';
}

/**
 * 關閉管理員 modal。
 */
function closeAdminRolesModal() {
  const modal = document.getElementById('adminRolesModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 將目前 _roles 與 _modulePermissions 填入 admin modal 表單。
 */
function _populateAdminModal() {
  // 填入階級名稱
  _roles.forEach(role => {
    const nameInput = document.getElementById(`roleName_${role.level}`);
    if (nameInput) nameInput.value = role.name;
    const nameEnInput = document.getElementById(`roleNameEn_${role.level}`);
    if (nameEnInput) nameEnInput.value = role.nameEn;
  });
  // 填入模組權限 select
  Object.keys(_modulePermissions).forEach(mod => {
    Object.keys(_modulePermissions[mod]).forEach(action => {
      const sel = document.getElementById(`perm_${mod}_${action}`);
      if (sel) sel.value = String(_modulePermissions[mod][action]);
    });
  });
}

/**
 * 儲存管理員表單修改到 Firestore /settings/guild。
 * 同時更新本地 _roles / _modulePermissions。
 */
async function saveAdminRoles() {
  if (!hasMinLevel(5)) return;
  // 讀取階級名稱表單
  const newRoles = _roles.map(role => {
    const nameInput   = document.getElementById(`roleName_${role.level}`);
    const nameEnInput = document.getElementById(`roleNameEn_${role.level}`);
    return {
      ...role,
      name:   nameInput   ? nameInput.value.trim()   || role.name   : role.name,
      nameEn: nameEnInput ? nameEnInput.value.trim() || role.nameEn : role.nameEn,
    };
  });
  // 讀取模組權限 select
  const newPerms = {};
  Object.keys(_modulePermissions).forEach(mod => {
    newPerms[mod] = {};
    Object.keys(_modulePermissions[mod]).forEach(action => {
      const sel = document.getElementById(`perm_${mod}_${action}`);
      newPerms[mod][action] = sel ? parseInt(sel.value, 10) : _modulePermissions[mod][action];
    });
  });
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': localStorage.getItem('authToken') || '' },
      body: JSON.stringify({ guild: { roles: newRoles, modulePermissions: newPerms } }),
    });
    _roles = newRoles;
    _modulePermissions = newPerms;
    if (window.currentUser) {
      window.currentUser.roles             = _roles;
      window.currentUser.modulePermissions = _modulePermissions;
    }
    closeAdminRolesModal();
    showToast('設定已儲存', 'success');
  } catch (err) {
    console.error('[auth] saveAdminRoles error:', err);
    showToast('儲存失敗：' + (err.message || err), 'error');
  }
}

// ══════════════════════════════════════════════
//  7. 登出
// ══════════════════════════════════════════════

/**
 * 登出 Firebase，若在 LIFF 環境也呼叫 liff.logout()。
 */
async function logout() {
  try {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) {
      liff.logout();
    }
    window.currentUser = null;
    updateHeaderAuth(null);
    // 重設本地快取
    _roles             = DEFAULT_ROLES.slice();
    _modulePermissions = { ...DEFAULT_MODULE_PERMISSIONS };
    showToast('已登出', 'info');
  } catch (err) {
    console.error('[auth] logout error:', err);
    showToast('登出失敗', 'error');
  }
}

// ══════════════════════════════════════════════
//  8. showToast 安全呼叫（與 index.html 共用）
// ══════════════════════════════════════════════

/**
 * 呼叫全域 showToast（由 index.html 定義）；若不存在則 fallback 到 console。
 * @param {string} msg
 * @param {'success'|'error'|'info'} [type='info']
 */
function showToast(msg, type = 'info') {
  if (typeof window.showToast === 'function') {
    window.showToast(msg, type);
  } else {
    console.info(`[toast:${type}] ${msg}`);
  }
}

// ══════════════════════════════════════════════
//  Export 到全域（供 index.html inline script 呼叫）
// ══════════════════════════════════════════════
window.Auth = {
  initLiff,
  initAuthListener,
  canAccess,
  hasMinLevel,
  getRoleByLevel,
  updateHeaderAuth,
  openProfileModal,
  closeProfileModal,
  openAdminRolesModal,
  closeAdminRolesModal,
  saveAdminRoles,
  logout,
  DEFAULT_ROLES,
  DEFAULT_MODULE_PERMISSIONS,
};

// 覆寫 index.html 原有的 logout()（若有）
window.logout        = logout;
window.openProfileModal      = openProfileModal;
window.closeProfileModal     = closeProfileModal;
window.openAdminRolesModal   = openAdminRolesModal;
window.closeAdminRolesModal  = closeAdminRolesModal;
window.saveAdminRoles        = saveAdminRoles;
window.canAccess             = canAccess;
window.hasMinLevel           = hasMinLevel;
