/* ══════════════════════════════════════════════════
   天堂：經典版 管理系統 — app.js
   Firebase + Google OAuth Admin Auth
══════════════════════════════════════════════════ */

const API_BASE = '/api';

// ── State ────────────────────────────────────────
let state = { members: [], battles: [], sieges: [], alliances: [], treasury: null, transactions: [], activityLogs: [] };
let auth = { isLoggedIn: false, isAdmin: false, user: null, token: null };
let filters = { members: '', battles: '', sieges: '', alliances: '', treasury: '' };

// ── Charts ───────────────────────────────────────
let classChartInstance = null;
let treasuryChartInstance = null;
let treasuryTrendChartInstance = null;

// (duplicate early declarations removed → canonical versions defined below)

const _filterTimers = {};
function setFilter(section, query) {
  filters[section] = query.toLowerCase();
  // 300ms debounce so rapid typing doesn't re-render on every keystroke
  clearTimeout(_filterTimers[section]);
  _filterTimers[section] = setTimeout(() => {
    if (section === 'members') renderMembers();
    else if (section === 'battles') renderBattles();
    else if (section === 'sieges') renderSieges();
    else if (section === 'alliances') renderAlliances();
    else if (section === 'treasury') renderTreasury();
  }, 300);
}



function toggleExpand(id) {
  const row = document.getElementById(`details-${id}`);
  const icon = document.getElementById(`icon-${id}`);
  if (row) row.classList.toggle('expanded');
  if (icon) icon.classList.toggle('rotate-180');
}

function getAttendanceHtml(attIds) {
  if (!attIds || attIds.length === 0) return '<div style="opacity:0.5;">無出席紀錄</div>';
  return attIds.map(aid => {
    let person = state.members.find(m => (m.ID || m.id) === aid);
    let type = 'blood';
    if (!person) {
      person = state.alliances.find(a => (a.ID || a.id) === aid);
      type = person ? 'alliance' : 'unknown';
    }
    const name = person ? (person.name || person.Name || '未知') : '已刪除人員';
    const job = person ? person.job : '';
    const badge = type === 'alliance' ? '<span class="bg-primary/20 text-primary border border-primary/30 text-[11px] px-1 rounded-sm ml-1 font-bold">聯盟</span>' : '';
    return `<div>${name} ${badge} <span class="text-slate-500 font-bold ml-1">${job}</span></div>`;
  }).join('');
}


// ── LINE (LIFF) member login + rank-based access ──
async function tryLineLogin() {
  const liffId = window._liffId;
  if (!liffId || typeof liff === 'undefined') return false;
  try {
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      if (liff.isInClient()) { liff.login(); return false; } // redirect inside LINE app
      return false; // desktop browser outside LINE -> remain guest
    }
    const profile = await liff.getProfile();
    const lineUserId = profile.userId;
    const res = await fetch(`${API_BASE}/me?lineUserId=${encodeURIComponent(lineUserId)}`);
    const j = await res.json();
    if (j && j.ok && j.data) {
      auth.lineUserId = lineUserId;
      auth.isMember = true;
      auth.member = j.data.member || null;
      auth.roleLevel = j.data.roleLevel || 0;
      auth.roleName = j.data.role || '';
      auth.permissions = j.data.permissions || null;
      auth.battleCount = j.data.battleCount || 0;
      auth.siegeCount = j.data.siegeCount || 0;
      auth.memberBound = !!j.data.bound;
      auth.actionPerms = j.data.actionPerms || null;
      try {
        const ar = await fetch(`${API_BASE}/line-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineUserId, displayName: profile.displayName }) });
        const aj = await ar.json();
        if (aj && aj.customToken && window.firebase && firebase.auth) {
          const cred = await firebase.auth().signInWithCustomToken(aj.customToken);
          auth.firebaseUser = cred.user;
          auth.firebaseToken = await cred.user.getIdToken();
        }
      } catch (e) { console.warn('[line-login] firebase session failed:', e && e.message); }
      console.info('[line-login] member:', auth.roleName, 'level', auth.roleLevel);
      return true;
    }
  } catch (e) { console.warn('[line-login] failed:', e && e.message); }
  return false;
}

function canViewModule(mod) { if (auth.isAdmin) return true; if (!auth.permissions) return true; return auth.permissions[mod] ? auth.permissions[mod].view : true; }
function canEditModule(mod) { if (auth.isAdmin) return true; if (!auth.permissions) return false; return auth.permissions[mod] ? auth.permissions[mod].edit : false; }

function applyPermissions() {
  // "我的檔案" tab — visible for any LINE-member session so an unbound user
  // (roleLevel 0) still has a profile entry sitting next to the rest of the
  // sidebar rather than being the lone visible item.
  document.querySelectorAll('[data-section="myprofile"]').forEach(b => { b.style.display = auth.isMember ? '' : 'none'; });
  // Gate module nav by view permission. LINE members get a baseline of
  // overview / battles / sieges visible regardless of roleLevel, so an
  // unbound member still sees the public guild views alongside 我的檔案.
  const memberBaseline = new Set(['overview', 'battles', 'sieges']);
  ['overview', 'members', 'battles', 'sieges', 'alliances', 'treasury'].forEach(mod => {
    let show = canViewModule(mod);
    if (!show && auth.isMember && memberBaseline.has(mod)) show = true;
    document.querySelectorAll(`.nav-item[data-section="${mod}"], .mnav-btn[data-section="${mod}"]`).forEach(b => { b.style.display = show ? '' : 'none'; });
  });
  const canEditMembers = auth.isAdmin || canEditModule('members');
  document.querySelectorAll('#membersTable .admin-col').forEach(el => el.classList.toggle('hidden', !canEditMembers));
  // Officers (roleLevel>=3) can create + settle battles/sieges
  document.querySelectorAll('#battles .admin-col').forEach(el => el.classList.toggle('hidden', !(auth.isAdmin || canEditModule('battles'))));
  document.querySelectorAll('#sieges .admin-col').forEach(el => el.classList.toggle('hidden', !(auth.isAdmin || canEditModule('sieges'))));
  const showCard = (mod) => auth.isAdmin || auth.openMode || auth.isLoggedIn || canEditModule(mod);
  const bc = document.getElementById('battleAddCard'); if (bc) bc.classList.toggle('hidden', !showCard('battles'));
  const sc = document.getElementById('siegeAddCard'); if (sc) sc.classList.toggle('hidden', !showCard('sieges'));
  // Treasury ops card: visible to anyone who can record income/expense/castle-tax
  const canTreasuryOps = canDoActionClient('treasuryIncome') || canDoActionClient('treasuryExpense') || canDoActionClient('treasuryCastleTax');
  const toc = document.getElementById('treasuryOpsCard'); if (toc) toc.classList.toggle('hidden', !canTreasuryOps);
  // Permission-config card: owner only
  const tpc = document.getElementById('treasuryPermCard'); if (tpc) tpc.classList.toggle('hidden', !auth.isAdmin);
  const mac = document.getElementById('memberAddCard'); if (mac) mac.classList.toggle('hidden', !(auth.isAdmin || auth.openMode || canDoActionClient('memberCreate')));
  document.querySelectorAll('[onclick*="openLineBroadcastModal"]').forEach(b => b.classList.toggle('hidden', !canDoActionClient('lineBroadcast')));
  // Limit income/expense options to what the actor may do (non-owner)
  const txType = document.getElementById('txType');
  if (txType && txType.options && !auth.isAdmin) {
    const allowIncome = canDoActionClient('treasuryIncome');
    const allowExpense = canDoActionClient('treasuryExpense');
    [...txType.options].forEach(o => { o.hidden = (o.value === 'income' && !allowIncome) || (o.value === 'expense' && !allowExpense); });
    const cur = txType.selectedOptions[0];
    if (cur && cur.hidden) { const first = [...txType.options].find(o => !o.hidden); if (first) txType.value = first.value; }
  }
}

async function renderMyProfile() {
  if (!auth.isMember || !auth.member) return;
  const m = auth.member;
  const id = m.ID || m.id;
  const set = (eid, v) => { const el = document.getElementById(eid); if (el) el.textContent = v; };
  const name = m.name || m.Name || '—';
  set('myProfileName', name);
  set('myProfileRole', auth.roleName || '');
  set('myProfileJob', m.job || '—');
  set('myProfileTier', m.tier || '一般');
  set('myProfileLevel', m.level || '—');
  set('myProfileBattles', auth.battleCount || 0);
  set('myProfileSieges', auth.siegeCount || 0);
  const av = document.getElementById('myProfileAvatar'); if (av) av.textContent = (name.charAt(0) || '?').toUpperCase();
  try {
    const j = (u) => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const [att, lv] = await Promise.all([j(`${API_BASE}/members/${id}/attendance-history`), j(`${API_BASE}/members/${id}/level-history`)]);
    const attEl = document.getElementById('myProfileAttHistory');
    if (attEl) {
      const list = (att && att.ok ? att.data : []) || [];
      attEl.innerHTML = list.length ? list.slice(0, 10).map(h => { const icon = h.type === 'siege' ? '🏰' : '⚔️'; const d = h.date ? new Date(h.date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : ''; return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--bd);"><span>${icon} ${h.name || ''}</span><span style="color:var(--tx3);">${d}</span></div>`; }).join('') : '<div style="font-size:12px;color:var(--tx3);">尚無出席記錄</div>';
    }
    const lvEl = document.getElementById('myProfileLevelHistory');
    if (lvEl) {
      const list = (lv && lv.ok ? lv.data : []) || [];
      lvEl.innerHTML = list.length ? list.slice(0, 10).map(h => { const d = h.changedAt ? new Date(h.changedAt).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : ''; return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--bd);"><span>${h.prevLevel != null ? h.prevLevel + ' → ' : ''}Lv${h.level}</span><span style="color:var(--tx3);">${d}</span></div>`; }).join('') : '<div style="font-size:12px;color:var(--tx3);">尚無等級異動</div>';
    }
  } catch (e) { console.warn('myProfile history failed', e); }
}

// ── Init ─────────────────────────────────────────
async function init() {
  // 1. Fetch server config (open mode / Google Client ID)
  try {
    const cfgRes = await fetch(`${API_BASE}/config`);
    const cfg = await cfgRes.json();
    window._liffId = cfg.liffId || '';
    if (cfg.openMode) {
      // No ADMIN_EMAILS configured — give everyone admin access
      auth.isAdmin = true;
      auth.isLoggedIn = false; // still not "logged in" as a named user
      auth.openMode = true;
    }
    if (cfg.googleClientId) {
      window.GOOGLE_CLIENT_ID = cfg.googleClientId;
      // Init Google Sign-In after we have the client ID
      if (window.google && window.google.accounts) {
        google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: function (resp) { handleGoogleLogin(resp && resp.credential); },
          auto_select: false,
        });
      }
    }
  } catch (e) {
    console.warn('Config fetch failed, defaulting to guest mode');
  }

  // 2. Restore existing session from localStorage
  if (!auth.openMode) {
    const savedToken = localStorage.getItem('gToken');
    const savedUser = localStorage.getItem('gUser');
    if (savedToken && savedUser) {
      try {
        const res = await fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: savedToken })
        });
        if (res.ok) {
          const data = await res.json();
          setAuthState(savedToken, data);
        } else {
          clearAuthState();
        }
      } catch (e) {
        clearAuthState();
      }
    }
  }

  // 2.5 LINE (LIFF) member login — only when no owner (Google) session
  if (!auth.isLoggedIn && !auth.isAdmin) {
    await tryLineLogin();
  }

  await fetchData();
  renderAuthUI();
  applyPermissions();
  // Default landing: members -> 我的檔案; owner -> overview
  if (auth.isMember && !auth.isAdmin) { switchSection('myprofile'); renderMyProfile(); }

  // Attach Firestore realtime listeners (auto-refresh on remote changes)
  startRealtimeSync();

  // Start Telemetry Simulation
  startTelemetry();
}

// ── Realtime sync (Firestore onSnapshot) ─────────
let _realtimeStarted = false;
let _realtimeTimer = null;
function startRealtimeSync() {
  if (_realtimeStarted) return;
  const fdb = window._firebaseDb;
  if (!fdb || typeof fdb.collection !== 'function') return; // client SDK unavailable -> silent degrade
  _realtimeStarted = true;
  const cols = ['Members', 'Battles', 'Sieges', 'Transactions', 'Alliances'];
  const seen = {};
  const scheduleRefresh = () => {
    clearTimeout(_realtimeTimer);
    _realtimeTimer = setTimeout(() => { fetchData(); }, 800); // debounce bursts into one refresh
  };
  cols.forEach(col => {
    try {
      fdb.collection(col).onSnapshot(
        () => { if (!seen[col]) { seen[col] = true; return; } scheduleRefresh(); }, // ignore initial attach
        (err) => { console.warn('[realtime] listener disabled for', col, err && err.message); }
      );
    } catch (e) { console.warn('[realtime] attach failed', col, e && e.message); }
  });
  console.log('[realtime] onSnapshot listeners attached');
}

// ── Telemetry Simulation ─────────────────────────
function startTelemetry() {
  setInterval(updateTelemetry, 2500);
  setInterval(updateClock, 1000);
  updateTelemetry();
  updateClock();
}

function updateClock() {
  const el = document.getElementById('sysClockDisplay');
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

function updateTelemetry() {
  const latencyEl = document.getElementById('latencyDisplay');
  const costEl = document.getElementById('costDisplay');
  const bandwidthEl = document.getElementById('bandwidthDisplay');
  
  if (latencyEl) {
    const latency = Math.floor(Math.random() * 15) + 18; // 18-33ms
    latencyEl.textContent = `${latency}ms`;
  }
  
  if (costEl) {
    const currentCost = (0.124 + (Math.random() * 0.01) - 0.005).toFixed(3);
    costEl.textContent = `$${currentCost}`;
  }
  
  if (bandwidthEl) {
    const bw = (1.2 + (Math.random() * 0.4) - 0.2).toFixed(1);
    bandwidthEl.textContent = `${bw} MB/s`;
  }
}

// ── Auth ─────────────────────────────────────────
function setAuthState(token, userData) {
  auth.isLoggedIn = true;
  auth.isAdmin = userData.isAdmin;
  auth.user = userData;
  auth.token = token;
  localStorage.setItem('gToken', token);
  localStorage.setItem('gUser', JSON.stringify(userData));
}

function clearAuthState() {
  auth = { isLoggedIn: false, isAdmin: false, user: null, token: null };
  localStorage.removeItem('gToken');
  localStorage.removeItem('gUser');
}

async function handleGoogleLogin(credential) {
  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: credential })
    });

    const data = await res.json();

    if (!res.ok) {
      document.getElementById('loginError').textContent = data.error || '登入失敗';
      document.getElementById('loginError').classList.remove('hidden');
      return;
    }

    setAuthState(credential, data);
    closeLoginModal();
    renderAuthUI();
    renderMembers(); // Re-render with admin controls
    renderAlliances();

    if (data.isAdmin) {
      showToast(`歡迎，${data.name || data.email}！已以管理員身份登入`, 'success');
    } else {
      showToast(`歡迎，${data.name || data.email}！已登入血盟系統`, 'success');
    }
  } catch (e) {
    document.getElementById('loginError').textContent = '無法連線至伺服器，請稍後再試';
    document.getElementById('loginError').classList.remove('hidden');
  }
}

function logout() {
  clearAuthState();
  renderAuthUI();
  renderMembers();
  renderAlliances();
  showToast('已登出', 'default');
  
  // Reset Google One Tap
  if (window.google && window.google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
}

function renderAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');

  if (auth.openMode) {
    // Open mode: hide login button, show status pill
    loginBtn.innerHTML = '<i class="material-symbols-outlined">lock_open</i><span>Admin_Override</span>';
    loginBtn.style.cursor = 'default';
    loginBtn.onclick = null;
    loginBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
  } else if (auth.isLoggedIn && auth.user) {
    loginBtn.classList.add('hidden');
    userInfo.classList.remove('hidden');
    document.getElementById('userAvatar').src = auth.user.picture || '';
    document.getElementById('userName').textContent = auth.user.name || auth.user.email;
    if (auth.isAdmin) {
      document.getElementById('adminBadge').classList.remove('hidden');
    } else {
      document.getElementById('adminBadge').classList.add('hidden');
    }
  } else {
    loginBtn.innerHTML = '<i class="material-symbols-outlined">login</i><span>Auth_Required</span>';
    loginBtn.onclick = openLoginModal;
    loginBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
  }

  // Show/hide admin-only elements based on isAdmin flag
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !auth.isAdmin);
  });
  // Show/hide auth-required elements based on isLoggedIn or openMode
  document.querySelectorAll('.auth-required').forEach(el => {
    el.classList.toggle('hidden', !(auth.isLoggedIn || auth.openMode));
  });
  document.querySelectorAll('.admin-col').forEach(el => {
    el.classList.toggle('hidden', !auth.isAdmin);
  });

  // Guest notice for members
  const guestNotice = document.getElementById('memberGuestNotice');
  if (guestNotice) {
    guestNotice.classList.toggle('hidden', auth.isAdmin);
  }
}

// ── Login Modal ───────────────────────────────────
function openLoginModal() {
  document.getElementById('loginModal').style.display = 'flex';
  document.getElementById('loginError').classList.add('hidden');
  const div = document.getElementById('googleSignInDiv');
  if (!div) return;

  // Case A: GSI script not loaded yet (async defer can finish after init()).
  // Show a wait message and retry once the global appears.
  if (!(window.google && window.google.accounts && window.google.accounts.id)) {
    div.innerHTML = '<div style="color:var(--tx3);font-size:13px;padding:16px 0;text-align:center;font-family:\'JetBrains Mono\',monospace;letter-spacing:0.12em;">> AWAITING GOOGLE IDENTITY SDK…</div>';
    setTimeout(function () {
      var modal = document.getElementById('loginModal');
      if (modal && modal.style.display === 'flex') openLoginModal();
    }, 700);
    return;
  }

  // Case B: SDK is ready — make sure it's initialised with our client_id
  // every time the modal opens (idempotent). The earlier initialize() call
  // in init() can be a no-op if the SDK wasn't loaded yet; this guarantees
  // renderButton has a valid client_id to bind to.
  var clientId = window.GOOGLE_CLIENT_ID || '';
  if (!clientId) {
    div.innerHTML = '<div style="color:#f87171;font-size:13px;padding:16px 0;text-align:center;font-weight:700;letter-spacing:0.08em;">GOOGLE_CLIENT_ID NOT CONFIGURED<br><span style="font-size:11px;opacity:0.8;">請在 Vercel 環境變數設定 GOOGLE_CLIENT_ID</span></div>';
    return;
  }

  try {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: function (resp) { handleGoogleLogin(resp && resp.credential); },
      auto_select: false,
    });
    div.innerHTML = ''; // clear any prior placeholder before render
    google.accounts.id.renderButton(div, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 280,
    });
  } catch (e) {
    console.error('[auth] GSI renderButton error:', e);
    div.innerHTML = '<div style="color:#f87171;font-size:13px;padding:16px 0;text-align:center;">Google 元件初始化失敗<br><span style="font-size:11px;opacity:0.8;">' + (e && e.message ? String(e.message).replace(/[<>&]/g, '') : 'unknown') + '</span></div>';
  }
}

function closeLoginModal(e) {
  if (e && e.target !== document.getElementById('loginModal')) return;
  document.getElementById('loginModal').style.display = 'none';
}

// ── Navigation ────────────────────────────────────
function switchSection(sectionId) {
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll(`.nav-item[data-section="${sectionId}"], .mobile-nav-item[data-section="${sectionId}"]`).forEach(btn => btn.classList.add('active'));
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  const el = document.getElementById(sectionId);
  if (el) el.classList.add('active');
  setMobileNavActive(sectionId);
  if (sectionId === 'treasury' && auth.isAdmin && typeof loadTreasuryPermConfig === 'function') { loadTreasuryPermConfig(); }
  // Sync top-nav underline
  document.querySelectorAll('.top-nav-link').forEach(a => a.classList.remove('active-nav'));
  const topLink = document.querySelector(`.top-nav-link[onclick*="${sectionId}"]`);
  if (topLink) topLink.classList.add('active-nav');
}

function setTopNavActive(el) {
  document.querySelectorAll('.top-nav-link').forEach(a => a.classList.remove('active-nav'));
  if (el) el.classList.add('active-nav');
}

function setMobileNavActive(sectionId) {
  document.querySelectorAll('.mnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
    // Update fill icon
    const icon = btn.querySelector('.mnav-icon');
    if (icon) {
      icon.style.fontVariationSettings = btn.dataset.section === sectionId
        ? "'FILL' 1, 'wght' 700, 'GRAD' 0, 'opsz' 24"
        : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
    }
  });
}

// ── Toast & Activity Feed ─────────────────────────
function showToast(msg, type = 'default') {
  const container = document.getElementById('toastContainer');
  const colorMap = { success: 'toast-success', error: 'toast-error', info: 'toast-info', default: 'toast-info' };
  const cls = colorMap[type] || 'toast-info';
  const id = 'toast-' + Date.now();
  const card = document.createElement('div');
  card.className = `toast-card ${cls}`;
  card.id = id;
  card.innerHTML = `
    <div class="toast-dot"></div>
    <span class="toast-msg">${msg}</span>
    <button onclick="dismissToast('${id}')" style="color:#475569;font-size:14px;line-height:1;background:none;border:none;cursor:pointer;padding:0 2px;flex-shrink:0;">✕</button>
    <div class="toast-progress"></div>`;
  if (container) container.appendChild(card);
  setTimeout(() => dismissToast(id), 3200);
  logActivity(msg, type);
}

function dismissToast(id) {
  const card = document.getElementById(id);
  if (!card) return;
  card.classList.add('dismissing');
  setTimeout(() => card.remove(), 280);
}

function logActivity(content, type = 'default') {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  state.activityLogs.unshift({ time, content, type });
  if (state.activityLogs.length > 50) state.activityLogs.pop();
  renderActivityFeed();
}

// Alias used by sendBroadcast()
const logToTerminal = logActivity;

function renderActivityFeed() {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const items = [];

  // Server-side activity log (real backend events) — newest, shown first
  (state.serverFeed || []).forEach(ev => {
    const icon = ev.module === 'treasury' ? '\uD83D\uDCB0' : ev.module === 'members' ? '\uD83D\uDC64' : ev.module === 'sieges' ? '\uD83C\uDFF0' : '\u2694\uFE0F';
    items.push({ ts: new Date(ev.createdAt || 0), html:
      `<li class="feed-item">
        <div class="feed-icon bg-amber-900/30">${icon}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-1.5 flex-wrap">
            <span class="text-[10px] font-black text-primary uppercase tracking-wide">${ev.action || ''}</span>
            <span class="text-[10px] font-bold text-white/80 truncate">${ev.target || ''}</span>
          </div>
          <div class="text-[11px] text-slate-500 font-bold mt-0.5">${ev.detail || ''}</div>
        </div>
        <span class="text-[10px] font-black uppercase text-amber-700/60 flex-shrink-0">\u25CF</span>
      </li>` });
  });

  [...state.battles].forEach(b => {
    const isOk = (b.result||b.status) === 'success';
    const boss = b.bossName || b.boss || '首領';
    const cfg = getBossConfig()[boss];
    const bossIcon = cfg ? cfg.icon : '⚔️';
    const date = new Date(b.time||b.createdAt||0).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
    let att = [];
    try { att = typeof b.attendance==='string'?JSON.parse(b.attendance):(b.attendance||[]); } catch(e){}
    items.push({ ts: new Date(b.time||b.createdAt||0), html:
      `<li class="feed-item">
        <div class="feed-icon ${isOk ? 'bg-red-900/40' : 'bg-slate-800/60'}">${bossIcon}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-1.5 flex-wrap">
            <span class="text-[10px] font-black ${isOk?'text-primary':'text-slate-500'} uppercase tracking-wide">${isOk?'擊殺':'失敗'}</span>
            <span class="text-[10px] font-bold text-white/80 truncate">${boss}</span>
          </div>
          <div class="text-[11px] text-slate-500 font-bold mt-0.5">${date} · ${att.length} 人出席</div>
        </div>
        <span class="text-[10px] font-black uppercase tracking-wide ${isOk ? 'text-green-600' : 'text-red-700'} flex-shrink-0">${isOk?'✓':'✗'}</span>
      </li>` });
  });

  [...state.sieges].forEach(s => {
    const castle = s.castle || s.castleName || '城堡';
    const isAtk = (s.type||s.siegeType) === 'attack';
    const typeLabel = isAtk ? '攻城' : '守城';
    const date = new Date(s.date||s.createdAt||0).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
    let att = [];
    try { att = typeof s.attendance==='string'?JSON.parse(s.attendance):(s.attendance||[]); } catch(e){}
    items.push({ ts: new Date(s.date||s.createdAt||0), html:
      `<li class="feed-item">
        <div class="feed-icon bg-amber-900/30">🏰</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-1.5 flex-wrap">
            <span class="text-[10px] font-black ${isAtk?'text-red-400':'text-blue-400'} uppercase tracking-wide">${typeLabel}</span>
            <span class="text-[10px] font-bold text-white/80 truncate">${castle}</span>
          </div>
          <div class="text-[11px] text-slate-500 font-bold mt-0.5">${date} · ${att.length} 人出席</div>
        </div>
        <span class="text-[10px] font-black uppercase text-amber-700/60 flex-shrink-0">⚔️</span>
      </li>` });
  });

  items.sort((a,b) => b.ts - a.ts);
  if (!items.length) {
    feed.innerHTML = `<li class="empty-state"><div class="empty-icon">🏰</div><div class="empty-text">尚無活動記錄</div></li>`;
    return;
  }
  feed.innerHTML = items.slice(0,8).map(i=>i.html).join('');
  return;
  // (legacy code below kept for fallback)
  const feed2 = document.getElementById('activityFeed');
  if (!feed2) return;

  const typeConfig = {
    success: { icon: '✅', color: '#10b981' },
    error:   { icon: '❌', color: '#f43f5e' },
    default: { icon: '💬', color: 'var(--Copper-dim)' },
  };

  feed.innerHTML = state.activityLogs.map(log => {
    const cfg = typeConfig[log.type] || typeConfig.default;
    return `
    <li class="activity-item">
      <div class="activity-time" style="display:flex;align-items:center;gap:6px;">
        <span style="color:${cfg.color};font-size:0.7rem;">${cfg.icon}</span>
        ${log.time}
      </div>
      <div class="activity-content">${log.content}</div>
    </li>`;
  }).join('');
}

// ── Auth Header ───────────────────────────────────
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) headers['x-google-token'] = auth.token;
  if (auth.firebaseToken) headers['x-firebase-token'] = auth.firebaseToken;
  return headers;
}
const authHeader = authHeaders; // alias for legacy call sites

// ── Data Fetching ─────────────────────────────────
function setLoading(on) { try { document.body.classList.toggle('lin-loading', !!on); } catch (e) {} }

async function fetchData() {
  setLoading(true);
  try {
    // Error Boundary: each request fails independently and falls back.
    // safeJson sends auth headers by default so role-gated endpoints
    // (e.g. /api/members → requireRole(2)) work after login; on any non-2xx
    // (incl. 401/403 for unauthorised guests) it logs and returns the fallback.
    state._errors = {};
    const safeJson = (url, fallback) => fetch(url, { headers: authHeader() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .catch(err => { console.warn('fetch failed:', url, err.message); state._errors[url] = true; return fallback; });
    const asList = (v) => Array.isArray(v) ? v : ((v && Array.isArray(v.data)) ? v.data : []);
    const [m, b, s, a, tr, txList, ov, feed] = await Promise.all([
      safeJson(`${API_BASE}/members`, []),
      safeJson(`${API_BASE}/battles`, []),
      safeJson(`${API_BASE}/sieges`, []),
      safeJson(`${API_BASE}/alliances`, []),
      safeJson(`${API_BASE}/treasury`, null),
      safeJson(`${API_BASE}/transactions`, []),
      safeJson(`${API_BASE}/overview`, null),
      safeJson(`${API_BASE}/activity-feed`, null),
    ]);
    state.members = asList(m);
    state.battles = asList(b);
    state.sieges = asList(s);
    state.alliances = asList(a);
    state.treasury = tr || { balance: 0 };
    state.transactions = asList(txList);
    state.overview = (ov && ov.ok && ov.data) ? ov.data : (ov && ov.kpi ? ov : null);
    state.serverFeed = (feed && feed.ok && Array.isArray(feed.data)) ? feed.data : (Array.isArray(feed) ? feed : []);

    const safeRender = (fn, name) => { try { fn(); } catch (e) { console.error('render ' + name + ' failed:', e); } };
    safeRender(renderMembers, 'members');
    safeRender(renderBattles, 'battles');
    safeRender(renderSieges, 'sieges');
    safeRender(renderAlliances, 'alliances');
    safeRender(renderTreasury, 'treasury');
    safeRender(renderTransactions, 'transactions');
    safeRender(renderOverview, 'overview');
    safeRender(renderMemberTierStrip, 'tierStrip');
    safeRender(renderSiegeStats, 'siegeStats');
    safeRender(renderAllianceStats, 'allianceStats');
    safeRender(renderActivityFeed, 'activityFeed');
    safeRender(renderMyProfile, 'myprofile');
    safeRender(applyPermissions, 'permissions');
    safeRender(renderCheckboxes, 'checkboxes');
    safeRender(updateMemberCountBadge, 'memberBadge');
    safeRender(renderCharts, 'charts');
    safeRender(updateStatusTexts, 'statusTexts');

    // ── Populate Event Horizon feed with data summary ──
    const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const memberTiers = {};
    state.members.forEach(m => { memberTiers[m.tier || '一般'] = (memberTiers[m.tier || '一般'] || 0) + 1; });
    const tierStr = Object.entries(memberTiers).map(([t,c]) => `${t}×${c}`).join(' | ') || '無';

    // Seed with structured system entries (only seed once — clear stale boot entries first)
    state.activityLogs = state.activityLogs.filter(l => !l._boot);

    const bootEntries = [
      { time: now, content: `SYSTEM_READY → 血盟管理終端機已上線`, type: 'success', _boot: true },
      { time: now, content: `DATA_SYNC → ${state.members.length} 成員 / ${state.alliances.length} 聯盟`, type: 'default', _boot: true },
      { time: now, content: `OPS_LOG → ${state.battles.length} 戰場 / ${state.sieges.length} 攻城`, type: 'default', _boot: true },
      { time: now, content: `TIER_MAP → ${tierStr}`, type: 'default', _boot: true },
    ];

    if (state.battles.length > 0) {
      const last = state.battles[0];
      bootEntries.push({ time: now, content: `LAST_OP → ${last.boss || last.name || '?'} · ${last.date || ''}`, type: 'default', _boot: true });
    }
    if (state.sieges.length > 0) {
      const last = state.sieges[0];
      bootEntries.push({ time: now, content: `LAST_SIEGE → ${last.castle || last.name || '?'} · ${last.date || ''}`, type: 'default', _boot: true });
    }

    state.activityLogs = [...bootEntries, ...state.activityLogs];
    renderActivityFeed();

  } catch (err) {
    console.error('Fetch error:', err);
    showToast('無法連線至伺服器', 'error');
  } finally {
    setLoading(false);
  }
}


function updateMemberCountBadge() {
  const badge = document.getElementById('memberCountBadge');
  if (badge) badge.textContent = String(state.members.length).padStart(2, '0');
  
  // Update Global Metrics
  const globalMembers = document.getElementById('globalMemberCount');
  const globalAlliances = document.getElementById('globalAllianceCount');
  const globalOps = document.getElementById('globalOpsCount');
  const globalNet = document.getElementById('globalNetDist');
  
  if (globalMembers) globalMembers.textContent = state.members.length;
  if (globalAlliances) globalAlliances.textContent = state.alliances.length;
  if (globalOps) globalOps.textContent = state.battles.length + state.sieges.length;
  
  if (globalNet) {
    let totalNet = 0;
    state.battles.forEach(b => {
      let att = [];
      try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch(e){}
      totalNet += Math.floor(Number(b.revenuePerPerson || 0)) * att.length;
    });
    state.sieges.forEach(s => {
      let att = [];
      try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch(e){}
      totalNet += Math.floor(Number(s.revenuePerPerson || 0)) * att.length;
    });
    globalNet.textContent = totalNet.toLocaleString();
  }
}

function updateStatusTexts() {
  const battleStatus = document.getElementById('battleStatusText');
  if (battleStatus) {
    battleStatus.textContent = state.battles.length > 0
      ? `> ${state.battles.length} ENCOUNTER(S) LOGGED → LAST: ${state.battles[0]?.bossName || state.battles[0]?.boss || '?'}`
      : '> AWAITING NEW LOGS...';
  }
  const siegeStatus = document.getElementById('siegeStatusText');
  if (siegeStatus) {
    siegeStatus.textContent = state.sieges.length > 0
      ? `> ${state.sieges.length} SIEGE(S) RECORDED → LAST: ${state.sieges[0]?.castle || '?'}`
      : '> MONITORING CASTLE STATUS...';
  }
}

// ── Checkboxes (Officer Roll-Call) ───────────────────
function selectAllAttendance(containerId, checked) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

function filterAttendance(containerId, query) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const q = query.trim().toLowerCase();
  // Show/hide individual labels
  el.querySelectorAll('label').forEach(label => {
    label.style.display = (!q || label.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
  // Hide entire job-group blocks if no visible members inside
  el.querySelectorAll('.att-group').forEach(group => {
    const visible = [...group.querySelectorAll('label')].some(l => l.style.display !== 'none');
    group.style.display = visible ? '' : 'none';
  });
}

function renderCheckboxes() {
  const buildHtml = () => {
    if (!state.members.length && !state.alliances.length) {
      return '<span class="text-xs text-slate-400 font-bold uppercase p-2">尚無成員或聯盟，請先新增人員</span>';
    }
    // Group blood members by job, sort within group by level desc
    const grouped = {};
    JOB_ORDER.forEach(j => { grouped[j] = []; });
    state.members.forEach(m => {
      const job = m.job || '其他';
      if (!grouped[job]) grouped[job] = [];
      grouped[job].push(m);
    });
    Object.values(grouped).forEach(arr => arr.sort((a, b) => (b.level || 0) - (a.level || 0)));

    let html = '';
    Object.entries(grouped).forEach(([job, members]) => {
      if (!members.length) return;
      const icon = JOB_ICON[job] || '⚔️';
      html += `<div class="mb-1 att-group">
        <div class="flex items-center justify-between px-2 py-1 bg-amber-900/10 border-l-2 border-amber-700/40 mb-1">
          <span class="text-[11px] font-black uppercase tracking-widest text-amber-700/80">${icon} ${job} (${members.length})</span>
          <div class="flex gap-2">
            <button type="button" onclick="(function(el){el.querySelectorAll('input').forEach(cb=>cb.checked=true)})(this.closest('.att-group'))" class="text-[10px] text-primary font-black uppercase hover:underline">全</button>
            <button type="button" onclick="(function(el){el.querySelectorAll('input').forEach(cb=>cb.checked=false)})(this.closest('.att-group'))" class="text-[10px] text-slate-500 font-black uppercase hover:underline">取</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-0.5">
          ${members.map(m => {
            const lv = m.level ? `<span class="text-[11px] text-amber-600 font-bold ml-1">Lv${m.level}</span>` : '';
            return `<label class="hover:bg-primary/10 px-2 py-1.5 transition-colors flex items-center gap-2 cursor-pointer">
              <input type="checkbox" value="${m.ID || m.id}" class="rounded-none border border-white/20 bg-black/40 accent-primary w-3.5 h-3.5 flex-shrink-0">
              <span class="text-white font-black text-[11px] uppercase truncate">${m.name || m.Name || '未知'}</span>${lv}
            </label>`;
          }).join('')}
        </div>
      </div>`;
    });

    if (state.alliances.length) {
      html += `<div class="mb-1 mt-2 att-group">
        <div class="flex items-center justify-between px-2 py-1 bg-blue-900/10 border-l-2 border-blue-700/40 mb-1">
          <span class="text-[11px] font-black uppercase tracking-widest text-blue-400/80">🤝 聯盟成員 (${state.alliances.length})</span>
          <div class="flex gap-2">
            <button type="button" onclick="(function(el){el.querySelectorAll('input').forEach(cb=>cb.checked=true)})(this.closest('.att-group'))" class="text-[10px] text-secondary font-black uppercase hover:underline">全</button>
            <button type="button" onclick="(function(el){el.querySelectorAll('input').forEach(cb=>cb.checked=false)})(this.closest('.att-group'))" class="text-[10px] text-slate-500 font-black uppercase hover:underline">取</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-0.5">
          ${state.alliances.map(a => `
            <label class="hover:bg-secondary/10 px-2 py-1.5 transition-colors flex items-center gap-2 cursor-pointer">
              <input type="checkbox" value="${a.ID || a.id}" class="rounded-none border border-white/20 bg-black/40 accent-secondary w-3.5 h-3.5 flex-shrink-0">
              <span class="text-white font-black text-[11px] uppercase truncate">${a.name || a.Name || '未知'}</span>
              <span class="bg-secondary/20 text-secondary text-[10px] px-1 rounded-sm font-bold flex-shrink-0">聯盟</span>
            </label>`).join('')}
        </div>
      </div>`;
    }
    return html;
  };

  const html = buildHtml();
  const bAtt = document.getElementById('bAttendance');
  if (bAtt) bAtt.innerHTML = html;
  const sAtt = document.getElementById('sAttendance');
  if (sAtt) sAtt.innerHTML = html;
}

function getCheckedValues(id) {
  const el = document.getElementById(id);
  if (!el) return [];
  return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ── Boss Name Input ────────────────────────────────
// (free-text only — no preset list)

// ── Castle Select ─────────────────────────────────
function handleCastleSelect(sel) {
  const customInput = document.getElementById('sCastleCustom');
  if (!customInput) return;
  if (sel.value === '__custom__') {
    customInput.classList.remove('hidden');
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
    customInput.value = '';
  }
}

function getBossName() {
  return (document.getElementById('bBossNameInput')?.value || '').trim() || '未知首領';
}

// ── Members ───────────────────────────────────────
async function addMember() {
  const name = document.getElementById('mName').value.trim();
  const job = document.getElementById('mJob').value;
  const notes = document.getElementById('mNotes').value.trim();
  const tier = document.getElementById('mTier')?.value || '一般';
  const level = parseInt(document.getElementById('mLevel')?.value || 0) || 0;
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/members`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes, tier, level })
    });
    if (res.status === 401) { showToast('請先登入管理員帳號', 'error'); openLoginModal(); return; }
    if (res.status === 403) { showToast('您的帳號非授權管理員', 'error'); return; }

    document.getElementById('mName').value = '';
    document.getElementById('mJob').value = '';
    document.getElementById('mNotes').value = '';
    showToast(`${name} 已加入血盟！`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteMember(id, name) {
  if (!confirm(`確定從血盟移除「${name}」？`)) return;
  const res = await fetch(`${API_BASE}/members/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { showToast('刪除失敗（權限不足）', 'error'); return; }
  showToast(`${name} 已移除`, 'success');
  await fetchData();
}

function openEditModal(id) {
  const m = state.members.find(x => (x.ID || x.id) === id);
  if (!m) return;
  document.getElementById('editMemberId').value = id;
  document.getElementById('editMemberName').value = m.name || m.Name || '';
  document.getElementById('editMemberJob').value = m.job || '王族';
  document.getElementById('editMemberNotes').value = m.notes || '';
  document.getElementById('editMemberTier').value = m.tier || '一般';
  const lvEl = document.getElementById('editMemberLevel');
  if (lvEl) lvEl.value = m.level || '';
  document.getElementById('editMemberModal').style.display = 'flex';
}

function closeEditModal(e) {
  if (e && e.target !== document.getElementById('editMemberModal')) return;
  document.getElementById('editMemberModal').style.display = 'none';
}

async function updateMember() {
  const id = document.getElementById('editMemberId').value;
  const name = document.getElementById('editMemberName').value.trim();
  const job = document.getElementById('editMemberJob').value;
  const notes = document.getElementById('editMemberNotes').value.trim();
  const tier = document.getElementById('editMemberTier').value || '一般';
  const level = parseInt(document.getElementById('editMemberLevel')?.value || 0) || 0;
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    if (auth.firebaseUser) { try { auth.firebaseToken = await auth.firebaseUser.getIdToken(); } catch (e) {} }
    const res = await fetch(`${API_BASE}/members/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes, tier, level })
    });
    if (!res.ok) { showToast('修改失敗（權限不足）', 'error'); return; }
    document.getElementById('editMemberModal').style.display = 'none';
    showToast(`${name} 資料已更新`, 'success');
    await fetchData();
  } catch (e) { showToast('修改失敗', 'error'); }
}

// ── Member Sort State ─────────────────────────────
let memberSort = { by: 'tier', dir: 'desc' };
let memberTierFilter = null; // null = all tiers

const TIER_ORDER = { '核心': 0, '一般': 1, '試煉': 2, '預備': 3, '外交': 4 };
const TIER_CONFIG = {
  '核心': { label: 'CORE', bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/30' },
  '一般': { label: 'UNIT', bg: 'bg-white/5', text: 'text-slate-400', border: 'border-white/10' },
  '試煉': { label: 'PROB', bg: 'bg-slate-800/50', text: 'text-slate-500', border: 'border-slate-700' },
  '預備': { label: 'PROB', bg: 'bg-slate-800/50', text: 'text-slate-500', border: 'border-slate-700' },
  '外交': { label: 'DEPL', bg: 'bg-secondary/10', text: 'text-secondary', border: 'border-secondary/30' },
};
const JOB_ORDER = ['王族', '騎士', '妖精', '法師', '黑妖'];
const JOB_ICON  = { '王族': '👑', '騎士': '⚔️', '妖精': '🌿', '法師': '🔮', '黑妖': '🌑' };

function setMemberSort(by) {
  if (memberSort.by === by) {
    memberSort.dir = memberSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    memberSort.by = by;
    memberSort.dir = 'desc';
  }
  ['tier', 'level'].forEach(key => {
    const btn = document.getElementById(`sortBy${key.charAt(0).toUpperCase() + key.slice(1)}Btn`);
    if (!btn) return;
    const label = key === 'tier' ? '階級 TIER' : '等級 LEVEL';
    if (key === memberSort.by) {
      btn.style.cssText = 'border-color:rgba(201,168,76,0.5);color:#c9a84c;background:rgba(201,168,76,0.08)';
    } else {
      btn.style.cssText = 'border-color:rgba(255,255,255,0.1);color:#64748b;background:transparent';
    }
    btn.textContent = `${label} ${memberSort.by === key && memberSort.dir === 'asc' ? '▴' : '▾'}`;
  });
  renderMembers();
}

function setMemberTierFilter(tier) {
  memberTierFilter = tier;
  document.querySelectorAll('.tier-chip').forEach(btn => {
    const isAll = btn.classList.contains('tier-chip-all');
    const matches = tier === null ? isAll : btn.textContent.trim() === tier;
    btn.style.cssText = matches
      ? 'border-color:rgba(201,168,76,0.5);color:#c9a84c;background:rgba(201,168,76,0.08)'
      : 'border-color:rgba(255,255,255,0.08);color:#475569;background:transparent';
  });
  renderMembers();
}

function renderMembers() {
  const tbody = document.querySelector('#membersTable tbody');
  if (!tbody) return;

  // Build per-member attendance count from battles + sieges
  const attCount = {};
  [...state.battles, ...state.sieges].forEach(op => {
    let att = [];
    try { att = typeof op.attendance === 'string' ? JSON.parse(op.attendance) : (op.attendance || []); } catch(e){}
    att.forEach(id => { attCount[id] = (attCount[id] || 0) + 1; });
  });

  let data = [...state.members];

  // Text search filter
  if (filters.members) {
    const q = filters.members.toLowerCase();
    data = data.filter(m =>
      (m.name || m.Name || '').toLowerCase().includes(q) ||
      (m.job || '').toLowerCase().includes(q) ||
      (m.notes || '').toLowerCase().includes(q)
    );
  }

  // Tier chip filter
  if (memberTierFilter) {
    data = data.filter(m => (m.tier || '一般') === memberTierFilter);
  }

  // Sort
  data.sort((a, b) => {
    if (memberSort.by === 'tier') {
      const ta = TIER_ORDER[a.tier] ?? 9, tb = TIER_ORDER[b.tier] ?? 9;
      if (ta !== tb) return memberSort.dir === 'desc' ? ta - tb : tb - ta;
      return (b.level || 0) - (a.level || 0);
    } else {
      const la = a.level || 0, lb = b.level || 0;
      if (la !== lb) return memberSort.dir === 'desc' ? lb - la : la - lb;
      return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
    }
  });

  // Group by job
  const groups = {};
  JOB_ORDER.forEach(j => { groups[j] = []; });
  data.forEach(m => {
    const job = m.job || '其他';
    if (!groups[job]) groups[job] = [];
    groups[job].push(m);
  });

  const labelEl = document.getElementById('memberCountLabel');
  if (labelEl) labelEl.textContent = `${data.length} MEMBERS`;

  const rows = [];
  Object.entries(groups).forEach(([job, members]) => {
    if (!members.length) return;
    const icon = JOB_ICON[job] || '⚔️';
    rows.push(`
      <tr class="border-b border-amber-900/30">
        <td colspan="7" class="py-2 pl-4">
          <span class="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600/80">${icon} ${job} · ${members.length}</span>
        </td>
      </tr>`);

    members.forEach(m => {
      const id = m.ID || m.id;
      const name = m.name || m.Name || '';
      const tier = m.tier || '一般';
      const tc = TIER_CONFIG[tier] || TIER_CONFIG['一般'];

      // New tier badge using CSS design system
      const tierBadge = `<span class="tier-badge tier-${tier}">${tc.label || tier}</span>`;

      // Level with progress bar (max level 99)
      const lv = m.level || 0;
      const lvPct = Math.round((lv / 99) * 100);
      const levelCell = lv
        ? `<div class="flex flex-col gap-0.5">
            <span class="font-black text-[11px] text-white leading-none">${lv}</span>
            <div class="level-bar-track w-10"><div class="level-bar-fill" style="width:${lvPct}%"></div></div>
           </div>`
        : `<span class="text-[11px] text-slate-700 font-black">—</span>`;

      // Job with color class
      const jobIcon = JOB_ICON[m.job] || '';
      const jobCell = `<span class="job-${m.job} font-bold text-[12px]">${jobIcon} ${m.job || ''}</span>`;

      // LINE status
      const lineStatus = m.lineUserId
        ? `<span class="inline-flex items-center gap-1 bg-secondary/10 text-secondary border border-secondary/25 text-[10px] px-1.5 py-0.5 font-black uppercase rounded-sm"><span style="width:5px;height:5px;background:currentColor;border-radius:50%;display:inline-block;"></span>LINE</span>`
        : `<span class="text-slate-700 text-[10px] font-black">—</span>`;

      const canEditMembers = auth.isAdmin || canEditModule('members');
      const adminActions = canEditMembers ? `
        <td class="py-2.5 pr-4 text-right admin-col">
          <div class="flex items-center justify-end gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
            ${auth.isAdmin ? `<button class="text-[11px] font-black text-secondary hover:underline tracking-tight" onclick="openLineBindModal('members','${id}','${name.replace(/'/g,"\\'")}')">LINE</button>` : ''}
            <button class="text-[11px] font-black text-amber-400 hover:underline tracking-tight" onclick="openEditModal('${id}')">編輯</button>
            ${canDoActionClient('memberDelete') ? `<button class="text-[11px] font-black text-primary hover:underline tracking-tight" onclick="deleteMember('${id}','${name.replace(/'/g,"\\'")}')">刪除</button>` : ''}
          </div>
        </td>` : '<td class="py-2.5 pr-4 text-right admin-col hidden"></td>';

      const memberAtt = attCount[id] || 0;
      const avatarLetter = (name.charAt(0) || '?').toUpperCase();
      const avatarBg = tc.bg || 'bg-white/5';
      const avatarBorder = tc.border || 'border-white/10';
      const avatarText = tc.text || 'text-slate-400';
      const attBadge = `<span class="att-pill ${memberAtt > 0 ? 'has-att' : ''}">${memberAtt > 0 ? memberAtt : '—'}</span>`;

      rows.push(`
        <tr class="data-row border-b border-white/5 group cursor-pointer" onclick="openMemberProfile('${id}')">
          <td class="py-2.5 pl-3">
            <div class="flex items-center gap-2.5">
              <div class="w-7 h-7 rounded-full ${avatarBg} border ${avatarBorder} flex items-center justify-center flex-shrink-0">
                <span class="text-[11px] font-black ${avatarText}">${avatarLetter}</span>
              </div>
              <div class="flex flex-col min-w-0">
                <span class="font-black text-white/90 uppercase tracking-tight group-hover:text-primary transition-colors text-[13px] leading-tight truncate">${name}</span>
                <span class="text-[10px] font-mono text-slate-700 uppercase tracking-widest">·${id.slice(-4).toUpperCase()}</span>
              </div>
            </div>
          </td>
          <td class="py-2.5">${levelCell}</td>
          <td class="py-2.5 hidden sm:table-cell">${jobCell}</td>
          <td class="py-2.5">${tierBadge}</td>
          <td class="py-2.5 text-center hidden md:table-cell">${attBadge}</td>
          <td class="py-2.5 text-[11px] text-slate-600 font-bold uppercase max-w-[140px] truncate hidden lg:table-cell">${m.notes || ''}</td>
          <td class="py-2.5 text-center">${lineStatus}</td>
          ${adminActions}
        </tr>`);
    });
  }); // close Object.entries(groups).forEach

  tbody.innerHTML = rows.join('') || `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">⚔️</div><div class="empty-text">查無成員</div></div></td></tr>`;

}


// ── Shared Detail View Modal ──────────────────────
function openDetailModal(type, id) {
  const isBattle = type === 'battle';
  const data = isBattle ? state.battles.find(x => (x.ID || x.id) === id) : state.sieges.find(x => (x.ID || x.id) === id);
  if (!data) return;

  const dateStr = new Date(data.time || data.date || data.createdAt).toLocaleString('zh-TW');
  const title = isBattle ? `⚔️ ${data.bossName || data.boss || '未知首領'} (${dateStr})` : `🏰 ${data.castle || '攻城戰'} (${dateStr})`;
  document.getElementById('detailModalTitle').textContent = title;

  // Attendance
  let attIds = [];
  try { attIds = typeof data.attendance === 'string' ? JSON.parse(data.attendance) : (data.attendance || []); } catch (e) {}
  document.getElementById('detailAttendanceCount').textContent = attIds.length;
  
  const attListHtml = attIds.map(aid => {
    let person = state.members.find(m => (m.ID || m.id) === aid);
    let type = 'blood';
    if (!person) {
      person = state.alliances.find(a => (a.ID || a.id) === aid);
      type = person ? 'alliance' : 'unknown';
    }
    
    const name = person ? (person.name || person.Name || '未知') : '已刪除人員';
    const job = person ? person.job : '';
    const badge = type === 'alliance' ? '<span class="bg-[#4285F4] text-white text-[11px] px-1 rounded-sm ml-1 font-bold">聯盟</span>' : '';
    
    return `<div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">${name} ${badge} <span style="font-size:12px;opacity:0.6;">${job}</span></div>`;
  }).join('') || '<div style="opacity:0.5;">無出席紀錄</div>';
  document.getElementById('detailAttendanceList').innerHTML = attListHtml;

  const dropsGroup = document.getElementById('detailDropsGroup');
  if (isBattle) {
    let drops = [];
    try { drops = typeof data.drops === 'string' ? JSON.parse(data.drops) : (data.drops || []); } catch (e) {}
    if (drops.length > 0) {
      dropsGroup.classList.remove('hidden');
      document.getElementById('detailDropsList').innerHTML = drops.map(d => `
        <tr class="hover:bg-white/5 transition-colors">
          <td class="py-2 px-3 text-white font-black uppercase">${d.name}</td>
          <td class="py-2 px-3 text-right text-primary font-bold uppercase">${Number(d.price).toLocaleString()}</td>
        </tr>
      `).join('');
    } else {
      dropsGroup.classList.add('hidden');
    }
  } else {
    dropsGroup.classList.add('hidden');
  }

  document.getElementById('detailModal').style.display = 'flex';
}

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById('detailModal')) return;
  document.getElementById('detailModal').style.display = 'none';
}

// ── Battles ───────────────────────────────────────
// getBossConfig — boss names are free-text input; returns {} for fallback lookups
function getBossConfig() { return {}; }

let _bossFilter = null; // null = show all

function setBossFilter(boss) {
  _bossFilter = boss;
  // Update filter button styles
  document.querySelectorAll('.boss-filter-btn').forEach(btn => {
    const isActive = btn.id === (boss ? `bossFilter-${boss}` : 'bossFilter-all');
    btn.style.cssText = isActive
      ? 'border-color:rgba(201,168,76,0.5);color:#c9a84c;background:rgba(201,168,76,0.08)'
      : 'border-color:rgba(255,255,255,0.08);color:#475569;background:transparent';
  });
  renderBattles();
}

function updateBattlePreview() {
  const pool = Number(document.getElementById('bAuctionPool')?.value || 0);
  const dropTotal = [...document.querySelectorAll('.loot-price')]
    .reduce((s, el) => s + (Number(el.value) || 0), 0);
  const totalLoot = dropTotal > 0 ? dropTotal : pool;
  const count = document.querySelectorAll('#bAttendance input[type="checkbox"]:checked').length;
  const perPerson = count > 0 ? Math.floor(totalLoot / count) : 0;

  const previewEl = document.getElementById('battlePreview');
  const amtEl = document.getElementById('battlePreviewAmt');
  const cntEl = document.getElementById('battlePreviewCount');
  if (!previewEl) return;

  if (totalLoot > 0 || count > 0) {
    previewEl.classList.remove('hidden');
    amtEl.textContent = perPerson.toLocaleString() + ' 天幣';
    cntEl.textContent = count + ' 人';
  } else {
    previewEl.classList.add('hidden');
  }
}

function updateSiegePreview() {
  const reward = Number(document.getElementById('sReward')?.value || 0);
  const count = document.querySelectorAll('#sAttendance input[type="checkbox"]:checked').length;
  const perPerson = count > 0 ? Math.floor(reward / count) : 0;

  const previewEl = document.getElementById('siegePreview');
  const amtEl = document.getElementById('siegePreviewAmt');
  const cntEl = document.getElementById('siegePreviewCount');
  if (!previewEl) return;

  if (reward > 0 || count > 0) {
    previewEl.classList.remove('hidden');
    if (amtEl) amtEl.textContent = perPerson.toLocaleString() + ' 天幣';
    if (cntEl) cntEl.textContent = count + ' 人';
  } else {
    previewEl.classList.add('hidden');
  }
}

function addLootRow() {
  const container = document.getElementById('bDropsList');
  const div = document.createElement('div');
  div.className = 'loot-row flex gap-2';
  div.innerHTML = `
    <input type="text" placeholder="物品名稱" class="atelier-input flex-1 text-xs loot-name">
    <input type="number" placeholder="價格" class="atelier-input w-24 text-xs loot-price" oninput="updateBattlePreview()">
    <button class="btn btn-outline px-2 py-1" onclick="removeLootRow(this)"><span class="material-symbols-outlined text-sm">close</span></button>`;
  container.appendChild(div);
}

function removeLootRow(btn) {
  const all = document.querySelectorAll('.loot-row');
  if (all.length > 1) { btn.closest('.loot-row').remove(); updateBattlePreview(); }
}

async function addBattle() {
  const bossName = getBossName();
  const time = document.getElementById('bTime').value || new Date().toISOString();
  const attendance = getCheckedValues('bAttendance');
  const auctionPool = Number(document.getElementById('bAuctionPool').value) || 0;
  const notes = document.getElementById('bNotes')?.value.trim() || '';
  const result = document.getElementById('bResult')?.value || 'success';

  const drops = [];
  document.querySelectorAll('.loot-row').forEach(row => {
    const name = row.querySelector('.loot-name')?.value.trim();
    const price = row.querySelector('.loot-price')?.value;
    if (name) drops.push({ name, price: Number(price) || 0 });
  });

  const totalLoot = drops.length > 0 ? drops.reduce((sum, d) => sum + d.price, 0) : auctionPool;
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(totalLoot / count) : 0;

  try {
    const res = await fetch(`${API_BASE}/battles`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ bossName, time, attendance, drops, auctionPool: totalLoot, revenuePerPerson, notes, result, status: 'pending' })
    });
    if (res.status === 401) { showToast('請先登入系統', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }

    // Reset form
    document.getElementById('bDropsList').innerHTML = `
      <div class="loot-row flex gap-2">
        <input type="text" placeholder="物品名稱" class="atelier-input flex-1 text-xs loot-name">
        <input type="number" placeholder="價格" class="atelier-input w-24 text-xs loot-price" oninput="updateBattlePreview()">
        <button class="btn btn-outline px-2 py-1" onclick="removeLootRow(this)"><span class="material-symbols-outlined text-sm">close</span></button>
      </div>`;
    document.getElementById('bAuctionPool').value = '';
    if (document.getElementById('bNotes')) document.getElementById('bNotes').value = '';
    document.getElementById('battlePreview')?.classList.add('hidden');
    document.querySelectorAll('#bAttendance input[type="checkbox"]').forEach(cb => cb.checked = false);
    showToast(`${bossName} 討伐紀錄提交！每人分紅 ${revenuePerPerson.toLocaleString()} 天幣`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteBattle(id, bossName) {
  if (!confirm(`確定移除討伐紀錄「${bossName}」？這將會影響結算中心的資料。`)) return;
  const res = await fetch(`${API_BASE}/battles/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { showToast('刪除失敗（權限不足）', 'error'); return; }
  showToast(`${bossName} 紀錄已移除`, 'success');
  await fetchData();
}

// ── Battle Stats & Leaderboard ───────────────────────
function renderBossStats() {
  const cardsEl = document.getElementById('bossStatsCards');
  const lbEl    = document.getElementById('battleLeaderboard');
  const statusEl= document.getElementById('battleStatusText');
  if (!cardsEl) return;

  const bossMap = {};
  state.battles.forEach(b => {
    const name = b.bossName || b.boss || '未知';
    if (!bossMap[name]) bossMap[name] = { kills: 0, successKills: 0, totalLoot: 0, totalAtt: 0, lastDate: null };
    const entry = bossMap[name];
    entry.kills++;
    if (b.result !== 'failed') entry.successKills++;
    let pool = Number(b.auctionPool || 0);
    if (!pool) {
      let drops = [];
      try { drops = typeof b.drops === 'string' ? JSON.parse(b.drops) : (b.drops || []); } catch {}
      pool = drops.reduce((s, d) => s + (Number(d.price) || 0), 0);
    }
    entry.totalLoot += pool;
    let att = [];
    try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch {}
    entry.totalAtt += att.length;
    const d = new Date(b.time || b.createdAt);
    if (!entry.lastDate || d > entry.lastDate) entry.lastDate = d;
  });

  const cards = Object.entries(bossMap).sort((a, b) => b[1].kills - a[1].kills).map(([boss, s]) => {
    const cfg = getBossConfig()[boss] || { icon: '⚔️', color: '#c9a84c', tier: '首領' };
    const avgLoot = s.kills > 0 ? Math.floor(s.totalLoot / s.kills) : 0;
    const avgAtt  = s.kills > 0 ? Math.round(s.totalAtt / s.kills) : 0;
    const lastStr = s.lastDate ? s.lastDate.toLocaleDateString('zh-TW') : '—';
    return `<div class="flex-shrink-0 w-44 bg-black/40 border p-3" style="border-color:${cfg.color}30">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xl">${cfg.icon}</span>
        <div>
          <div class="text-xs font-black text-white uppercase tracking-tight">${boss}</div>
          <div class="text-[10px] font-bold uppercase tracking-widest" style="color:${cfg.color}">${cfg.tier || ''}</div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        <span class="text-slate-500 uppercase font-bold">擊殺</span><span class="text-white font-black">${s.successKills}/${s.kills}</span>
        <span class="text-slate-500 uppercase font-bold">平均掉落</span><span class="font-black" style="color:${cfg.color}">${avgLoot.toLocaleString()}</span>
        <span class="text-slate-500 uppercase font-bold">平均人數</span><span class="text-slate-300 font-bold">${avgAtt} 人</span>
        <span class="text-slate-500 uppercase font-bold">最近</span><span class="text-slate-400 font-bold">${lastStr}</span>
      </div>
    </div>`;
  }).join('');
  cardsEl.innerHTML = cards || '<span class="text-slate-600 text-xs font-bold uppercase">尚無首領戰紀錄</span>';

  if (statusEl) {
    const total = state.battles.length;
    const settled = state.battles.filter(b => b.status === 'settled').length;
    statusEl.textContent = `TOTAL: ${total} BATTLES · SETTLED: ${settled}`;
  }

  const filterEl = document.getElementById('bossFilterBtns');
  if (filterEl) {
    filterEl.innerHTML = Object.keys(bossMap).sort().map(boss => {
      const cfg = getBossConfig()[boss] || { icon: '⚔️', color: '#64748b' };
      const safeId = boss.replace(/\s/g, '-');
      return `<button id="bossFilter-${safeId}" onclick="setBossFilter('${boss}')"
        class="boss-filter-btn text-[11px] font-black uppercase tracking-widest px-2.5 py-1 border transition-all"
        style="border-color:rgba(255,255,255,0.08);color:#475569">
        ${cfg.icon} ${boss}
      </button>`;
    }).join('');
  }

  if (lbEl) {
    const attMap = {};
    state.battles.forEach(b => {
      let att = [];
      try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch {}
      att.forEach(id => { attMap[id] = (attMap[id] || 0) + 1; });
    });
    const top = Object.entries(attMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    lbEl.innerHTML = top.map(([id, cnt], i) => {
      const member = state.members.find(m => (m.ID || m.id) === id) || state.alliances.find(a => (a.ID || a.id) === id);
      const name = member ? (member.name || member.Name || '未知') : '已刪除';
      const bRankCls = ['rank-gold','rank-silver','rank-bronze'];
      const barMax = top[0]?.[1] || 1;
      const rkBattle = i < 3
        ? `<span class="${bRankCls[i]} text-sm w-5 flex-shrink-0">★</span>`
        : `<span class="text-[10px] text-slate-600 font-black w-5 flex-shrink-0">${i+1}</span>`;
      const barWb = Math.round(cnt / barMax * 100);
      return `<div class="card-row">
        ${rkBattle}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1 mb-0.5">
            <span class="text-[10px] font-black text-white uppercase truncate flex-1">${name}</span>
            <span class="text-[11px] font-black text-primary flex-shrink-0">${cnt}次</span>
          </div>
          <div class="level-bar-track"><div class="level-bar-fill" style="width:${barWb}%"></div></div>
        </div>
      </div>`;
    }).join('') || '<span class="text-slate-600 text-xs font-bold col-span-4 py-2">尚無出席紀錄</span>';
  }
}

function renderBattles() {
  renderBossStats();
  const tbody = document.querySelector('#battlesTable tbody');
  if (!tbody) return;

  let data = [...state.battles].sort((a, b) =>
    new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)
  );
  if (filters.battles) {
    const q = filters.battles;
    data = data.filter(b =>
      (b.bossName || b.boss || '').toLowerCase().includes(q) ||
      (b.time || b.createdAt || '').includes(q) ||
      (b.notes || '').toLowerCase().includes(q)
    );
  }
  if (_bossFilter) {
    data = data.filter(b => (b.bossName || b.boss || '') === _bossFilter);
  }

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-500 font-bold uppercase py-8">查無討伐紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(b => {
    const id = b.ID || b.id;
    const date = new Date(b.time || b.createdAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const boss = b.bossName || b.boss || '';
    const cfg = getBossConfig()[boss] || { icon: '⚔️', color: '#c9a84c' };
    let att = [];
    try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
    const count = att.length;
    let pool = b.auctionPool || 0;
    let drops = [];
    try { drops = typeof b.drops === 'string' ? JSON.parse(b.drops) : (b.drops || []); } catch (e) {}
    if (!pool) {
      pool = drops.reduce((sum, d) => sum + (Number(d.price) || 0), 0);
    }
    const rev = b.revenuePerPerson || (count > 0 ? Math.floor(pool / count) : 0);
    
    const isFailed = b.result === 'failed';
    const resultBadge = isFailed
      ? `<span class="tier-badge result-failed">✗ 失敗</span>`
      : `<span class="tier-badge result-success">✓ 成功</span>`;

    const isSettled = b.status === 'settled';
    const statusBadge = isSettled
      ? `<span class="tier-badge" style="color:#34d399;border-color:rgba(52,211,153,0.4);background:rgba(52,211,153,0.08);">已結算</span>`
      : `<span class="tier-badge" style="color:#f59e0b;border-color:rgba(245,158,11,0.35);background:rgba(245,158,11,0.07);">待結算</span>`;

    const canEditBattles = auth.isAdmin || canEditModule('battles');
    const adminActions = canEditBattles ? `
      <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
        ${!isSettled ? `<button class="text-[10px] font-black text-emerald-400 hover:underline tracking-tight" onclick="event.stopPropagation(); openSettleModal('battle','${id}')">結算</button>` : ''}
        ${canDoActionClient('lineBroadcast') ? `<button class="text-[10px] font-black text-secondary hover:underline tracking-tight" onclick="event.stopPropagation(); openBroadcastModal('battle','${id}','${boss.replace(/'/g, "\\'")}')">LINE</button>` : ''}
        ${canDoActionClient('battleDelete') ? `<button class="text-[10px] font-black text-error hover:underline tracking-tight" onclick="event.stopPropagation(); deleteBattle('${id}', '${boss.replace(/'/g, "\\'")}')">刪除</button>` : ''}
      </div>
    ` : '';

    let dropsHtml = '';
    if (drops.length > 0) {
      const dropRows = drops.map(d => `
        <div class="flex justify-between border-b border-border/20 py-1.5">
          <span class="text-[10px] font-black text-slate-300 uppercase">${d.name}</span>
          <span class="text-[10px] font-mono text-secondary font-black">${Number(d.price || d.highestBid || 0).toLocaleString()}</span>
        </div>`).join('');
      dropsHtml = `<div class="flex-1 max-w-sm">
        <div class="text-[10px] font-black text-secondary uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
          <span class="w-1 h-1 bg-secondary rounded-full"></span> LOOT_MANIFEST
        </div>
        <div class="bg-black/20 p-4 border border-border/30">${dropRows}</div>
      </div>`;
    }

    // Group attendance by job for detail view
    const attDetailHtml = (() => {
      if (!att.length) return '<div class="text-slate-600 text-xs font-bold uppercase col-span-full">無出席紀錄</div>';
      const grouped = {};
      JOB_ORDER.forEach(j => { grouped[j] = []; });
      att.forEach(aid => {
        const m = state.members.find(x => (x.ID || x.id) === aid) || state.alliances.find(x => (x.ID || x.id) === aid);
        if (!m) return;
        const job = m.job || '其他';
        if (!grouped[job]) grouped[job] = [];
        grouped[job].push(m);
      });
      return Object.entries(grouped).filter(([,arr]) => arr.length).map(([job, members]) => `
        <div class="col-span-full mb-1">
          <span class="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600/60">${JOB_ICON[job] || '⚔️'} ${job} · ${members.length}</span>
        </div>
        ${members.map(m => {
          const lv = m.level ? `<span class="text-[10px] text-amber-600 ml-1">Lv${m.level}</span>` : '';
          const isAlly = !!state.alliances.find(a => (a.ID || a.id) === (m.ID || m.id));
          const allyBadge = isAlly ? '<span class="text-[10px] bg-secondary/20 text-secondary px-1 rounded ml-1">聯盟</span>' : '';
          return `<div class="flex items-center gap-1 py-0.5">
            <span class="text-[10px] font-black text-white uppercase">${m.name || m.Name || '未知'}</span>${lv}${allyBadge}
          </div>`;
        }).join('')}`).join('');
    })();

    return `
      <tr class="data-row cursor-pointer group border-b border-white/5" onclick="toggleExpand('b-${id}')">
        <td class="py-2.5 pl-3 text-[12px] font-mono text-slate-400 uppercase tracking-tight whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <span class="expand-icon material-symbols-outlined text-[14px] text-primary/40 group-hover:text-primary transition-colors" id="icon-b-${id}">expand_more</span>
            ${date}
          </div>
        </td>
        <td class="py-2.5">
          <span class="font-black text-white uppercase group-hover:text-primary transition-colors tracking-tight text-[13px]">${cfg.icon} ${boss}</span>
          ${b.notes ? `<div class="text-[10px] text-slate-600 font-bold uppercase mt-0.5 max-w-[150px] truncate">${b.notes}</div>` : ''}
        </td>
        <td class="py-2.5 text-[10px] text-slate-400 font-bold hidden sm:table-cell">${count} 人</td>
        <td class="py-2.5 text-[10px] font-mono text-slate-500 hidden md:table-cell">${Number(pool).toLocaleString()}</td>
        <td class="py-2.5">
           <span class="text-[13px] font-black text-primary tracking-tight">${Number(rev).toLocaleString()}</span>
        </td>
        <td class="py-2.5">${resultBadge}</td>
        <td class="py-2.5 hidden lg:table-cell">${statusBadge}</td>
        <td class="py-2.5 pr-3 text-right ${(auth.isAdmin || canEditModule('battles') || canEditModule('sieges')) ? 'admin-col' : 'admin-col hidden'}">
          ${adminActions}
        </td>
      </tr>
      <tr id="details-b-${id}" class="expandable-details">
        <td colspan="8" class="p-0 border-b border-border/50 bg-black/60 overflow-hidden">
          <div class="p-6 flex flex-col md:flex-row gap-8">
             <div class="flex-1">
                <div class="text-[10px] font-black text-primary uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
                  <span class="w-1 h-1 bg-primary rounded-full animate-pulse"></span> 出席名單 (${count})
                </div>
                <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1">
                   ${attDetailHtml}
                </div>
             </div>
             ${dropsHtml}
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ── Sieges ────────────────────────────────────────
async function addSiege() {
  const date = document.getElementById('sDate').value || new Date().toISOString();
  const siegeType = document.getElementById('sSiegeType')?.value || 'attack';
  const castleSel = document.getElementById('sCastle').value;
  const castle = castleSel === '__custom__'
    ? (document.getElementById('sCastleCustom').value.trim() || '未知城堡')
    : castleSel;
  const reward = Number(document.getElementById('sReward').value) || 0;
  const notes = document.getElementById('sSiegeNotes')?.value.trim() || '';
  const attendance = getCheckedValues('sAttendance');

  if (!castle) { showToast('請選擇或輸入城堡名稱', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/sieges`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ date, castle, siegeType, reward, notes, attendance, status: 'pending' })
    });
    if (res.status === 401) { showToast('請先登入系統', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }
    showToast(`${castle} 攻城戰已記錄！`, 'success');
    // Reset form
    const castleSel2 = document.getElementById('sCastle');
    if (castleSel2) castleSel2.selectedIndex = 0;
    const customIn = document.getElementById('sCastleCustom');
    if (customIn) { customIn.classList.add('hidden'); customIn.value = ''; }
    document.getElementById('sReward').value = '';
    if (document.getElementById('sSiegeNotes')) document.getElementById('sSiegeNotes').value = '';
    document.querySelectorAll('#sAttendance input[type="checkbox"]').forEach(cb => cb.checked = false);
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteSiege(id, castle) {
  if (!confirm(`確定移除攻城紀錄「${castle}」？這將會影響結算中心的資料。`)) return;
  const res = await fetch(`${API_BASE}/sieges/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { showToast('刪除失敗（權限不足）', 'error'); return; }
  showToast(`${castle} 紀錄已移除`, 'success');
  await fetchData();
}

function renderSieges() {
  const tbody = document.querySelector('#siegesTable tbody');
  if (!tbody) return;

  let data = state.sieges;
  if (filters.sieges) {
    const q = filters.sieges;
    data = data.filter(s =>
      (s.castle || '').toLowerCase().includes(q) ||
      (s.date || s.createdAt || '').includes(q)
    );
  }

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-500 font-bold uppercase py-8">查無攻城戰紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(s => {
    const id = s.ID || s.id;
    const castle = s.castle || '';
    const date = new Date(s.date || s.createdAt).toLocaleString('en-GB', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
    const count = att.length;
    const subsidy = s.subsidyPerPerson || 0;
    const isSettled = s.status === 'settled';

    const typeBadge = s.siegeType === 'defend'
      ? `<span class="tier-badge siege-defend">🛡 守城</span>`
      : `<span class="tier-badge siege-attack">⚔️ 攻城</span>`;

    const statusBadge = isSettled
      ? `<span class="tier-badge" style="color:#34d399;border-color:rgba(52,211,153,0.4);background:rgba(52,211,153,0.08);">已結算</span>`
      : `<span class="tier-badge" style="color:#f59e0b;border-color:rgba(245,158,11,0.35);background:rgba(245,158,11,0.07);">待結算</span>`;

    const canEditSieges = auth.isAdmin || canEditModule('sieges');
    const adminActions = canEditSieges ? `
      <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
        ${!isSettled ? `<button class="text-[10px] font-black text-emerald-400 hover:underline tracking-tight" onclick="event.stopPropagation(); openSettleModal('siege','${id}')">SETTLE</button>` : ''}
        ${canDoActionClient('lineBroadcast') ? `<button class="text-[10px] font-black text-secondary hover:underline tracking-tight" onclick="event.stopPropagation(); openBroadcastModal('siege','${id}','${castle.replace(/'/g, "\\'")}')">LINE_CALL</button>` : ''}
        ${canDoActionClient('siegeDelete') ? `<button class="text-[10px] font-black text-error hover:underline tracking-tight" onclick="event.stopPropagation(); deleteSiege('${id}', '${castle.replace(/'/g, "\\'")}')">PURGE</button>` : ''}
      </div>
    ` : '';

    return `
      <tr class="data-row cursor-pointer group border-b border-white/5" onclick="toggleExpand('s-${id}')">
        <td class="py-2.5 pl-3 text-[12px] font-mono text-slate-400 uppercase tracking-tight whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <span class="expand-icon material-symbols-outlined text-[14px] text-secondary/40 group-hover:text-secondary transition-colors" id="icon-s-${id}">expand_more</span>
            ${date}
          </div>
        </td>
        <td class="py-2.5">${typeBadge}</td>
        <td class="py-2.5 font-bold text-white uppercase group-hover:text-secondary transition-colors tracking-tight text-xs max-w-[110px] truncate">${castle}</td>
        <td class="py-2.5 text-[10px] text-slate-400 font-bold hidden sm:table-cell">${count} 人</td>
        <td class="py-2.5 text-[10px] font-mono text-slate-500 hidden md:table-cell">${Number(s.reward || 0).toLocaleString()}</td>
        <td class="py-2.5">
           <span class="text-[13px] font-black text-secondary tracking-tight">${subsidy > 0 ? Number(subsidy).toLocaleString() : '—'}</span>
        </td>
        <td class="py-2.5 hidden lg:table-cell">${statusBadge}</td>
        <td class="py-2.5 pr-3 text-right ${(auth.isAdmin || canEditModule('battles') || canEditModule('sieges')) ? 'admin-col' : 'admin-col hidden'}">
          ${adminActions}
        </td>
      </tr>
      <tr id="details-s-${id}" class="expandable-details">
        <td colspan="8" class="p-0 bg-black/40 overflow-hidden">
          <div class="p-8">
             <div class="text-[10px] font-black text-secondary uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
               <span class="w-1 h-1 bg-secondary rounded-full animate-pulse"></span> DEPLOYED_NODES (${count})
             </div>
             <div class="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                ${getAttendanceHtml(att)}
             </div>
             ${s.notes ? `<div class="mt-4 text-[10px] text-amber-700/60 font-bold uppercase">備註：${s.notes}</div>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}


// ── Alliances ─────────────────────────────────────
async function addAlliance() {
  const name = document.getElementById('aName').value.trim();
  const pledgeName = document.getElementById('aPledgeName')?.value.trim() || '';
  const job = document.getElementById('aJob').value;
  const notes = document.getElementById('aNotes').value.trim();
  if (!name || !job) { showToast('請填寫完整資料', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/alliances`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name, pledgeName, job, notes })
    });
    if (res.status === 401) { showToast('請先登入管理員帳號', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }
    document.getElementById('aName').value = '';
    document.getElementById('aNotes').value = '';
    showToast(`${name} 已加入聯盟！`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteAlliance(id, name) {
  if (!confirm(`確定移除聯盟成員「${name}」？`)) return;
  const res = await fetch(`${API_BASE}/alliances/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { showToast('刪除失敗（權限不足）', 'error'); return; }
  showToast(`${name} 已移除`, 'success');
  await fetchData();
}

function openEditAllianceModal(id) {
  const a = state.alliances.find(x => (x.ID || x.id) === id);
  if (!a) return;
  document.getElementById('editAllianceId').value = id;
  document.getElementById('editAllianceName').value = a.name || a.Name || '';
  document.getElementById('editAlliancePledgeName').value = a.pledgeName || '';
  document.getElementById('editAllianceJob').value = a.job || '王族';
  document.getElementById('editAllianceNotes').value = a.notes || '';
  document.getElementById('editAllianceModal').style.display = 'flex';
}

function closeEditAllianceModal(e) {
  if (e && e.target !== document.getElementById('editAllianceModal')) return;
  document.getElementById('editAllianceModal').style.display = 'none';
}

async function updateAlliance() {
  const id = document.getElementById('editAllianceId').value;
  const name = document.getElementById('editAllianceName').value.trim();
  const pledgeName = document.getElementById('editAlliancePledgeName')?.value.trim() || '';
  const job = document.getElementById('editAllianceJob').value;
  const notes = document.getElementById('editAllianceNotes').value.trim();
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/alliances/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name, pledgeName, job, notes })
    });
    if (!res.ok) { showToast('修改失敗（權限不足）', 'error'); return; }
    document.getElementById('editAllianceModal').style.display = 'none';
    showToast(`${name} 聯盟資料已更新`, 'success');
    await fetchData();
  } catch (e) { showToast('修改失敗', 'error'); }
}

function renderAlliances() {
  const tbody = document.querySelector('#alliancesTable tbody');
  if (!tbody) return;
  
  let data = state.alliances;
  if (filters.alliances) {
    const q = filters.alliances;
    data = data.filter(a => 
      (a.name || a.Name || '').toLowerCase().includes(q) || 
      (a.job || '').toLowerCase().includes(q) || 
      (a.notes || '').toLowerCase().includes(q)
    );
  }
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-500 font-bold uppercase py-8">查無聯盟成員</td></tr>';
    return;
  }

  // Group by pledgeName
  const groups = {};
  data.forEach(a => {
    const grp = a.pledgeName || '（未分類）';
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(a);
  });

  const rows = [];
  Object.entries(groups).forEach(([grpName, members]) => {
    // Group header row
    rows.push(`
      <tr class="bg-amber-950/20 border-y border-amber-900/20">
        <td colspan="7" class="py-2 pl-3 text-[10px] font-black text-secondary uppercase tracking-widest">
          <span class="material-symbols-outlined text-[12px] align-middle mr-1" style="font-variation-settings:'FILL' 1;">groups</span>
          ${grpName} <span class="text-amber-700/50 font-normal ml-1">(${members.length})</span>
        </td>
      </tr>`);

    // Build per-ally attendance count
    const allyAttCount = {};
    [...state.battles, ...state.sieges].forEach(op => {
      let att2 = [];
      try { att2 = typeof op.attendance==='string'?JSON.parse(op.attendance):(op.attendance||[]); } catch(e){}
      att2.forEach(aid => { allyAttCount[aid] = (allyAttCount[aid]||0)+1; });
    });

    members.forEach(a => {
      const id = a.ID || a.id;
      const name = a.name || a.Name || '';
      const avatarLetter = (name.charAt(0) || '?').toUpperCase();
      const attCnt = allyAttCount[id] || 0;
      const lineStatus = a.lineUserId
        ? `<span class="inline-flex items-center gap-1 bg-secondary/10 text-secondary border border-secondary/25 text-[10px] px-1.5 py-0.5 font-black uppercase rounded-sm"><span style="width:5px;height:5px;background:currentColor;border-radius:50%;display:inline-block;"></span>LINE</span>`
        : `<span class="text-slate-700 text-[10px] font-black">—</span>`;
      const adminActions = auth.isAdmin
        ? `<td class="py-2.5 pr-3 text-right admin-col">
            <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="text-[10px] font-black text-secondary hover:underline" onclick="openLineBindModal('alliances','${id}','${name.replace(/'/g, "\\'")}')">LINK</button>
              <button class="text-[10px] font-black text-primary hover:underline" onclick="openEditAllianceModal('${id}')">EDIT</button>
              <button class="text-[10px] font-black text-error hover:underline" onclick="deleteAlliance('${id}', '${name.replace(/'/g, "\\'")}')">刪除</button>
            </div>
           </td>`
        : '<td class="py-2.5 pr-3 text-right admin-col hidden"></td>';
      rows.push(`
        <tr class="data-row border-b border-white/5 group">
          <td class="py-2.5 pl-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full bg-blue-900/30 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <span class="text-[11px] font-black text-blue-400">${avatarLetter}</span>
              </div>
              <div class="flex flex-col min-w-0">
                <span class="font-black text-white uppercase group-hover:text-secondary transition-colors text-xs truncate">${name}</span>
                <span class="text-[10px] font-mono text-slate-600 uppercase">·${id.slice(-4).toUpperCase()}</span>
              </div>
            </div>
          </td>
          <td class="py-2.5 text-[10px] text-amber-700/70 font-bold truncate max-w-[100px]">${a.pledgeName || '—'}</td>
          <td class="py-2.5 hidden sm:table-cell"><span class="job-${a.job} font-bold text-[10px]">${JOB_ICON[a.job]||''} ${a.job || ''}</span></td>
          <td class="py-2.5 text-center hidden md:table-cell">
            ${attCnt > 0 ? `<span class="font-black text-[10px] text-secondary">${attCnt}</span>` : '<span class="text-slate-700 text-[10px] font-black">—</span>'}
          </td>
          <td class="py-2.5 text-[11px] text-slate-600 font-bold hidden lg:table-cell truncate max-w-[130px]">${a.notes || ''}</td>
          <td class="py-2.5 text-center">${lineStatus}</td>
          ${adminActions}
        </tr>`);
    }); // close members.forEach
  }); // close groups.forEach

  tbody.innerHTML = rows.join('');
}

// ── Treasury (結算中心) ───────────────────────────
function renderTreasury() {
  // Update real treasury balance display
  const balanceEl = document.getElementById('treasuryBalanceDisplay');
  const bal = Number(state.treasury?.balance || 0);
  // Income / Expense totals from transactions
  const txList = state.transactions || [];
  const totalIncome = txList.filter(t=>Number(t.amount||0)>0).reduce((s,t)=>s+Number(t.amount||0),0);
  const totalExpense = Math.abs(txList.filter(t=>Number(t.amount||0)<0).reduce((s,t)=>s+Number(t.amount||0),0));
  const setEl = (id, val) => { const e = document.getElementById(id); if(e) e.textContent=val; };
  setEl('treasuryTotalIncome',  totalIncome  > 0 ? totalIncome.toLocaleString()  : '—');
  setEl('treasuryTotalExpense', totalExpense > 0 ? totalExpense.toLocaleString() : '—');
  if (balanceEl) balanceEl.textContent = bal.toLocaleString();

  const tbody = document.querySelector('#treasuryTable tbody');
  if (!tbody) return;

  if (state.members.length === 0 && state.alliances.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 font-bold uppercase py-8">尚無人員紀錄，無法結算</td></tr>';
    return;
  }

  // Initialize treasury data for all members and alliances
  const treasuryMap = {};
  state.members.forEach(m => {
    const id = m.ID || m.id;
    treasuryMap[id] = {
      name: m.name || m.Name || '未知',
      type: 'blood',
      attendanceCount: 0,
      battleRev: 0,
      siegeRev: 0
    };
  });
  state.alliances.forEach(a => {
    const id = a.ID || a.id;
    treasuryMap[id] = {
      name: a.name || a.Name || '未知',
      type: 'alliance',
      attendanceCount: 0,
      battleRev: 0,
      siegeRev: 0
    };
  });

  // Process Battles
  state.battles.forEach(b => {
    let att = [];
    try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
    
    // Ensure rev is a clean number
    const rev = Math.floor(Number(b.revenuePerPerson || 0));
    
    att.forEach(memberId => {
      if (treasuryMap[memberId]) {
        treasuryMap[memberId].attendanceCount += 1;
        treasuryMap[memberId].battleRev += rev;
      }
    });
  });

  // Process Sieges
  state.sieges.forEach(s => {
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
    
    const rev = Math.floor(Number(s.revenuePerPerson || 0));
    
    att.forEach(memberId => {
      if (treasuryMap[memberId]) {
        treasuryMap[memberId].attendanceCount += 1;
        treasuryMap[memberId].siegeRev += rev;
      }
    });
  });

  // Update treasury summary stats
  const allEntries = Object.values(treasuryMap);
  const grandTotal = allEntries.reduce((sum, t) => sum + t.battleRev + t.siegeRev, 0);
  const activeAccts = allEntries.filter(t => t.attendanceCount > 0).length;
  const totalDistEl = document.getElementById('totalDistDisplay');
  const activeAcctsEl = document.getElementById('activeAcctsDisplay');
  if (totalDistEl) totalDistEl.textContent = grandTotal.toLocaleString();
  if (activeAcctsEl) activeAcctsEl.textContent = activeAccts;

  // Generate HTML — apply treasury search filter
  let treasuryEntries = allEntries;
  if (filters.treasury) {
    const q = filters.treasury;
    treasuryEntries = treasuryEntries.filter(t => t.name.toLowerCase().includes(q));
  }
  
  if (treasuryEntries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-500 font-bold uppercase py-8">查無符合結果</td></tr>';
    return;
  }
  
  const rows = treasuryEntries
    // Sort by Total Revenue (descending)
    .sort((a, b) => (b.battleRev + b.siegeRev) - (a.battleRev + a.siegeRev))
    .map((t, i) => {
      const totalRev = t.battleRev + t.siegeRev;
      const maxRev = treasuryEntries.length > 0
        ? Math.max(...treasuryEntries.map(x => x.battleRev + x.siegeRev), 1)
        : 1;
      const barPct = totalRev > 0 ? Math.round(totalRev / maxRev * 100) : 0;
      const typeBadge = t.type === 'alliance'
        ? '<span class="tier-badge" style="color:#60a5fa;border-color:rgba(96,165,250,0.4);background:rgba(96,165,250,0.08);margin-left:4px;">聯盟</span>'
        : '';
      const tRankCls = ['rank-gold','rank-silver','rank-bronze'];
      const rankEl = i < 3
        ? `<span class="${tRankCls[i]} text-sm mr-1">★</span>`
        : `<span class="text-[11px] text-slate-600 font-black mr-1">${i+1}</span>`;

      return `
        <tr class="data-row border-b border-white/5 group">
          <td class="py-2.5 pl-2">
            <div class="flex items-center min-w-0">
              ${rankEl}
              <span class="font-black text-white uppercase group-hover:text-primary transition-colors text-xs truncate">${t.name}</span>
              ${typeBadge}
            </div>
            ${barPct > 0 ? `<div class="level-bar-track mt-0.5 ml-5"><div class="level-bar-fill" style="width:${barPct}%"></div></div>` : ''}
          </td>
          <td class="py-2.5 text-center"><span class="att-pill ${t.attendanceCount > 0 ? 'has-att' : ''}">${t.attendanceCount || '—'}</span></td>
          <td class="py-2.5 text-right text-slate-500 font-bold text-[10px] hidden md:table-cell">${t.battleRev > 0 ? t.battleRev.toLocaleString() : '—'}</td>
          <td class="py-2.5 text-right text-slate-500 font-bold text-[10px] hidden md:table-cell">${t.siegeRev > 0 ? t.siegeRev.toLocaleString() : '—'}</td>
          <td class="py-2.5 pr-2 text-right font-black text-primary text-xs">${totalRev > 0 ? totalRev.toLocaleString() : '—'}</td>
        </tr>`;
    });

  tbody.innerHTML = rows.join('');
}

// ── Transactions Render ──────────────────────────
function renderTransactions() {
  const tbody = document.getElementById('transactionsTbody');
  if (!tbody) return;
  const txList = state.transactions || [];
  if (!txList.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">尚無收支記錄</div></div></td></tr>`;
    return;
  }

  const catIconMap = {
    '城堡稅收': '🏰', '首領戰分紅': '⚔️', '攻城戰薪津': '🏰',
    '薪津支出': '💰', '裝備採購': '🛡️', '活動獎勵': '🎁',
    '其他收入': '📥', '其他支出': '📤', '手動結算': '⚖️'
  };

  const sorted = [...txList].sort((a, b) =>
    new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)
  );

  tbody.innerHTML = sorted.map(tx => {
    const amt = Number(tx.amount || 0);
    const isIncome = amt >= 0;
    const date = new Date(tx.date || tx.createdAt || 0).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
    const cat = tx.category || (isIncome ? '其他收入' : '其他支出');
    const catIcon = catIconMap[cat] || (isIncome ? '📥' : '📤');
    const amtColor = isIncome ? 'text-emerald-400' : 'text-red-400';
    const amtStr = `${isIncome ? '+' : ''}${amt.toLocaleString()}`;
    const note = tx.note || tx.description || '';

    return `<tr class="data-row border-b border-white/5 group">
      <td class="py-2 pl-3 text-[11px] font-mono text-slate-500 whitespace-nowrap">${date}</td>
      <td class="py-2 hidden sm:table-cell">
        <div class="flex items-center gap-1.5">
          <span class="text-sm">${catIcon}</span>
          <span class="text-[11px] font-black uppercase tracking-wide text-slate-400">${cat}</span>
        </div>
      </td>
      <td class="py-2 text-[10px] text-slate-400 font-bold max-w-[200px] truncate">${note}</td>
      <td class="py-2 pr-3 text-right font-black text-xs ${amtColor} whitespace-nowrap">${amtStr}</td>
    </tr>`;
  }).join('');
}

// ── Charts ────────────────────────────────────────
function renderTreasuryTrendChart() {
  if (!window.Chart) return;
  const ctx = document.getElementById('treasuryTrendChart');
  if (!ctx) return;
  const trend = (state.overview && state.overview.treasuryTrend) || [];
  if (treasuryTrendChartInstance) treasuryTrendChartInstance.destroy();
  treasuryTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(t => (t.month || '').slice(2)),
      datasets: [
        { label: '收入', data: trend.map(t => t.income), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 2 },
        { label: '支出', data: trend.map(t => t.expense), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.10)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 2 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 9 } } } }
    }
  });
}

function renderCharts() {
  if (!window.Chart) return;
  Chart.defaults.color = 'rgba(255,255,255,0.4)';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.weight = '600';
  renderTreasuryTrendChart();

  // 1. Class Distribution Chart (Members)
  const ctxClass = document.getElementById('classChart');
  if (ctxClass) {
    if (classChartInstance) classChartInstance.destroy();
    
    const classCounts = {};
    state.members.forEach(m => {
      const job = m.job || 'UNKNOWN';
      classCounts[job] = (classCounts[job] || 0) + 1;
    });

    const labels = Object.keys(classCounts);
    const data = Object.values(classCounts);
    
    classChartInstance = new Chart(ctxClass, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: [
            '#B87333', // Copper
            '#A8A49C', // Muted Copper
            '#C0C0C0', // Silver
            '#4A453C', // Dark Copper
            '#706C61', // Taupe
            '#2A2825', // Warm Black
            '#1A1918'  // Deep Neutral
          ],
          borderWidth: 2,
          borderColor: '#0a0a0a'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1918',
            titleColor: '#B87333',
            titleFont: { size: 11, weight: '800' },
            bodyFont: { size: 12, weight: '600' },
            padding: 12,
            cornerRadius: 4,
            borderColor: 'rgba(212, 175, 55, 0.2)',
            borderWidth: 1
          }
        }
      }
    });
  }

  // 2. Treasury Top Earners Chart (Treasury)
  const ctxTreasury = document.getElementById('treasuryChart');
  if (ctxTreasury && state.members.length > 0) {
    if (treasuryChartInstance) treasuryChartInstance.destroy();

    const treasuryMap = {};
    state.members.forEach(m => {
      const id = m.ID || m.id;
      treasuryMap[id] = { name: m.name || m.Name || '', total: 0 };
    });
    state.alliances.forEach(a => {
      const id = a.ID || a.id;
      treasuryMap[id] = { name: a.name || a.Name || '', total: 0 };
    });
    
    state.battles.forEach(b => {
      let att = [];
      try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
      const rev = Math.floor(Number(b.revenuePerPerson || 0));
      att.forEach(id => { if (treasuryMap[id]) treasuryMap[id].total += rev; });
    });

    state.sieges.forEach(s => {
      let att = [];
      try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
      const rev = Math.floor(Number(s.revenuePerPerson || 0));
      att.forEach(id => { if (treasuryMap[id]) treasuryMap[id].total += rev; });
    });

    const topEarners = Object.values(treasuryMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8); // Top 8 for cleaner layout

    treasuryChartInstance = new Chart(ctxTreasury, {
      type: 'bar',
      data: {
        labels: topEarners.map(t => t.name),
        datasets: [{
          label: 'Net_Dividend',
          data: topEarners.map(t => t.total),
          backgroundColor: 'rgba(212, 175, 55, 0.15)',
          borderColor: '#B87333',
          borderWidth: 1,
          hoverBackgroundColor: 'rgba(212, 175, 55, 0.3)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false },
            border: { display: false },
            ticks: { font: { size: 9 }, color: 'rgba(255,255,255,0.3)' }
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 9 }, color: 'rgba(255,255,255,0.3)' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1918',
            titleColor: '#B87333',
            titleFont: { size: 11, weight: '800' },
            bodyFont: { size: 12, weight: '600' },
            padding: 12,
            cornerRadius: 4,
            borderColor: 'rgba(212, 175, 55, 0.2)',
            borderWidth: 1
          }
        }
      }
    });
  }
}

// ── CSV Export ────────────────────────────────────
function exportToCSV(moduleName) {
  let data = [];
  let filename = `${moduleName}_export_${new Date().toISOString().slice(0, 10)}.csv`;
  let headers = [];

  switch (moduleName) {
    case 'members':
      headers = ['ID', 'Class', 'Metadata'];
      data = state.members.map(m => [m.name || m.Name || '', m.job || '', m.notes || '']);
      break;
    case 'battles':
      headers = ['Time', 'Target', 'Pax', 'Pool', 'Dividend'];
      data = state.battles.map(b => {
        const date = new Date(b.time || b.createdAt).toLocaleString('zh-TW');
        let att = [];
        try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
        let pool = b.auctionPool || 0;
        if (!pool) {
          try {
            const drops = typeof b.drops === 'string' ? JSON.parse(b.drops) : (b.drops || []);
            pool = drops.reduce((sum, d) => sum + (Number(d.price) || 0), 0);
          } catch (e) {}
        }
        const rev = b.revenuePerPerson || (att.length > 0 ? Math.floor(pool / att.length) : 0);
        return [date, b.bossName || b.boss || '', att.length, pool, rev];
      });
      break;
    case 'sieges':
      headers = ['Time', 'Castle', 'Pax', 'Pool', 'Dividend'];
      data = state.sieges.map(s => {
        const date = new Date(s.date || s.createdAt).toLocaleString('zh-TW');
        let att = [];
        try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
        const rev = s.revenuePerPerson || (att.length > 0 ? Math.floor(Number(s.reward || 0) / att.length) : 0);
        return [date, s.castle || '', att.length, s.reward || 0, rev];
      });
      break;
    case 'alliances':
      headers = ['ID', 'Class', 'Metadata'];
      data = state.alliances.map(a => [a.name || a.Name || '', a.job || '', a.notes || '']);
      break;
    case 'treasury':
      headers = ['Type', 'Character ID', 'Ops Count', 'Battle Div', 'Siege Div', 'Net Total'];
      const treasuryMapExport = {};
      state.members.forEach(m => {
        const id = m.ID || m.id;
        treasuryMapExport[id] = { name: m.name || m.Name || '', type: 'Blood', count: 0, battle: 0, siege: 0 };
      });
      state.alliances.forEach(a => {
        const id = a.ID || a.id;
        treasuryMapExport[id] = { name: a.name || a.Name || '', type: 'Alliance', count: 0, battle: 0, siege: 0 };
      });
      state.battles.forEach(b => {
        let att = [];
        try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
        const rev = Math.floor(Number(b.revenuePerPerson || 0));
        att.forEach(id => { if (treasuryMapExport[id]) { treasuryMapExport[id].count++; treasuryMapExport[id].battle += rev; } });
      });
      state.sieges.forEach(s => {
        let att = [];
        try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
        const rev = Math.floor(Number(s.revenuePerPerson || 0));
        att.forEach(id => { if (treasuryMapExport[id]) { treasuryMapExport[id].count++; treasuryMapExport[id].siege += rev; } });
      });
      data = Object.values(treasuryMapExport)
        .sort((a, b) => (b.battle + b.siege) - (a.battle + a.siege))
        .map(t => [t.type, t.name, t.count, t.battle, t.siege, t.battle + t.siege]);
      break;
  }

  if (data.length === 0) {
    showToast('沒有資料可供匯出', 'error');
    return;
  }

  // Create CSV string (with BOM for Excel)
  const csvContent = [
    headers.join(','),
    ...data.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  // Trigger download
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── Expose Google login handler globally ────────────
window.handleGoogleLogin = handleGoogleLogin;

// ── Admin LINE Binding Modal ─────────────────────────
async function openAdminBindModal() {
  const modal = document.getElementById('adminBindModal');
  if (!modal) return;
  modal.style.display = 'flex';
  // Hide any leftover code from a previous session before refreshing
  const box = document.getElementById('adminBindCodeBox');
  if (box) box.style.display = 'none';
  await refreshAdminBindStatus();
}

function closeAdminBindModal(e) {
  if (e && e.target && e.target.id !== 'adminBindModal') return;
  const modal = document.getElementById('adminBindModal');
  if (modal) modal.style.display = 'none';
}

async function refreshAdminBindStatus() {
  const statusEl = document.getElementById('adminBindStatus');
  const unbindBtn = document.getElementById('adminUnbindBtn');
  if (!statusEl) return;
  statusEl.textContent = '載入中…';
  if (unbindBtn) unbindBtn.style.display = 'none';
  try {
    const res = await fetch(`${API_BASE}/admin/line-bind`, { headers: authHeader() });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      statusEl.innerHTML = `<span style="color:#f87171;">⚠ 無法載入綁定狀態</span><br><span style="font-size:11px;opacity:0.7;">${(data && data.error) || ('HTTP ' + res.status)}</span>`;
      return;
    }
    if (data.bound) {
      const dn = data.displayName ? `<b style="color:#60a5fa;">${_escAdminBind(data.displayName)}</b>` : '<i style="color:var(--tx3);">(無暱稱)</i>';
      statusEl.innerHTML = `<div style="color:#4ade80;font-weight:900;letter-spacing:0.08em;margin-bottom:4px;">✓ LINE 已綁定</div>${dn}<br><span style="font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace;">${_escAdminBind(data.email)}</span>`;
      if (unbindBtn) unbindBtn.style.display = 'inline-flex';
    } else {
      statusEl.innerHTML = `<div style="color:var(--tx2);">尚未綁定 LINE 帳號</div><div style="font-size:11px;color:var(--tx3);margin-top:6px;">點下方「產生綁定碼」開始</div>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:#f87171;">⚠ 網路錯誤</span><br><span style="font-size:11px;opacity:0.7;">${_escAdminBind(String(e.message || e))}</span>`;
  }
}

async function generateAdminBindCode() {
  const btn = document.getElementById('adminBindGenBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  try {
    const res = await fetch(`${API_BASE}/admin/line-bind/code`, {
      method: 'POST',
      headers: authHeader(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast((data && data.error) || '產生綁定碼失敗', 'error');
      return;
    }
    const codeEl = document.getElementById('adminBindCodeValue');
    const boxEl = document.getElementById('adminBindCodeBox');
    if (codeEl) codeEl.textContent = data.code;
    if (boxEl) boxEl.style.display = 'block';
    showToast('綁定碼已產生（24 小時有效）', 'success');
  } catch (e) {
    showToast('網路錯誤，請稍後再試', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function unbindAdminLine() {
  if (!confirm('確定要解除目前的 LINE 綁定嗎？解綁後將不再收到血盟廣播通知。')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/line-bind`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast((data && data.error) || '解綁失敗', 'error');
      return;
    }
    showToast('已解除 LINE 綁定', 'success');
    const boxEl = document.getElementById('adminBindCodeBox');
    if (boxEl) boxEl.style.display = 'none';
    await refreshAdminBindStatus();
  } catch (e) {
    showToast('網路錯誤，請稍後再試', 'error');
  }
}

// Local HTML-escape helper (named to avoid collision with auth.js _esc)
function _escAdminBind(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.openAdminBindModal = openAdminBindModal;
window.closeAdminBindModal = closeAdminBindModal;
window.generateAdminBindCode = generateAdminBindCode;
window.unbindAdminLine = unbindAdminLine;

// ── Manual LINE login trigger (from #loginModal LINE button) ──────────
// Reuses the existing tryLineLogin() pipeline but actively kicks LIFF
// login on desktop too (tryLineLogin only auto-runs on init and only
// fires liff.login() inside the LINE in-app browser).
async function triggerLineLogin() {
  const liffId = window._liffId;
  const btn = document.getElementById('lineSignInBtn');
  const hint = document.getElementById('lineLoginHint');
  if (!liffId) {
    if (hint) hint.textContent = 'LIFF_ID NOT CONFIGURED';
    if (hint) hint.style.color = '#f87171';
    return;
  }
  if (typeof liff === 'undefined') {
    if (hint) hint.textContent = 'LIFF SDK NOT LOADED — RELOAD PAGE';
    if (hint) hint.style.color = '#f87171';
    return;
  }
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
  try {
    await liff.init({ liffId });
    if (liff.isLoggedIn()) {
      // Already authenticated — re-run the existing pipeline to finish
      // Firebase custom-token sign-in and load member data.
      await tryLineLogin();
      closeLoginModal();
      renderAuthUI && renderAuthUI();
      await fetchData();
      applyPermissions && applyPermissions();
      showToast('LINE 登入成功', 'success');
    } else {
      // Redirect to LINE OAuth — comes back to the same URL, then init()
      // will call tryLineLogin() automatically on the next page load.
      liff.login({ redirectUri: window.location.href });
    }
  } catch (e) {
    console.error('[line-login] manual trigger failed:', e);
    if (hint) {
      hint.textContent = 'LINE LOGIN ERROR: ' + (e && e.message ? String(e.message).slice(0, 60) : 'unknown');
      hint.style.color = '#f87171';
    }
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

window.triggerLineLogin = triggerLineLogin;

// ── LINE Broadcast Modal ────────────────────────────
let _broadcastTarget = null;

function openBroadcastModal(type, id, name) {
  _broadcastTarget = { type, id, name };
  const modal = document.getElementById('lineBroadcastModal');
  document.getElementById('broadcastTargetName').textContent = `[${type === 'siege' ? '攻城戰' : '首領戰'}] ${name}`;
  document.getElementById('broadcastNotes').value = '';
  document.getElementById('broadcastTime').value = '';
  document.getElementById('broadcastResult').textContent = '';
  // Reset to default mode
  const radios = document.querySelectorAll('input[name="broadcastMode"]');
  radios.forEach(r => { r.checked = r.value === 'bound'; });
  updateBroadcastUI();
  modal.style.display = 'flex';
}

function closeBroadcastModal(e) {
  const modal = document.getElementById('lineBroadcastModal');
  if (e && e.target !== modal) return;
  modal.style.display = 'none';
}

function updateBroadcastUI() {
  const mode = document.querySelector('input[name="broadcastMode"]:checked')?.value || 'bound';
  const tierBox = document.getElementById('tierCheckboxes');
  const preview = document.getElementById('broadcastPreview');
  const previewText = document.getElementById('broadcastPreviewText');

  tierBox.classList.toggle('hidden', mode !== 'tier');

  // Count potential recipients for preview
  if (mode === 'all') {
    preview.classList.remove('hidden');
    previewText.textContent = '► 廣播路線：全部關注者（不限綁定狀態）';
  } else if (mode === 'bound') {
    const allPeople = [...state.members, ...state.alliances];
    const count = allPeople.filter(p => p.lineUserId).length;
    preview.classList.remove('hidden');
    previewText.textContent = `► 將發送給 ${count} 位已綁定成員`;
  } else if (mode === 'tier') {
    const selectedTiers = Array.from(document.querySelectorAll('#tierCheckboxes input:checked')).map(c => c.value);
    const count = state.members.filter(m => m.lineUserId && selectedTiers.includes(m.tier || '一般')).length;
    preview.classList.remove('hidden');
    previewText.textContent = `► 分級 [${selectedTiers.join(' / ')}] 將發送給 ${count} 位成員`;
  }
}

async function sendBroadcast() {
  if (!_broadcastTarget) return;
  const mode = document.querySelector('input[name="broadcastMode"]:checked')?.value || 'bound';
  const selectedTiers = mode === 'tier'
    ? Array.from(document.querySelectorAll('#tierCheckboxes input:checked')).map(c => c.value)
    : [];

  if (mode === 'tier' && selectedTiers.length === 0) {
    showToast('請至少勾選一個分級', 'error');
    return;
  }

  const btn = document.getElementById('broadcastSendBtn');
  const result = document.getElementById('broadcastResult');
  btn.disabled = true;
  btn.textContent = '推播中..';
  result.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/line/broadcast`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        recordId: _broadcastTarget.id,
        type: _broadcastTarget.type,
        bossName: _broadcastTarget.type === 'battle' ? _broadcastTarget.name : undefined,
        castle: _broadcastTarget.type === 'siege' ? _broadcastTarget.name : undefined,
        time: document.getElementById('broadcastTime').value,
        notes: document.getElementById('broadcastNotes').value.trim(),
        broadcastMode: mode,
        tiers: selectedTiers
      })
    });
    const data = await res.json();
    if (res.ok) {
      const methodLabel = {
        all: '廣播給所有關注者',
        bound: `已發送給 ${data.sent} 位綁定成員`,
        tier: `已發送給 ${data.sent} 位 [${selectedTiers.join('/')}] 成員`
      }[data.method] || `已發送給 ${data.sent || 0} 位`;
      result.className = 'text-secondary font-black text-sm mt-2 uppercase tracking-widest';
      result.textContent = `✅ 推播成功！${methodLabel}`;
      showToast('LINE 召集令已發出！', 'success');
      logToTerminal(`LINE BROADCAST [${mode.toUpperCase()}]: ${_broadcastTarget.name} → ${methodLabel}`);
    } else {
      result.className = 'text-[#ff3333] font-black text-sm mt-2 uppercase';
      result.textContent = `❌ ${data.error || '推播失敗'}`;
    }
  } catch (e) {
    result.className = 'text-error font-black text-sm mt-2 uppercase tracking-widest';
    result.textContent = '❌ 網路錯誤，請稍後再試';
  } finally {
    btn.disabled = false;
    btn.textContent = '📢 發送 LINE 召集令';
  }
}

// ── LINE Binding Modal ─────────────────────────────
let _bindTarget = null;

function openLineBindModal(collection, id, name) {
  const person = collection === 'members'
    ? state.members.find(m => (m.ID || m.id) == id)
    : state.alliances.find(a => (a.ID || a.id) == id);
  _bindTarget = { collection, id, name, currentLine: person?.lineId || '' };
  document.getElementById('lineBindName').textContent = name;
  document.getElementById('lineBindInput').value = _bindTarget.currentLine;
  const modal = document.getElementById('lineBindModal');
  modal.style.display = 'flex';
}

function closeLineBindModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('lineBindModal');
  modal.style.display = 'none';
  _bindTarget = null;
}

async function saveLineBinding() {
  if (!_bindTarget) return;
  const lineId = document.getElementById('lineBindInput').value.trim();
  const { collection, id } = _bindTarget;
  try {
    const res = await fetch(`${API_BASE}/${collection}/${id}/line`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ lineId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('LINE ID 已更新', 'success');
      closeLineBindModal();
      await fetchData();
    } else {
      showToast(data.error || '更新失敗', 'error');
    }
  } catch (e) {
    showToast('❌ 網路錯誤，請稍後再試', 'error');
  }
}

// ── Settle Modal ─────────────────────────────────────
let _settleTarget = null;

// ── Settlement Wizard helpers ─────────────────────────
function _settleParseArr(v) { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } }
function _settleMemberName(id) {
  const p = [...state.members, ...state.alliances].find(m => (m.ID || m.id) === id);
  return p ? (p.name || p.Name || id) : id;
}
function _settleParseDrops(v) {
  return _settleParseArr(v).map(d => ({ id: d.id, itemName: d.itemName || d.name || '未命名', price: Number(d.price || d.highestBid || 0) }));
}
function _settleDropsPool() {
  const fromDrops = (_settleTarget.drops || []).reduce((s, d) => s + Number(d.price || 0), 0);
  if (fromDrops > 0) return fromDrops;
  const r = _settleTarget.record;
  return Number(r.auctionPool || (typeof r.drops === 'number' ? r.drops : 0) || 0);
}
function _settleSteps() { return _settleTarget.type === 'battle' ? [1, 2, 3] : [1, 3]; }
function _settleRenderStepper() {
  const labels = { 1: '出席', 2: '掉寶', 3: '分配' };
  const el = document.getElementById('settleStepper'); if (!el) return;
  el.innerHTML = _settleSteps().map((n, i) => {
    const active = n === _settleTarget.step;
    return `<div style="flex:1;text-align:center;padding:6px 4px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid ${active ? 'var(--or)' : 'var(--bd)'};color:${active ? 'var(--or)' : 'var(--tx3)'};">${i + 1}. ${labels[n]}</div>`;
  }).join('');
}
function _settleShowStep(n) {
  _settleTarget.step = n;
  ['settleStep1', 'settleStep2', 'settleStep3'].forEach(p => { const e = document.getElementById(p); if (e) e.style.display = 'none'; });
  const cur = document.getElementById('settleStep' + n); if (cur) cur.style.display = '';
  if (n === 1) _settleRenderStep1();
  else if (n === 2) _settleRenderStep2();
  else if (n === 3) renderSettlePreview();
  const steps = _settleSteps(); const idx = steps.indexOf(n); const isLast = idx === steps.length - 1;
  const back = document.getElementById('settleBackBtn'), next = document.getElementById('settleNextBtn'), exec = document.getElementById('settleExecBtn');
  if (back) back.style.display = idx > 0 ? '' : 'none';
  if (next) next.style.display = isLast ? 'none' : '';
  if (exec) exec.style.display = isLast ? '' : 'none';
  _settleRenderStepper();
}
function _settleRenderStep1() {
  const el = document.getElementById('settleAttList'); if (!el) return;
  if (!_settleTarget.attIds.length) { el.innerHTML = '<div style="font-size:11px;color:var(--tx3);grid-column:1/-1;text-align:center;padding:12px;">尚無出席名單</div>'; return; }
  el.innerHTML = _settleTarget.attIds.map(id => {
    const removed = _settleTarget.removed.includes(id);
    return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:4px 6px;border:1px solid var(--bd);background:${removed ? 'transparent' : 'var(--bg)'};opacity:${removed ? 0.4 : 1};cursor:pointer;"><input type="checkbox" ${removed ? '' : 'checked'} onchange="settleToggleAtt('${id}')" style="accent-color:var(--or);"> ${_settleMemberName(id)}</label>`;
  }).join('');
}
function settleToggleAtt(id) {
  const i = _settleTarget.removed.indexOf(id);
  if (i >= 0) _settleTarget.removed.splice(i, 1); else _settleTarget.removed.push(id);
  _settleRenderStep1();
}
function _settleRenderStep2() {
  const el = document.getElementById('settleDropsList'); if (!el) return;
  const drops = _settleTarget.drops || [];
  el.innerHTML = !drops.length
    ? '<div style="font-size:11px;color:var(--tx3);text-align:center;padding:12px;">尚無掉寶，可於上方新增</div>'
    : drops.map(d => `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);"><span style="flex:1;font-size:12px;color:var(--tx);">${d.itemName}</span><input type="number" value="${d.price || 0}" min="0" step="1000" onchange="settleSetDropPrice('${d.id}', this.value)" class="atelier-input" style="width:110px;font-size:11px;"><button onclick="settleDeleteDrop('${d.id}')" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:13px;">🗑</button></div>`).join('');
  const tot = document.getElementById('settleDropsTotal'); if (tot) tot.textContent = _settleDropsPool().toLocaleString();
}
async function settleAddDrop() {
  const inp = document.getElementById('settleNewDrop'); const name = (inp && inp.value || '').trim();
  if (!name) { showToast('請輸入物品名稱', 'error'); return; }
  try {
    const res = await fetch(`${API_BASE}/battles/${_settleTarget.id}/drops`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ itemName: name }) });
    const data = await res.json();
    if (res.ok && data.dropId) { _settleTarget.drops.push({ id: data.dropId, itemName: name, price: 0 }); if (inp) inp.value = ''; _settleRenderStep2(); }
    else showToast(data.error || '新增失敗', 'error');
  } catch (e) { showToast('網路錯誤', 'error'); }
}
async function settleSetDropPrice(dropId, val) {
  const price = Math.max(0, Number(val) || 0);
  const d = _settleTarget.drops.find(x => x.id === dropId); if (d) d.price = price;
  const tot = document.getElementById('settleDropsTotal'); if (tot) tot.textContent = _settleDropsPool().toLocaleString();
  try { await fetch(`${API_BASE}/battles/${_settleTarget.id}/drops/${dropId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ price }) }); }
  catch (e) { console.warn('set drop price failed', e); }
}
async function settleDeleteDrop(dropId) {
  try { await fetch(`${API_BASE}/battles/${_settleTarget.id}/drops/${dropId}`, { method: 'DELETE', headers: authHeaders() }); } catch (e) {}
  _settleTarget.drops = _settleTarget.drops.filter(d => d.id !== dropId); _settleRenderStep2();
}
async function settleGoStep(dir) {
  const steps = _settleSteps(); let idx = steps.indexOf(_settleTarget.step);
  if (dir > 0) {
    if (_settleTarget.step === 1 && _settleTarget.removed.length) {
      for (const rid of _settleTarget.removed.slice()) {
        try { await fetch(`${API_BASE}/battles/${_settleTarget.id}/attendance/${rid}`, { method: 'DELETE', headers: authHeaders() }); } catch (e) {}
      }
      _settleTarget.attIds = _settleTarget.attIds.filter(id => !_settleTarget.removed.includes(id));
      _settleTarget.removed = [];
    }
    idx = Math.min(steps.length - 1, idx + 1);
  } else { idx = Math.max(0, idx - 1); }
  _settleShowStep(steps[idx]);
}

function openSettleModal(type, id) {
  const collection = type === 'battle' ? state.battles : state.sieges;
  const record = collection.find(r => (r.ID || r.id) == id);
  if (!record) return;
  _settleTarget = {
    type, id, record, step: 1,
    attIds: _settleParseArr(record.attendance).map(String),
    removed: [],
    drops: type === 'battle' ? _settleParseDrops(record.drops) : [],
  };
  document.getElementById('settleTitle').textContent =
    type === 'battle' ? `結算精靈：${record.bossName || '首領戰'}` : `結算精靈：${record.castle || '攻城戰'}`;
  const subsidyRow = document.getElementById('settleSubsidyRow');
  if (subsidyRow) subsidyRow.style.display = type === 'siege' ? '' : 'none';
  _settleShowStep(1);
  document.getElementById('settleModal').style.display = 'flex';
}

function closeSettleModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('settleModal');
  modal.style.display = 'none';
  _settleTarget = null;
}

function renderSettlePreview() {
  if (!_settleTarget) return;
  const { type } = _settleTarget;
  const previewEl = document.getElementById('settlePreview'); if (!previewEl) return;
  const reservePct = parseFloat(document.getElementById('settleReserve')?.value || 0);
  const subsidyPer = parseFloat(document.getElementById('settleSubsidy')?.value || 0);
  const attCount = _settleTarget.attIds.length;
  if (type === 'battle') {
    const pool = _settleDropsPool();
    const reserve = Math.floor(pool * reservePct / 100);
    const distributable = pool - reserve;
    const per = attCount > 0 ? Math.floor(distributable / attCount) : 0;
    previewEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;">
      <span style="color:var(--tx2);">總拍賣池</span><span style="color:var(--tx);text-align:right;">${pool.toLocaleString()} 天幣</span>
      <span style="color:var(--tx2);">公積金 (${reservePct}%)</span><span style="color:var(--or);text-align:right;">${reserve.toLocaleString()} 天幣</span>
      <span style="color:var(--tx2);">可分配</span><span style="color:var(--tx);text-align:right;">${distributable.toLocaleString()} 天幣</span>
      <span style="color:var(--tx2);">出席人數</span><span style="color:var(--tx);text-align:right;">${attCount} 人</span>
      <span style="color:var(--tx2);font-weight:700;">每人分得</span><span style="color:#51cf66;font-weight:700;text-align:right;">${per.toLocaleString()} 天幣</span>
    </div>`;
  } else {
    const totalSubsidy = subsidyPer * attCount;
    previewEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;">
      <span style="color:var(--tx2);">公積金比例</span><span style="color:var(--or);text-align:right;">${reservePct}%</span>
      <span style="color:var(--tx2);">出席人數</span><span style="color:var(--tx);text-align:right;">${attCount} 人</span>
      <span style="color:var(--tx2);">薪津/人</span><span style="color:var(--tx);text-align:right;">${subsidyPer.toLocaleString()} 天幣</span>
      <span style="color:var(--tx2);font-weight:700;">薪津總計</span><span style="color:#ff6b35;font-weight:700;text-align:right;">-${totalSubsidy.toLocaleString()} 天幣</span>
    </div>`;
  }
}

async function confirmSettle() {
  if (!_settleTarget) return;
  const { type, id } = _settleTarget;
  const reservePct = parseFloat(document.getElementById('settleReserve')?.value || 0);
  const subsidyPer = parseFloat(document.getElementById('settleSubsidy')?.value || 0);
  const endpoint = type === 'battle'
    ? `${API_BASE}/battles/${id}/settle`
    : `${API_BASE}/sieges/${id}/settle`;
  const body = type === 'battle'
    ? { reservePercentage: reservePct }
    : { subsidyPerPerson: subsidyPer, reservePercentage: reservePct, source: _settleTarget.record.castle || '攻城戰' };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('結算完成！金庫已更新', 'success');
      closeSettleModal();
      await fetchData();
    } else {
      showToast(data.error || '結算失敗', 'error');
    }
  } catch (e) {
    showToast('❌ 網路錯誤，請稍後再試', 'error');
  }
}

// ── Member Profile Modal ──────────────────────────────
async function openMemberProfile(id) {
  const member = state.members.find(m => (m.ID || m.id) == id);
  const modal = document.getElementById('memberProfileModal');
  if (!modal) return;
  const setTxt = (eid, v) => { const el = document.getElementById(eid); if (el) el.textContent = v; };

  // Immediate basic info from local state (correct field names)
  if (member) {
    setTxt('profileName', member.name || member.Name || '—');
    setTxt('profileJob', member.job || member.class || '—');
    setTxt('profileTier', member.tier || '一般');
    setTxt('profileLine', member.lineUserId || member.lineId || '未綁定');
    setTxt('profileNote', member.notes || member.note || '—');
  }
  // Local fallback counts: attendance is an array of member-ID strings
  const parseArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
  const localB = state.battles.filter(b => parseArr(b.attendance).includes(String(id))).length;
  const localS = state.sieges.filter(s => parseArr(s.attendance).includes(String(id))).length;
  setTxt('profileBattleCount', localB);
  setTxt('profileSiegeCount', localS);

  const histEl = document.getElementById('profileHistory');
  if (histEl) histEl.innerHTML = '<div style="font-size:11px;color:var(--tx3);text-align:center;padding:8px;">載入中…</div>';
  modal.style.display = 'flex';

  // Enrich from backend: authoritative counts + attendance / level history
  try {
    const j = (url) => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
    const [detail, attHist, lvHist] = await Promise.all([
      j(`${API_BASE}/members/${id}`),
      j(`${API_BASE}/members/${id}/attendance-history`),
      j(`${API_BASE}/members/${id}/level-history`),
    ]);
    const d = detail && detail.ok ? detail.data : null;
    if (d) {
      if (d.battleCount != null) setTxt('profileBattleCount', d.battleCount);
      if (d.siegeCount != null) setTxt('profileSiegeCount', d.siegeCount);
      if (d.lineUserId) setTxt('profileLine', d.lineUserId);
    }
    if (histEl) {
      const att = (attHist && attHist.ok ? attHist.data : []) || [];
      const lv = (lvHist && lvHist.ok ? lvHist.data : []) || [];
      let html = '<div style="font-size:10px;color:var(--or);text-transform:uppercase;letter-spacing:0.08em;font-weight:900;margin:0 0 6px;">近期出席</div>';
      if (!att.length) html += '<div style="font-size:11px;color:var(--tx3);">尚無出席記錄</div>';
      else html += att.slice(0, 8).map(h => {
        const icon = h.type === 'siege' ? '🏰' : '⚔️';
        const date = h.date ? new Date(h.date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';
        return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--bd);"><span>${icon} ${h.name || ''}</span><span style="color:var(--tx3);">${date}</span></div>`;
      }).join('');
      if (lv.length) {
        html += '<div style="font-size:10px;color:var(--or);text-transform:uppercase;letter-spacing:0.08em;font-weight:900;margin:10px 0 6px;">等級歷史</div>';
        html += lv.slice(0, 6).map(h => {
          const date = h.changedAt ? new Date(h.changedAt).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';
          return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--bd);"><span>${h.prevLevel != null ? h.prevLevel + ' → ' : ''}Lv${h.level}</span><span style="color:var(--tx3);">${date}</span></div>`;
        }).join('');
      }
      histEl.innerHTML = html;
    }
  } catch (e) {
    console.error('profile enrich failed:', e);
    if (histEl) histEl.innerHTML = '<div style="font-size:11px;color:var(--tx3);">歷史載入失敗</div>';
  }
}

function closeMemberProfile(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('memberProfileModal');
  if (!modal) return;
  modal.style.display = 'none';
}

// ── Overview Panel ────────────────────────────────────
function renderOverview() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const ov = state.overview && state.overview.kpi ? state.overview : null;
  const bal = Number((ov ? ov.kpi.treasuryBalance : state.treasury?.balance) || 0);

  // KPI strip — prefer server-aggregated values, fall back to client compute
  const kpis = [
    ['kpiMemberCount',   ov ? ov.kpi.memberCount : state.members.length],
    ['kpiTreasury',      bal.toLocaleString()],
    ['kpiBattleCount',   ov ? ov.kpi.bossKills : state.battles.filter(b => (b.result || b.status) === 'success').length],
    ['kpiAllianceCount', ov ? ov.kpi.allianceCount : state.alliances.length],
  ];
  // Month-over-month income arrow on the treasury KPI
  const deltaEl = document.getElementById('kpiTreasuryDelta');
  if (deltaEl) {
    if (ov) {
      const pct = Number(ov.kpi.momIncomePct || 0);
      const up = pct >= 0;
      deltaEl.textContent = (up ? '\u25B2 ' : '\u25BC ') + Math.abs(pct) + '% 收入';
      deltaEl.style.color = up ? '#34d399' : '#f87171';
    } else { deltaEl.textContent = ''; }
  }
  kpis.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.classList.remove('kpi-animate');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('kpi-animate');
  });

  // Legacy ids still used by treasury card in overview
  set('overviewClanBank', bal.toLocaleString());
  set('overviewTotalOps', state.battles.length + state.sieges.length);

  // Battle summary
  const totalB = state.battles.length;
  const wonB   = state.battles.filter(b => (b.result || b.status) === 'success').length;
  set('ovBattleTotal',   totalB);
  set('ovBattleWinRate', totalB > 0 ? Math.round(wonB / totalB * 100) + '%' : '—');
  set('ovSiegeTotal',    state.sieges.length);

  // Recent battles mini list
  const rbEl = document.getElementById('ovRecentBattles');
  if (rbEl) {
    const recent = [...state.battles]
      .sort((a,b) => new Date(b.time||b.createdAt||0) - new Date(a.time||a.createdAt||0))
      .slice(0, 5);
    if (!recent.length) {
      rbEl.innerHTML = '<div class="text-[11px] text-slate-600 font-bold uppercase">尚無戰鬥記錄</div>';
    } else {
      rbEl.innerHTML = recent.map(b => {
        const isOk = (b.result||b.status) === 'success';
        const date = new Date(b.time||b.createdAt||0).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'});
        const boss = b.bossName || b.boss || '未知首領';
        const cfg = getBossConfig()[boss];
        const bossIcon = cfg ? cfg.icon : '⚔️';
        return `<div class="card-row" style="${isOk?'border-color:rgba(52,211,153,0.3);':''}">
          <span class="text-sm flex-shrink-0">${bossIcon}</span>
          <span class="font-black text-[10px] text-white/80 flex-1 truncate">${boss}</span>
          <span class="text-[11px] text-slate-600 flex-shrink-0">${date}</span>
          <span class="tier-badge ${isOk?'result-success':'result-failed'} flex-shrink-0">${isOk?'✓ 成功':'✗ 失敗'}</span>
        </div>`;
      }).join('');
    }
  }

  // Tier bars in overview
  const tierBarsEl = document.getElementById('overviewTierBars');
  if (tierBarsEl) {
    const tierCounts = {};
    state.members.forEach(m => { const t = m.tier||'一般'; tierCounts[t] = (tierCounts[t]||0)+1; });
    const total = state.members.length || 1;
    const tierDefs = [
      { key:'核心', label:'CORE',    color:'bg-primary/70' },
      { key:'一般', label:'REGULAR', color:'bg-amber-600/60' },
      { key:'試煉', label:'TRIAL',   color:'bg-slate-500/60' },
      { key:'預備', label:'RESERVE', color:'bg-slate-600/50' },
      { key:'外交', label:'DIPL',    color:'bg-secondary/60' },
    ];
    tierBarsEl.innerHTML = tierDefs.map(td => {
      const cnt = tierCounts[td.key] || 0;
      if (!cnt) return '';
      const pct = Math.round(cnt / total * 100);
      return `<div class="group cursor-default" onclick="switchSection('members');setMemberTierFilter('${td.key}')">
        <div class="flex justify-between items-baseline mb-0.5">
          <span class="tier-badge tier-${td.key} group-hover:opacity-80 transition-opacity">${td.label}</span>
          <span class="text-[11px] font-black text-slate-400">${cnt} 人</span>
        </div>
        <div class="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div class="h-full ${td.color} rounded-full transition-all duration-700 group-hover:brightness-125" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  // Class legend in overview
  const legendEl = document.getElementById('overviewClassLegend');
  if (legendEl) {
    const jobCounts = {};
    state.members.forEach(m => { const j = m.job||'其他'; jobCounts[j] = (jobCounts[j]||0)+1; });
    legendEl.innerHTML = Object.entries(jobCounts).map(([job, cnt]) => {
      const icon = JOB_ICON[job] || '⚔️';
      return `<div class="flex items-center gap-1 truncate">
        <span class="text-sm">${icon}</span>
        <span class="text-[11px] text-slate-300 font-bold flex-1 truncate">${job}</span>
        <span class="text-[11px] text-amber-600 font-black">${cnt}</span>
      </div>`;
    }).join('');
  }

  // Top contributors (attendance leaderboard across all ops)
  const listEl = document.getElementById('topContributorsList');
  if (listEl) {
    const counts = {};
    [...state.battles, ...state.sieges].forEach(op => {
      let att = [];
      try { att = typeof op.attendance === 'string' ? JSON.parse(op.attendance) : (op.attendance || []); } catch(e){}
      att.forEach(id => { counts[id] = (counts[id]||0)+1; });
    });
    const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,6);
    if (!top.length) {
      listEl.innerHTML = '<div class="text-[11px] text-slate-600 font-bold uppercase text-center py-2">尚無出席記錄</div>';
    } else {
      const rankCls = ['rank-gold','rank-silver','rank-bronze'];
      const rankNum = ['①','②','③','④','⑤','⑥'];
      listEl.innerHTML = top.map(([id, cnt], i) => {
        const member = [...state.members, ...state.alliances].find(m => (m.ID||m.id) === id);
        const name = member ? (member.name||member.Name||id) : id.slice(-6).toUpperCase();
        const job = member ? (member.job || '') : '';
        const jobIcon = JOB_ICON[job] || '';
        const rankEl = i < 3
          ? `<span class="${rankCls[i]} text-sm w-5 text-center flex-shrink-0">★</span>`
          : `<span class="text-[10px] text-slate-600 font-black w-5 text-center flex-shrink-0">${rankNum[i]||i+1}</span>`;
        const barW = top[0]?.[1] > 0 ? Math.round(cnt / top[0][1] * 100) : 0;
        return `<div class="card-row">
          ${rankEl}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 mb-0.5">
              <span class="text-[10px] font-black text-on-surface uppercase truncate flex-1">${jobIcon} ${name}</span>
              <span class="text-[11px] font-black text-secondary bg-secondary/10 px-1.5 py-0.5 rounded flex-shrink-0">${cnt}</span>
            </div>
            <div class="level-bar-track w-full">
              <div class="level-bar-fill" style="width:${barW}%"></div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }
}

// ── Member Tier Strip ──────────────────────────────────
function renderMemberTierStrip() {
  const el = document.getElementById('memberTierStrip');
  if (!el) return;
  const tierDefs = [
    { key:'核心', label:'Core',    icon:'⭐', bg:'bg-primary/10',    border:'border-primary/30',    text:'text-primary'   },
    { key:'一般', label:'Regular', icon:'⚔️', bg:'bg-white/5',       border:'border-white/10',      text:'text-slate-400' },
    { key:'試煉', label:'Trial',   icon:'🔰', bg:'bg-slate-800/50',  border:'border-slate-700',     text:'text-slate-500' },
    { key:'預備', label:'Reserve', icon:'📋', bg:'bg-slate-800/40',  border:'border-slate-700/50',  text:'text-slate-500' },
    { key:'外交', label:'Dipl.',   icon:'🤝', bg:'bg-secondary/10',  border:'border-secondary/30',  text:'text-secondary' },
  ];
  const counts = {};
  state.members.forEach(m => { const t = m.tier||'一般'; counts[t] = (counts[t]||0)+1; });
  el.innerHTML = tierDefs.map(td => {
    const cnt = counts[td.key] || 0;
    return `<div class="s1-panel" style="padding:10px;text-align:center;border-top:2px solid var(--or2);">
      <div class="text-base mb-0.5">${td.icon}</div>
      <div class="text-[11px] ${td.text} font-black uppercase tracking-widest">${td.label}</div>
      <div class="text-xl font-bold ${td.text} mt-0.5">${cnt}</div>
    </div>`;
  }).join('');
}

// ── Siege Stats Panel ──────────────────────────────────
function renderSiegeStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  const total = state.sieges.length;
  set('siegeKpiTotal', total);

  // Average attendance
  let totalAtt = 0;
  const castleCounts = {};
  const attendeeCounts = {};

  state.sieges.forEach(s => {
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance||[]); } catch(e){}
    totalAtt += att.length;
    att.forEach(id => { attendeeCounts[id] = (attendeeCounts[id]||0)+1; });
    const castle = s.castle || s.castleName || '未知城堡';
    castleCounts[castle] = (castleCounts[castle]||0)+1;
  });

  set('siegeKpiAvgAtt', total > 0 ? Math.round(totalAtt / total) : 0);

  // Total pay distributed
  const totalPay = state.sieges.reduce((sum, s) => {
    const subsidy = Number(s.subsidyPerPerson || s.perPersonPay || 0);
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance||[]); } catch(e){}
    return sum + subsidy * att.length;
  }, 0);
  set('siegeKpiTotalPay', totalPay > 0 ? totalPay.toLocaleString() : '—');

  // Castle stats
  const castleEl = document.getElementById('siegeCastleStats');
  if (castleEl) {
    const entries = Object.entries(castleCounts).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) {
      castleEl.innerHTML = '<div class="text-[11px] text-slate-600 font-bold uppercase col-span-4">尚無城堡紀錄</div>';
    } else {
      castleEl.innerHTML = entries.map(([castle, cnt]) =>
        `<div class="s1-panel" style="padding:8px;text-align:center;border-top:2px solid var(--or2);">
          <div class="text-base mb-0.5">🏰</div>
          <div class="text-[11px] font-black text-secondary uppercase truncate">${castle}</div>
          <div class="text-lg font-bold text-white">${cnt}</div>
          <div class="text-[10px] text-slate-500 font-bold uppercase">次</div>
        </div>`
      ).join('');
    }
  }

  // Siege leaderboard — with rank medals and progress bars
  const lbEl = document.getElementById('siegeLeaderboard');
  if (lbEl) {
    const top = Object.entries(attendeeCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (!top.length) {
      lbEl.innerHTML = '<div class="text-[11px] text-slate-600 font-bold uppercase col-span-4">尚無出席記錄</div>';
    } else {
      const sRankCss = ['rank-gold','rank-silver','rank-bronze'];
      const topMax = top[0]?.[1] || 1;
      lbEl.innerHTML = top.map(([id, cnt], i) => {
        const m = [...state.members,...state.alliances].find(x => (x.ID||x.id)===id);
        const name = m ? (m.name||m.Name||id) : id.slice(-6).toUpperCase();
        const job = m ? (m.job || '') : '';
        const jobIcon = JOB_ICON[job] || '';
        const rkEl = i < 3
          ? `<span class="${sRankCss[i]} text-sm">★</span>`
          : `<span class="text-[10px] text-slate-600 font-black">${i+1}</span>`;
        const barWs = Math.round(cnt / topMax * 100);
        return `<div class="card-row">
          ${rkEl}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 mb-0.5">
              <span class="text-[11px] font-black text-white uppercase truncate flex-1">${jobIcon} ${name}</span>
              <span class="text-[11px] font-black text-secondary flex-shrink-0">${cnt}</span>
            </div>
            <div class="level-bar-track"><div class="level-bar-fill" style="width:${barWs}%"></div></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Status text
  set('siegeStatusText', total > 0 ? `${total} OPERATIONS LOGGED` : 'NO OPERATIONS');
}

// ── Alliance Stats Panel ───────────────────────────────
function renderAllianceStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('allyKpiCount', state.alliances.length);

  // Unique pledges
  const pledges = {};
  state.alliances.forEach(a => {
    const p = a.pledgeName || '（未分類）';
    if (!pledges[p]) pledges[p] = 0;
    pledges[p]++;
  });
  set('allyKpiPledges', Object.keys(pledges).length);

  // Ops count (alliances who appeared in at least one battle/siege)
  const opsIds = new Set();
  [...state.battles, ...state.sieges].forEach(op => {
    let att = [];
    try { att = typeof op.attendance === 'string' ? JSON.parse(op.attendance) : (op.attendance || []); } catch(e){}
    att.forEach(id => {
      if (state.alliances.find(a => (a.ID||a.id) === id)) opsIds.add(id);
    });
  });
  set('allyKpiOps', opsIds.size);

  // Class bars
  const classBarsEl = document.getElementById('allyClassBars');
  if (classBarsEl) {
    const jobCounts = {};
    state.alliances.forEach(a => { const j = a.job||'其他'; jobCounts[j]=(jobCounts[j]||0)+1; });
    const total = state.alliances.length || 1;
    const jobColors = { '王族':'#fbbf24','騎士':'#60a5fa','妖精':'#34d399','法師':'#c084fc','黑妖':'#f87171' };
    classBarsEl.innerHTML = Object.entries(jobCounts)
      .sort((a,b)=>b[1]-a[1])
      .map(([job, cnt]) => {
        const pct = Math.round(cnt/total*100);
        const color = jobColors[job] || '#64748b';
        const icon = JOB_ICON[job] || '⚔️';
        return `<div class="flex items-center gap-2">
          <span class="text-xs w-4 flex-shrink-0">${icon}</span>
          <span class="text-[11px] font-black uppercase tracking-wide w-12 flex-shrink-0" style="color:${color}">${job}</span>
          <div class="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${color}40;box-shadow:0 0 6px ${color}60"></div>
          </div>
          <span class="text-[11px] font-black text-slate-500 w-5 text-right flex-shrink-0">${cnt}</span>
        </div>`;
      }).join('');
  }

  // Pledge list
  const pledgeListEl = document.getElementById('allyPledgeList');
  if (pledgeListEl) {
    pledgeListEl.innerHTML = Object.entries(pledges)
      .sort((a,b)=>b[1]-a[1])
      .map(([p, cnt]) =>
        `<div class="s1-panel" style="padding:8px;text-align:center;">
          <div class="text-[11px] font-black text-blue-400 uppercase truncate">${p}</div>
          <div class="text-sm font-bold text-white">${cnt}</div>
        </div>`
      ).join('');
  }
}

// ── Treasury Render ───────────────────────────────
// (Treasury is rendered inline in renderTreasury() called from fetchData)

// ── Castle Tax Functions ───────────────────────────
function addCastleTaxRow() {
  const list = document.getElementById('castleTaxList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center mt-0';
  row.innerHTML = `
    <input type="text" placeholder="城堡名稱" data-role="castle-name"
      class="flex-1 bg-[#1a1508] border border-[#4a3f20] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#c9a84c]">
    <input type="number" placeholder="稅金" data-role="castle-amount" min="0"
      class="w-32 bg-[#1a1508] border border-[#4a3f20] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#c9a84c]">
    <button onclick="removeCastleTaxRow(this)" class="text-[#ff4444] hover:text-red-400 px-2 text-lg leading-none">✕</button>`;
  list.appendChild(row);
}

function removeCastleTaxRow(btn) {
  btn.closest('div').remove();
}

function canDoActionClient(action) {
  if (auth.isAdmin) return true;
  if (!auth.actionPerms) return false;
  return auth.actionPerms[action] === true;
}

async function addManualTransaction() {
  const type = document.getElementById('txType') ? document.getElementById('txType').value : 'income';
  const category = document.getElementById('txCategory') ? document.getElementById('txCategory').value : '其他';
  const amount = parseFloat((document.getElementById('txAmount') || {}).value || 0);
  const note = ((document.getElementById('txNote') || {}).value || '').trim();
  if (!amount || amount <= 0) { showToast('請輸入有效金額', 'error'); return; }
  const act = type === 'expense' ? 'treasuryExpense' : 'treasuryIncome';
  if (!canDoActionClient(act)) { showToast(type === 'expense' ? '您沒有支出登記權限' : '您沒有收入登記權限', 'error'); return; }
  try {
    if (auth.firebaseUser) { try { auth.firebaseToken = await auth.firebaseUser.getIdToken(); } catch (e) {} }
    const res = await fetch(`${API_BASE}/transactions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ type, amount, category, note }) });
    const data = await res.json();
    if (res.ok) {
      showToast(`已登記${type === 'expense' ? '支出' : '收入'} ${amount.toLocaleString()}`, 'success');
      const a = document.getElementById('txAmount'); if (a) a.value = '';
      const n = document.getElementById('txNote'); if (n) n.value = '';
      await fetchData();
    } else { showToast(data.error || '登記失敗', 'error'); }
  } catch (e) { showToast('網路錯誤', 'error'); }
}

const _TREASURY_ROLE_OPTS = [[5, '會主'], [4, '元帥'], [3, '幹部'], [2, '成員'], [1, '新人']];
const PERM_ACTIONS = [
  { key: 'treasuryIncome', label: '收入登記', def: 3 },
  { key: 'treasuryExpense', label: '支出登記', def: 4 },
  { key: 'treasuryCastleTax', label: '城堡稅登錄', def: 3 },
  { key: 'memberCreate', label: '新增成員', def: 3 },
  { key: 'memberDelete', label: '刪除成員', def: 5 },
  { key: 'battleDelete', label: '刪除首領戰', def: 4 },
  { key: 'siegeDelete', label: '刪除攻城戰', def: 4 },
  { key: 'lineBroadcast', label: 'LINE 召集', def: 3 },
];
function _roleOptionsHtml(val) {
  return _TREASURY_ROLE_OPTS.map(([lv, n]) => `<option value="${lv}" ${Number(val) === lv ? 'selected' : ''}>${n}（Lv${lv}）</option>`).join('');
}
async function loadTreasuryPermConfig() {
  let cfg = {};
  try { const r = await fetch(`${API_BASE}/settings`); const j = await r.json(); cfg = (j && j.ok && j.data && j.data.permissions) || {}; } catch (e) {}
  const el = document.getElementById('permConfigList'); if (!el) return;
  el.innerHTML = PERM_ACTIONS.map(a => {
    const val = cfg[a.key] != null ? cfg[a.key] : a.def;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><label style="font-size:11px;color:var(--tx2);flex:1;">${a.label}</label><select data-perm-key="${a.key}" class="atelier-input" style="width:120px;">${_roleOptionsHtml(val)}</select></div>`;
  }).join('');
}
async function saveTreasuryPermConfig() {
  const el = document.getElementById('permConfigList'); if (!el) return;
  const permissions = {};
  el.querySelectorAll('select[data-perm-key]').forEach(sel => { permissions[sel.getAttribute('data-perm-key')] = Number(sel.value); });
  try {
    const res = await fetch(`${API_BASE}/settings`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ permissions }) });
    const d = await res.json();
    if (res.ok) showToast('權限設定已更新', 'success');
    else showToast(d.error || '儲存失敗（需擁有者）', 'error');
  } catch (e) { showToast('網路錯誤', 'error'); }
}

async function submitCastleTax() {
  if (!canDoActionClient('treasuryCastleTax')) { showToast('您沒有城堡稅登錄權限', 'error'); return; }
  if (auth.firebaseUser) { try { auth.firebaseToken = await auth.firebaseUser.getIdToken(); } catch (e) {} }
  const list = document.getElementById('castleTaxList');
  if (!list) return;
  const entries = [...list.querySelectorAll('div')].map(row => ({
    castle: row.querySelector('[data-role="castle-name"]')?.value.trim(),
    amount: parseFloat(row.querySelector('[data-role="castle-amount"]')?.value || 0)
  })).filter(e => e.castle && e.amount > 0);
  if (!entries.length) { showToast('請填寫至少一筆城堡稅收資料', 'error'); return; }

  const total = entries.reduce((s, e) => s + e.amount, 0);
  try {
    const res = await fetch(`${API_BASE}/treasury/castle-tax`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ entries, total })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`城堡稅收已登錄 ${entries.length} 筆`, 'success');
      const list2 = document.getElementById('castleTaxList');
      if (list2) { list2.innerHTML = ''; addCastleTaxRow(); }
      await fetchData();
    } else {
      showToast(data.error || '登錄失敗', 'error');
    }
  } catch (e) {
    showToast('❌ 網路錯誤，請稍後再試', 'error');
  }
}

// ── Start ─────────────────────────────────────────
if (!window._initRan) { window._initRan = true; init(); }
