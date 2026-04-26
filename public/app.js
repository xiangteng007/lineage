const API_BASE = '/api';

// State
let state = {
  members: [],
  battles: [],
  sieges: [],
  alliances: []
};

// Initialization
async function init() {
  await fetchData();
}

// Navigation
function switchSection(sectionId) {
  // Update buttons
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  // Update sections
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
}

// Toast
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.className = 'show';
  setTimeout(() => { t.className = t.className.replace('show', ''); }, 3000);
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
  } catch (err) {
    console.error('Fetch error:', err);
    showToast('無法連線至伺服器讀取資料');
  }
}

// Render Checkboxes
function renderCheckboxes() {
  const membersHtml = state.members.map(m => `
    <label class="checkbox-item">
      <input type="checkbox" value="${m.ID || m.id}"> ${m.name || m.Name}
    </label>
  `).join('');
  
  const bAtt = document.getElementById('bAttendance');
  if(bAtt) bAtt.innerHTML = membersHtml;
  
  const sAtt = document.getElementById('sAttendance');
  if(sAtt) sAtt.innerHTML = membersHtml;
}

function getCheckedValues(containerId) {
  const container = document.getElementById(containerId);
  if(!container) return [];
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function getMemberName(id) {
  const m = state.members.find(x => x.ID === id || x.id === id);
  return m ? (m.name || m.Name) : id;
}

// Members
async function addMember() {
  const name = document.getElementById('mName').value.trim();
  const job = document.getElementById('mJob').value;
  const level = document.getElementById('mLevel').value;

  if (!name || !job) {
    showToast('請填寫完整資訊');
    return;
  }

  try {
    await fetch(`${API_BASE}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, job, level })
    });
    
    document.getElementById('mName').value = '';
    document.getElementById('mLevel').value = '';
    showToast('新增成員成功');
    await fetchData();
  } catch (e) {
    showToast('新增失敗');
  }
}

async function deleteMember(id) {
  if(!confirm('確定刪除？')) return;
  await fetch(`${API_BASE}/members/${id}`, { method: 'DELETE' });
  showToast('刪除成功');
  await fetchData();
}

function renderMembers() {
  const tbody = document.querySelector('#membersTable tbody');
  if(!tbody) return;
  tbody.innerHTML = state.members.map(m => `
    <tr>
      <td>${m.name || m.Name || ''}</td>
      <td>${m.job || ''}</td>
      <td>Lv.${m.level || ''}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteMember('${m.ID || m.id}')">刪除</button>
      </td>
    </tr>
  `).join('');
}

// Battles
function addLootRow() {
  const container = document.getElementById('bDropsList');
  const div = document.createElement('div');
  div.className = 'loot-item';
  div.innerHTML = `
    <input type="text" placeholder="物品名稱" class="loot-name">
    <input type="number" placeholder="拍出金額" class="loot-price">
  `;
  container.appendChild(div);
}

async function addBattle() {
  const bossName = document.getElementById('bBossName').value;
  const time = document.getElementById('bTime').value || new Date().toISOString();
  const attendance = getCheckedValues('bAttendance');
  const auctionPool = document.getElementById('bAuctionPool').value || 0;
  
  const drops = [];
  document.querySelectorAll('.loot-item').forEach(item => {
    const name = item.querySelector('.loot-name').value;
    const price = item.querySelector('.loot-price').value;
    if (name) {
      drops.push({ name, price: Number(price) || 0 });
    }
  });

  const participantCount = attendance.length;
  const totalLoot = drops.length > 0 ? drops.reduce((sum, d) => sum + d.price, 0) : Number(auctionPool);
  const revenuePerPerson = participantCount > 0 ? Math.floor(totalLoot / participantCount) : 0;

  try {
    await fetch(`${API_BASE}/battles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bossName, time, attendance, drops, auctionPool: totalLoot, revenuePerPerson, status: 'completed' })
    });
    
    showToast('首領戰紀錄提交成功');
    // reset form partially
    document.getElementById('bDropsList').innerHTML = `
      <div class="loot-item">
        <input type="text" placeholder="物品名稱" class="loot-name">
        <input type="number" placeholder="拍出金額" class="loot-price">
      </div>
    `;
    await fetchData();
  } catch (e) {
    showToast('新增失敗');
  }
}

function renderBattles() {
  const tbody = document.querySelector('#battlesTable tbody');
  if(!tbody) return;
  tbody.innerHTML = state.battles.map(b => {
    const date = new Date(b.time || b.createdAt).toLocaleString();
    let att = [];
    try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch(e){}
    const count = att.length;
    let pool = b.auctionPool || 0;
    if(!pool) {
      try {
        const drops = typeof b.drops === 'string' ? JSON.parse(b.drops) : (b.drops || []);
        pool = drops.reduce((sum, d) => sum + (Number(d.price)||0), 0);
      } catch(e) {}
    }
    const rev = b.revenuePerPerson || (count > 0 ? Math.floor(pool / count) : 0);
    
    return `
      <tr>
        <td>${date}</td>
        <td>${b.bossName || b.boss || ''}</td>
        <td>${count} 人</td>
        <td>${pool}</td>
        <td style="color:var(--success); font-weight:bold;">${rev}</td>
      </tr>
    `;
  }).join('');
}

// Sieges
async function addSiege() {
  const date = document.getElementById('sDate').value || new Date().toISOString();
  const castle = document.getElementById('sCastle').value;
  const reward = document.getElementById('sReward').value || 0;
  const attendance = getCheckedValues('sAttendance');
  
  const count = attendance.length;
  const revenuePerPerson = count > 0 ? Math.floor(Number(reward) / count) : 0;

  try {
    await fetch(`${API_BASE}/sieges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, castle, reward, attendance, revenuePerPerson })
    });
    showToast('攻城戰紀錄提交成功');
    await fetchData();
  } catch(e) {
    showToast('新增失敗');
  }
}

function renderSieges() {
  const tbody = document.querySelector('#siegesTable tbody');
  if(!tbody) return;
  tbody.innerHTML = state.sieges.map(s => {
    const date = new Date(s.date || s.createdAt).toLocaleString();
    let att = [];
    try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch(e){}
    const count = att.length;
    const rev = s.revenuePerPerson || (count > 0 ? Math.floor(Number(s.reward||0)/count) : 0);
    
    return `
      <tr>
        <td>${date}</td>
        <td>${s.castle || s.targetName || ''}</td>
        <td>${count} 人</td>
        <td>${s.reward || s.totalBonus || 0}</td>
        <td style="color:var(--success); font-weight:bold;">${rev}</td>
      </tr>
    `;
  }).join('');
}

// Alliances
async function addAlliance() {
  const name = document.getElementById('aName').value.trim();
  const job = document.getElementById('aJob').value;
  if (!name || !job) {
    showToast('請填寫完整資訊');
    return;
  }
  try {
    await fetch(`${API_BASE}/alliances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, job, level: '' })
    });
    document.getElementById('aName').value = '';
    showToast('新增聯盟成員成功');
    await fetchData();
  } catch (e) {
    showToast('新增失敗');
  }
}

async function deleteAlliance(id) {
  if(!confirm('確定刪除？')) return;
  await fetch(`${API_BASE}/alliances/${id}`, { method: 'DELETE' });
  showToast('刪除成功');
  await fetchData();
}

function renderAlliances() {
  const tbody = document.querySelector('#alliancesTable tbody');
  if(!tbody) return;
  tbody.innerHTML = state.alliances.map(a => `
    <tr>
      <td>${a.name || a.Name || ''}</td>
      <td>${a.job || ''}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteAlliance('${a.ID || a.id}')">刪除</button>
      </td>
    </tr>
  `).join('');
}

// Start
init();
