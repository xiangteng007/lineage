require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const line = require('@line/bot-sdk');
const firebase = require('./firebase');
const agg = require('./lib/aggregations');
const httpx = require('./lib/http');
const { logActivity } = require('./lib/activity');
const permissions = require('./lib/permissions');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET'
};

function getLineClient() {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken });
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// ── LINE Bot Webhook ────────────────────────────
app.post('/api/webhook', line.middleware(lineConfig), (req, res) => {
  Promise
    .all(req.body.events.map(handleLineEvent))
    .then((result) => res.json(result))
    .catch((err) => { console.error('LINE Bot Error:', err); res.status(500).end(); });
});

async function sendLineReply(replyToken, text) {
  try {
    return await getLineClient().replyMessage({ replyToken, messages: [{ type: 'text', text }] });
  } catch (err) {
    console.error('LINE reply error:', err.message);
  }
}

async function handlePostbackEvent(event) {
  const params = new URLSearchParams(event.postback.data);
  const action = params.get('action');
  const lineUserId = event.source.userId;

  if (action === 'attend') {
    const type = params.get('type');
    const recordId = params.get('id');
    const collection = type === 'siege' ? 'Sieges' : 'Battles';

    const [members, alliances] = await Promise.all([
      firebase.getAllData('Members'),
      firebase.getAllData('Alliances')
    ]);
    const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);

    if (!person) {
      return sendLineReply(event.replyToken, '❌ 您尚未綁定血盟帳號！\n\n請傳送「綁定」取得您的 LINE ID，並通知管理員協助設定。');
    }

    const record = await firebase.getDocument(collection, recordId);
    if (!record) {
      return sendLineReply(event.replyToken, '❌ 找不到對應的戰役紀錄，可能已被移除。');
    }

    let attendance = [];
    try { attendance = typeof record.attendance === 'string' ? JSON.parse(record.attendance) : (record.attendance || []); } catch (e) {}

    const memberId = person.ID || person.id;
    const memberName = person.name || person.Name || '未知';

    if (attendance.includes(memberId)) {
      return sendLineReply(event.replyToken, `✅ ${memberName}，您已在出席名單中，無需重複確認！`);
    }

    attendance.push(memberId);
    await firebase.updateData(collection, recordId, { attendance: JSON.stringify(attendance) });
    return sendLineReply(event.replyToken, `✅ ${memberName} 出席確認成功！\n系統已記錄您的參與，戰況順利！⚔️`);
  }

  return Promise.resolve(null);
}

async function handleLineEvent(event) {
  if (event.type === 'follow') {
    return sendLineReply(event.replyToken, '🛡️ 歡迎加入血盟通知系統！\n\n可用指令：\n・名單 → 查詢血盟成員\n・拍賣 → 最新首領戰分紅\n・金庫 → 公積金與本月收支\n・出席排行 → 出席排行榜\n・攻城報名 → 近期攻城戰\n・綁定 → 取得您的 LINE ID\n・我的資料 / 我的記錄 → 個人統計\n・更新等級 85 → 自助更新等級\n・網頁 → 開啟管理系統');
  }

  if (event.type === 'postback') return handlePostbackEvent(event);
  if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);

  const text = event.message.text.trim();
  const lineUserId = event.source.userId;
  let replyText = '指令無法辨識。\n\n可用指令：\n・名單 / 拍賣 / 網頁\n・綁定 / 我的資料 / 我的記錄\n・金庫 / 出席排行 / 攻城報名\n・更新等級 85';

  if (text === '名單') {
    const members = await firebase.getAllData('Members');
    const count = members.length;
    const TIER_ICON = { '核心': '⭐', '一般': '○', '試煉': '△', '外交': '◇' };
    // Group by job for nicer display
    const JOB_ORDER = ['王族', '騎士', '妖精', '法師', '黑妖'];
    const grouped = {};
    members.forEach(m => {
      const job = m.job || '其他';
      if (!grouped[job]) grouped[job] = [];
      grouped[job].push(m);
    });
    replyText = `🛡️ 血盟目前有 ${count} 名成員\n`;
    let shown = 0;
    for (const job of JOB_ORDER) {
      const group = grouped[job];
      if (!group || !group.length) continue;
      replyText += `\n【${job}】\n`;
      group.sort((a, b) => (b.level || 0) - (a.level || 0)).slice(0, 8).forEach(m => {
        if (shown >= 15) return;
        const icon = TIER_ICON[m.tier] || '○';
        const lv = m.level ? ` Lv${m.level}` : '';
        replyText += `${icon} ${m.name}${lv}\n`;
        shown++;
      });
    }
    if (count > shown) replyText += `\n...以及其他 ${count - shown} 名成員。`;

  } else if (text === '拍賣') {
    const battles = await firebase.getAllData('Battles');
    const lastBattle = battles.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt))[0];
    if (lastBattle) {
      let totalLoot = 0;
      try {
        const drops = typeof lastBattle.drops === 'string' ? JSON.parse(lastBattle.drops) : (lastBattle.drops || []);
        totalLoot = drops.reduce((sum, l) => sum + (Number(l.price) || 0), 0);
      } catch (e) { totalLoot = Number(lastBattle.auctionPool) || 0; }
      let participantCount = 0;
      try {
        const att = typeof lastBattle.attendance === 'string' ? JSON.parse(lastBattle.attendance) : (lastBattle.attendance || []);
        participantCount = att.length;
      } catch (e) {}
      const bonus = participantCount > 0 ? Math.floor(totalLoot / participantCount) : 0;
      replyText = `💰 最新首領戰 [${lastBattle.bossName || '未知'}]\n總拍賣金：${totalLoot} 天幣\n參與人數：${participantCount} 人\n每人分紅：${bonus} 天幣`;
    } else { replyText = '目前沒有首領戰紀錄。'; }

  } else if (text === '網頁') {
    replyText = '請點擊選單開啟「天堂精典管理系統」LIFF App。';

  } else if (text === '綁定') {
    replyText = `🔗 您的 LINE User ID 為：\n\n${lineUserId}\n\n請將此 ID 傳給管理員，由管理員在系統後台完成綁定。\n綁定後即可透過 LINE 確認出席並接收通知！`;

  } else if (text === '我的資料') {
    const [members, alliances, battles, sieges] = await Promise.all([
      firebase.getAllData('Members'), firebase.getAllData('Alliances'),
      firebase.getAllData('Battles'), firebase.getAllData('Sieges')
    ]);
    const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);
    if (!person) {
      replyText = '❌ 您尚未綁定血盟帳號。\n傳送「綁定」取得您的 LINE ID。';
    } else {
      const personId = person.ID || person.id;
      const TIER_LABEL = { '核心': '⭐核心', '一般': '○一般', '試煉': '△試煉', '外交': '◇外交' };
      let battleCount = 0, siegeCount = 0, totalDiv = 0;
      battles.forEach(b => {
        let att = [];
        try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (e) {}
        if (att.includes(personId)) { battleCount++; totalDiv += Math.floor(Number(b.revenuePerPerson || 0)); }
      });
      sieges.forEach(s => {
        let att = [];
        try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (e) {}
        if (att.includes(personId)) { siegeCount++; totalDiv += Math.floor(Number(s.revenuePerPerson || 0)); }
      });
      const tierLabel = TIER_LABEL[person.tier] || '○一般';
      const levelStr = person.level ? ` ｜ 等級：Lv${person.level}` : '';
      replyText = `🛡️ ${person.name || person.Name} 的個人資料\n職業：${person.job || '—'}${levelStr} ｜ 分級：${tierLabel}\n\n⚔️ 首領戰出席：${battleCount} 次\n🏰 攻城戰出席：${siegeCount} 次\n💰 累計分紅：${totalDiv.toLocaleString()} 天幣\n\n📝 傳送「更新等級 數字」可自助更新等級`;
    }

  } else if (text === '金庫') {
    const transactions = await firebase.getAllData('Transactions');
    const balance = agg.computeBalance(transactions);
    const tm = agg.monthlyTotals(transactions, new Date());
    replyText = `💰 血盟金庫\n目前公積金：${balance.toLocaleString()} 天幣\n\n本月收入：+${tm.income.toLocaleString()}\n本月支出：-${tm.expense.toLocaleString()}\n本月淨額：${tm.net >= 0 ? '+' : ''}${tm.net.toLocaleString()}`;

  } else if (text === '出席排行') {
    const [battles, sieges, members] = await Promise.all([
      firebase.getAllData('Battles'), firebase.getAllData('Sieges'), firebase.getAllData('Members')
    ]);
    const lb = agg.attendanceLeaderboard(battles, sieges, members, 10);
    if (!lb.length) { replyText = '目前尚無出席記錄。'; }
    else {
      const medal = ['🥇', '🥈', '🥉'];
      replyText = '🏆 出席排行榜 TOP 10\n\n' + lb.map((r, i) =>
        `${medal[i] || (i + 1) + '.'} ${r.name} — ${r.count} 場`).join('\n');
    }

  } else if (text === '攻城報名' || text === '攻城') {
    const sieges = await firebase.getAllData('Sieges');
    const now = Date.now();
    const upcoming = sieges
      .filter(s => s.status !== 'settled')
      .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
      .slice(0, 5);
    if (!upcoming.length) { replyText = '目前沒有待進行的攻城戰。'; }
    else {
      replyText = '🏰 近期攻城戰\n\n' + upcoming.map(s => {
        const castle = s.castle || s.castleName || '未知城堡';
        const d = s.date ? new Date(s.date).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '待定';
        let pre = []; try { pre = JSON.parse(s.preRegistered || '[]'); } catch (e) {}
        return `・${castle}（${d}）報名 ${pre.length} 人`;
      }).join('\n') + '\n\n請至網頁或由幹部協助報名。';
    }

  } else if (text === '我的記錄') {
    const [members, alliances, battles, sieges] = await Promise.all([
      firebase.getAllData('Members'), firebase.getAllData('Alliances'),
      firebase.getAllData('Battles'), firebase.getAllData('Sieges')
    ]);
    const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);
    if (!person) { replyText = '❌ 您尚未綁定血盟帳號。\n傳送「綁定」取得您的 LINE ID。'; }
    else {
      const pid = person.ID || person.id;
      const inAtt = (r) => { try { const a = typeof r.attendance === 'string' ? JSON.parse(r.attendance) : (r.attendance || []); return a.includes(pid); } catch (e) { return false; } };
      const myB = battles.filter(inAtt).sort((a, b) => new Date(b.time || b.createdAt || 0) - new Date(a.time || a.createdAt || 0)).slice(0, 5);
      const myS = sieges.filter(inAtt).sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)).slice(0, 5);
      let txt = `📋 ${person.name || person.Name} 的近期記錄\n`;
      txt += `\n⚔️ 首領戰（近 5 場）\n`;
      txt += myB.length ? myB.map(b => `・${b.bossName || '?'} ${b.time ? new Date(b.time).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : ''}`).join('\n') : '・無';
      txt += `\n\n🏰 攻城戰（近 5 場）\n`;
      txt += myS.length ? myS.map(s => `・${s.castle || '?'} ${s.date ? new Date(s.date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : ''}`).join('\n') : '・無';
      replyText = txt;
    }

  } else if (/^更新等級\s*\d+$/.test(text)) {
    // ── Member self-service level update via LINE Bot ──────────────────────
    const newLevel = parseInt(text.replace(/^更新等級\s*/, ''), 10);
    if (newLevel < 1 || newLevel > 99) {
      replyText = '❌ 等級必須介於 1 至 99 之間。\n例：更新等級 85';
    } else {
      const members = await firebase.getAllData('Members');
      const member = members.find(m => m.lineUserId === lineUserId);
      if (!member) {
        replyText = '❌ 您尚未綁定血盟帳號，無法更新等級。\n傳送「綁定」取得您的 LINE ID，交給管理員完成綁定。';
      } else {
        const memberId = member.ID || member.id;
        const oldLevel = member.level || '未設定';
        const ok = await firebase.updateData('Members', memberId, { level: newLevel });
        if (ok) {
          replyText = `✅ 等級更新成功！\n\n🛡️ ${member.name || member.Name}\n${oldLevel} → Lv${newLevel}\n\n傳送「我的資料」查看完整個人資訊。`;
        } else {
          replyText = '❌ 更新失敗，請稍後再試或聯絡管理員。';
        }
      }
    }
  }

  return sendLineReply(event.replyToken, replyText);
}

// ── JSON body parser (must come before API routes using req.body) ─────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Google Admin Auth ────────────────────────────

/** Verify Google ID token and return payload or null */
async function verifyGoogleToken(token) {
  return new Promise((resolve) => {
    https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (payload.error) { resolve(null); return; }
          resolve(payload);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

/** Admin middleware — requires valid Google token from admin email list */
async function requireAdmin(req, res, next) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

  if (adminEmails.length === 0) {
    console.warn('⚠️ ADMIN_EMAILS not configured — running in open mode');
    return next();
  }

  const token = req.headers['x-google-token'];
  if (!token) return res.status(401).json({ error: '未登入，請先以管理員帳號登入' });

  const payload = await verifyGoogleToken(token);
  if (!payload || !payload.email) return res.status(401).json({ error: '無效的登入憑證' });

  if (!adminEmails.includes(payload.email.toLowerCase())) {
    return res.status(403).json({ error: `${payload.email} 非授權管理員帳號` });
  }

  req.adminEmail = payload.email;
  next();
}

/** Auth middleware — requires valid Google token (any user) */
async function requireAuth(req, res, next) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

  if (adminEmails.length === 0) {
    return next();
  }

  const token = req.headers['x-google-token'];
  if (!token) return res.status(401).json({ error: '未登入，請先以 Google 帳號登入' });

  const payload = await verifyGoogleToken(token);
  if (!payload || !payload.email) return res.status(401).json({ error: '無效的登入憑證' });

  req.userEmail = payload.email;
  req.userName = payload.name;
  next();
}

/**
 * Role-gated middleware factory. Allows EITHER:
 *   • the Google owner/admin (always roleLevel 5), OR
 *   • a LINE member (verified Firebase ID token) whose resolved roleLevel >= minLevel.
 * In open mode (no ADMIN_EMAILS) everything is allowed (dev).
 */
function requireRole(minLevel) {
  return async function (req, res, next) {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length === 0) { req.actorRole = 5; return next(); }

    // 1) Google owner / admin
    const gtoken = req.headers['x-google-token'];
    if (gtoken) {
      const payload = await verifyGoogleToken(gtoken);
      if (payload && payload.email && adminEmails.includes(payload.email.toLowerCase())) {
        req.adminEmail = payload.email; req.actorRole = 5; return next();
      }
    }

    // 2) LINE member via Firebase ID token (uid === lineUserId)
    const ftoken = req.headers['x-firebase-token'];
    if (ftoken) {
      try {
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(ftoken);
        const lineUserId = decoded.uid;
        const members = await firebase.getAllData('Members');
        const member = members.find(m => m.lineUserId === lineUserId) || null;
        const level = permissions.resolveRoleLevel(member, false);
        if (level >= minLevel) {
          req.actorMember = member; req.actorLineId = lineUserId; req.actorRole = level;
          req.userEmail = (member && (member.name || member.Name)) || lineUserId;
          return next();
        }
        return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: `權限不足（需 ${minLevel} 級以上）` });
      } catch (e) {
        return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '無效的登入憑證' });
      }
    }

    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '未登入' });
  };
}

// ── Configurable permission config (settings/permissions, 60s cache) ──
let _permCfg = null, _permCfgAt = 0;
async function getActionPermConfig() {
  const now = Date.now();
  if (_permCfg && (now - _permCfgAt) < 60000) return _permCfg;
  try {
    const doc = await firebase.getDocument('settings', 'permissions');
    _permCfg = (doc && typeof doc === 'object') ? doc : {};
  } catch (e) { _permCfg = {}; }
  _permCfgAt = now;
  return _permCfg;
}
function invalidatePermConfig() { _permCfg = null; _permCfgAt = 0; }

/** Resolve the acting user's roleLevel: Google owner=5, LINE member via firebase token, open mode=5. */
async function resolveActor(req) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.length === 0) return { role: 5, openMode: true };
  const gtoken = req.headers['x-google-token'];
  if (gtoken) {
    const payload = await verifyGoogleToken(gtoken);
    if (payload && payload.email && adminEmails.includes(payload.email.toLowerCase())) {
      return { role: 5, adminEmail: payload.email };
    }
  }
  const ftoken = req.headers['x-firebase-token'];
  if (ftoken) {
    try {
      const admin = require('firebase-admin');
      const decoded = await admin.auth().verifyIdToken(ftoken);
      const members = await firebase.getAllData('Members');
      const member = members.find(m => m.lineUserId === decoded.uid) || null;
      return { role: permissions.resolveRoleLevel(member, false), member, lineId: decoded.uid };
    } catch (e) { return { role: 0, error: 'invalid' }; }
  }
  return { role: 0 };
}

/** Gate a configurable action by roleLevel + settings/permissions. `action` may be a string or function(req)->string. */
function requireAction(action) {
  return async function (req, res, next) {
    const act = typeof action === 'function' ? action(req) : action;
    const actor = await resolveActor(req);
    if (actor.error) return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '無效的登入憑證' });
    const cfg = await getActionPermConfig();
    if (permissions.canDoAction(actor.role, act, cfg)) {
      req.actorRole = actor.role;
      req.adminEmail = actor.adminEmail;
      req.userEmail = actor.adminEmail || (actor.member && (actor.member.name || actor.member.Name)) || actor.lineId;
      return next();
    }
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: `權限不足（${act}）` });
  };
}

// ── System Config Endpoint ────────────────────────
app.get('/api/config', (req, res) => {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  res.json({
    openMode: adminEmails.length === 0,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    liffId: process.env.LINE_LIFF_ID || ''
  });
});

// ── System Status Endpoint ────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    storageMode: firebase.getStorageMode(),
    timestamp: new Date().toISOString()
  });
});

// ── Auth Endpoints ───────────────────────────────
app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: '缺少 token' });

  const payload = await verifyGoogleToken(token);
  if (!payload || !payload.email) return res.status(401).json({ error: '無效的 token' });

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.length === 0 || adminEmails.includes(payload.email.toLowerCase());

  res.json({
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    isAdmin
  });
});

// ── Helpers ──────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── LINE Broadcast API ───────────────────────────
// broadcastMode: 'all' | 'bound' | 'tier'
// tiers: array of tier names (used when broadcastMode === 'tier')
app.post('/api/line/broadcast', requireAction('lineBroadcast'), async (req, res) => {
  const { recordId, type, bossName, castle, time, notes, broadcastMode = 'bound', tiers = [] } = req.body;
  if (!recordId || !type) return res.status(400).json({ error: '缺少必要參數' });

  const issiege = type === 'siege';
  const title = issiege ? '🏰 攻城戰召集！' : '⚔️ 首領戰召集！';
  const targetName = bossName || castle || '未知';
  const timeStr = time
    ? new Date(time).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '全天候待命';

  const TIER_LABEL = { '核心': '⭐核心', '一般': '○一般', '試煉': '△試煉', '外交': '◇外交' };
  const HEADER_COLOR = { all: '#1a1a2e', bound: '#111111', tier: '#1b2838' };

  const flexMessage = {
    type: 'flex',
    altText: `${title} — ${targetName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: HEADER_COLOR[broadcastMode] || '#111111', paddingAll: '16px',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#ffe600' },
          ...(broadcastMode === 'tier' && tiers.length > 0 ? [{
            type: 'text',
            text: tiers.map(t => TIER_LABEL[t] || t).join(' / ') + ' 專屬召集',
            size: 'xs', color: '#aaaaaa', margin: 'xs'
          }] : [])
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: targetName, weight: 'bold', size: 'xxl', color: '#ff3333', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: '⏰ 集結時間', size: 'sm', color: '#666666', flex: 3 },
              { type: 'text', text: timeStr, size: 'sm', weight: 'bold', flex: 4, wrap: true }
            ]
          },
          ...(notes ? [{
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '📋 備註', size: 'sm', color: '#666666', flex: 3 },
              { type: 'text', text: notes, size: 'sm', wrap: true, flex: 4 }
            ]
          }] : [])
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: {
            type: 'postback',
            label: '✅  我要出席',
            data: `action=attend&type=${type}&id=${recordId}`,
            displayText: '我要出席！'
          },
          style: 'primary', color: '#ff3333', height: 'sm'
        }],
        styles: { separator: true }
      }
    }
  };

  try {
    const [members, alliances] = await Promise.all([firebase.getAllData('Members'), firebase.getAllData('Alliances')]);
    const client = getLineClient();

    // ── MODE: all — Broadcast to ALL LINE followers (no binding required)
    if (broadcastMode === 'all') {
      await client.broadcast({ messages: [flexMessage] });
      return res.json({ ok: true, method: 'all', sent: null });
    }

    // ── MODE: tier — Multicast to tier-filtered LINE-bound blood pledge members
    if (broadcastMode === 'tier') {
      if (!tiers || tiers.length === 0) {
        return res.status(400).json({ error: '請至少選擇一個分級' });
      }
      const targetUserIds = members
        .filter(m => m.lineUserId && tiers.includes(m.tier || '一般'))
        .map(m => m.lineUserId)
        .filter((v, i, a) => a.indexOf(v) === i);

      if (targetUserIds.length === 0) {
        return res.status(400).json({ error: `所選分級 [${tiers.join('/')}] 尚無綁定 LINE 的成員` });
      }
      await client.multicast({ to: targetUserIds, messages: [flexMessage] });
      return res.json({ ok: true, method: 'tier', sent: targetUserIds.length });
    }

    // ── MODE: bound (default) — Multicast to all LINE-bound members & alliances
    const boundUserIds = [...members, ...alliances]
      .filter(p => p.lineUserId)
      .map(p => p.lineUserId)
      .filter((v, i, a) => a.indexOf(v) === i);

    if (boundUserIds.length > 0) {
      await client.multicast({ to: boundUserIds, messages: [flexMessage] });
      return res.json({ ok: true, method: 'bound', sent: boundUserIds.length });
    } else {
      // Fallback: no bound members → broadcast to all followers
      await client.broadcast({ messages: [flexMessage] });
      return res.json({ ok: true, method: 'all', sent: null, note: '無綁定成員，已廣播給所有關注者' });
    }
  } catch (e) {
    console.error('LINE broadcast error:', e);
    res.status(500).json({ error: e.message || '推播失敗，請確認 LINE Token 設定' });
  }
});

// ── LINE Binding API ─────────────────────────────
app.put('/api/members/:id/line-bind', requireAdmin, async (req, res) => {
  const { lineUserId } = req.body;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  await firebase.updateData('Members', req.params.id, { lineUserId });
  res.json({ ok: true });
});

app.delete('/api/members/:id/line-bind', requireAdmin, async (req, res) => {
  await firebase.updateData('Members', req.params.id, { lineUserId: null });
  res.json({ ok: true });
});

app.put('/api/alliances/:id/line-bind', requireAdmin, async (req, res) => {
  const { lineUserId } = req.body;
  if (!lineUserId) return res.status(400).json({ error: '缺少 lineUserId' });
  await firebase.updateData('Alliances', req.params.id, { lineUserId });
  res.json({ ok: true });
});

app.delete('/api/alliances/:id/line-bind', requireAdmin, async (req, res) => {
  await firebase.updateData('Alliances', req.params.id, { lineUserId: null });
  res.json({ ok: true });
});

// ── Members ──────────────────────────────────────
// Read-gated: roster is sensitive — recruit (level 1) and unbound guests cannot list.
// Defaults align with lib/permissions.js DEFAULT_MODULE_PERMS.members.minRead = 2.
app.get('/api/members', requireRole(2), async (req, res) => {
  let members = await firebase.getAllData('Members');
  const { search, role, active } = req.query;
  const cls = req.query.class;
  if (search) {
    const q = String(search).toLowerCase();
    members = members.filter(m => [m.name, m.Name, m.job, m.tier].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }
  if (cls) members = members.filter(m => (m.job || m.class) === cls);
  if (role) members = members.filter(m => m.tier === role);
  if (active === 'true') members = members.filter(m => m.isActive !== false);
  else if (active === 'false') members = members.filter(m => m.isActive === false);
  httpx.listResponse(res, members, req.query);
});

app.post('/api/members', requireAction('memberCreate'), async (req, res) => {
  const member = { ID: uid(), createdAt: new Date().toISOString(), ...req.body };
  await firebase.addData('Members', member);
  logActivity(firebase, { action: 'create', module: 'members', actor: req.userEmail || 'open_mode', target: member.name || member.Name || member.ID, detail: '新增成員' });
  res.json(member);
});

app.put('/api/members/:id', requireRole(3), async (req, res) => {
  const body = { ...req.body };
  // Anti-escalation: a non-owner cannot grant a roleLevel above their own.
  if ((req.actorRole || 0) < 5 && body.roleLevel != null && Number(body.roleLevel) > (req.actorRole || 0)) {
    delete body.roleLevel;
  }
  await firebase.updateData('Members', req.params.id, body);
  logActivity(firebase, { action: 'update', module: 'members', actor: req.adminEmail || req.userEmail || 'officer', target: body.name || body.Name || req.params.id, detail: '編輯成員' + (body.tier ? `（階級 ${body.tier}）` : '') });
  res.json({ id: req.params.id, ...body });
});

app.delete('/api/members/:id', requireAction('memberDelete'), async (req, res) => {
  await firebase.deleteData('Members', req.params.id);
  res.json({ ok: true });
});

// ── Battles ──────────────────────────────────────
app.get('/api/battles', async (req, res) => {
  let battles = await firebase.getAllData('Battles');
  const { boss, status, dateFrom, dateTo } = req.query;
  if (boss) battles = battles.filter(b => b.bossName === boss || b.bossId === boss);
  if (status) battles = battles.filter(b => b.status === status);
  if (dateFrom) battles = battles.filter(b => new Date(b.time || b.createdAt) >= new Date(dateFrom));
  if (dateTo) battles = battles.filter(b => new Date(b.time || b.createdAt) <= new Date(dateTo));
  battles.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt));
  httpx.listResponse(res, battles, req.query);
});

app.post('/api/battles', requireRole(3), async (req, res) => {
  const battle = { ID: uid(), time: new Date().toISOString(), attendance: '[]', drops: '[]', status: 'pending', createdBy: req.userEmail || 'open_mode', ...req.body };
  await firebase.addData('Battles', battle);
  res.json(battle);
});

app.put('/api/battles/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Battles', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/battles/:id', requireAction('battleDelete'), async (req, res) => {
  await firebase.deleteData('Battles', req.params.id);
  res.json({ ok: true });
});

// ── Treasury & Transactions ──────────────────────
app.get('/api/treasury', async (req, res) => {
  const [treasury, transactions] = await Promise.all([
    firebase.getAllData('Treasury'),
    firebase.getAllData('Transactions'),
  ]);
  const doc = treasury.length > 0 ? treasury[0] : null;
  const storedBalance = doc ? (Number(doc.balance) || 0) : 0;
  const balance = agg.computeBalance(transactions);
  const now = new Date();
  const thisMonth = agg.monthlyTotals(transactions, now);
  const lastMonth = agg.monthlyTotals(transactions, new Date(now.getFullYear(), now.getMonth() - 1, 15));
  res.json({
    balance,                                 // authoritative: computed from transactions
    storedBalance,                           // legacy Treasury doc value (reconciliation aid)
    reconciled: balance === storedBalance,
    monthIncome: thisMonth.income,
    monthExpense: thisMonth.expense,
    monthNet: thisMonth.net,
    momIncomePct: agg.pctChange(thisMonth.income, lastMonth.income),
    txCount: transactions.length,
  });
});

app.get('/api/transactions', async (req, res) => {
  let transactions = await firebase.getAllData('Transactions');
  const { type, category, dateFrom, dateTo } = req.query;
  if (type) transactions = transactions.filter(t => t.type === type);
  if (category) transactions = transactions.filter(t => t.category === category);
  if (dateFrom) transactions = transactions.filter(t => new Date(t.createdAt) >= new Date(dateFrom));
  if (dateTo) transactions = transactions.filter(t => new Date(t.createdAt) <= new Date(dateTo));
  transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  httpx.listResponse(res, transactions, req.query);
});

// ── 手動收支 (income / expense) ──────────────────
app.post('/api/transactions', requireAction(req => (req.body && req.body.type === 'expense') ? 'treasuryExpense' : 'treasuryIncome'), async (req, res) => {
  const { type, amount, category = '其他', source = '', note = '' } = req.body;
  if (!type || !['income', 'expense'].includes(type)) return res.status(400).json({ error: 'type 必須為 income 或 expense' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: '金額必須大於 0' });

  const amt = Math.floor(Number(amount));

  // 取得金庫文件
  const treasuryDocs = await firebase.getAllData('Treasury');
  let currentBalance = 0;
  let treasuryId = 'main';
  if (treasuryDocs.length > 0) {
    currentBalance = Number(treasuryDocs[0].balance) || 0;
    treasuryId = treasuryDocs[0].ID || treasuryDocs[0].id || 'main';
  }
  const newBalance = type === 'income' ? currentBalance + amt : currentBalance - amt;

  if (treasuryDocs.length === 0) {
    await firebase.addData('Treasury', { ID: 'main', balance: newBalance });
  } else {
    await firebase.updateData('Treasury', treasuryId, { balance: newBalance });
  }

  const tx = {
    ID: uid(), type, amount: amt, category, source, note,
    createdAt: new Date().toISOString(),
    createdBy: req.adminEmail || 'admin'
  };
  await firebase.addData('Transactions', tx);
  logActivity(firebase, { action: type, module: 'treasury', actor: req.adminEmail || 'admin', target: category, detail: `${type === 'income' ? '收入' : '支出'} ${amt}` });
  res.json({ ok: true, transaction: tx, newBalance });
});

// ── 城堡稅收批次登錄 ─────────────────────────────
// entries: [{ castle, amount }] — 每個城堡一筆
app.post('/api/transactions/castle-tax', requireAction('treasuryCastleTax'), async (req, res) => {
  const { entries = [] } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: '請提供城堡稅收項目' });

  const treasuryDocs = await firebase.getAllData('Treasury');
  let currentBalance = Number(treasuryDocs[0]?.balance) || 0;
  let treasuryId = treasuryDocs[0]?.ID || treasuryDocs[0]?.id || 'main';

  const results = [];
  let totalAdded = 0;

  for (const entry of entries) {
    const amt = Math.floor(Number(entry.amount) || 0);
    if (amt <= 0) continue;
    const tx = {
      ID: uid(), type: 'income', amount: amt,
      category: '城堡稅收',
      source: entry.castle || '未知城堡',
      note: entry.note || '',
      createdAt: new Date().toISOString(),
      createdBy: req.adminEmail || 'admin'
    };
    await firebase.addData('Transactions', tx);
    results.push(tx);
    totalAdded += amt;
  }

  const newBalance = currentBalance + totalAdded;
  if (treasuryDocs.length === 0) {
    await firebase.addData('Treasury', { ID: 'main', balance: newBalance });
  } else {
    await firebase.updateData('Treasury', treasuryId, { balance: newBalance });
  }

  res.json({ ok: true, entries: results, totalAdded, newBalance });
});

// ── Loot Auction & Settlement ────────────────────
app.post('/api/battles/:id/drops', requireRole(3), async (req, res) => {
  const { itemName } = req.body;
  if (!itemName) return res.status(400).json({ error: '缺少物品名稱' });
  
  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ error: '找不到該戰役' });
  
  let drops = [];
  try { drops = typeof battle.drops === 'string' ? JSON.parse(battle.drops) : (battle.drops || []); } catch (e) {}
  
  const dropId = uid();
  drops.push({
    id: dropId,
    itemName,
    highestBid: 0,
    bidderId: null,
    auctionStage: 'participant',
    endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  
  await firebase.updateData('Battles', req.params.id, { drops: JSON.stringify(drops) });
  res.json({ ok: true, dropId });
});

app.post('/api/battles/:id/drops/:dropId/bid', requireAuth, async (req, res) => {
  const { amount, bidderId } = req.body;
  
  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ error: '找不到該戰役' });
  
  let drops = [];
  try { drops = typeof battle.drops === 'string' ? JSON.parse(battle.drops) : (battle.drops || []); } catch (e) {}
  
  const dropIndex = drops.findIndex(d => d.id === req.params.dropId);
  if (dropIndex === -1) return res.status(404).json({ error: '找不到該掉落物' });
  
  if (amount <= drops[dropIndex].highestBid) {
    return res.status(400).json({ error: '出價必須高於目前最高價' });
  }
  
  drops[dropIndex].highestBid = amount;
  drops[dropIndex].bidderId = bidderId;
  
  await firebase.updateData('Battles', req.params.id, { drops: JSON.stringify(drops) });
  res.json({ ok: true, drop: drops[dropIndex] });
});

app.post('/api/battles/:id/settle', requireRole(3), async (req, res) => {
  const { reservePercentage = 0 } = req.body;

  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ error: '找不到該戰役' });
  if (battle.status === 'settled') return res.status(400).json({ error: '此戰役已結算，不可重複結算' });

  let drops = [];
  try { drops = typeof battle.drops === 'string' ? JSON.parse(battle.drops) : (battle.drops || []); } catch (e) {}

  // Support both auction-bid format (highestBid) and simple price format (price)
  const dropsTotal = drops.reduce((sum, d) => sum + (Number(d.highestBid || d.price) || 0), 0);
  const totalRevenue = dropsTotal > 0 ? dropsTotal : Number(battle.auctionPool || 0);
  const pct = Math.max(0, Math.min(100, Number(reservePercentage) || 0));
  const reserveDeduction = Math.floor(totalRevenue * (pct / 100));
  const distributable = totalRevenue - reserveDeduction;
  
  let attendance = [];
  try { attendance = typeof battle.attendance === 'string' ? JSON.parse(battle.attendance) : (battle.attendance || []); } catch (e) {}
  
  const participantCount = attendance.length;
  const dividendPerPerson = participantCount > 0 ? Math.floor(distributable / participantCount) : 0;
  
  const treasuryDocs = await firebase.getAllData('Treasury');
  let currentBalance = 0;
  let treasuryId = 'main';
  if (treasuryDocs.length > 0) {
    currentBalance = treasuryDocs[0].balance || 0;
    treasuryId = treasuryDocs[0].ID || treasuryDocs[0].id;
  }
  const newBalance = currentBalance + reserveDeduction;
  if (treasuryDocs.length === 0) {
    await firebase.addData('Treasury', { ID: 'main', balance: newBalance });
  } else {
    await firebase.updateData('Treasury', treasuryId, { balance: newBalance });
  }
  
  await firebase.addData('Transactions', {
    ID: uid(),
    type: 'income',
    amount: reserveDeduction,
    source: `首領戰 ${battle.bossName || '未知'} 公積金抽成`,
    createdAt: new Date().toISOString()
  });
  
  await firebase.updateData('Battles', req.params.id, {
    status: 'settled',
    totalRevenue,
    reserveDeduction,
    dividendPerPerson
  });
  logActivity(firebase, { action: 'settle', module: 'battles', actor: req.adminEmail || 'admin', target: battle.bossName || '首領戰', detail: `結算 分紅/人 ${dividendPerPerson}` });

  const [members, alliances] = await Promise.all([firebase.getAllData('Members'), firebase.getAllData('Alliances')]);
  const boundParticipants = [...members, ...alliances]
    .filter(p => attendance.includes(p.ID || p.id) && p.lineUserId)
    .map(p => p.lineUserId)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (boundParticipants.length > 0) {
    const title = '💰 戰利品分發通知';
    const flexMessage = {
      type: 'flex',
      altText: `分寶通知 — ${battle.bossName || '未知'}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: '#111111', paddingAll: '16px',
          contents: [
            { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#f5c32e' }
          ]
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
          contents: [
            { type: 'text', text: battle.bossName || '未知', weight: 'bold', size: 'lg', color: '#ffffff' },
            { type: 'separator', margin: 'md' },
            {
              type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'text', text: '總收入', size: 'sm', color: '#8ba1b5', flex: 3 },
                { type: 'text', text: `${totalRevenue} 鑽`, size: 'sm', weight: 'bold', flex: 4, align: 'end', color: '#ffffff' }
              ]
            },
            {
              type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: `公積金抽成 (${reservePercentage}%)`, size: 'sm', color: '#8ba1b5', flex: 3 },
                { type: 'text', text: `-${reserveDeduction} 鑽`, size: 'sm', flex: 4, align: 'end', color: '#e53e3e' }
              ]
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'text', text: '個人分紅', size: 'md', color: '#8ba1b5', flex: 3, weight: 'bold' },
                { type: 'text', text: `${dividendPerPerson} 鑽`, size: 'lg', weight: 'bold', flex: 4, align: 'end', color: '#06c755' }
              ]
            }
          ]
        }
      }
    };
    try {
      const client = getLineClient();
      await client.multicast({ to: boundParticipants, messages: [flexMessage] });
    } catch (e) {
      console.error('Failed to send LINE notification for settlement:', e);
    }
  }
  
  res.json({ ok: true, totalRevenue, reserveDeduction, dividendPerPerson });
});

// ── Siege Settle ─────────────────────────────────
// source: 'reward' (從攻城獎勵扣) | 'treasury' (從公積金扣)
// subsidyPerPerson: 每人薪津金額 (admin 每次手動輸入)
// reservePercentage: 0-100, 僅 source='reward' 時生效
app.post('/api/sieges/:id/settle', requireRole(3), async (req, res) => {
  const { subsidyPerPerson = 0, reservePercentage = 0, source = 'reward' } = req.body;

  const siege = await firebase.getDocument('Sieges', req.params.id);
  if (!siege) return res.status(404).json({ error: '找不到該攻城戰紀錄' });
  if (siege.status === 'settled') return res.status(400).json({ error: '此攻城戰已結算，不可重複結算' });

  let attendance = [];
  try { attendance = typeof siege.attendance === 'string' ? JSON.parse(siege.attendance) : (siege.attendance || []); } catch (e) {}

  const participantCount = attendance.length;
  const perPerson = Math.floor(Number(subsidyPerPerson) || 0);
  const totalPayout = perPerson * participantCount;

  // ── 取得或初始化金庫 ────────────────────────────
  const treasuryDocs = await firebase.getAllData('Treasury');
  let currentBalance = 0;
  let treasuryId = 'main';
  if (treasuryDocs.length > 0) {
    currentBalance = Number(treasuryDocs[0].balance) || 0;
    treasuryId = treasuryDocs[0].ID || treasuryDocs[0].id || 'main';
  }

  let reserveDeduction = 0;
  let newBalance = currentBalance;

  if (source === 'reward') {
    // 從攻城獎勵池扣：先抽公積金，其餘為薪津來源
    const pct = Math.max(0, Math.min(100, Number(reservePercentage) || 0));
    reserveDeduction = Math.floor(Number(siege.reward || 0) * (pct / 100));
    newBalance = currentBalance + reserveDeduction;
    if (reserveDeduction > 0) {
      await firebase.addData('Transactions', {
        ID: uid(), type: 'income', amount: reserveDeduction,
        category: '攻城戰公積金抽成',
        source: `攻城戰 ${siege.castle || '未知'} 公積金 ${pct}%`,
        createdAt: new Date().toISOString()
      });
    }
  } else {
    // 從公積金扣：直接扣除
    newBalance = currentBalance - totalPayout;
    await firebase.addData('Transactions', {
      ID: uid(), type: 'expense', amount: totalPayout,
      category: '攻城戰薪津',
      source: `攻城戰 ${siege.castle || '未知'} 薪津 × ${participantCount} 人`,
      createdAt: new Date().toISOString()
    });
  }

  // ── 更新金庫 ─────────────────────────────────
  if (treasuryDocs.length === 0) {
    await firebase.addData('Treasury', { ID: 'main', balance: newBalance });
  } else {
    await firebase.updateData('Treasury', treasuryId, { balance: newBalance });
  }

  // ── 更新攻城戰紀錄 ───────────────────────────
  await firebase.updateData('Sieges', req.params.id, {
    status: 'settled',
    subsidyPerPerson: perPerson,
    totalPayout,
    reserveDeduction,
    revenuePerPerson: perPerson,
    settledSource: source,
    settledAt: new Date().toISOString()
  });
  logActivity(firebase, { action: 'settle', module: 'sieges', actor: req.adminEmail || 'admin', target: siege.castle || '攻城戰', detail: `薪津/人 ${perPerson}` });

  // ── LINE 推播分寶通知 ─────────────────────────
  const [members, alliances] = await Promise.all([firebase.getAllData('Members'), firebase.getAllData('Alliances')]);
  const boundParticipants = [...members, ...alliances]
    .filter(p => attendance.includes(p.ID || p.id) && p.lineUserId)
    .map(p => p.lineUserId)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (boundParticipants.length > 0) {
    const typeLabel = siege.siegeType === 'defend' ? '🛡️ 守城戰' : '🏰 攻城戰';
    const sourceLabel = source === 'treasury' ? '公積金支出' : '攻城獎勵';
    const flexMessage = {
      type: 'flex', altText: `薪津通知 — ${siege.castle || '未知'}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#1a1228', paddingAll: '16px',
          contents: [{ type: 'text', text: `${typeLabel} 薪津發放`, weight: 'bold', size: 'xl', color: '#e2a827' }]
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
          contents: [
            { type: 'text', text: siege.castle || '未知城堡', weight: 'bold', size: 'lg', color: '#ffffff' },
            { type: 'separator', margin: 'md' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '參與人數', size: 'sm', color: '#8ba1b5', flex: 3 },
              { type: 'text', text: `${participantCount} 人`, size: 'sm', weight: 'bold', flex: 4, align: 'end', color: '#ffffff' }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
              { type: 'text', text: '資金來源', size: 'sm', color: '#8ba1b5', flex: 3 },
              { type: 'text', text: sourceLabel, size: 'sm', flex: 4, align: 'end', color: '#cccccc' }
            ]},
            { type: 'separator', margin: 'md' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '個人薪津', size: 'md', color: '#8ba1b5', flex: 3, weight: 'bold' },
              { type: 'text', text: `${perPerson.toLocaleString()} 天幣`, size: 'lg', weight: 'bold', flex: 4, align: 'end', color: '#06c755' }
            ]}
          ]
        }
      }
    };
    try {
      const client = getLineClient();
      await client.multicast({ to: boundParticipants, messages: [flexMessage] });
    } catch (e) {
      console.error('攻城戰 LINE 薪津通知失敗:', e);
    }
  }

  res.json({ ok: true, perPerson, totalPayout, reserveDeduction, participantCount, newBalance });
});

// ── Sieges ───────────────────────────────────────
app.get('/api/sieges', async (req, res) => {
  let sieges = await firebase.getAllData('Sieges');
  const { castle, type, status, dateFrom, dateTo } = req.query;
  if (castle) sieges = sieges.filter(s => s.castle === castle || s.castleName === castle);
  if (type) sieges = sieges.filter(s => (s.siegeType || s.type) === type);
  if (status) sieges = sieges.filter(s => s.status === status);
  if (dateFrom) sieges = sieges.filter(s => new Date(s.date || s.createdAt) >= new Date(dateFrom));
  if (dateTo) sieges = sieges.filter(s => new Date(s.date || s.createdAt) <= new Date(dateTo));
  sieges.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  httpx.listResponse(res, sieges, req.query);
});

app.post('/api/sieges', requireRole(3), async (req, res) => {
  const siege = { ID: uid(), date: new Date().toISOString(), attendance: '[]', reward: 0, createdBy: req.userEmail || 'open_mode', ...req.body };
  await firebase.addData('Sieges', siege);
  res.json(siege);
});

app.put('/api/sieges/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Sieges', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/sieges/:id', requireAction('siegeDelete'), async (req, res) => {
  await firebase.deleteData('Sieges', req.params.id);
  res.json({ ok: true });
});

// ── Alliances ────────────────────────────────────
app.get('/api/alliances', async (req, res) => {
  let alliances = await firebase.getAllData('Alliances');
  const { type, active, search } = req.query;
  if (type) alliances = alliances.filter(a => a.type === type);
  if (active === 'true') alliances = alliances.filter(a => !a.endDate && a.isActive !== false);
  else if (active === 'false') alliances = alliances.filter(a => !!a.endDate || a.isActive === false);
  if (search) {
    const q = String(search).toLowerCase();
    alliances = alliances.filter(a => [a.guildName, a.name, a.leaderName].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }
  httpx.listResponse(res, alliances, req.query);
});

app.post('/api/alliances', requireAdmin, async (req, res) => {
  const a = { ID: uid(), createdAt: new Date().toISOString(), ...req.body };
  await firebase.addData('Alliances', a);
  res.json(a);
});

app.put('/api/alliances/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Alliances', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/alliances/:id', requireAdmin, async (req, res) => {
  await firebase.deleteData('Alliances', req.params.id);
  res.json({ ok: true });
});

// ── Custom Data API (ChromaDB) ───────────────────
const chroma = require('./chroma');

app.post('/api/chroma/collection', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '缺少 collection name' });
    const collection = await chroma.getOrCreateCollection(name);
    res.json({ ok: true, name: collection.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chroma/add', requireAdmin, async (req, res) => {
  try {
    const { collectionName, ids, documents, metadatas } = req.body;
    if (!collectionName || !ids || !documents) return res.status(400).json({ error: '缺少必要參數' });
    await chroma.addData(collectionName, ids, documents, metadatas);
    res.json({ ok: true, count: ids.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chroma/search', requireAuth, async (req, res) => {
  try {
    const { collectionName, queryTexts, nResults } = req.body;
    if (!collectionName || !queryTexts) return res.status(400).json({ error: '缺少必要參數' });
    const results = await chroma.queryData(collectionName, queryTexts, nResults || 5);
    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Pre-Registration API ──────────────────────────
// POST /api/battles/:id/pre-register
// POST /api/sieges/:id/pre-register
['battles', 'sieges'].forEach(col => {
  app.post(`/api/${col}/:id/pre-register`, express.json(), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, note } = req.body;
      if (!name) return res.status(400).json({ error: '缺少角色名' });
      const db = firebase.getDb ? firebase.getDb() : null;
      if (!db) return res.status(503).json({ error: 'DB unavailable' });
      const ref = db.collection(firebase.resolveCollection(col)).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: '找不到記錄' });
      const data = snap.data();
      let preReg = [];
      try { preReg = JSON.parse(data.preRegistered || '[]'); } catch {}
      // 避免重複報名
      if (preReg.some(p => p.name === name)) {
        return res.json({ ok: true, message: '已報名', preRegistered: JSON.stringify(preReg) });
      }
      preReg.push({ name, note: note || '', registeredAt: new Date().toISOString() });
      await ref.update({ preRegistered: JSON.stringify(preReg) });
      res.json({ ok: true, preRegistered: JSON.stringify(preReg) });
    } catch (err) {
      console.error(`pre-register ${col} error:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE pre-registration (cancel)
  app.delete(`/api/${col}/:id/pre-register`, express.json(), async (req, res) => {
    try {
      const { id } = req.params;
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: '缺少角色名' });
      const db = firebase.getDb ? firebase.getDb() : null;
      if (!db) return res.status(503).json({ error: 'DB unavailable' });
      const ref = db.collection(firebase.resolveCollection(col)).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: '找不到記錄' });
      let preReg = [];
      try { preReg = JSON.parse(snap.data().preRegistered || '[]'); } catch {}
      preReg = preReg.filter(p => p.name !== name);
      await ref.update({ preRegistered: JSON.stringify(preReg) });
      res.json({ ok: true, preRegistered: JSON.stringify(preReg) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST attendance (幹部勾稽)
  app.post(`/api/${col}/:id/attendance`, requireRole(3), express.json(), async (req, res) => {
    try {
      const { id } = req.params;
      const { attendance, drops, loot, note } = req.body;
      if (!Array.isArray(attendance)) return res.status(400).json({ error: '缺少出席名單' });
      const db = firebase.getDb ? firebase.getDb() : null;
      if (!db) return res.status(503).json({ error: 'DB unavailable' });
      const ref = db.collection(firebase.resolveCollection(col)).doc(id);
      await ref.update({
        attendance: JSON.stringify(attendance),
        drops: drops || 0,
        loot: loot || 0,
        note: note || '',
        updatedAt: new Date().toISOString()
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// ── Design Panel API ─────────────────────────────
const fs = require('fs');
app.post('/api/save-design', express.json(), (req, res) => {
  try {
    const { cssVars, brandName, brandSubtitle } = req.body;
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (cssVars) {
      for (const [key, value] of Object.entries(cssVars)) {
        const regex = new RegExp(`(${key.replace(/[-]/g,'\\-')}:\\s*)([^;]+)(;)`, 'g');
        html = html.replace(regex, `$1${value}$3`);
      }
    }
    if (brandName !== undefined) {
      html = html.replace(
        /(<div style="font-size:18px;font-weight:900;color:var\(--or\);[^"]*">)[^<]*/,
        `$1${brandName}`
      );
    }
    if (brandSubtitle !== undefined) {
      html = html.replace(
        /(<div style="font-size:11px;color:var\(--tx2\);"[^>]*>)[^<]*/,
        `$1${brandSubtitle}`
      );
    }
    fs.writeFileSync(htmlPath, html, 'utf8');
    res.json({ ok: true, message: '設計已儲存至 index.html' });
  } catch (err) {
    console.error('save-design error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── LINE Bot (新版 webhook + Firebase Auth) ───────
try {
  const { setupLineBot } = require('./linebot');
  setupLineBot(app);
  console.log('✅ LINE Bot 模組已掛載 (/webhook/line, /api/line-auth)');
} catch (e) {
  console.warn('⚠️  LINE Bot 模組未能載入（可能缺少環境變數）:', e.message);
}

// ── Sprint B/C/D write endpoints ──────────────────────────────────────────
// POST /api/members/:id/level-update — level change + levelHistory sub-collection
app.post('/api/members/:id/level-update', requireAuth, async (req, res) => {
  const newLevel = parseInt(req.body.level, 10);
  if (!Number.isFinite(newLevel) || newLevel < 1 || newLevel > 99)
    return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: '等級必須介於 1 至 99' });
  const member = await firebase.getDocument('Members', req.params.id);
  if (!member) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該成員' });
  const oldLevel = member.level || null;
  await firebase.updateData('Members', req.params.id, { level: newLevel, updatedAt: new Date().toISOString() });
  try {
    const db = firebase.getDb();
    if (db) await db.collection(firebase.resolveCollection('members')).doc(String(req.params.id))
      .collection('levelHistory').add({ level: newLevel, prevLevel: oldLevel, changedBy: req.userEmail || 'open_mode', changedAt: new Date().toISOString(), note: req.body.note || '' });
  } catch (e) { console.error('levelHistory write failed:', e.message); }
  logActivity(firebase, { action: 'level-update', module: 'members', actor: req.userEmail || 'open_mode', target: member.name || member.Name || req.params.id, detail: `${oldLevel != null ? oldLevel : '?'} → Lv${newLevel}` });
  res.json({ ok: true, id: req.params.id, level: newLevel, prevLevel: oldLevel });
});

// POST /api/alliances/:id/end — end a diplomatic relationship
app.post('/api/alliances/:id/end', requireAdmin, async (req, res) => {
  const a = await firebase.getDocument('Alliances', req.params.id);
  if (!a) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該外交關係' });
  const endDate = req.body.endDate || new Date().toISOString();
  await firebase.updateData('Alliances', req.params.id, { endDate, isActive: false, endReason: req.body.reason || '', updatedAt: new Date().toISOString() });
  logActivity(firebase, { action: 'end', module: 'alliances', actor: req.adminEmail || 'admin', target: a.guildName || a.name || req.params.id, detail: req.body.reason || '結束外交' });
  res.json({ ok: true, id: req.params.id, endDate });
});

// PUT /api/settings — upsert guild / roles / modules settings docs
app.put('/api/settings', requireAdmin, async (req, res) => {
  const db = firebase.getDb();
  if (!db) return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'DB unavailable' });
  const updated = [];
  for (const key of ['guild', 'roles', 'modules', 'permissions']) {
    if (req.body[key] && typeof req.body[key] === 'object') {
      await db.collection('settings').doc(key).set({ ...req.body[key], updatedAt: new Date().toISOString() }, { merge: true });
      updated.push(key);
    }
  }
  if (updated.includes('permissions')) invalidatePermConfig();
  logActivity(firebase, { action: 'update', module: 'settings', actor: req.adminEmail || 'admin', target: updated.join(','), detail: '更新設定' });
  res.json({ ok: true, updated });
});

// DELETE /api/battles/:id/attendance/:memberId — remove one attendee
app.delete('/api/battles/:id/attendance/:memberId', requireRole(3), async (req, res) => {
  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該戰役' });
  let attendance = [];
  try { attendance = typeof battle.attendance === 'string' ? JSON.parse(battle.attendance) : (battle.attendance || []); } catch (e) {}
  const before = attendance.length;
  attendance = attendance.filter(id => id !== req.params.memberId);
  await firebase.updateData('Battles', req.params.id, { attendance: JSON.stringify(attendance) });
  res.json({ ok: true, removed: before - attendance.length, attendance });
});

// PUT /api/battles/:id/drops/:dropId — edit a drop item
app.put('/api/battles/:id/drops/:dropId', requireRole(3), async (req, res) => {
  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該戰役' });
  let drops = [];
  try { drops = typeof battle.drops === 'string' ? JSON.parse(battle.drops) : (battle.drops || []); } catch (e) {}
  const idx = drops.findIndex(d => d.id === req.params.dropId);
  if (idx === -1) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該掉落物' });
  const { itemName, price, highestBid, bidderId } = req.body;
  if (itemName !== undefined) drops[idx].itemName = itemName;
  if (price !== undefined) drops[idx].price = Number(price) || 0;
  if (highestBid !== undefined) drops[idx].highestBid = Number(highestBid) || 0;
  if (bidderId !== undefined) drops[idx].bidderId = bidderId;
  await firebase.updateData('Battles', req.params.id, { drops: JSON.stringify(drops) });
  res.json({ ok: true, drop: drops[idx] });
});

// DELETE /api/battles/:id/drops/:dropId — remove a drop item
app.delete('/api/battles/:id/drops/:dropId', requireRole(3), async (req, res) => {
  const battle = await firebase.getDocument('Battles', req.params.id);
  if (!battle) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: '找不到該戰役' });
  let drops = [];
  try { drops = typeof battle.drops === 'string' ? JSON.parse(battle.drops) : (battle.drops || []); } catch (e) {}
  const before = drops.length;
  drops = drops.filter(d => d.id !== req.params.dropId);
  await firebase.updateData('Battles', req.params.id, { drops: JSON.stringify(drops) });
  res.json({ ok: true, removed: before - drops.length });
});

// ── Extra read-only endpoints (overview / stats / activity-feed / details) ──
require('./lib/routes-extra')(app, firebase, agg, httpx);
require('./lib/routes-sprint-bcd')(app, firebase, agg, httpx);
require('./lib/routes-auth')(app, firebase, agg);
require('./lib/routes-liff')(app, firebase);

// ── Serve frontend ───────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏰 天堂：經典版 | 水蛇伺服器-長途夜車 管理系統已啟動`);
  console.log(`   本機: http://localhost:${PORT}`);
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   區網: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('\n   其他成員請連線上方「區網」網址\n');
});
