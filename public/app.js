/* ══════════════════════════════════════════════════
   天堂：經典版 管理系統 — app.js
   Firebase + Google OAuth Admin Auth
══════════════════════════════════════════════════ */

const API_BASE = '/api';

// ── State ────────────────────────────────────────
let state = { members: [], battles: [], sieges: [], alliances: [] };
let auth = { isLoggedIn: false, isAdmin: false, user: null, token: null };

// ── Init ─────────────────────────────────────────
async function init() {
  // Restore session from localStorage
  const savedToken = localStorage.getItem('gToken');
  const savedUser = localStorage.getItem('gUser');
  if (savedToken && savedUser) {
    try {
      const user = JSON.parse(savedUser);
      // Re-verify token silently
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
      showToast(`${data.email} 非授權管理員帳號`, 'error');
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

  if (auth.isLoggedIn && auth.user) {
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
    loginBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
  }

  // Show/hide admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !auth.isAdmin);
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

// ── Toast ─────────────────────────────────────────
function showToast(msg, type = 'default') {
  const t = document.getElementById('toast');
  const icons = { success: '✅', error: '❌', default: '💬' };
  t.textContent = `${icons[type] || '💬'} ${msg}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
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
    renderCheckboxes();
    updateMemberCountBadge();
  } catch (err) {
    console.error('Fetch error:', err);
    showToast('無法連線至伺服器', 'error');
  }
}

function updateMemberCountBadge() {
  const badge = document.getElementById('memberCountBadge');
  if (badge) badge.textContent = `⚔️ 共 ${state.members.length} 名血盟兄弟`;
}

// ── Checkboxes ────────────────────────────────────
function renderCheckboxes() {
  const html = state.members.length > 0
    ? state.members.map(m => `
        <label>
          <input type="checkbox" value="${m.ID || m.id}">
          ${m.name || m.Name || '未知'} <span style="opacity:.5;font-size:12px;">(${m.job || ''})</span>
        </label>`).join('')
    : '<span style="color:var(--text-dim);font-size:12px;">尚無成員，請先新增血盟成員</span>';

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
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/members/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name, job, notes })
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
  if (state.members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:32px;">尚無成員紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = state.members.map(m => {
    const id = m.ID || m.id;
    const name = m.name || m.Name || '';
    const adminActions = auth.isAdmin ? `
      <td class="admin-col">
        <div class="table-actions">
          <button class="btn-edit-sm" onclick="openEditModal('${id}')">✏️ 編輯</button>
          <button class="btn-danger-sm" onclick="deleteMember('${id}', '${name.replace(/'/g, "\\'")}')">🗑️ 刪除</button>
        </div>
      </td>` : '<td class="admin-col hidden"></td>';
    return `
      <tr>
        <td><strong>${name}</strong></td>
        <td>${m.job || ''}</td>
        <td class="notes-cell">${m.notes || '<span style="opacity:.4;">—</span>'}</td>
        ${adminActions}
      </tr>`;
  }).join('');
}

// ── Battles ───────────────────────────────────────
function addLootRow() {
  const container = document.getElementById('bDropsList');
  const div = document.createElement('div');
  div.className = 'loot-row';
  div.innerHTML = `
    <input type="text" placeholder="物品名稱" class="loot-name">
    <input type="number" placeholder="拍出天幣" class="loot-price">
    <button class="btn-icon" onclick="removeLootRow(this)">✕</button>`;
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
    if (res.status === 401) { showToast('請先登入管理員帳號', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }

    document.getElementById('bDropsList').innerHTML = `
      <div class="loot-row">
        <input type="text" placeholder="物品名稱" class="loot-name">
        <input type="number" placeholder="拍出天幣" class="loot-price">
        <button class="btn-icon" onclick="removeLootRow(this)">✕</button>
      </div>`;
    document.getElementById('bAuctionPool').value = '';
    document.querySelectorAll('#bAttendance input[type="checkbox"]').forEach(cb => cb.checked = false);
    showToast(`${bossName} 討伐紀錄提交！每人分紅 ${revenuePerPerson.toLocaleString()} 天幣`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

function renderBattles() {
  const tbody = document.querySelector('#battlesTable tbody');
  if (!tbody) return;
  if (state.battles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:32px;">尚無討伐紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = state.battles.map(b => {
    const date = new Date(b.time || b.createdAt).toLocaleString('zh-TW');
    let att = [];
    try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
    const count = att.length;
    let pool = b.auctionPool || 0;
    if (!pool) {
      try {
        const drops = typeof b.drops === 'string' ? JSON.parse(b.drops) : (b.drops || []);
        pool = drops.reduce((sum, d) => sum + (Number(d.price) || 0), 0);
      } catch (e) {}
    }
    const rev = b.revenuePerPerson || (count > 0 ? Math.floor(pool / count) : 0);
    return `
      <tr>
        <td>${date}</td>
        <td><strong>${b.bossName || b.boss || ''}</strong></td>
        <td>${count} 人</td>
        <td>${Number(pool).toLocaleString()} 天幣</td>
        <td style="color:var(--gold-light);font-weight:700;">${Number(rev).toLocaleString()} 天幣</td>
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
    if (res.status === 401) { showToast('請先登入管理員帳號', 'error'); openLoginModal(); return; }
    if (!res.ok) { showToast('提交失敗（權限不足）', 'error'); return; }
    showToast(`${castle} 攻城戰提交！每人分紅 ${revenuePerPerson.toLocaleString()} 天幣`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

function renderSieges() {
  const tbody = document.querySelector('#siegesTable tbody');
  if (!tbody) return;
  if (state.sieges.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:32px;">尚無攻城戰紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = state.sieges.map(s => {
    const date = new Date(s.date || s.createdAt).toLocaleString('zh-TW');
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
    const count = att.length;
    const rev = s.revenuePerPerson || (count > 0 ? Math.floor(Number(s.reward || 0) / count) : 0);
    return `
      <tr>
        <td>${date}</td>
        <td><strong>${s.castle || ''}</strong></td>
        <td>${count} 人</td>
        <td>${Number(s.reward || 0).toLocaleString()} 天幣</td>
        <td style="color:var(--gold-light);font-weight:700;">${Number(rev).toLocaleString()} 天幣</td>
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

function renderAlliances() {
  const tbody = document.querySelector('#alliancesTable tbody');
  if (!tbody) return;
  if (state.alliances.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:32px;">尚無聯盟成員</td></tr>';
    return;
  }
  tbody.innerHTML = state.alliances.map(a => {
    const id = a.ID || a.id;
    const name = a.name || a.Name || '';
    const adminActions = auth.isAdmin
      ? `<td class="admin-col"><button class="btn-danger-sm" onclick="deleteAlliance('${id}', '${name.replace(/'/g, "\\'")}')">🗑️ 移除</button></td>`
      : '<td class="admin-col hidden"></td>';
    return `
      <tr>
        <td><strong>${name}</strong></td>
        <td>${a.job || ''}</td>
        <td class="notes-cell">${a.notes || '<span style="opacity:.4;">—</span>'}</td>
        ${adminActions}
      </tr>`;
  }).join('');
}

// ── Expose Google login handler globally ──────────
window.handleGoogleLogin = handleGoogleLogin;

// ── Start ─────────────────────────────────────────
init();
