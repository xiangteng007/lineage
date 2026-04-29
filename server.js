require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const line = require('@line/bot-sdk');
const firebase = require('./firebase');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET'
};

function getLineClient() {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken });
}

const app = express();
const PORT = process.env.PORT || 3000;

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
    return sendLineReply(event.replyToken, '🛡️ 歡迎加入血盟通知系統！\n\n可用指令：\n・名單 → 查詢血盟成員\n・拍賣 → 最新首領戰分紅\n・綁定 → 取得您的 LINE ID\n・我的資料 → 個人出席統計\n・網頁 → 開啟管理系統');
  }

  if (event.type === 'postback') return handlePostbackEvent(event);
  if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);

  const text = event.message.text.trim();
  const lineUserId = event.source.userId;
  let replyText = '指令無法辨識。\n\n可用指令：\n・名單 / 拍賣 / 網頁\n・綁定 / 我的資料';

  if (text === '名單') {
    const members = await firebase.getAllData('Members');
    const count = members.length;
    const TIER_ICON = { '核心': '⭐', '一般': '○', '試煉': '△', '外交': '◇' };
    replyText = `🛡️ 血盟目前有 ${count} 名成員\n`;
    members.slice(0, 10).forEach(m => {
      const icon = TIER_ICON[m.tier] || '○';
      replyText += `${icon} ${m.name} (${m.job || ''})${m.notes ? ' ｜' + m.notes : ''}\n`;
    });
    if (count > 10) replyText += `...以及其他 ${count - 10} 名成員。`;

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
      replyText = `🛡️ ${person.name || person.Name} 的個人資料\n職業：${person.job || '—'} ｜ 分級：${tierLabel}\n\n⚔️ 首領戰出席：${battleCount} 次\n🏰 攻城戰出席：${siegeCount} 次\n💰 累計分紅：${totalDiv.toLocaleString()} 天幣`;
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

// ── System Config Endpoint ────────────────────────
app.get('/api/config', (req, res) => {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  res.json({
    openMode: adminEmails.length === 0,
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
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
app.post('/api/line/broadcast', requireAdmin, async (req, res) => {
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
app.get('/api/members', async (req, res) => {
  const members = await firebase.getAllData('Members');
  res.json(members);
});

app.post('/api/members', async (req, res) => {
  const member = { ID: uid(), createdAt: new Date().toISOString(), ...req.body };
  await firebase.addData('Members', member);
  res.json(member);
});

app.put('/api/members/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Members', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/members/:id', requireAdmin, async (req, res) => {
  await firebase.deleteData('Members', req.params.id);
  res.json({ ok: true });
});

// ── Battles ──────────────────────────────────────
app.get('/api/battles', async (req, res) => {
  const battles = await firebase.getAllData('Battles');
  res.json(battles.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)));
});

app.post('/api/battles', requireAuth, async (req, res) => {
  const battle = { ID: uid(), time: new Date().toISOString(), attendance: '[]', drops: '[]', status: 'pending', createdBy: req.userEmail || 'open_mode', ...req.body };
  await firebase.addData('Battles', battle);
  res.json(battle);
});

app.put('/api/battles/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Battles', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/battles/:id', requireAdmin, async (req, res) => {
  await firebase.deleteData('Battles', req.params.id);
  res.json({ ok: true });
});

// ── Sieges ───────────────────────────────────────
app.get('/api/sieges', async (req, res) => {
  const sieges = await firebase.getAllData('Sieges');
  res.json(sieges.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt)));
});

app.post('/api/sieges', requireAuth, async (req, res) => {
  const siege = { ID: uid(), date: new Date().toISOString(), attendance: '[]', reward: 0, createdBy: req.userEmail || 'open_mode', ...req.body };
  await firebase.addData('Sieges', siege);
  res.json(siege);
});

app.put('/api/sieges/:id', requireAdmin, async (req, res) => {
  await firebase.updateData('Sieges', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/sieges/:id', requireAdmin, async (req, res) => {
  await firebase.deleteData('Sieges', req.params.id);
  res.json({ ok: true });
});

// ── Alliances ────────────────────────────────────
app.get('/api/alliances', async (req, res) => {
  const alliances = await firebase.getAllData('Alliances');
  res.json(alliances);
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

module.exports = app;
