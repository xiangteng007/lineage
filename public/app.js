const API_BASE = '/api';

// State
let state = { members: [], battles: [], sieges: [], alliances: [] };

// Init
async function init() {
  await fetchData();
  updateMemberCountBadge();
}

// Navigation
function switchSection(sectionId) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const clickedBtn = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
  if (clickedBtn) clickedBtn.classList.add('active');
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
}

// Toast
function showToast(msg, type = 'default') {
  const t = document.getElementById('toast');
  t.textContent = (type === 'success' ? '✅ ' : type === 'error' ? '❌ ' : '💬 ') + msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Member count badge
function updateMemberCountBadge() {
  const badge = document.getElementById('memberCountBadge');
  if (badge) badge.textContent = `⚔️ 共 ${state.members.length} 名血盟兄弟`;
}

// Data Fetching
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

// Render Checkboxes for attendance
function renderCheckboxes() {
  const membersHtml = state.members.length > 0
    ? state.members.map(m => `
        <label>
          <input type="checkbox" value="${m.ID || m.id}">
          ${m.name || m.Name || '未知'} (${m.job || ''})
        </label>
      `).join('')
    : '<span style="color:var(--text-dim);font-size:13px;padding:8px;">尚無成員，請先新增血盟成員</span>';

  const bAtt = document.getElementById('bAttendance');
  if (bAtt) bAtt.innerHTML = membersHtml;
  const sAtt = document.getElementById('sAttendance');
  if (sAtt) sAtt.innerHTML = membersHtml;
}

function getCheckedValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ── Members ──
async function addMember() {
  const name = document.getElementById('mName').value.trim();
  const job = document.getElementById('mJob').value;
  const level = document.getElementById('mLevel').value;
  if (!name || !job) { showToast('請填寫角色名稱與職業', 'error'); return; }
  try {
    await fetch(`${API_BASE}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, job, level })
    });
    document.getElementById('mName').value = '';
    document.getElementById('mLevel').value = '';
    document.getElementById('mJob').value = '';
    showToast(`${name} 已加入血盟！`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteMember(id) {
  if (!confirm('確定從血盟移除此成員？')) return;
  await fetch(`${API_BASE}/members/${id}`, { method: 'DELETE' });
  showToast('成員已移除', 'success');
  await fetchData();
}

function renderMembers() {
  const tbody = document.querySelector('#membersTable tbody');
  if (!tbody) return;
  if (state.members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:32px;">尚無成員紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = state.members.map(m => `
    <tr>
      <td><strong>${m.name || m.Name || ''}</strong></td>
      <td>${m.job || ''}</td>
      <td>Lv. ${m.level || '-'}</td>
      <td><button class="btn btn-danger" onclick="deleteMember('${m.ID || m.id}')">移除</button></td>
    </tr>
  `).join('');
}

// ── Battles ──
function addLootRow() {
  const container = document.getElementById('bDropsList');
  const div = document.createElement('div');
  div.className = 'loot-row';
  div.innerHTML = `
    <input type="text" placeholder="物品名稱" class="loot-name">
    <input type="number" placeholder="拍出天幣" class="loot-price">
    <button class="btn-icon" onclick="removeLootRow(this)">✕</button>
  `;
  container.appendChild(div);
}

function removeLootRow(btn) {
  const row = btn.closest('.loot-row');
  if (document.querySelectorAll('.loot-row').length > 1) row.remove();
}

async function addBattle() {
  const bossName = document.getElementById('bBossName').value;
  const time = document.getElementById('bTime').value || new Date().toISOString();
  const attendance = getCheckedValues('bAttendance');
  const auctionPool = Number(document.getElementById('bAuctionPool').value) || 0;

  const drops = [];
  document.querySelectorAll('.loot-row').forEach(row => {
    const name = row.querySelector('.loot-name').value;
    const price = row.querySelector('.loot-price').value;
    if (name) drops.push({ name, price: Number(price) || 0 });
  });

  const totalLoot = drops.length > 0 ? drops.reduce((sum, d) => sum + d.price, 0) : auctionPool;
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(totalLoot / count) : 0;

  try {
    await fetch(`${API_BASE}/battles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bossName, time, attendance, drops, auctionPool: totalLoot, revenuePerPerson, status: 'completed' })
    });
    document.getElementById('bDropsList').innerHTML = `
      <div class="loot-row">
        <input type="text" placeholder="物品名稱" class="loot-name">
        <input type="number" placeholder="拍出天幣" class="loot-price">
        <button class="btn-icon" onclick="removeLootRow(this)">✕</button>
      </div>`;
    document.getElementById('bAuctionPool').value = '';
    showToast(`${bossName} 討伐紀錄已提交！每人分紅 ${revenuePerPerson} 天幣`, 'success');
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
        <td>${pool.toLocaleString()} 天幣</td>
        <td style="color:var(--gold-light);font-weight:700;">${rev.toLocaleString()} 天幣</td>
      </tr>`;
  }).join('');
}

// ── Sieges ──
async function addSiege() {
  const date = document.getElementById('sDate').value || new Date().toISOString();
  const castle = document.getElementById('sCastle').value;
  const reward = Number(document.getElementById('sReward').value) || 0;
  const attendance = getCheckedValues('sAttendance');
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(reward / count) : 0;
  try {
    await fetch(`${API_BASE}/sieges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, castle, reward, attendance, revenuePerPerson })
    });
    showToast(`${castle} 攻城戰紀錄已提交！每人分紅 ${revenuePerPerson} 天幣`, 'success');
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
        <td style="color:var(--gold-light);font-weight:700;">${rev.toLocaleString()} 天幣</td>
      </tr>`;
  }).join('');
}

// ── Alliances ──
async function addAlliance() {
  const name = document.getElementById('aName').value.trim();
  const job = document.getElementById('aJob').value;
  if (!name || !job) { showToast('請填寫完整資訊', 'error'); return; }
  try {
    await fetch(`${API_BASE}/alliances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, job })
    });
    document.getElementById('aName').value = '';
    showToast(`${name} 已加入聯盟！`, 'success');
    await fetchData();
  } catch (e) { showToast('新增失敗', 'error'); }
}

async function deleteAlliance(id) {
  if (!confirm('確定移除此聯盟成員？')) return;
  await fetch(`${API_BASE}/alliances/${id}`, { method: 'DELETE' });
  showToast('已移除', 'success');
  await fetchData();
}

function renderAlliances() {
  const tbody = document.querySelector('#alliancesTable tbody');
  if (!tbody) return;
  if (state.alliances.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:32px;">尚無聯盟成員</td></tr>';
    return;
  }
  tbody.innerHTML = state.alliances.map(a => `
    <tr>
      <td><strong>${a.name || a.Name || ''}</strong></td>
      <td>${a.job || ''}</td>
      <td><button class="btn btn-danger" onclick="deleteAlliance('${a.ID || a.id}')">移除</button></td>
    </tr>
  `).join('');
}

// Start
init();
