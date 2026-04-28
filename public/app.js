/* ══════════════════════════════════════════════════
   天堂：經典版 管理系統 — app.js
   Firebase + Google OAuth Admin Auth
══════════════════════════════════════════════════ */

const API_BASE = '/api';

// ── State ────────────────────────────────────────
let state = { members: [], battles: [], sieges: [], alliances: [] };
let auth = { isLoggedIn: false, isAdmin: false, user: null, token: null };
let filters = { members: '', battles: '', sieges: '', alliances: '', treasury: '' };

// ── Charts ───────────────────────────────────────
let classChartInstance = null;
let treasuryChartInstance = null;

function setFilter(section, query) {
  filters[section] = query.toLowerCase();
  if (section === 'members') renderMembers();
  else if (section === 'battles') renderBattles();
  else if (section === 'sieges') renderSieges();
  else if (section === 'alliances') renderAlliances();
  else if (section === 'treasury') renderTreasury();
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
    const badge = type === 'alliance' ? '<span class="bg-[#4285F4] text-white text-[9px] px-1 rounded-sm ml-1 font-bold">聯盟</span>' : '';
    return `<div>${name} ${badge} <span class="text-gray-500 font-bold ml-1">${job}</span></div>`;
  }).join('');
}


// ── Init ─────────────────────────────────────────
async function init() {
  // 1. Fetch server config (open mode / Google Client ID)
  try {
    const cfgRes = await fetch(`${API_BASE}/config`);
    const cfg = await cfgRes.json();
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
          callback: handleGoogleCredential,
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

  await fetchData();
  renderAuthUI();
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
    loginBtn.innerHTML = '🔓 <span style="font-size:12px;">開放管理模式</span>';
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
    loginBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><span>系統登入</span>';
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
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginError').classList.add('hidden');

  // Render Google Sign-In button
  if (window.google && window.google.accounts) {
    const clientId = document.querySelector('meta[name="google-client-id"]')?.content || '';
    // Try to render the button
    try {
      google.accounts.id.renderButton(
        document.getElementById('googleSignInDiv'),
        {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 280
        }
      );
    } catch (e) {
      // If Google client ID not configured, show placeholder
      document.getElementById('googleSignInDiv').innerHTML = `
        <div style="background:#fff;border-radius:4px;padding:10px 24px;display:flex;align-items:center;gap:10px;cursor:default;opacity:0.7;">
          <span style="color:#444;font-size:14px;">請先設定 Google Client ID</span>
        </div>
        <p style="color:var(--text-soft);font-size:12px;margin-top:12px;">請在 Vercel 環境變數中加入 GOOGLE_CLIENT_ID</p>
      `;
    }
  } else {
    document.getElementById('googleSignInDiv').innerHTML = `
      <div style="color:var(--text-soft);font-size:13px;padding:16px 0;">
        Google 登入載入中... 如長時間無反應，請重新整理頁面
      </div>
    `;
  }
}

function closeLoginModal(e) {
  if (e && e.target !== document.getElementById('loginModal')) return;
  document.getElementById('loginModal').classList.add('hidden');
}

// ── Navigation ────────────────────────────────────
function switchSection(sectionId) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
}

// ── Toast & Terminal ──────────────────────────────
function showToast(msg, type = 'default') {
  const t = document.getElementById('toast');
  const icons = { success: '✅', error: '❌', default: '💬' };
  t.textContent = `${icons[type] || '💬'} ${msg}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
  logToTerminal(`[${type.toUpperCase()}] ${msg}`);
}

function logToTerminal(msg) {
  const terminal = document.getElementById('terminalLog');
  if (!terminal) return;
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  // Remove cursor from last element
  const lastLine = terminal.lastElementChild;
  if (lastLine && lastLine.querySelector('.cursor-blink')) {
    lastLine.querySelector('.cursor-blink').remove();
  }
  
  const line = document.createElement('span');
  line.innerHTML = `> [${time}] ${msg}<span class="cursor-blink"></span>`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// ── Auth Header ───────────────────────────────────
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) headers['x-google-token'] = auth.token;
  return headers;
}

// ── Data Fetching ─────────────────────────────────
async function fetchData() {
  try {
    const [m, b, s, a] = await Promise.all([
      fetch(`${API_BASE}/members`).then(r => r.json()),
      fetch(`${API_BASE}/battles`).then(r => r.json()),
      fetch(`${API_BASE}/sieges`).then(r => r.json()),
      fetch(`${API_BASE}/alliances`).then(r => r.json())
    ]);
    state.members = m || [];
    state.battles = b || [];
    state.sieges = s || [];
    state.alliances = a || [];

    renderMembers();
    renderBattles();
    renderSieges();
    renderAlliances();
    renderTreasury();
    renderCheckboxes();
    updateMemberCountBadge();
    renderCharts();
  } catch (err) {
    console.error('Fetch error:', err);
    showToast('無法連線至伺服器', 'error');
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

// ── Checkboxes ────────────────────────────────────
function renderCheckboxes() {
  const membersHtml = state.members.map(m => `
        <label class="hover:bg-[#ffe6e6] p-2 transition-colors border-2 border-transparent hover:border-[#111] flex items-center gap-2">
          <input type="checkbox" value="${m.ID || m.id}" class="rounded-none border-2 border-[#111] text-[#ff3333] focus:ring-[#111] bg-white accent-[#ff3333]">
          <div>
            <span class="text-[#111] uppercase font-black text-sm">${m.name || m.Name || '未知'}</span> 
            <span class="text-[10px] text-gray-500 font-bold uppercase ml-1">(${m.job || ''})</span>
          </div>
        </label>`).join('');

  const alliancesHtml = state.alliances.map(a => `
        <label class="hover:bg-[#e6f0ff] p-2 transition-colors border-2 border-transparent hover:border-[#111] flex items-center gap-2">
          <input type="checkbox" value="${a.ID || a.id}" class="rounded-none border-2 border-[#111] text-[#4285F4] focus:ring-[#111] bg-white accent-[#4285F4]">
          <div>
            <span class="text-[#111] uppercase font-black text-sm">${a.name || a.Name || '未知'}</span> 
            <span class="bg-[#4285F4] text-white text-[9px] px-1 py-0.5 rounded-sm ml-1 align-middle uppercase font-bold">聯盟</span>
            <span class="text-[10px] text-gray-500 font-bold uppercase ml-1">(${a.job || ''})</span>
          </div>
        </label>`).join('');

  const html = (state.members.length > 0 || state.alliances.length > 0)
    ? membersHtml + alliancesHtml
    : '<span class="text-xs text-slate-400 font-bold uppercase p-2">尚無成員或聯盟，請先新增人員</span>';

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

// ── Boss Select ───────────────────────────────────
function handleBossSelect(sel) {
  const customGroup = document.getElementById('bCustomBossGroup');
  if (sel.value === '__custom__') {
    customGroup.style.display = 'flex';
    document.getElementById('bBossCustom').focus();
  } else {
    customGroup.style.display = 'none';
  }
}

function getBossName() {
  const sel = document.getElementById('bBossSelect');
  if (sel.value === '__custom__') {
    return document.getElementById('bBossCustom').value.trim() || '未知首領';
  }
  return sel.value;
}

// ── Members ───────────────────────────────────────
async function addMember() {
  const name = document.getElementById('mName').value.trim();
  const job = document.getElementById('mJob').value;
  const notes = document.getElementById('mNotes').value.trim();
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/members`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes })
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
  document.getElementById('editMemberModal').classList.remove('hidden');
}

function closeEditModal(e) {
  if (e && e.target !== document.getElementById('editMemberModal')) return;
  document.getElementById('editMemberModal').classList.add('hidden');
}

async function updateMember() {
  const id = document.getElementById('editMemberId').value;
  const name = document.getElementById('editMemberName').value.trim();
  const job = document.getElementById('editMemberJob').value;
  const notes = document.getElementById('editMemberNotes').value.trim();
  const tier = document.getElementById('editMemberTier').value || '一般';
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/members/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes, tier })
    });
    if (!res.ok) { showToast('修改失敗（權限不足）', 'error'); return; }
    document.getElementById('editMemberModal').classList.add('hidden');
    showToast(`${name} 資料已更新`, 'success');
    await fetchData();
  } catch (e) { showToast('修改失敗', 'error'); }
}

function renderMembers() {
  const tbody = document.querySelector('#membersTable tbody');
  if (!tbody) return;
  
  let data = state.members;
  if (filters.members) {
    const q = filters.members;
    data = data.filter(m => 
      (m.name || m.Name || '').toLowerCase().includes(q) || 
      (m.job || '').toLowerCase().includes(q) || 
      (m.notes || '').toLowerCase().includes(q)
    );
  }
  
  const TIER_CONFIG = {
    '核心': { label: '⭐核心', bg: 'bg-[#ffe600]', text: 'text-[#111]' },
    '一般': { label: '○一般', bg: 'bg-[#4285F4]', text: 'text-white' },
    '試煉': { label: '△試煉', bg: 'bg-gray-400', text: 'text-white' },
    '外交': { label: '◇外交', bg: 'bg-[#8e24aa]', text: 'text-white' },
  };
  tbody.innerHTML = data.map(m => {
    const id = m.ID || m.id;
    const name = m.name || m.Name || '';
    const tc = TIER_CONFIG[m.tier] || { label: '○一般', bg: 'bg-[#4285F4]', text: 'text-white' };
    const tierBadge = `<span class="${tc.bg} ${tc.text} text-[9px] px-1.5 py-0.5 font-black uppercase">${tc.label}</span>`;
    const lineStatus = m.lineUserId
      ? `<span class="bg-[#06c755] text-white text-[9px] px-1.5 py-0.5 font-bold uppercase">LINE✓</span>`
      : `<span class="bg-gray-200 text-gray-500 text-[9px] px-1.5 py-0.5 font-bold uppercase">--</span>`;
    const adminActions = auth.isAdmin ? `
      <td class="py-3 pr-2 text-right admin-col">
        <div class="flex items-center justify-end gap-2">
          <button class="action-btn" style="background:#06c755;color:#fff;" onclick="openLineBindModal('members','${id}','${name.replace(/'/g, "\\'")}')">LINE</button>
          <button class="action-btn edit" onclick="openEditModal('${id}')">MUTATE</button>
          <button class="action-btn delete" onclick="deleteMember('${id}', '${name.replace(/'/g, "\\'")}')">DELETE</button>
        </div>
      </td>` : '<td class="py-3 pr-2 text-right admin-col hidden"></td>';
    return `
      <tr class="hover:bg-[#ffe6e6] transition-colors">
        <td class="py-3 pl-2 font-black text-[#111] uppercase">${name}</td>
        <td class="py-3 text-[#111] font-bold uppercase">${m.job || ''}</td>
        <td class="py-3 text-center">${tierBadge}</td>
        <td class="py-3 notes-cell text-gray-600 font-bold uppercase">${m.notes || '<span class="opacity-40">—</span>'}</td>
        <td class="py-3 text-center">${lineStatus}</td>
        ${adminActions}
      </tr>`;
  }).join('');
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
    const badge = type === 'alliance' ? '<span class="bg-[#4285F4] text-white text-[9px] px-1 rounded-sm ml-1 font-bold">聯盟</span>' : '';
    
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
        <tr class="hover:bg-[#ffe6e6] transition-colors">
          <td class="py-2 px-3 text-[#111] font-black uppercase">${d.name}</td>
          <td class="py-2 px-3 text-right text-[#111] font-bold uppercase">${Number(d.price).toLocaleString()}</td>
        </tr>
      `).join('');
    } else {
      dropsGroup.classList.add('hidden');
    }
  } else {
    dropsGroup.classList.add('hidden');
  }

  document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById('detailModal')) return;
  document.getElementById('detailModal').classList.add('hidden');
}

// ── Battles ───────────────────────────────────────
function addLootRow() {
  const container = document.getElementById('bDropsList');
  const div = document.createElement('div');
  div.className = 'loot-row flex gap-2';
  div.innerHTML = `
    <input type="text" placeholder="Item Name" class="brutal-input flex-1 text-xs loot-name">
    <input type="number" placeholder="Value" class="brutal-input w-24 text-xs loot-price">
    <button class="brutal-button brutal-button-primary px-2" onclick="removeLootRow(this)"><span class="material-symbols-outlined text-sm">close</span></button>`;
  container.appendChild(div);
}

function removeLootRow(btn) {
  const all = document.querySelectorAll('.loot-row');
  if (all.length > 1) btn.closest('.loot-row').remove();
}

async function addBattle() {
  const bossName = getBossName();
  const time = document.getElementById('bTime').value || new Date().toISOString();
  const attendance = getCheckedValues('bAttendance');
  const auctionPool = Number(document.getElementById('bAuctionPool').value) || 0;

  const drops = [];
  document.querySelectorAll('.loot-row').forEach(row => {
    const name = row.querySelector('.loot-name').value.trim();
    const price = row.querySelector('.loot-price').value;
    if (name) drops.push({ name, price: Number(price) || 0 });
  });

  const totalLoot = drops.length > 0 ? drops.reduce((sum, d) => sum + d.price, 0) : auctionPool;
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(totalLoot / count) : 0;

  try {
    const res = await fetch(`${API_BASE}/battles`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ bossName, time, attendance, drops, auctionPool: totalLoot, revenuePerPerson, status: 'completed' })
    });
    if (res.status === 401) { showToast('請先登入系統', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }

    document.getElementById('bDropsList').innerHTML = `
      <div class="loot-row flex gap-2">
        <input type="text" placeholder="Item Name" class="brutal-input flex-1 text-xs loot-name">
        <input type="number" placeholder="Value" class="brutal-input w-24 text-xs loot-price">
        <button class="brutal-button brutal-button-primary px-2" onclick="removeLootRow(this)"><span class="material-symbols-outlined text-sm">close</span></button>
      </div>`;
    document.getElementById('bAuctionPool').value = '';
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

function renderBattles() {
  const tbody = document.querySelector('#battlesTable tbody');
  if (!tbody) return;
  
  let data = state.battles;
  if (filters.battles) {
    const q = filters.battles;
    data = data.filter(b => 
      (b.bossName || b.boss || '').toLowerCase().includes(q) ||
      (b.time || b.createdAt || '').includes(q)
    );
  }
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-500 font-bold uppercase py-8">查無討伐紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(b => {
    const id = b.ID || b.id;
    const date = new Date(b.time || b.createdAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const boss = b.bossName || b.boss || '';
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
    
    const adminActions = auth.isAdmin ? `
      <button class="action-btn" style="background:#06c755;color:#fff;" onclick="event.stopPropagation(); openBroadcastModal('battle','${id}','${boss.replace(/'/g, "\\'")}')">LINE召</button>
      <button class="action-btn delete ml-2" onclick="event.stopPropagation(); deleteBattle('${id}', '${boss.replace(/'/g, "\\'")}')">DELETE</button>
    ` : '';

    let dropsHtml = '';
    if (drops.length > 0) {
      const dropRows = drops.map(d => `<div class="flex justify-between border-b border-gray-200 py-1"><span>${d.name}</span><span class="font-bold">${Number(d.price).toLocaleString()}</span></div>`).join('');
      dropsHtml = `<div class="flex-1 max-w-sm">
        <label class="block font-black uppercase text-xs mb-2 bg-black text-white inline-block px-2 py-1 border-2 border-black">LOOT_TABLE</label>
        <div class="mt-2 text-xs">${dropRows}</div>
      </div>`;
    }

    return `
      <tr class="hover:bg-[#ffe6e6] transition-colors cursor-pointer" onclick="toggleExpand('b-${id}')">
        <td class="py-3 pl-2 text-gray-600 font-bold uppercase"><span class="expand-icon material-symbols-outlined text-[14px] mr-1" id="icon-b-${id}">expand_more</span>${date}</td>
        <td class="py-3 font-black text-[#111] uppercase">${boss}</td>
        <td class="py-3 text-[#111] font-bold uppercase">${count} PAX</td>
        <td class="py-3 text-[#111] font-bold uppercase">${Number(pool).toLocaleString()}</td>
        <td class="py-3 font-black text-[#ff3333] uppercase">${Number(rev).toLocaleString()}</td>
        <td class="py-3 pr-2 text-right ${auth.isAdmin ? 'admin-col' : 'admin-col hidden'}">
          <div class="flex items-center justify-end gap-2">
            ${adminActions}
          </div>
        </td>
      </tr>
      <tr id="details-b-${id}" class="expandable-details">
        <td colspan="6" class="p-0 border-b-2 border-black bg-gray-50">
          <div class="p-4 flex flex-col md:flex-row gap-6">
             <div class="flex-1">
                <label class="block font-black uppercase text-xs mb-2 bg-[#ffe600] inline-block px-2 py-1 border-2 border-black">PAX_LIST (${count})</label>
                <div class="attendance-grid mt-2 text-xs !bg-transparent !border-none !p-0 !max-h-full" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px;">
                   ${getAttendanceHtml(att)}
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
  const castle = document.getElementById('sCastle').value;
  const reward = Number(document.getElementById('sReward').value) || 0;
  const attendance = getCheckedValues('sAttendance');
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(reward / count) : 0;

  try {
    const res = await fetch(`${API_BASE}/sieges`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ date, castle, reward, attendance, revenuePerPerson })
    });
    if (res.status === 401) { showToast('請先登入系統', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }
    showToast(`${castle} 攻城戰提交！每人分紅 ${revenuePerPerson.toLocaleString()} 天幣`, 'success');
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
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-500 font-bold uppercase py-8">查無攻城戰紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(s => {
    const id = s.ID || s.id;
    const castle = s.castle || '';
    const date = new Date(s.date || s.createdAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
    const count = att.length;
    const rev = s.revenuePerPerson || (count > 0 ? Math.floor(Number(s.reward || 0) / count) : 0);
    
    const adminActions = auth.isAdmin ? `
      <button class="action-btn" style="background:#06c755;color:#fff;" onclick="event.stopPropagation(); openBroadcastModal('siege','${id}','${castle.replace(/'/g, "\\'")}')">LINE召</button>
      <button class="action-btn delete ml-2" onclick="event.stopPropagation(); deleteSiege('${id}', '${castle.replace(/'/g, "\\'")}')">DELETE</button>
    ` : '';

    return `
      <tr class="hover:bg-[#ffe6e6] transition-colors cursor-pointer" onclick="toggleExpand('s-${id}')">
        <td class="py-3 pl-2 text-gray-600 font-bold uppercase"><span class="expand-icon material-symbols-outlined text-[14px] mr-1" id="icon-s-${id}">expand_more</span>${date}</td>
        <td class="py-3 font-black text-[#111] uppercase">${castle}</td>
        <td class="py-3 text-[#111] font-bold uppercase">${count} PAX</td>
        <td class="py-3 text-[#111] font-bold uppercase">${Number(s.reward || 0).toLocaleString()}</td>
        <td class="py-3 font-black text-[#ff3333] uppercase">${Number(rev).toLocaleString()}</td>
        <td class="py-3 pr-2 text-right ${auth.isAdmin ? 'admin-col' : 'admin-col hidden'}">
          <div class="flex items-center justify-end gap-2">
            ${adminActions}
          </div>
        </td>
      </tr>
      <tr id="details-s-${id}" class="expandable-details">
        <td colspan="6" class="p-0 border-b-2 border-black bg-gray-50">
          <div class="p-4 flex flex-col md:flex-row gap-6">
             <div class="flex-1">
                <label class="block font-black uppercase text-xs mb-2 bg-[#ffe600] inline-block px-2 py-1 border-2 border-black">PAX_LIST (${count})</label>
                <div class="attendance-grid mt-2 text-xs !bg-transparent !border-none !p-0 !max-h-full" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px;">
                   ${getAttendanceHtml(att)}
                </div>
             </div>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ── Alliances ─────────────────────────────────────
async function addAlliance() {
  const name = document.getElementById('aName').value.trim();
  const job = document.getElementById('aJob').value;
  const notes = document.getElementById('aNotes').value.trim();
  if (!name || !job) { showToast('請填寫完整資訊', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/alliances`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes })
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
  document.getElementById('editAllianceJob').value = a.job || '王族';
  document.getElementById('editAllianceNotes').value = a.notes || '';
  document.getElementById('editAllianceModal').classList.remove('hidden');
}

function closeEditAllianceModal(e) {
  if (e && e.target !== document.getElementById('editAllianceModal')) return;
  document.getElementById('editAllianceModal').classList.add('hidden');
}

async function updateAlliance() {
  const id = document.getElementById('editAllianceId').value;
  const name = document.getElementById('editAllianceName').value.trim();
  const job = document.getElementById('editAllianceJob').value;
  const notes = document.getElementById('editAllianceNotes').value.trim();
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/alliances/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes })
    });
    if (!res.ok) { showToast('修改失敗（權限不足）', 'error'); return; }
    document.getElementById('editAllianceModal').classList.add('hidden');
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
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-gray-500 font-bold uppercase py-8">查無聯盟成員</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(a => {
    const id = a.ID || a.id;
    const name = a.name || a.Name || '';
    const adminActions = auth.isAdmin
      ? `<td class="py-3 pr-2 text-right admin-col">
          <div class="flex items-center justify-end gap-2">
            <button class="action-btn edit" onclick="openEditAllianceModal('${id}')">MUTATE</button>
            <button class="action-btn delete" onclick="deleteAlliance('${id}', '${name.replace(/'/g, "\\'")}')">DELETE</button>
          </div>
         </td>`
      : '<td class="py-3 pr-2 text-right admin-col hidden"></td>';
    return `
      <tr class="hover:bg-[#ffe6e6] transition-colors">
        <td class="py-3 pl-2 font-black text-[#111] uppercase">${name}</td>
        <td class="py-3 text-[#111] font-bold uppercase">${a.job || ''}</td>
        <td class="py-3 notes-cell text-gray-600 font-bold uppercase">${a.notes || '<span class="opacity-40">—</span>'}</td>
        ${adminActions}
      </tr>`;
  }).join('');
}

// ── Treasury (結算中心) ───────────────────────────
function renderTreasury() {
  const tbody = document.querySelector('#treasuryTable tbody');
  if (!tbody) return;
  
  if (state.members.length === 0 && state.alliances.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 font-bold uppercase py-8">尚無人員紀錄，無法結算</td></tr>';
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

  // Generate HTML
  const rows = Object.values(treasuryMap)
    // Sort by Total Revenue (descending)
    .sort((a, b) => (b.battleRev + b.siegeRev) - (a.battleRev + a.siegeRev))
    .map(t => {
      const totalRev = t.battleRev + t.siegeRev;
      const typeBadge = t.type === 'alliance' 
        ? '<span class="bg-[#4285F4] text-white text-[10px] px-1.5 py-0.5 rounded-sm font-bold uppercase ml-2">聯盟</span>'
        : '';
      
      return `
        <tr class="hover:bg-[#ffe6e6] transition-colors border-b border-[#111]/10 last:border-0">
          <td class="py-3 pl-2 font-black text-[#111] uppercase flex items-center">${t.name} ${typeBadge}</td>
          <td class="py-3 text-center text-[#111] font-bold uppercase">${t.attendanceCount}</td>
          <td class="py-3 text-right text-[#111] font-bold uppercase">${t.battleRev.toLocaleString()}</td>
          <td class="py-3 text-right text-[#111] font-bold uppercase">${t.siegeRev.toLocaleString()}</td>
          <td class="py-3 pr-2 text-right font-black text-[#ffe600] uppercase bg-[#111] border-l-4 border-l-black">${totalRev.toLocaleString()}</td>
        </tr>`;
    });

  tbody.innerHTML = rows.join('');
}

// ── Charts ────────────────────────────────────────
function renderCharts() {
  if (!window.Chart) return;
  Chart.defaults.color = '#111';
  Chart.defaults.font.family = "'Space Grotesk', sans-serif";
  Chart.defaults.font.weight = 'bold';

  // 1. Class Distribution Chart (Members)
  const ctxClass = document.getElementById('classChart');
  if (ctxClass) {
    if (classChartInstance) classChartInstance.destroy();
    
    const classCounts = {};
    state.members.forEach(m => {
      const job = m.job || '未知';
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
          backgroundColor: ['#ff3333', '#ffe600', '#4285F4', '#34A853', '#fb8c00', '#8e24aa', '#111'],
          borderWidth: 2,
          borderColor: '#111'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111',
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 14, weight: 'bold' },
            padding: 10,
            cornerRadius: 0,
            displayColors: true
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
      .slice(0, 10); // Top 10

    treasuryChartInstance = new Chart(ctxTreasury, {
      type: 'bar',
      data: {
        labels: topEarners.map(t => t.name),
        datasets: [{
          label: 'Total Dividend',
          data: topEarners.map(t => t.total),
          backgroundColor: '#ffe600',
          borderColor: '#111',
          borderWidth: 4,
          hoverBackgroundColor: '#ff3333'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.1)', tickLength: 0 },
            border: { dash: [4, 4], color: '#111', width: 2 },
            ticks: { font: { size: 10, weight: 'bold' } }
          },
          x: {
            grid: { display: false },
            border: { color: '#111', width: 4 },
            ticks: { font: { size: 10, weight: 'bold' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111',
            titleColor: '#ffe600',
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 14, weight: 'bold' },
            padding: 10,
            cornerRadius: 0
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
    ...data.map(row => row.map(cell => \`"\${String(cell).replace(/"/g, '""')}"\`).join(','))
  ].join('\\n');

  // Trigger download
  const blob = new Blob(['\\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
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
  modal.classList.remove('hidden');
}

function closeBroadcastModal(e) {
  const modal = document.getElementById('lineBroadcastModal');
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
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
    previewText.textContent = '▶ 廣播路線：全部關注者（不限綁定狀態）';
  } else if (mode === 'bound') {
    const allPeople = [...state.members, ...state.alliances];
    const count = allPeople.filter(p => p.lineUserId).length;
    preview.classList.remove('hidden');
    previewText.textContent = `▶ 將發送給 ${count} 位已綁定成員`;
  } else if (mode === 'tier') {
    const selectedTiers = Array.from(document.querySelectorAll('#tierCheckboxes input:checked')).map(c => c.value);
    const count = state.members.filter(m => m.lineUserId && selectedTiers.includes(m.tier || '一般')).length;
    preview.classList.remove('hidden');
    previewText.textContent = `▶ 分級 [${selectedTiers.join(' / ')}] 將發送給 ${count} 位成員`;
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
  btn.textContent = '推播中...';
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
      result.className = 'text-[#34A853] font-black text-sm mt-2 uppercase';
      result.textContent = `✅ 推播成功！${methodLabel}`;
      showToast('LINE 召集令已發出！', 'success');
      logToTerminal(`LINE BROADCAST [${mode.toUpperCase()}]: ${_broadcastTarget.name} → ${methodLabel}`);
    } else {
      result.className = 'text-[#ff3333] font-black text-sm mt-2 uppercase';
      result.textContent = `❌ ${data.error || '推播失敗'}`;
    }
  } catch (e) {
    result.className = 'text-[#ff3333] font-black text-sm mt-2 uppercase';
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
    ? state.members.find(m => (m.ID || m.id) === id)
    : state.alliances.find(a => (a.ID || a.id) === id);
  _bindTarget = { collection, id, name };
  const modal = document.getElementById('lineBindModal');
  document.getElementById('bindMemberName').textContent = name;
  document.getElementById('bindLineUserId').value = person?.lineUserId || '';
  document.getElementById('bindResult').textContent = '';
  modal.classList.remove('hidden');
}

function closeLineBindModal(e) {
  const modal = document.getElementById('lineBindModal');
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
}

async function saveLineBinding() {
  if (!_bindTarget) return;
  const lineUserId = document.getElementById('bindLineUserId').value.trim();
  const result = document.getElementById('bindResult');

  if (!lineUserId) {
    // Unbind
    if (!confirm(`確定解除 ${_bindTarget.name} 的 LINE 綁定？`)) return;
    try {
      const res = await fetch(`${API_BASE}/${_bindTarget.collection === 'members' ? 'members' : 'alliances'}/${_bindTarget.id}/line-bind`, {
        method: 'DELETE', headers: authHeaders()
      });
      if (res.ok) {
        showToast(`${_bindTarget.name} LINE 綁定已解除`, 'success');
        document.getElementById('lineBindModal').classList.add('hidden');
        await fetchData();
      }
    } catch (e) { showToast('解除失敗', 'error'); }
    return;
  }

  try {
    const endpoint = _bindTarget.collection === 'members' ? 'members' : 'alliances';
    const res = await fetch(`${API_BASE}/${endpoint}/${_bindTarget.id}/line-bind`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ lineUserId })
    });
    if (res.ok) {
      result.className = 'text-[#34A853] font-black text-sm mt-2';
      result.textContent = '✅ 綁定成功！';
      showToast(`${_bindTarget.name} LINE 綁定完成`, 'success');
      await fetchData();
    } else {
      result.className = 'text-[#ff3333] font-black text-sm mt-2';
      result.textContent = '❌ 綁定失敗，請確認權限';
    }
  } catch (e) {
    result.className = 'text-[#ff3333] font-black text-sm mt-2';
    result.textContent = '❌ 網路錯誤';
  }
}

// ── Start ─────────────────────────────────────────────
init();
