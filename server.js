// ══════════════════════════════════════════════════════
// Lineage Classic — Blood Pledge Command Center
// Phase 1-6 Complete | Vercel-ready Express Server
// ══════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const line = require('@line/bot-sdk');
const firebase = require('./firebase');

// ── LINE Config ──────────────────────────────────────
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

// ── Phase 5: GET /api/webhook (LINE Webhook URL Verification) ──
app.get('/api/webhook', (req, res) => {
    res.status(200).json({ ok: true, message: 'LINE Webhook endpoint is active', phase: 5 });
});

// ── Phase 5: POST /api/webhook (LINE Bot Events) ─────
app.post('/api/webhook', line.middleware(lineConfig), (req, res) => {
    Promise
      .all(req.body.events.map(handleLineEvent))
      .then((result) => res.json(result))
      .catch((err) => { console.error('LINE Bot Error:', err); res.status(500).end(); });
});

// ── LINE Reply Helper ────────────────────────────────
async function sendLineReply(replyToken, text) {
    try {
          return await getLineClient().replyMessage({ replyToken, messages: [{ type: 'text', text }] });
    } catch (err) {
          console.error('LINE reply error:', err.message);
    }
}

// ── Phase 5: Postback Event Handler ─────────────────
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
              return sendLineReply(event.replyToken, 'You have not bound your Blood Pledge account.\n\nSend "BIND" to get your LINE ID.');
      }

      const record = await firebase.getDocument(collection, recordId);
        if (!record) {
                return sendLineReply(event.replyToken, 'Record not found. It may have been removed.');
        }

      let attendance = [];
        try { attendance = typeof record.attendance === 'string' ? JSON.parse(record.attendance) : (record.attendance || []); } catch (e) {}

      const memberId = person.ID || person.id;
        const memberName = person.name || person.Name || 'Unknown';

      if (attendance.includes(memberId)) {
              return sendLineReply(event.replyToken, `${memberName} — already confirmed!`);
      }

      attendance.push(memberId);
        await firebase.updateData(collection, recordId, { attendance: JSON.stringify(attendance) });
        return sendLineReply(event.replyToken, `${memberName} attendance confirmed!`);
  }

  return Promise.resolve(null);
}

// ── Phase 5: LINE Event Router ───────────────────────
async function handleLineEvent(event) {
    if (event.type === 'follow') {
          return sendLineReply(event.replyToken, 'Welcome to Blood Pledge Notification System!\n\nCommands:\n- 名單 → Members\n- 拍賣 → Latest auction\n- BIND → Get LINE ID\n- STATS → Personal records\n- DIVIDEND → Payouts\n- 網頁 → Open admin panel');
    }

  if (event.type === 'postback') return handlePostbackEvent(event);
    if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);

  const text = event.message.text.trim();
    const lineUserId = event.source.userId;
    let replyText = 'Command not recognized.\n\nAvailable: 名單 / 拍賣 / BIND / STATS / DIVIDEND / 網頁';

  if (text === '名單') {
        const members = await firebase.getAllData('Members');
        const count = members.length;
        const TIER_ICON = { '核心': '★', '一般': '○', '試煉': '△', '外交': '◇', '預備': '□' };
        replyText = `Blood Pledge: ${count} members\n`;
        members.slice(0, 10).forEach(m => {
                const icon = TIER_ICON[m.tier] || '○';
                replyText += `${icon} ${m.name} (${m.job || ''})${m.notes ? ' | ' + m.notes : ''}\n`;
        });
        if (count > 10) replyText += `... and ${count - 10} more.`;

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
                replyText = `[${lastBattle.bossName || 'Unknown'}]\nTotal: ${totalLoot} Adena\nPlayers: ${participantCount}\nPer person: ${bonus} Adena`;
        } else { replyText = 'No battle records yet.'; }

  } else if (text === '網頁') {
        const liffId = process.env.LIFF_ID || '';
        if (liffId) {
                replyText = `Open management panel:\nhttps://liff.line.me/${liffId}`;
        } else {
                replyText = 'Please open the admin panel from the menu.';
        }

  } else if (text === 'BIND' || text === '綁定') {
        replyText = `Your LINE User ID:\n${lineUserId}\n\nShare this with your administrator to complete binding.`;

  } else if (text === 'STATS' || text === '我的資料') {
        const [members, alliances, battles, sieges] = await Promise.all([
                firebase.getAllData('Members'), firebase.getAllData('Alliances'),
                firebase.getAllData('Battles'), firebase.getAllData('Sieges')
              ]);
        const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);
        if (!person) {
                replyText = 'No bound account found.\nSend "BIND" to get your LINE ID.';
        } else {
                const personId = person.ID || person.id;
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
                replyText = `${person.name || person.Name}\nClass: ${person.job || '-'} | Tier: ${person.tier || '-'}\n\nBosses: ${battleCount}\nSieges: ${siegeCount}\nTotal earned: ${totalDiv.toLocaleString()} Adena`;
        }

  } else if (text === 'DIVIDEND' || text === '分紅') {
        const battles = await firebase.getAllData('Battles');
        const [members, alliances] = await Promise.all([firebase.getAllData('Members'), firebase.getAllData('Alliances')]);
        const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);
        if (!person) {
                replyText = 'No bound account. Send "BIND" to get your LINE ID.';
        } else {
                const personId = person.ID || person.id;
                const recent = battles
                  .filter(b => { let att = []; try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch(e){} return att.includes(personId); })
                  .sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt))
                  .slice(0, 5);
                if (recent.length === 0) {
                          replyText = 'No dividend records found.';
                } else {
                          replyText = `Recent dividends for ${person.name || person.Name}:\n`;
                          recent.forEach(b => {
                                      const d = new Date(b.time || b.createdAt).toLocaleDateString('zh-TW');
                                      replyText += `${d} ${b.bossName || '-'}: ${Number(b.revenuePerPerson || 0).toLocaleString()} Adena\n`;
                          });
                }
        }
  }

  return sendLineReply(event.replyToken, replyText);
}

// ── JSON body parser ─────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Phase 5: LINE Status Endpoint ───────────────────
app.get('/api/line/status', async (req, res) => {
    const hasToken = !!(process.env.LINE_CHANNEL_ACCESS_TOKEN);
    const hasSecret = !!(process.env.LINE_CHANNEL_SECRET);
    const liffId = process.env.LIFF_ID || null;
    let botProfile = null;
    if (hasToken && process.env.LINE_CHANNEL_ACCESS_TOKEN !== 'DUMMY_TOKEN') {
          try {
                  botProfile = await getLineClient().getBotInfo();
          } catch (e) {
                  botProfile = { error: e.message };
          }
    }
    res.json({
          ok: hasToken && hasSecret,
          hasToken,
          hasSecret,
          liffId,
          botProfile,
          phase: 5,
          webhookUrl: process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}/api/webhook`
                  : null
    });
});

// ── Phase 6: LIFF Config Endpoint ───────────────────
app.get('/api/liff/config', (req, res) => {
    const liffId = process.env.LIFF_ID || '';
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
    res.json({
          liffId,
          liffUrl: liffId ? `https://liff.line.me/${liffId}` : null,
          baseUrl,
          features: {
                  attendance: true,
                  profile: true,
                  dividends: true
          },
          phase: 6
    });
});

// ── Phase 6: LIFF Profile Endpoint ──────────────────
app.post('/api/liff/profile', async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
    try {
          const profileData = await new Promise((resolve, reject) => {
                  https.get(`https://api.line.me/v2/profile`, {
                            headers: { Authorization: `Bearer ${accessToken}` }
                  }, (r) => {
                            let data = '';
                            r.on('data', c => data += c);
                            r.on('end', () => {
                                        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                            });
                  }).on('error', reject);
          });
          const [members, alliances] = await Promise.all([
                  firebase.getAllData('Members'),
                  firebase.getAllData('Alliances')
                ]);
          const boundMember = [...members, ...alliances].find(p => p.lineUserId === profileData.userId);
          res.json({
                  ok: true,
                  lineProfile: profileData,
                  boundMember: boundMember || null,
                  isBound: !!boundMember
          });
    } catch (e) {
          res.status(500).json({ error: e.message });
    }
});

// ── Phase 6: LIFF Attendance Confirm via Web ─────────
app.post('/api/liff/attend', async (req, res) => {
    const { lineUserId, recordId, type } = req.body;
    if (!lineUserId || !recordId || !type) {
          return res.status(400).json({ error: 'Missing required fields' });
    }
    const collection = type === 'siege' ? 'Sieges' : 'Battles';
    const [members, alliances] = await Promise.all([
          firebase.getAllData('Members'),
          firebase.getAllData('Alliances')
        ]);
    const person = [...members, ...alliances].find(p => p.lineUserId === lineUserId);
    if (!person) return res.status(404).json({ error: 'Member not found. Please bind your account first.' });
    const record = await firebase.getDocument(collection, recordId);
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    let attendance = [];
    try { attendance = typeof record.attendance === 'string' ? JSON.parse(record.attendance) : (record.attendance || []); } catch (e) {}
    const memberId = person.ID || person.id;
    if (attendance.includes(memberId)) {
          return res.json({ ok: true, alreadyConfirmed: true, memberName: person.name || person.Name });
    }
    attendance.push(memberId);
    await firebase.updateData(collection, recordId, { attendance: JSON.stringify(attendance) });
    res.json({ ok: true, alreadyConfirmed: false, memberName: person.name || person.Name });
});

// ── Google Admin Auth ────────────────────────────────
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

async function requireAdmin(req, res, next) {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length === 0) { console.warn('ADMIN_EMAILS not configured — open mode'); return next(); }
    const token = req.headers['x-google-token'];
    if (!token) return res.status(401).json({ error: 'Not authenticated. Please sign in as admin.' });
    const payload = await verifyGoogleToken(token);
    if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid credentials' });
    if (!adminEmails.includes(payload.email.toLowerCase())) return res.status(403).json({ error: `${payload.email} is not an authorized admin` });
    req.adminEmail = payload.email;
    next();
}

async function requireAuth(req, res, next) {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length === 0) return next();
    const token = req.headers['x-google-token'];
    if (!token) return res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    const payload = await verifyGoogleToken(token);
    if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid credentials' });
    req.userEmail = payload.email;
    req.userName = payload.name;
    next();
}

// ── System Endpoints ─────────────────────────────────
app.get('/api/config', (req, res) => {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    res.json({
          openMode: adminEmails.length === 0,
          googleClientId: process.env.GOOGLE_CLIENT_ID || '',
          liffId: process.env.LIFF_ID || '',
          phases: { 1: 'complete', 2: 'complete', 3: 'complete', 4: 'complete', 5: 'complete', 6: 'complete' }
    });
});

app.get('/api/status', (req, res) => {
    res.json({
          ok: true,
          storageMode: firebase.getStorageMode(),
          timestamp: new Date().toISOString(),
          version: '4.0',
          phases: { 1: 'complete', 2: 'complete', 3: 'complete', 4: 'complete', 5: 'complete', 6: 'complete' }
    });
});

// ── Auth Endpoints ───────────────────────────────────
app.post('/api/auth/verify', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const payload = await verifyGoogleToken(token);
    if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid token' });
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const isAdmin = adminEmails.length === 0 || adminEmails.includes(payload.email.toLowerCase());
    res.json({ email: payload.email, name: payload.name, picture: payload.picture, isAdmin });
});

// ── Helpers ──────────────────────────────────────────
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── LINE Broadcast API ───────────────────────────────
app.post('/api/line/broadcast', requireAdmin, async (req, res) => {
    const { recordId, type, bossName, castle, time, notes, broadcastMode = 'bound', tiers = [] } = req.body;
    if (!recordId || !type) return res.status(400).json({ error: 'Missing required fields' });

           const issiege = type === 'siege';
    const title = issiege ? 'Siege Battle Call!' : 'Boss Hunt Call!';
    const targetName = bossName || castle || 'Unknown';
    const timeStr = time
      ? new Date(time).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : 'On-demand';

           const liffId = process.env.LIFF_ID || '';
    const attendAction = liffId
      ? { type: 'uri', label: 'Confirm Attendance', uri: `https://liff.line.me/${liffId}?type=${type}&id=${recordId}` }
          : { type: 'postback', label: 'Confirm Attendance', data: `action=attend&type=${type}&id=${recordId}`, displayText: 'Attending!' };

           const TIER_LABEL = { '核心': 'CORE', '一般': 'STANDARD', '試煉': 'TRIAL', '外交': 'DIPLOMAT', '預備': 'RESERVE' };
    const flexMessage = {
          type: 'flex',
          altText: `${title} — ${targetName}`,
          contents: {
                  type: 'bubble',
                  header: {
                            type: 'box', layout: 'vertical',
                            backgroundColor: '#111111', paddingAll: '16px',
                            contents: [
                              { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#ffe600' },
                                        ...(broadcastMode === 'tier' && tiers.length > 0 ? [{
                                                      type: 'text',
                                                      text: tiers.map(t => TIER_LABEL[t] || t).join(' / ') + ' Exclusive',
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
                                              { type: 'text', text: 'Muster Time', size: 'sm', color: '#666666', flex: 3 },
                                              { type: 'text', text: timeStr, size: 'sm', weight: 'bold', flex: 4, wrap: true }
                                                          ]
                              },
                                        ...(notes ? [{
                                                      type: 'box', layout: 'horizontal', margin: 'sm',
                                                      contents: [
                                                        { type: 'text', text: 'Notes', size: 'sm', color: '#666666', flex: 3 },
                                                        { type: 'text', text: notes, size: 'sm', wrap: true, flex: 4 }
                                                                    ]
                                        }] : [])
                                      ]
                  },
                  footer: {
                            type: 'box', layout: 'vertical', paddingAll: '12px',
                            contents: [{
                                        type: 'button',
                                        action: attendAction,
                                        style: 'primary', color: '#ff3333', height: 'sm'
                            }],
                            styles: { separator: true }
                  }
          }
    };

           try {
                 const [members, alliances] = await Promise.all([firebase.getAllData('Members'), firebase.getAllData('Alliances')]);
                 const client = getLineClient();

      if (broadcastMode === 'all') {
              await client.broadcast({ messages: [flexMessage] });
              return res.json({ ok: true, method: 'all', sent: null });
      }

      if (broadcastMode === 'tier') {
              if (!tiers || tiers.length === 0) return res.status(400).json({ error: 'Please select at least one tier' });
              const targetUserIds = members
                .filter(m => m.lineUserId && tiers.includes(m.tier || '一般'))
                .map(m => m.lineUserId)
                .filter((v, i, a) => a.indexOf(v) === i);
              if (targetUserIds.length === 0) return res.status(400).json({ error: `No bound members in selected tiers: [${tiers.join('/')}]` });
              await client.multicast({ to: targetUserIds, messages: [flexMessage] });
              return res.json({ ok: true, method: 'tier', sent: targetUserIds.length });
      }

      const boundUserIds = [...members, ...alliances]
                   .filter(p => p.lineUserId)
                   .map(p => p.lineUserId)
                   .filter((v, i, a) => a.indexOf(v) === i);

      if (boundUserIds.length > 0) {
              await client.multicast({ to: boundUserIds, messages: [flexMessage] });
              return res.json({ ok: true, method: 'bound', sent: boundUserIds.length });
      } else {
              await client.broadcast({ messages: [flexMessage] });
              return res.json({ ok: true, method: 'all', sent: null, note: 'No bound members, broadcast to all followers' });
      }
           } catch (e) {
                 console.error('LINE broadcast error:', e);
                 res.status(500).json({ error: e.message || 'Broadcast failed. Check LINE Token configuration.' });
           }
});

// ── LINE Binding API ─────────────────────────────────
app.put('/api/members/:id/line-bind', requireAdmin, async (req, res) => {
    const { lineUserId } = req.body;
    if (!lineUserId) return res.status(400).json({ error: 'Missing lineUserId' });
    await firebase.updateData('Members', req.params.id, { lineUserId });
    res.json({ ok: true });
});

app.delete('/api/members/:id/line-bind', requireAdmin, async (req, res) => {
    await firebase.updateData('Members', req.params.id, { lineUserId: null });
    res.json({ ok: true });
});

app.put('/api/alliances/:id/line-bind', requireAdmin, async (req, res) => {
    const { lineUserId } = req.body;
    if (!lineUserId) return res.status(400).json({ error: 'Missing lineUserId' });
    await firebase.updateData('Alliances', req.params.id, { lineUserId });
    res.json({ ok: true });
});

app.delete('/api/alliances/:id/line-bind', requireAdmin, async (req, res) => {
    await firebase.updateData('Alliances', req.params.id, { lineUserId: null });
    res.json({ ok: true });
});

// ── Members CRUD ─────────────────────────────────────
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

// ── Battles CRUD ─────────────────────────────────────
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

// ── Sieges CRUD ──────────────────────────────────────
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

// ── Alliances CRUD ───────────────────────────────────
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

// ── Treasury CRUD ────────────────────────────────────
app.get('/api/treasury', async (req, res) => {
    const transactions = await firebase.getAllData('Treasury');
    res.json(transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post('/api/treasury', requireAdmin, async (req, res) => {
    const tx = { ID: uid(), createdAt: new Date().toISOString(), createdBy: req.adminEmail || 'open_mode', ...req.body };
    await firebase.addData('Treasury', tx);
    res.json(tx);
});

app.delete('/api/treasury/:id', requireAdmin, async (req, res) => {
    await firebase.deleteData('Treasury', req.params.id);
    res.json({ ok: true });
});

// ── Permissions API (Phase dashboard) ───────────────
app.get('/api/permissions', (req, res) => {
    res.json({
          phases: [
            { id: 1, name: 'Frontend UI', status: 'complete', description: 'Main dashboard, members, battles, sieges, treasury' },
            { id: 2, name: 'Auth + LINE', status: 'complete', description: 'Google OAuth admin auth, LINE account binding' },
            { id: 3, name: 'Backend Bridge', status: 'complete', description: 'Firebase Firestore integration, REST API' },
            { id: 4, name: 'LINE Bot Core', status: 'complete', description: 'Messaging commands, broadcast, postback' },
            { id: 5, name: 'Automation', status: 'complete', description: 'Webhook verification, HMAC validation, auto-attendance' },
            { id: 6, name: 'LIFF Integration', status: 'complete', description: 'LIFF profile, web attendance confirmation, deep links' }
                ],
          endpoints: [
            { method: 'GET/POST', path: '/api/members/:id', desc: 'Member CRUD', status: 'exists' },
            { method: 'POST', path: '/api/auth/verify', desc: 'Google OAuth verify', status: 'exists' },
            { method: 'GET', path: '/api/webhook', desc: 'LINE Webhook verification', status: 'exists' },
            { method: 'POST', path: '/api/webhook', desc: 'LINE Bot events', status: 'exists' },
            { method: 'GET', path: '/api/line/status', desc: 'LINE integration status', status: 'exists' },
            { method: 'GET', path: '/api/liff/config', desc: 'LIFF configuration', status: 'exists' },
            { method: 'POST', path: '/api/liff/profile', desc: 'LIFF user profile', status: 'exists' },
            { method: 'POST', path: '/api/liff/attend', desc: 'LIFF attendance confirm', status: 'exists' },
            { method: 'POST', path: '/api/line/broadcast', desc: 'LINE broadcast/multicast', status: 'exists' }
                ]
    });
});

// ── Serve frontend ───────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n Blood Pledge Command Center - Phase 5+6 Complete`);
    console.log(` Local: http://localhost:${PORT}`);
    console.log(` Webhook: /api/webhook (GET: verify, POST: events)`);
    console.log(` LIFF: /api/liff/config\n`);
});

module.exports = app;
