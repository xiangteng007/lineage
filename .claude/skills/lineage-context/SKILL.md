---
name: lineage-context
description: 載入 Lineage AI（天堂經典版公會管理系統）完整專案知識庫 — 線上座標、架構、檔案地圖、API 路由總表、Firestore 資料模型、RBAC 權限、LINE Bot 指令派發、部署流程、已知雷點。回答專案問題或動手修改前先調用本 skill。
---

# Lineage AI 專案知識庫

> 天堂經典版血盟（公會）管理系統。Node.js/Express + Firebase Firestore + LINE Bot，部署於 Vercel。
> 本文件由 2026-08-01 全庫深入研究產出。動態現況（待辦、最新 PR）以 `HANDOFF.md` 為準。

## 1. 線上座標（Production）

| 項目 | 值 |
|---|---|
| 正式網址 | https://lineage-nine-sigma.vercel.app/ |
| GitHub repo | https://github.com/xiangteng007/lineage（branch `main`，push 後 Vercel 自動部署 ~1 分鐘） |
| Firebase 專案 | `lineage-b0156` |
| LIFF ID（成員登入） | `2010179295-wGSFr2QH` |
| LINE Messaging API channel | `2009898242`（@312agkoe「長途夜車」） |
| ADMIN_EMAILS（Vercel env） | xiangteng007 / tang851206 / Gary19890130 / emmashiu（@gmail.com） |
| COLLECTION_MODE | `legacy`（PascalCase 集合：Members/Battles/Sieges/Treasury/Transactions） |

健康檢查：`curl https://lineage-nine-sigma.vercel.app/api/status` → 應回 `storageMode: "firebase"`。

## 2. 架構總覽

- **後端** `server.js`（~1400 行）：Express API + 靜態檔 + SPA catch-all。寫入走 Firebase **Admin SDK**（繞過 Firestore rules）。
- **前端** `public/`：Vanilla JS 靜態 SPA。`index.html`（~3800 行，含 8 個 IIFE inline script）+ `app.js`（~3200 行）。前端用 Firebase **Client SDK** 做即時讀取。
- **雙軌登入**：擁有者 = Google OAuth（GSI）→ `x-google-token` header；成員 = LINE LIFF → `x-firebase-token` header。
- **LINE Bot** `linebot.js`（~1030 行）：webhook `/webhook/line`、指令派發器 `handleEvent()`。
- **RAG 雛形** `chroma.js`：ChromaDB client（env `CHROMA_SERVER_URL` / `CHROMA_SERVER_TOKEN`）+ `/api/chroma/*` 端點 + `@xenova/transformers` 依賴。尚未接入業務流程。

## 3. 檔案地圖

| 檔案 | 職責 |
|---|---|
| `server.js` | 全部主 API + 中介層 `requireAuth / requireRole(n) / requireAction(action) / requireAdmin`。**`setupLineBot` mount 在 `express.json()` 之前**（必要）。 |
| `firebase.js` | 資料層：`resolveCollection / queryCollection / countCollection / getDb / COL / COLLECTION_MODE`。 |
| `linebot.js` | LINE webhook + Bot 指令 + 綁定流程（member 與 admin 分流）。 |
| `chroma.js` | ChromaDB 封裝：`getOrCreateCollection / addData / queryData / deleteData`。 |
| `lib/aggregations.js` | 純函式聚合（可離線單元測試）：overview/treasury/battle/siege/alliance/castle。 |
| `lib/permissions.js` | RBAC 常數與判斷：`ROLE_NAMES / DEFAULT_MODULE_PERMS / TIER_TO_ROLE_LEVEL / DEFAULT_ACTION_PERMS / resolveRoleLevel / canDoAction`。 |
| `lib/http.js` | 回應工具：`ok/fail/wantsEnvelope/parsePaging/listResponse`（列表預設回陣列；帶 page/limit 才回信封）。 |
| `lib/activity.js` | `logActivity()` 寫 `activityLog`（best-effort）。 |
| `lib/routes-extra.js` | overview / stats / activity-feed / member 子資源。 |
| `lib/routes-sprint-bcd.js` | B/C/D 統計端點 + `GET /api/settings`。 |
| `lib/routes-auth.js` | `GET /api/me`（回 roleLevel + permissions map）。 |
| `lib/routes-liff.js` | LIFF 出席頁 4 端點 + rate-limit + audit（18 個單元測試）。 |
| `lib/routes-admin-bind.js` | admin LINE 綁定 3 端點（`requireAdmin`）。 |
| `public/app.js` | 前端主程式：`init()/fetchData()/render*`、雙軌 auth、結算精靈、`safeJson/authHeader`。 |
| `public/auth.js` | 前端 auth 輔助 + LIFF 初始化，`authReady` CustomEvent。 |
| `public/liff/attend.html` | LIFF 出席確認頁。 |
| `scripts/seed-settings.js` | seed `settings/permissions|modules|roles|guild`（預設 dry-run，`--commit` 寫入）。**RBAC 未 seed 會全面 403**。 |
| `scripts/inspect-line-data.js` | 唯讀 Firestore inspector（需 root 放 `serviceAccountKey.json`）。 |
| `scripts/migrate-collections.js` | legacy→canonical 集合遷移（dry-run 優先）。 |
| `HANDOFF.md` / `SCHEMA.md` / `DEPLOYMENT.md` | 交接文件（最權威）/ 資料模型 / 部署手冊。 |
| `Lineage_AI_全模組深化開發計畫.docx` | Phase 5 全模組深化計畫書 v2.2（六模組、Sprint A–D、API 契約、UI 設計系統規範）。 |

## 4. API 路由總表（含權限中介層）

**server.js：**

| 路由 | 權限 |
|---|---|
| `POST /api/webhook`（line.middleware） | LINE 簽章 |
| `GET /api/config`、`GET /api/status` | 公開 |
| `POST /api/auth/verify` | 公開（驗 token） |
| `POST /api/line/broadcast` | `requireAction('lineBroadcast')`（預設 roleLevel≥3） |
| `PUT/DELETE /api/members/:id/line-bind`、`/api/alliances/:id/line-bind` | `requireAdmin` |
| `GET /api/members` | `requireRole(2)` |
| `POST /api/members` | `requireAction('memberCreate')` |
| `PUT /api/members/:id` | `requireRole(3)`；`DELETE` → `requireAction('memberDelete')`（預設 5） |
| `GET /api/battles` | 公開；`POST` → role 3；`PUT` → admin；`DELETE` → `battleDelete`（預設 4） |
| `GET /api/treasury`、`GET /api/transactions` | 公開 |
| `POST /api/transactions` | 動態：expense → `treasuryExpense`(4)；income → `treasuryIncome`(3) |
| `POST /api/transactions/castle-tax` | `treasuryCastleTax`(3) |
| `POST /api/battles/:id/drops`、`/settle`、`PUT/DELETE drops/:dropId`、`DELETE attendance/:memberId` | role 3 |
| `POST /api/battles/:id/drops/:dropId/bid` | `requireAuth` |
| `GET /api/sieges` | 公開；`POST`/`settle` → role 3；`PUT` → admin；`DELETE` → `siegeDelete`(4) |
| `GET /api/alliances` | 公開；`POST/PUT/DELETE`、`POST :id/end` → admin |
| `POST /api/chroma/collection`、`/add` | admin；`POST /api/chroma/search` → `requireAuth` |
| `POST /api/members/:id/level-update` | `requireAuth` |
| `PUT /api/settings` | admin；`PUT /api/guild` → role 3（白名單欄位＋長度上限，寫 `settings/guild`） |
| `GET *` | SPA catch-all |

**lib/ 路由：** `GET /api/overview`、`/api/stats/class-distribution|attendance-leaderboard|treasury-trend`、`/api/treasury/stats|category-breakdown`、`/api/activity-feed`、`/api/members/:id(+attendance|battle|level-history)`、`/api/battles/stats|kill-leaderboard`、`/api/sieges/stats|castle-status`、`/api/alliances/stats`、`GET /api/settings`、`GET /api/me`、`GET/POST/DELETE /api/admin/line-bind(/code)`（admin）、`GET /api/liff/config`、`POST /api/liff/profile|attend`、`GET /api/line/status`。

回應慣例：列表未帶 `page/limit` 回**陣列**（相容舊前端）；帶分頁回信封 `{ ok, data, total, page, pageSize }`；錯誤 `{ ok:false, error, code }`。

## 5. RBAC 權限系統

- roleLevel：**5 會主 / 4 元帥 / 3 幹部 / 2 成員 / 1 新人 / 0 訪客**。Google admin（ADMIN_EMAILS）恆為 5。
- 成員 `tier` → 預設 roleLevel：核心=3、一般=2、外交=2、試煉=1、預備=1（`TIER_TO_ROLE_LEVEL`；明確 `roleLevel` 欄位優先）。
- 模組門檻 `DEFAULT_MODULE_PERMS`（minRead/minWrite）：treasury 3/4、members 2/3、settings 4/5、battles/sieges 1/3。
- action 門檻 `DEFAULT_ACTION_PERMS`：treasuryView 3、treasuryIncome 3、treasuryExpense 4、treasuryCastleTax 3、memberCreate 3、memberDelete 5、battleDelete 4、siegeDelete 4、lineBroadcast 3。
- 可由 `settings/permissions` 覆寫（Firestore）。**必須先 `node scripts/seed-settings.js --commit` seed，否則 requireAction 一律 403。**
- **⚠️ 身分驗證走自訂 header**：`requireAction/resolveActor` 讀 `x-google-token`（Google owner）或 `x-firebase-token`（LINE 成員），**不是** `Authorization: Bearer`。curl 手測要帶對。

## 6. LINE Bot 指令派發（linebot.js `handleEvent`）

事件分派：`follow` → 歡迎；`postback` → `handlePostback`（`action=linebot_register|linebot_unregister`，`type=boss|siege`，報名寫 `registrations` 陣列）；文字訊息依序比對：

| 指令 | 行為 |
|---|---|
| `取消` | 清除進行中 session |
| `綁定`（多步驟 session `bind_*`） | member 綁定；**admin 分流**：`bindCodes/{code}.adminEmail` 存在 → 寫 `adminLineBinds/{email}` 而非建成員 |
| `更新等級 {角色名} {等級}` | 更新等級 |
| `報名首領` / `報名攻城` / `報名守城` / `攻城報名` | 列出場次 Flex 卡（postback 報名） |
| `我的資料` / `我的記錄` | 個人檔案 / 近 5 場首領+攻城出席 |
| `公告` | 讀 `settings/guild.announcement` |
| `金庫` | Transactions 加總：餘額+本月收支 |
| `出席排行` | Battles+Sieges 出席 tally Top 10 |
| `生成綁定碼`【幹部】 | 產 6 位數綁定碼 |
| `出席 {battleId} {角色1},{角色2}`【幹部 roleLevel≥3】 | 依角色名解析成員 ID，寫入 attendance |
| 其他 | 回可用指令清單 |

新增指令 = 在 `handleEvent()` 的比對鏈加一行 + 實作 `handleXxx(event)`（回 `replyText(replyToken, ...)`），並更新未知指令的說明文字。

## 7. Firestore 資料模型（現況 = legacy 模式）

實際集合（PascalCase）：`Members`（name/job/level/tier/roleLevel/lineUserId）、`Battles`（bossName/time/registrations[]/attendance JSON 字串+attendees[]/drops/結算）、`Sieges`（castle/date/type attack|defend/registrations/attendance）、`Alliances`、`Transactions`（type income|expense/amount/category/createdAt）、`Treasury`（stored balance，權威值 = 交易加總）、`activityLog`、`adminLineBinds/{lowercase-email}`、`bindCodes/{code}`（used/adminEmail）、`settings/permissions|modules|roles|guild`。
目標 schema（小寫 members/bossBattles…）見 `SCHEMA.md`；切換走 `scripts/migrate-collections.js` + `COLLECTION_MODE=canonical`（只複製不刪源、可回滾）。注意 `attendance` 是 **JSON 字串**（讀取時 `JSON.parse`），`attendees` 是同步的陣列副本。

## 8. 開發 / 測試 / 部署

- `npm test` = `node --test`（aggregations / permissions / routes-liff，49 測試全綠）。`npm run seed` / `npm run migrate`。
- 部署：push `main` → Vercel 自動部署。**建議 PR 流程**：worktree 開 branch → push → `gh pr create` → squash merge。
- 沙箱（非 worktree）不能 push GitHub、不能改 Vercel env；**worktree 環境可 push + 用 gh CLI**。
- Vercel env 改動需在 Vercel dashboard 手動改 + redeploy。

## 9. 已知雷點（改碼前必讀，完整版見 HANDOFF.md §8）

1. **前端全域衝突**：`public/*.js` 與 index.html inline script 共用全域 scope — 新 inline script 一律 IIFE 包裹，禁止頂層宣告；大段 Edit 務必保留 `</style></head>`。
2. **Vercel serverless**：`/webhook/line` 必須 **await 完 handleEvent 才 `res.json()`**（res.send 後 instance 立即 freeze，async fetch 會 silently fail）。
3. `setupLineBot(app)` 必須在 `app.use(express.json())` **之前**（line.middleware 需 raw body 驗簽）。
4. LINE Flex 的 `styles` 是 **bubble 層級**屬性，放進 header/body/footer box → LINE 回 400。
5. LINE OA Manager「自動回應訊息」必須**關閉**，否則訊息不進 webhook。
6. RBAC 未 seed → 403（見 §5）；API 身分走 `x-google-token`/`x-firebase-token` header（見 §5）。
7. `firebase.js` 使用者改過，未經要求勿還原。機密（service account key、LINE secret）一律由使用者本人操作。
8. 前端載入順序：firebase CDN → LIFF SDK → firebase-config.js → auth.js → app.js → inline IIFE。

## 10. 現況與缺口（截至 2026-05-31，詳見 SESSION-SUMMARY-2026-05-31.md）

- 程式碼面：六模組 + Sprint A–D 端點大致到位、無未完成標記；Phase 5 UI 深化 13 輪完成。
- 營運面缺口：3 位 admin 待 LINE 綁定（僅 xiangteng007 已綁）、成員名冊待建檔與綁 lineUserId、production 留有一筆「測試首領」紀錄。
- 潛在方向：chroma.js RAG 尚未接業務（可做 AI 問答）、開發計畫 §7 前端任務 F07–F18 部分未做。
