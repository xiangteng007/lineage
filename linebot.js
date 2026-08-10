'use strict';

/**
 * @fileoverview LINE Bot webhook handler for Lineage AI guild management system.
 * Exports setupLineBot(app) to mount /webhook/line and /api/line-auth routes.
 *
 * Supported commands:
 *   綁定              → Start bind flow (6-digit code)
 *   更新等級 {角色} {Lv} → Update character level
 *   報名首領           → Register for boss battle (Flex Message)
 *   報名攻城           → Register for siege (Flex Message)
 *   報名守城           → Register for castle defense (Flex Message)
 *   我的資料           → Personal profile Flex Message
 *   公告              → Latest guild announcement
 *   出席 {id} {names}  → (幹部) Set attendees for battle/siege
 *   生成綁定碼         → (幹部) Generate a 6-digit bind code
 */

const line = require('@line/bot-sdk');
const store = require('./firebase');             // 本地資料層（PostgreSQL，API 同舊 Firestore）
const authTokens = require('./lib/auth-tokens');  // 本地 JWT（取代 Firebase Auth custom token）

// 取代 FieldValue.serverTimestamp()
const FieldValue = { serverTimestamp: () => new Date().toISOString() };

// ── Firestore 相容薄殼（後接本地 store）──────────────────────────────────
// linebot 原本大量使用 admin.firestore() 的鏈式 API。為了把資料層換成
// PostgreSQL 又不動到每個呼叫點，這裡用 store 重建等價的最小 Firestore 介面：
//   collection().where().orderBy().limit().get()
//   collection().doc().get()/set()/update()、collection().add()
//   snapshot：empty/size/docs/forEach；doc：exists/id/data()/ref.update()
function _querySnap(name, rows) {
  const docs = rows.map(r => ({
    id: r.id,
    data: () => r,
    ref: { update: (patch) => store.updateData(name, r.id, patch) },
  }));
  return { empty: docs.length === 0, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
}
function _docSnap(name, id, data) {
  return {
    id,
    exists: data != null,
    data: () => (data == null ? undefined : data),
    ref: { update: (patch) => store.updateData(name, id, patch) },
  };
}
function _query(name, where, order, lim) {
  return {
    where: (f, op, v) => _query(name, [...where, [f, op, v]], order, lim),
    orderBy: (f, dir) => _query(name, where, [...order, [f, dir || 'asc']], lim),
    limit: (n) => _query(name, where, order, n),
    get: async () => _querySnap(name, await store.queryCollection(name, { where, orderBy: order, limit: lim || undefined })),
  };
}
function _collection(name) {
  const q = _query(name, [], [], null);
  return {
    where: q.where,
    orderBy: q.orderBy,
    limit: q.limit,
    get: async () => _querySnap(name, await store.getAllData(name)),
    doc: (id) => ({
      get: async () => _docSnap(name, id, await store.getDocument(name, id)),
      set: async (data, opts) => (opts && opts.merge)
        ? store.upsertData(name, id, data)
        : store.addData(name, { ...data, ID: id }),
      update: (patch) => store.updateData(name, id, patch),
    }),
    add: async (data) => { const saved = await store.addData(name, data); return { id: saved && saved.ID }; },
  };
}
/** Firestore 相容入口（取代 admin.firestore()）。 */
function db() { return { collection: _collection }; }

// ── LINE client factory ────────────────────────────────────────────────────
function getLineConfig() {
  return {
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN',
  };
}

function getClient() {
  const { channelAccessToken } = getLineConfig();
  return new line.messagingApi.MessagingApiClient({ channelAccessToken });
}

// ── Session state machine ──────────────────────────────────────────────────
/**
 * In-memory session store keyed by LINE userId.
 * Shape: { step: string, data: Object, expires: number }
 */
const userSessions = new Map();

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes of inactivity

function getSession(userId) {
  const s = userSessions.get(userId);
  if (!s) return null;
  if (Date.now() > s.expires) { userSessions.delete(userId); return null; }
  return s;
}

function setSession(userId, step, data = {}) {
  userSessions.set(userId, { step, data, expires: Date.now() + SESSION_TTL_MS });
}

function clearSession(userId) {
  userSessions.delete(userId);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reply with one or more messages.
 * @param {string} replyToken
 * @param {Array|Object} messages
 */
async function reply(replyToken, messages) {
  try {
    const msgs = Array.isArray(messages) ? messages : [messages];
    await getClient().replyMessage({ replyToken, messages: msgs });
  } catch (err) {
    console.error('[linebot] reply error:', err.message);
  }
}

/**
 * Reply with plain text.
 * @param {string} replyToken
 * @param {string} text
 */
async function replyText(replyToken, text) {
  return reply(replyToken, [{ type: 'text', text }]);
}

/**
 * Lookup a member/alliance document by LINE userId.
 * @param {string} lineUserId
 * @returns {Promise<Object|null>}
 */
async function findMemberByLineId(lineUserId) {
  try {
    const [mSnap, aSnap] = await Promise.all([
      db().collection('Members').where('lineUserId', '==', lineUserId).limit(1).get(),
      db().collection('Alliances').where('lineUserId', '==', lineUserId).limit(1).get(),
    ]);
    if (!mSnap.empty) return { id: mSnap.docs[0].id, ...mSnap.docs[0].data(), _collection: 'Members' };
    if (!aSnap.empty) return { id: aSnap.docs[0].id, ...aSnap.docs[0].data(), _collection: 'Alliances' };
    return null;
  } catch (err) {
    console.error('[linebot] findMemberByLineId error:', err.message);
    return null;
  }
}

/**
 * Lookup a member by character name.
 * @param {string} charName
 * @returns {Promise<Object|null>}
 */
async function findMemberByCharName(charName) {
  try {
    const snap = await db().collection('Members')
      .where('name', '==', charName).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    return null;
  } catch (err) {
    console.error('[linebot] findMemberByCharName error:', err.message);
    return null;
  }
}

/**
 * Generate a random 6-digit numeric code as a string.
 * @returns {string}
 */
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Flex Message builders ──────────────────────────────────────────────────

/**
 * Build a Flex Message bubble for a battle/siege event.
 * @param {Object} event - Firestore document
 * @param {'boss'|'siege'} type
 * @returns {Object} LINE Flex bubble object
 */
function buildEventBubble(event, type) {
  const typeLabel = type === 'boss' ? '首領戰' : (event.siegeType === 'attack' ? '攻城戰' : '守城戰');
  const actionBoss = type === 'boss' ? 'boss' : 'siege';
  const count = Array.isArray(event.registrations) ? event.registrations.length : 0;
  const dateStr = event.date || event.time || '日期未定';
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#1a1a2e',
      contents: [{
        type: 'text', text: typeLabel, color: '#e2b96f', weight: 'bold', size: 'sm',
      }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        { type: 'text', text: event.bossName || event.name || '未命名', weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: `📅 ${dateStr}`, size: 'sm', color: '#888888' },
        { type: 'text', text: `👥 已報名：${count} 人`, size: 'sm', color: '#888888' },
      ],
    },
    footer: {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        {
          type: 'button', style: 'primary', height: 'sm',
          color: '#e2b96f',
          action: {
            type: 'postback', label: '報名',
            data: `action=linebot_register&type=${actionBoss}&id=${event.id}`,
            displayText: '報名',
          },
        },
        {
          type: 'button', style: 'secondary', height: 'sm',
          action: {
            type: 'postback', label: '取消報名',
            data: `action=linebot_unregister&type=${actionBoss}&id=${event.id}`,
            displayText: '取消報名',
          },
        },
      ],
    },
  };
}

/**
 * Build a Flex Message carousel for a list of events.
 * @param {Array} events
 * @param {'boss'|'siege'} type
 * @returns {Object} LINE Flex Carousel message
 */
function buildEventCarousel(events, type) {
  if (!events.length) return null;
  return {
    type: 'flex',
    altText: type === 'boss' ? '首領戰場次列表' : '攻/守城戰場次列表',
    contents: {
      type: 'carousel',
      contents: events.slice(0, 10).map(ev => buildEventBubble(ev, type)),
    },
  };
}

/**
 * Build a personal profile Flex Message.
 * @param {Object} member
 * @param {Object} stats - { battleCount, siegeCount, totalDiv }
 * @returns {Object} LINE Flex message
 */
function buildProfileFlex(member, stats) {
  const TIER_LABEL = { '核心': '⭐ 核心', '一般': '○ 一般', '試煉': '△ 試煉', '外交': '◇ 外交' };
  const tierStr = TIER_LABEL[member.tier] || '○ 一般';
  const chars = Array.isArray(member.characters) ? member.characters : [];

  const charRows = chars.map(c => ({
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: c.name || '未知', size: 'sm', flex: 3 },
      { type: 'text', text: c.job || '—', size: 'sm', flex: 2, color: '#888888' },
      { type: 'text', text: c.level ? `Lv${c.level}` : '—', size: 'sm', flex: 1, color: '#888888', align: 'end' },
    ],
  }));

  // Fallback: if no characters array, show root-level fields
  if (!charRows.length) {
    charRows.push({
      type: 'box', layout: 'horizontal',
      contents: [
        { type: 'text', text: member.name || '—', size: 'sm', flex: 3 },
        { type: 'text', text: member.job || '—', size: 'sm', flex: 2, color: '#888888' },
        { type: 'text', text: member.level ? `Lv${member.level}` : '—', size: 'sm', flex: 1, color: '#888888', align: 'end' },
      ],
    });
  }

  return {
    type: 'flex',
    altText: `${member.name || '成員'} 的個人資料`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a1a2e',
        contents: [{
          type: 'text', text: '🛡️ 個人資料', color: '#e2b96f', weight: 'bold',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'LINE 名稱', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: member.displayName || member.name || '—', size: 'sm', flex: 3 },
            ],
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '公會階級', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: tierStr, size: 'sm', flex: 3 },
            ],
          },
          { type: 'separator' },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '角色名', size: 'xs', color: '#aaaaaa', flex: 3, weight: 'bold' },
              { type: 'text', text: '職業', size: 'xs', color: '#aaaaaa', flex: 2, weight: 'bold' },
              { type: 'text', text: '等級', size: 'xs', color: '#aaaaaa', flex: 1, weight: 'bold', align: 'end' },
            ],
          },
          ...charRows,
          { type: 'separator' },
          {
            type: 'box', layout: 'vertical', spacing: 'xs',
            contents: [
              { type: 'text', text: `⚔️ 首領戰出席：${stats.battleCount} 次`, size: 'sm' },
              { type: 'text', text: `🏰 攻城戰出席：${stats.siegeCount} 次`, size: 'sm' },
              { type: 'text', text: `💰 累計分紅：${stats.totalDiv.toLocaleString()} 天幣`, size: 'sm' },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Build a job selection quick-reply buttons message.
 * @param {string} replyToken
 */
async function sendJobSelector(replyToken) {
  const jobs = ['劍士', '精靈', '法師', '黑暗精靈', '龍騎士'];
  await reply(replyToken, [{
    type: 'text',
    text: '請選擇職業：',
    quickReply: {
      items: jobs.map(job => ({
        type: 'action',
        action: { type: 'message', label: job, text: job },
      })),
    },
  }]);
}

// ── Command handlers ───────────────────────────────────────────────────────

/**
 * Handle the "follow" event (first subscribe).
 */
async function handleFollow(event) {
  await replyText(event.replyToken,
    '🛡️ 歡迎加入 Overnight Shuttle 血盟通知系統！\n\n可用指令：\n' +
    '・綁定 → 綁定公會帳號\n' +
    '・更新等級 {角色名} {等級} → 更新角色等級\n' +
    '・報名首領 / 報名攻城 / 報名守城 → 活動報名\n' +
    '・我的資料 → 個人檔案\n' +
    '・公告 → 最新公告\n\n' +
    '【幹部指令】\n' +
    '・生成綁定碼 → 產生新成員綁定碼\n' +
    '・出席 {battleId} {角色1},{角色2} → 更新出席名單'
  );
}

/**
 * Handle session-driven multi-step bind flow.
 * @param {Object} event
 * @param {Object|null} session
 * @param {string} text
 */
async function handleBindFlow(event, session, text) {
  const { replyToken, source: { userId } } = event;

  // Step 0: user typed "綁定"
  if (!session || session.step === 'idle') {
    setSession(userId, 'bind_await_code');
    return replyText(replyToken, '請輸入你的公會綁定碼（6位數字，由幹部提供）：');
  }

  // Step 1: awaiting bind code
  if (session.step === 'bind_await_code') {
    if (!/^\d{6}$/.test(text)) {
      return replyText(replyToken, '❌ 綁定碼格式錯誤，請輸入 6 位數字，或輸入「取消」結束。');
    }
    try {
      const codeDoc = await db().collection('bindCodes').doc(text).get();
      if (!codeDoc.exists) {
        return replyText(replyToken, '❌ 綁定碼無效，請確認後再試，或請幹部重新生成。');
      }
      const codeData = codeDoc.data();
      if (codeData.used) {
        return replyText(replyToken, '❌ 此綁定碼已被使用。請請幹部重新生成。');
      }
      // expiresAt may be a Firestore Timestamp (member-flow) or ISO string (admin-flow)
      const expiresAtMs = codeData.expiresAt && (codeData.expiresAt.toDate
        ? codeData.expiresAt.toDate().getTime()
        : Date.parse(codeData.expiresAt));
      if (expiresAtMs && expiresAtMs < Date.now()) {
        return replyText(replyToken, '❌ 綁定碼已過期（有效期 24 小時）。請請幹部重新生成。');
      }

      // ── Admin-bind branch: skip the new-member onboarding flow ──
      if (codeData.adminEmail) {
        const email = String(codeData.adminEmail).toLowerCase();
        // Best-effort LINE displayName lookup for nicer console + audit
        let displayName = '';
        try {
          const profile = await getClient().getProfile(userId);
          displayName = (profile && profile.displayName) || '';
        } catch (_) {}
        await db().collection('adminLineBinds').doc(email).set({
          email,
          lineUserId: userId,
          displayName,
          boundAt: FieldValue.serverTimestamp(),
        });
        await db().collection('bindCodes').doc(text).update({
          used: true,
          usedBy: userId,
          usedAt: FieldValue.serverTimestamp(),
        });
        clearSession(userId);
        return replyText(replyToken,
          `✅ 管理員 LINE 綁定成功！\n${email}\n你已加入血盟廣播通知名單。\n\n如需解綁，請至後台「LINE 綁定」面板。`
        );
      }

      // ── Member-bind branch (original flow) ──
      setSession(userId, 'bind_await_name', { code: text });
      return replyText(replyToken,
        '✅ 綁定碼驗證成功！歡迎加入 Overnight Shuttle\n你的身份：[成員] 新人\n\n請輸入你的遊戲角色名稱：'
      );
    } catch (err) {
      console.error('[linebot] bind code check error:', err.message);
      return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
    }
  }

  // Step 2: awaiting character name
  if (session.step === 'bind_await_name') {
    const charName = text.trim();
    if (!charName) return replyText(replyToken, '❌ 角色名稱不能為空，請重新輸入：');
    setSession(userId, 'bind_await_job', { ...session.data, charName });
    await reply(replyToken, [{
      type: 'text',
      text: `確認你的角色資訊？\n角色名：${charName}\n\n請選擇職業：`,
      quickReply: {
        items: ['劍士', '精靈', '法師', '黑暗精靈', '龍騎士'].map(job => ({
          type: 'action',
          action: { type: 'message', label: job, text: job },
        })),
      },
    }]);
    return;
  }

  // Step 3: awaiting job selection
  if (session.step === 'bind_await_job') {
    const validJobs = ['劍士', '精靈', '法師', '黑暗精靈', '龍騎士'];
    if (!validJobs.includes(text)) {
      return sendJobSelector(replyToken);
    }
    setSession(userId, 'bind_await_level', { ...session.data, job: text });
    return replyText(replyToken, `職業：${text}\n\n請輸入角色等級（1-99）：`);
  }

  // Step 4: awaiting level
  if (session.step === 'bind_await_level') {
    const level = parseInt(text, 10);
    if (isNaN(level) || level < 1 || level > 99) {
      return replyText(replyToken, '❌ 請輸入有效等級（1-99）：');
    }
    const { code, charName, job } = session.data;
    try {
      // Get display name from LINE profile
      let displayName = charName;
      try {
        const profile = await getClient().getProfile(userId);
        displayName = profile.displayName || charName;
      } catch (_) { /* ignore */ }

      const newMember = {
        lineUserId: userId,
        displayName,
        name: charName,
        job,
        level,
        tier: '試煉',
        createdAt: FieldValue.serverTimestamp(),
        characters: [{ name: charName, job, level }],
      };
      const docRef = await db().collection('Members').add(newMember);
      // Mark bind code as used
      await db().collection('bindCodes').doc(code).update({
        used: true,
        usedBy: userId,
        usedAt: FieldValue.serverTimestamp(),
      });
      clearSession(userId);
      return replyText(replyToken,
        `✅ 角色設定完成！\n\n角色名：${charName}\n職業：${job}\n等級：Lv${level}\n\n你可以到網頁查看個人檔案。`
      );
    } catch (err) {
      console.error('[linebot] bind save error:', err.message);
      clearSession(userId);
      return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
    }
  }
}

/**
 * Handle "更新等級 {角色名} {等級}"
 */
async function handleUpdateLevel(event, text) {
  const { replyToken, source: { userId } } = event;
  try {
    // Format: 更新等級 角色名 等級
    const match = text.match(/^更新等級\s+(\S+)\s+(\d+)$/);
    if (!match) {
      return replyText(replyToken, '格式：更新等級 {角色名} {等級}\n例：更新等級 流浪者 85');
    }
    const [, charName, levelStr] = match;
    const level = parseInt(levelStr, 10);
    if (level < 1 || level > 99) {
      return replyText(replyToken, '❌ 等級必須介於 1 至 99 之間。');
    }

    const member = await findMemberByLineId(userId);
    if (!member) {
      return replyText(replyToken, '❌ 您尚未綁定帳號，請先傳送「綁定」。');
    }

    // Verify ownership: charName must match member.name or exist in member.characters[]
    const chars = Array.isArray(member.characters) ? member.characters : [];
    const isOwner =
      (member.name || '').toLowerCase() === charName.toLowerCase() ||
      chars.some(c => (c.name || '').toLowerCase() === charName.toLowerCase());

    if (!isOwner) {
      return replyText(replyToken, `❌ 角色「${charName}」不屬於您的帳號，無法更新。`);
    }

    // Update root-level fields if name matches root; also update characters array
    const updatePayload = {};
    if ((member.name || '').toLowerCase() === charName.toLowerCase()) {
      updatePayload.level = level;
    }
    if (chars.length) {
      const updatedChars = chars.map(c =>
        (c.name || '').toLowerCase() === charName.toLowerCase() ? { ...c, level } : c
      );
      updatePayload.characters = updatedChars;
    }

    await db().collection(member._collection || 'Members').doc(member.id).update(updatePayload);
    return replyText(replyToken, `✅ ${charName} 等級已更新為 Lv${level}`);
  } catch (err) {
    console.error('[linebot] updateLevel error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

/**
 * Handle boss/siege registration listing.
 * @param {Object} event
 * @param {'boss'|'siege'} type
 * @param {'attack'|'defend'|null} siegeType - for siege sub-type filtering
 */
async function handleListEvents(event, type, siegeType) {
  const { replyToken } = event;
  try {
    const collection = type === 'boss' ? 'Battles' : 'Sieges';
    let query = db().collection(collection).where('settled', '==', false);
    if (type === 'siege' && siegeType) {
      query = query.where('siegeType', '==', siegeType);
    }
    const snap = await query.orderBy('date', 'asc').limit(10).get();

    if (snap.empty) {
      const label = type === 'boss' ? '首領戰' : (siegeType === 'attack' ? '攻城戰' : '守城戰');
      return replyText(replyToken, `目前沒有近期${label}場次。`);
    }

    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const flexMsg = buildEventCarousel(events, type);
    if (!flexMsg) return replyText(replyToken, '⚠️ 無法載入場次資訊');
    return reply(replyToken, [flexMsg]);
  } catch (err) {
    console.error('[linebot] listEvents error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

/**
 * Handle "我的資料"
 */
async function handleMyProfile(event) {
  const { replyToken, source: { userId } } = event;
  try {
    const member = await findMemberByLineId(userId);
    if (!member) {
      return replyText(replyToken, '❌ 您尚未綁定帳號，請先傳送「綁定」。');
    }

    const [battles, sieges] = await Promise.all([
      db().collection('Battles').get(),
      db().collection('Sieges').get(),
    ]);

    const memberId = member.id;
    let battleCount = 0, siegeCount = 0, totalDiv = 0;

    battles.forEach(doc => {
      const b = doc.data();
      let att = [];
      try { att = typeof b.attendance === 'string' ? JSON.parse(b.attendance) : (b.attendance || []); } catch (_) {}
      if (att.includes(memberId)) {
        battleCount++;
        totalDiv += Math.floor(Number(b.revenuePerPerson || 0));
      }
    });
    sieges.forEach(doc => {
      const s = doc.data();
      let att = [];
      try { att = typeof s.attendance === 'string' ? JSON.parse(s.attendance) : (s.attendance || []); } catch (_) {}
      if (att.includes(memberId)) {
        siegeCount++;
        totalDiv += Math.floor(Number(s.revenuePerPerson || 0));
      }
    });

    // Enrich with LINE display name
    try {
      const profile = await getClient().getProfile(userId);
      member.displayName = profile.displayName || member.displayName;
    } catch (_) { /* ignore */ }

    const flexMsg = buildProfileFlex(member, { battleCount, siegeCount, totalDiv });
    return reply(replyToken, [flexMsg]);
  } catch (err) {
    console.error('[linebot] myProfile error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

/**
 * Handle "公告"
 */
async function handleAnnouncement(event) {
  const { replyToken } = event;
  try {
    const doc = await db().collection('settings').doc('guild').get();
    if (!doc.exists || !doc.data().announcement) {
      return replyText(replyToken, '目前沒有公告。');
    }
    return replyText(replyToken, `📢 最新公告\n\n${doc.data().announcement}`);
  } catch (err) {
    console.error('[linebot] announcement error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

/**
 * Handle "生成綁定碼" (幹部 only)
 */
async function handleGenCode(event) {
  const { replyToken, source: { userId } } = event;
  try {
    const member = await findMemberByLineId(userId);
    if (!member || (member.roleLevel || 0) < 3) {
      return replyText(replyToken, '❌ 此指令限幹部（roleLevel ≥ 3）使用。');
    }
    const code = genCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db().collection('bindCodes').doc(code).set({
      code,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: expiresAt.toISOString(),
      used: false,
    });
    return replyText(replyToken, `🔑 綁定碼：${code}（24小時有效，請轉發給新成員）`);
  } catch (err) {
    console.error('[linebot] genCode error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

/**
 * Handle "出席 {battleId} {角色名1},{角色名2},..."  (幹部 only)
 */
async function handleSetAttendees(event, text) {
  const { replyToken, source: { userId } } = event;
  try {
    const match = text.match(/^出席\s+(\S+)\s+(.+)$/);
    if (!match) {
      return replyText(replyToken, '格式：出席 {battleId} {角色1},{角色2}\n例：出席 abc123 流浪者,龍騎士阿偉');
    }
    const [, battleId, namesStr] = match;
    const names = namesStr.split(',').map(n => n.trim()).filter(Boolean);

    const member = await findMemberByLineId(userId);
    if (!member || (member.roleLevel || 0) < 3) {
      return replyText(replyToken, '❌ 此指令限幹部（roleLevel ≥ 3）使用。');
    }

    // Try Battles first, then Sieges
    let collection = 'Battles';
    let docSnap = await db().collection('Battles').doc(battleId).get();
    if (!docSnap.exists) {
      docSnap = await db().collection('Sieges').doc(battleId).get();
      collection = 'Sieges';
    }
    if (!docSnap.exists) {
      return replyText(replyToken, `❌ 找不到 battleId：${battleId}`);
    }

    // Resolve names to member IDs
    const resolvePromises = names.map(n => findMemberByCharName(n));
    const resolved = await Promise.all(resolvePromises);
    const attendeeIds = resolved.filter(Boolean).map(m => m.id);
    const notFound = names.filter((_, i) => !resolved[i]);

    await db().collection(collection).doc(battleId).update({
      attendance: JSON.stringify(attendeeIds),
      attendees: attendeeIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    let msg = `✅ 已更新 ${battleId} 出席名單，共 ${attendeeIds.length} 人`;
    if (notFound.length) msg += `\n⚠️ 找不到角色：${notFound.join('、')}`;
    return replyText(replyToken, msg);
  } catch (err) {
    console.error('[linebot] setAttendees error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

// ── Postback handler ───────────────────────────────────────────────────────

/**
 * Handle postback events from Flex Message buttons.
 * @param {Object} event
 */
async function handlePostback(event) {
  const { replyToken, source: { userId }, postback } = event;
  try {
    const params = new URLSearchParams(postback.data);
    const action = params.get('action');
    const type = params.get('type');   // 'boss' | 'siege'
    const id = params.get('id');

    if (action === 'linebot_register' || action === 'linebot_unregister') {
      const member = await findMemberByLineId(userId);
      if (!member) {
        return replyText(replyToken, '❌ 您尚未綁定帳號，請先傳送「綁定」。');
      }

      const collection = type === 'boss' ? 'Battles' : 'Sieges';
      const docSnap = await db().collection(collection).doc(id).get();
      if (!docSnap.exists) {
        return replyText(replyToken, '❌ 找不到對應場次，可能已移除。');
      }

      const docData = docSnap.data();
      let regs = Array.isArray(docData.registrations) ? [...docData.registrations] : [];

      const isRegistering = action === 'linebot_register';
      const memberIdx = regs.indexOf(member.id);

      if (isRegistering) {
        if (memberIdx !== -1) {
          return replyText(replyToken, '✅ 您已報名此場次，無需重複操作。');
        }
        regs.push(member.id);
      } else {
        if (memberIdx === -1) {
          return replyText(replyToken, '您尚未報名此場次。');
        }
        regs.splice(memberIdx, 1);
      }

      await db().collection(collection).doc(id).update({ registrations: regs });

      const eventName = docData.bossName || docData.name || '未知場次';
      const dateStr = docData.date || docData.time || '';
      if (isRegistering) {
        return replyText(replyToken,
          `✅ 已預報名 ${eventName} ${dateStr}\n⚠️ 注意：實際出席名單由幹部確認，報名僅供參考`
        );
      } else {
        return replyText(replyToken, `✅ 已取消報名 ${eventName} ${dateStr}`);
      }
    }
  } catch (err) {
    console.error('[linebot] handlePostback error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

// ── Main event dispatcher ──────────────────────────────────────────────────

/**
 * Route a single LINE event to the correct handler.
 * @param {Object} event
 */
async function handleTreasury(event) {
  const { replyToken } = event;
  try {
    const snap = await db().collection('Transactions').get();
    let income = 0, expense = 0, mIncome = 0, mExpense = 0;
    const now = new Date();
    const ymNow = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    snap.forEach(doc => {
      const t = doc.data();
      const amt = Math.floor(Number(t.amount) || 0);
      if (t.type === 'income') income += amt; else if (t.type === 'expense') expense += amt;
      const d = new Date(t.createdAt || t.date || 0);
      const ym = isNaN(d.getTime()) ? '' : (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      if (ym === ymNow) { if (t.type === 'income') mIncome += amt; else if (t.type === 'expense') mExpense += amt; }
    });
    const balance = income - expense;
    const net = mIncome - mExpense;
    return replyText(replyToken,
      `\u{1F4B0} 血盟金庫\n目前公積金：${balance.toLocaleString()} 天幣\n\n本月收入：+${mIncome.toLocaleString()}\n本月支出：-${mExpense.toLocaleString()}\n本月淨額：${net >= 0 ? '+' : ''}${net.toLocaleString()}`);
  } catch (err) {
    console.error('[linebot] treasury error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

async function handleAttendanceRanking(event) {
  const { replyToken } = event;
  try {
    const [battles, sieges, members] = await Promise.all([
      db().collection('Battles').get(),
      db().collection('Sieges').get(),
      db().collection('Members').get(),
    ]);
    const tally = {};
    const tallyUp = (snap) => snap.forEach(doc => {
      const r = doc.data();
      let att = [];
      try { att = typeof r.attendance === 'string' ? JSON.parse(r.attendance) : (r.attendance || []); } catch (_) {}
      att.forEach(id => { tally[id] = (tally[id] || 0) + 1; });
    });
    tallyUp(battles); tallyUp(sieges);
    const nameById = {};
    members.forEach(doc => { const m = doc.data(); nameById[doc.id] = (m.name || m.Name || doc.id); });
    const ranked = Object.entries(tally)
      .map(([id, c]) => ({ name: nameById[id] || id, count: c }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
    if (!ranked.length) return replyText(replyToken, '目前尚無出席記錄。');
    const medal = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    return replyText(replyToken, '\u{1F3C6} 出席排行榜 TOP 10\n\n' +
      ranked.map((r, i) => `${medal[i] || (i + 1) + '.'} ${r.name} — ${r.count} 場`).join('\n'));
  } catch (err) {
    console.error('[linebot] ranking error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

async function handleMyRecords(event) {
  const { replyToken, source: { userId } } = event;
  try {
    const member = await findMemberByLineId(userId);
    if (!member) return replyText(replyToken, '❌ 您尚未綁定帳號，請先傳送「綁定」。');
    const [battles, sieges] = await Promise.all([
      db().collection('Battles').get(),
      db().collection('Sieges').get(),
    ]);
    const mid = member.id;
    const inAtt = (r) => { let a = []; try { a = typeof r.attendance === 'string' ? JSON.parse(r.attendance) : (r.attendance || []); } catch (_) {} return a.includes(mid); };
    const myB = [], myS = [];
    battles.forEach(doc => { const b = doc.data(); if (inAtt(b)) myB.push(b); });
    sieges.forEach(doc => { const sg = doc.data(); if (inAtt(sg)) myS.push(sg); });
    const fmt = (d) => { const x = new Date(d || 0); return isNaN(x.getTime()) ? '' : x.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }); };
    myB.sort((a, b) => new Date(b.time || b.createdAt || 0) - new Date(a.time || a.createdAt || 0));
    myS.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
    let txt = `\u{1F4CB} ${member.name || member.Name || ''} 的近期記錄\n`;
    txt += `\n⚔️ 首領戰（近 5 場）\n` + (myB.length ? myB.slice(0, 5).map(b => `・${b.bossName || '?'} ${fmt(b.time)}`).join('\n') : '・無');
    txt += `\n\n\u{1F3F0} 攻城戰（近 5 場）\n` + (myS.length ? myS.slice(0, 5).map(sg => `・${sg.castle || '?'} ${fmt(sg.date)}`).join('\n') : '・無');
    return replyText(replyToken, txt);
  } catch (err) {
    console.error('[linebot] myRecords error:', err.message);
    return replyText(replyToken, '⚠️ 系統錯誤，請稍後再試');
  }
}

async function handleEvent(event) {
  try {
    if (event.type === 'follow') return handleFollow(event);
    if (event.type === 'postback') return handlePostback(event);
    if (event.type !== 'message' || event.message.type !== 'text') return null;

    const text = event.message.text.trim();
    const userId = event.source.userId;
    const session = getSession(userId);

    // Cancel any in-progress session
    if (text === '取消') {
      clearSession(userId);
      return replyText(event.replyToken, '已取消操作。');
    }

    // ── Bind flow (multi-step) ──────────────────────────
    if (text === '綁定' || (session && session.step.startsWith('bind_'))) {
      return handleBindFlow(event, session, text);
    }

    // ── Level update ────────────────────────────────────
    if (/^更新等級\s+\S+\s+\d+$/.test(text)) {
      return handleUpdateLevel(event, text);
    }

    // ── Boss battle registration ────────────────────────
    if (text === '報名首領') return handleListEvents(event, 'boss', null);

    // ── Siege registration ──────────────────────────────
    if (text === '報名攻城') return handleListEvents(event, 'siege', 'attack');
    if (text === '報名守城') return handleListEvents(event, 'siege', 'defend');

    // ── Personal profile ────────────────────────────────
    if (text === '我的資料') return handleMyProfile(event);

    // ── Announcement ────────────────────────────────────
    if (text === '公告') return handleAnnouncement(event);

    // ── Officer: generate bind code ─────────────────────
    if (text === '生成綁定碼') return handleGenCode(event);

    // ── Officer: set attendees ──────────────────────────
    if (/^出席\s+\S+\s+.+$/.test(text)) return handleSetAttendees(event, text);

    if (text === '金庫') return handleTreasury(event);
    if (text === '出席排行') return handleAttendanceRanking(event);
    if (text === '我的記錄') return handleMyRecords(event);
    if (text === '攻城報名') return handleListEvents(event, 'siege', 'attack');

    // ── Unknown command ─────────────────────────────────
    return replyText(event.replyToken,
      '指令無法辨識。\n\n可用指令：\n' +
      '・綁定\n・更新等級 {角色名} {等級}\n・報名首領 / 報名攻城 / 報名守城\n' +
      '・我的資料 / 我的記錄\n・金庫 / 出席排行\n・公告\n\n【幹部】\n・生成綁定碼\n・出席 {battleId} {角色1},{角色2}'
    );
  } catch (err) {
    console.error('[linebot] handleEvent error:', err.message);
    try {
      await replyText(event.replyToken, '⚠️ 系統錯誤，請稍後再試');
    } catch (_) { /* ignore secondary error */ }
    return null;
  }
}

// ── Public setup function ──────────────────────────────────────────────────

/**
 * Mount LINE Bot webhook and LINE auth routes onto an Express app.
 *
 * Routes added:
 *   POST /webhook/line   — LINE Bot webhook (signature-verified)
 *   POST /api/line-auth  — Exchange LINE userId + displayName for Firebase Custom Token
 *
 * @param {import('express').Application} app
 */
function setupLineBot(app) {
  const cfg = getLineConfig();

  // ── POST /webhook/line ──────────────────────────────
  // LINE platform expects a 200 response immediately. The Verify button
  // also sends a body with no `events` field. We:
  //  1. Guard events to an array — Verify pings get { ok:true, processed:0 }.
  //  2. AWAIT handleEvent before responding. Earlier rev fired-and-forgot
  //     to be "non-blocking" but on Vercel serverless the instance freezes
  //     the moment res.json fires — every async LINE reply call then died
  //     mid-flight as "fetch failed". Awaiting keeps the instance alive
  //     until replyMessage completes; LINE allows up to ~30s before the
  //     reply token expires, and our handlers all finish well under 1s.
  //  3. Always reply 200 even on handler error — never make LINE retry
  //     a malformed event forever.
  app.post(
    '/webhook/line',
    line.middleware(cfg),
    async (req, res) => {
      const events = (req.body && Array.isArray(req.body.events)) ? req.body.events : [];
      if (events.length === 0) {
        return res.status(200).json({ ok: true, processed: 0 });
      }
      try {
        await Promise.all(events.map(ev =>
          Promise.resolve().then(() => handleEvent(ev))
            .catch(err => console.error('[linebot] handleEvent error:', err && err.message, '| event:', ev && ev.type))
        ));
      } catch (err) {
        console.error('[linebot] webhook fan-out error:', err && err.message);
      }
      res.status(200).json({ ok: true, processed: events.length });
    }
  );

  // ── POST /api/line-auth ─────────────────────────────
  /**
   * Body: { lineUserId: string, displayName: string }
   * Returns: { customToken: string }
   *
   * Client (LIFF) calls this after LIFF.getProfile(), then signs into
   * Firebase with signInWithCustomToken(customToken).
   */
  app.post('/api/line-auth', async (req, res) => {
    try {
      const { lineUserId, displayName } = req.body || {};
      if (!lineUserId) {
        return res.status(400).json({ error: 'lineUserId is required' });
      }

      // Upsert a minimal profile record so Firestore has the user
      const snap = await db().collection('Members')
        .where('lineUserId', '==', lineUserId).limit(1).get();

      if (snap.empty) {
        // Non-registered user: still issue token (read-only access rules in Firestore)
        // Firestore security rules should restrict what unregistered UIDs can do.
      } else {
        // Update displayName if changed
        const docRef = snap.docs[0].ref;
        await docRef.update({
          displayName: displayName || snap.docs[0].data().displayName,
          lastLoginAt: FieldValue.serverTimestamp(),
        });
      }

      // 本地 JWT（uid === lineUserId），取代 Firebase custom token
      const token = authTokens.issueMemberToken(lineUserId, { displayName: displayName || '' });
      return res.json({ token, customToken: token });
    } catch (err) {
      console.error('[linebot] /api/line-auth error:', err.message);
      return res.status(500).json({ error: '⚠️ 系統錯誤，請稍後再試' });
    }
  });

  console.log('[linebot] Routes mounted: POST /webhook/line, POST /api/line-auth');
}

module.exports = { setupLineBot };
