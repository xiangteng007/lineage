require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const line = require('@line/bot-sdk');
const firebase = require('./firebase');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET'
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ── LINE Bot Webhook ────────────────────────────
app.post('/api/webhook', line.middleware(lineConfig), (req, res) => {
  Promise
    .all(req.body.events.map(handleLineEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('LINE Bot Error:', err);
      res.status(500).end();
    });
});

async function handleLineEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const text = event.message.text.trim();
  
  let replyText = '指令無法辨識。目前支援：\n- 名單：查詢血盟成員\n- 拍賣：查詢最新拍賣分紅\n- 網頁：開啟管理系統';

  if (text === '名單') {
    const members = await firebase.getAllData('Members');
    const count = members.length;
    replyText = `🛡️ 血盟目前有 ${count} 名成員登記。\n`;
    members.slice(0, 10).forEach(m => {
      replyText += `- [Lv.${m.level || '?'}] ${m.name} (${m.job || m.classType})\n`;
    });
    if (count > 10) replyText += `...以及其他 ${count - 10} 名成員。`;
  } else if (text === '拍賣') {
    const battles = await firebase.getAllData('Battles');
    const lastBattle = battles.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt))[0];
    if (lastBattle) {
      // loot might be a JSON string or array
      let totalLoot = 0;
      try {
          const drops = typeof lastBattle.drops === 'string' ? JSON.parse(lastBattle.drops) : (lastBattle.drops || []);
          totalLoot = drops.reduce((sum, l) => sum + (Number(l.price) || 0), 0);
      } catch(e) {
          totalLoot = Number(lastBattle.auctionPool) || 0;
      }
      
      let participantCount = 0;
      try {
          const att = typeof lastBattle.attendance === 'string' ? JSON.parse(lastBattle.attendance) : (lastBattle.attendance || []);
          participantCount = att.length;
      } catch(e) {}

      const bonus = participantCount > 0 ? Math.floor(totalLoot / participantCount) : 0;
      replyText = `💰 最新首領戰 [${lastBattle.bossName || lastBattle.boss || '未知'}]\n總拍賣金：${totalLoot} 天幣\n參與人數：${participantCount} 人\n每人分紅：${bonus} 天幣`;
    } else {
      replyText = '目前沒有首領戰紀錄。';
    }
  } else if (text === '網頁') {
    replyText = '請點擊選單開啟「天堂精典管理系統」LIFF App。';
  }

  try {
    const client = new line.messagingApi.MessagingApiClient({
      channelAccessToken: lineConfig.channelAccessToken
    });
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }]
    });
  } catch (err) {
    const client = new line.Client(lineConfig);
    return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Members ─────────────────────────────────────
app.get('/api/members', async (req, res) => {
  const members = await firebase.getAllData('Members');
  res.json(members);
});

app.post('/api/members', async (req, res) => {
  const member = { ID: uid(), ...req.body };
  await firebase.addData('Members', member);
  res.json(member);
});

app.put('/api/members/:id', async (req, res) => {
  await firebase.updateData('Members', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/members/:id', async (req, res) => {
  await firebase.deleteData('Members', req.params.id);
  res.json({ ok: true });
});

// ── Battles ─────────────────────────────────────
app.get('/api/battles', async (req, res) => {
  const battles = await firebase.getAllData('Battles');
  res.json(battles.sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)));
});

app.post('/api/battles', async (req, res) => {
  const battle = {
    ID: uid(),
    time: new Date().toISOString(),
    attendance: '[]',
    drops: '[]',
    status: 'pending',
    ...req.body
  };
  await firebase.addData('Battles', battle);
  res.json(battle);
});

app.put('/api/battles/:id', async (req, res) => {
  await firebase.updateData('Battles', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/battles/:id', async (req, res) => {
  await firebase.deleteData('Battles', req.params.id);
  res.json({ ok: true });
});

// ── Sieges ──────────────────────────────────────
app.get('/api/sieges', async (req, res) => {
  const sieges = await firebase.getAllData('Sieges');
  res.json(sieges.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt)));
});

app.post('/api/sieges', async (req, res) => {
  const siege = {
    ID: uid(),
    date: new Date().toISOString(),
    attendance: '[]',
    reward: 0,
    ...req.body
  };
  await firebase.addData('Sieges', siege);
  res.json(siege);
});

app.put('/api/sieges/:id', async (req, res) => {
  await firebase.updateData('Sieges', req.params.id, req.body);
  res.json({ id: req.params.id, ...req.body });
});

app.delete('/api/sieges/:id', async (req, res) => {
  await firebase.deleteData('Sieges', req.params.id);
  res.json({ ok: true });
});

// ── Alliances ───────────────────────────────────
app.get('/api/alliances', async (req, res) => {
  const alliances = await firebase.getAllData('Alliances');
  res.json(alliances);
});
app.post('/api/alliances', async (req, res) => {
  const a = { ID: uid(), ...req.body };
  await firebase.addData('Alliances', a);
  res.json(a);
});
app.delete('/api/alliances/:id', async (req, res) => {
  await firebase.deleteData('Alliances', req.params.id);
  res.json({ ok: true });
});

// ── Serve frontend ──────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏰 天堂精典版管理系統已啟動`);
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

module.exports = app; // Export for Vercel Serverless
