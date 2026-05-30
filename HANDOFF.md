# Lineage AI — Session Handover / 交接文件

> 天堂經典版 公會管理系統 ｜ 給「新視窗 / 新 session」無痛接手用
> 最後更新：2026-05-29（本次 session 完成 Phase 5 全套 UI 深化 13 輪 + 後端 RBAC / LINE 綁定 / 雙登入 / webhook 修復）

---

## 0. 一句話現況 (TL;DR)

**系統穩定運行**：<https://lineage-nine-sigma.vercel.app/>
四位管理員已配置 (`ADMIN_EMAILS`)，**xiangteng007@gmail.com 的 LINE 已綁定**（uid `Ua1f...4d0b`，displayName「湘騰」），其他三位待綁。LINE Bot webhook 經三輪修復後完整可用，後台 admin LINE 綁定 modal + LIFF 出席頁 + Google/LINE 雙登入全部上線。

**正式環境 = GitHub `main` @ `6ee818c`**（PR #23 squash 後 HEAD）。
⚠️ **本機 repo 可能落後**：`git pull origin main` 同步、`HANDOFF.md` 是 untracked。

---

## 1. 線上座標 (Production coordinates)

| 項目 | 值 |
|---|---|
| 正式網址 | https://lineage-nine-sigma.vercel.app/ |
| Vercel 部署 | 從 GitHub `main` 自動部署（push 後 ~1 分鐘） |
| Vercel project URL | https://vercel.com/xxts-projects-ef5b1ba3/lineage |
| GitHub repo | https://github.com/xiangteng007/lineage （branch `main`） |
| Firebase 專案 | `lineage-b0156` |
| LIFF ID（成員登入） | `2010179295-wGSFr2QH` |
| Google OAuth Client ID（擁有者登入） | `100077284718-l9f737hsn4apu9fc16bo78mo1sdqsghh.apps.googleusercontent.com` |
| LINE Messaging API channel | `2009898242`（@312agkoe 帳號「長途夜車」）|
| LINE Login channel 名稱 | 天堂血盟成員登入 |
| **ADMIN_EMAILS** (Vercel env) | `xiangteng007@gmail.com,tang851206@gmail.com,Gary19890130@gmail.com,emmashiu@gmail.com` |
| COLLECTION_MODE | `legacy`（集合用 PascalCase：Members/Battles/Sieges/Treasury/Transactions/activityLog） |

---

## 2. 架構速覽

Node.js/Express（`server.js`）＋ Firebase Firestore。寫入走 **Admin SDK**（後端，繞過規則）；前端用 **Firebase Client SDK** 做即時讀取（onSnapshot）。雙軌登入：**擁有者 = Google OAuth**、**成員 = LINE LIFF**。可配置 RBAC（roleLevel 1–5 + action 權限存 `settings/permissions`）。前端是 `public/` 下的靜態 SPA。

### 關鍵檔案與職責

| 檔案 | 職責 |
|---|---|
| `server.js` | Express API + 靜態檔 + SPA catch-all。`requireAuth/requireRole(n)/requireAction(action)/requireAdmin` 中介層。**setupLineBot mount 在 express.json 之前**（必要，line.middleware 需 raw body）。約 1400 行。 |
| `firebase.js` | Firestore 資料層：`resolveCollection/queryCollection/countCollection/getDb/COL/COLLECTION_MODE`。 |
| `linebot.js` | LINE webhook（`/webhook/line`、`/api/line-auth`）＋ Bot 指令（名單/金庫/出席排行/攻城報名/我的記錄/綁定）。**Admin 綁定分流**：bind_await_code 內若 codeData.adminEmail 存在 → 寫 `adminLineBinds/{email}` 而非走 member 新增流程。約 1030 行。 |
| `lib/aggregations.js` | 純函式聚合：overview/treasury/battle/siege/alliance/castle 統計。 |
| `lib/permissions.js` | ROLE_NAMES、DEFAULT_MODULE_PERMS、TIER_TO_ROLE_LEVEL、DEFAULT_ACTION_PERMS、canDoAction… |
| `lib/http.js` | ok/fail/wantsEnvelope/parsePaging/listResponse（列表預設回陣列；有 page/limit 才回 envelope）。 |
| `lib/activity.js` | logActivity（寫 activityLog，best-effort）。 |
| `lib/routes-extra.js` / `routes-sprint-bcd.js` / `routes-auth.js` | 額外端點：overview/stats/activity-feed/member 子資源、B/C/D 統計、`/api/me`。 |
| **`lib/routes-liff.js`** | 本次 session 新增：LIFF 出席頁 4 端點（config/profile/attend/line/status）+ rate-limit + audit log。含 18 個 node:test 單元測試。 |
| **`lib/routes-admin-bind.js`** | 本次 session 新增：admin LINE 綁定 3 端點（GET status / POST code / DELETE unbind）。 |
| `public/index.html` | SPA 外殼：~3800 行（含本次 Round 1-13 累積 ~2400 行樣式 + 8 個 IIFE script + 新 admin bind / 雙登入 modal）。 |
| `public/app.js` | 前端主程式：`init()`、`fetchData()`、各 render*、雙軌 auth、結算精靈、admin bind handlers、`triggerLineLogin()`、handleGoogleLogin。約 3200 行。 |
| `public/firebase-config.js` | Firebase Web 設定 + 初始化（`fbAuth`/`fbDb`，見 §8 雷點 #1）。 |
| `public/auth.js` | 前端 auth 輔助 + LIFF 初始化。 |
| `public/liff/attend.html` | LIFF 出席確認頁（已 POST `accessToken`，server 端 verify）。 |
| `scripts/seed-settings.js` | 初始化 settings/permissions、/modules、/roles、/guild（預設 dry-run，`--commit` 寫入）。 |
| `scripts/migrate-collections.js` | legacy→canonical 集合遷移（dry-run）。 |
| **`scripts/inspect-line-data.js`** | 本次 session 新增：讀-only Firestore inspector，列出 Members/adminLineBinds/bindCodes/Auth users。需 `serviceAccountKey.json` 在 root。 |
| `DEPLOYMENT.md` / `SCHEMA.md` | 既有部署手冊與資料庫 schema。 |

---

## 3. 本次 session 做了什麼（2026-05-27 ~ 2026-05-29，PR #14 起算）

### 3.1 UI 深化 13 輪（純 CSS + IIFE，零 app.js 邏輯改動）

| Round | PR | 重點 |
|---|---|---|
| 1-2 | #1 (前 session) | Phase 5 起手：字體、KPI 角標、scanline、count-up、LINE 燈、modal HUD |
| 3 | #2 | Sidebar 間距、sec-title 加大、CRUD btn、row stagger |
| 3.5 | #3 | hotfix `</style></head>` 被吞 |
| 4 | #4 | 字體對比、panel-header 流水燈 |
| 5 | #5 | grid 背景、modal 流水燈、focus ring、btn sweep、row 鐵軌、KPI scan |
| 6 | #6 | sidebar grid、[NN] 序號、KPI glitch、modal flicker、AUTH halo、header beam |
| 7 | #7 | tier chip 三層 glow、大數字 LCD、search 放大鏡、quick-action lift |
| 8 | #8 | toast HUD、skeleton 琥珀掃描、login 紅色生物識別、EXPORT 彈跳 |
| 9 | #9 | Chart.js HUD defaults、settle stepper、EXECUTE pulse、SIGNAL LOST、mobile LED |
| 10 | #10 | **互動類** click ripple + offline 自動 SIGNAL LOST |
| 11 | #11 | **互動類** row flash on CRUD toast + SIGNAL LOST 自動 retry 倒數 |
| 12 | #12 | Chart crosshair + 新 row scrollIntoView/flash + 5xx SYSTEM FAULT |
| 13 | #13 | **字體系統重構**：type ramp + `--tx2` 0.60→0.85 + 全站尺寸校準 |
| trim | #14 | top-nav 首領戰/攻城戰 → 首領/攻城（與 sidebar 一致）|

**累計**：~2700 行 CSS + 8 個 IIFE script、零 app.js 邏輯改動、零 console error、零 regression、全部尊重 `prefers-reduced-motion`。

### 3.2 後端 RBAC + LIFF + Admin Bind（PR #15, #18）

- **PR #15**：`GET /api/members` 加 `requireRole(2)` middleware；前端 `safeJson` 預設帶 `authHeader()`。Guest 看不到成員名單（401 → fallback `[]` → 「查無成員」placeholder）。
- **PR #18**：完整 admin LINE 綁定方案：
  - 新 collection `adminLineBinds/{lowercase-email}`：`{ email, lineUserId, displayName, boundAt }`
  - 新 3 個 endpoint（`requireAdmin`）：`GET /api/admin/line-bind`、`POST /api/admin/line-bind/code`、`DELETE /api/admin/line-bind`
  - `bindCodes/{code}` 加 `adminEmail` 欄位區分 admin/member 綁定流程
  - `linebot.js` 的 `bind_await_code` 分流：codeData.adminEmail 存在 → 寫 `adminLineBinds` 結束
  - `/api/line/broadcast` 把 admin lineUserIds 納入 `bound` + `tier` 模式 multicast
  - 前端 admin-only 藍色「LINE 綁定」按鈕（概覽快速操作區）+ HUD 風 modal

### 3.3 登入相關修復（PR #16, #17, #19, #20, #26）

- **PR #16**：`openLoginModal` 內 GSI initialize idempotent（解決 SDK async load 時序問題 → 按鈕靜默不渲染）
- **PR #17**：`handleGoogleCredential` 完全沒定義 → 改成 `handleGoogleLogin(resp.credential)`（GSI callback 改寫）
- **PR #19**：雙登入 UI — Login modal 加綠色「使用 LINE 帳號登入」按鈕 + OR divider，`triggerLineLogin()` 手動觸發 `liff.login()` redirect
- **PR #20**：sidebar baseline — LINE member 即使 `roleLevel=0` 仍顯示 overview/battles/sieges（解決「我的檔案」孤立顯示）

### 3.4 LINE webhook 連環修復（PR #21, #22, #23）

LINE Verify 按鈕一直失敗 + 用戶傳「綁定」Bot 不回。三輪修復：

- **PR #21**：guard `req.body.events` 為 undefined（防 TypeError → 500）
- **PR #22**：把 `setupLineBot` mount 移到 `app.use(express.json())` **之前**（line.middleware 需 raw body 驗 X-Line-Signature）
- **PR #23**：**真正的元兇** — `await Promise.all(events.map(handleEvent))` 必須在 `res.json()` **之前**完成。原本 PR #21 的「先回 200 再 async 跑」在 Vercel serverless **catastrophic**：instance 在 res.send 後 freeze，async fetch 來不及送出就被殺，導致 `[linebot] reply error: fetch failed`。從 Vercel logs 看 Function Duration 34ms + External APIs: 0 outgoing requests 抓到根因。

### 3.5 LINE Official Account Manager 設定（手動，非程式碼）

從 LINE OA Manager (https://manager.line.biz/account/@312agkoe/setting/response) 把：
- **「自動回應訊息」改為關閉**（原本開著會攔截使用者訊息變成制式回覆，不送 webhook）
- **「Webhook」維持開啟**

LINE Developers Console 那邊 webhook URL 已正確：`https://lineage-nine-sigma.vercel.app/webhook/line`、Use webhook ON、Verify ✓ Success。

### 3.6 第一位 admin LINE 綁定完成（驗證全鏈路）

- `xiangteng007@gmail.com` → `Ua1f885a4438e34f632a876f013074d0b`（湘騰）
- `bindCodes/917727.used: true`、`usedAt: 2026-05-29 10:26 UTC+8`
- `adminLineBinds/xiangteng007@gmail.com` 寫入完成

---

## 4. ⚠️ Git 與部署現狀

| Ref | Commit | 說明 |
|---|---|---|
| **GitHub `origin/main`（真實/已部署）** | `6ee818c` | PR #23 squash 後 HEAD。Vercel 部署的就是這個。 |
| 本機 `main` 可能狀態 | 落後 / 含未推 branch | `git pull origin main` 同步 |
| 本機 `HANDOFF.md` / `.claude/` / `scripts/inspect-line-data.js` | untracked | 不在 git，但都很有用 |

### 接手第一件事

```bash
cd "C:\Users\xiang\Lineage AI"
git checkout main
git pull origin main
```

跑完本機 `main` 會到 `6ee818c`。

---

## 5. 部署流程 (deploy)

- **首選**：本機 `git pull` → 改檔 → `git commit` → `git push origin main` → Vercel 自動部署（約 1 分鐘）
- **PR-based**（推薦）：在 `.claude/worktrees/...` 或本機開 branch → push → `gh pr create` → `gh api -X PUT .../merge` squash
- **觸發 redeploy（沒程式碼改動）**：`git commit --allow-empty -m "chore: trigger redeploy"` → `git push origin main`
- **改 Vercel env vars**：必須去 https://vercel.com/xxts-projects-ef5b1ba3/lineage Settings → Environment Variables，然後手動 Redeploy（或 push trigger commit）

⚠️ **sandbox 不能 push 也不能 fetch GitHub**（proxy 403）也**不能改 Vercel env vars**。所有這些動作要在 Windows 終端機或讓使用者親自做。

> **例外**：worktree 環境（`.claude/worktrees/<name>/`）的 git push / gh CLI 都能用，共用 Windows GitHub 認證。

---

## 6. 已驗收 (verified working)

- 後端：`/api/status`、`/api/config`、`/api/overview`、`/api/members` (401 for guest)、`/api/line/status`、`/api/admin/line-bind*` (401 for guest)、`/webhook/line` (LINE Verify ✓ Success)
- 前端：開站 console 零錯誤、Round 1-13 全部 UI 改動實機可見、Google + LINE 雙登入 modal 正常渲染
- 互動：click ripple、row flash、count-up、glitch、modal flicker、HUD 角標、流水燈、scanline、SIGNAL LOST overlay、Chart.js crosshair、自動 retry
- **`npm test`**：49/49 通過（含 PR #1 加的 18 個 routes-liff 單元測試）
- **完整 admin LINE 綁定流程**：Google 登入 → 後台產綁定碼 → LINE Bot 收「綁定」+ 6 位數字 → adminLineBinds 寫入（湘騰已完成）

---

## 7. 待辦 (pending tasks)

| # | 項目 | 誰做 / 備註 |
|---|---|---|
| 30 | **三位 admin 完成 LINE 綁定** | tang851206 / Gary19890130 / emmashiu 各自走同樣流程。Google 登入後台 → 點概覽藍色「LINE 綁定」→ 產綁定碼 → LINE Bot 輸入「綁定」+ 6 位數字。完成後 `adminLineBinds` 會有 4 筆。 |
| 31 | **建立第一筆成員紀錄** | 後台 `成員` 分頁 → 點「+ 新增」（admin-only 才出現）→ 填角色名稱、職業、等級、tier「核心」（自動 roleLevel 3）→ 在該 row 用「LINE Bind」操作把 lineUserId 填進去 → 之後 attendance 統計、戰利品分紅可用 |
| 32 | **第一筆 LINE 廣播驗證** | 後台「首領戰」分頁建一筆假首領 → row 上點「LINE 廣播」→ 手機 LINE 應收到黑底琥珀色 Flex Message |
| 33 | **HANDOFF.md commit 進 main** | 本檔案目前 untracked，建議 `git add HANDOFF.md && git commit -m "docs: HANDOFF for 5/29 milestone"` |

---

## 8. 已知雷點 (gotchas — 編輯前必看)

1. **❗跨檔全域名稱衝突**：`public/*.js`（firebase-config.js / auth.js / app.js）與 index.html 的 inline script **共用同一個全域 lexical scope**。兩個檔各自在頂層 `const`/`let` 宣告同名變數 → 整支腳本 `SyntaxError`、**頁面看起來有畫面但全死**。`node --check` **抓不到**。
   > **建議寫法**：新增的 inline script 一律用 `(function(){ ... })()` IIFE 包起來，禁止頂層 `var/let/const/function` 宣告。Phase 5 的 8 個 IIFE（count-up / LINE status / ripple / offline / row flash / retry / chart / 5xx / scroll-flash）都是這樣寫的。
   > Edit 大區段時務必確認 `new_string` 結尾保留 `</style></head>` — Round 3 因為這個 bug 整頁變黑屏 10 分鐘。

2. **❗webhook + Vercel serverless**：`/webhook/line` 必須 **await 完 handleEvent 才 res.json**。Vercel 在 res.send 後立即 freeze instance，async fetch 會「fetch failed」silently。PR #23 的教訓。

3. **❗webhook + express.json**：`setupLineBot(app)` 必須在 `app.use(express.json())` 之前 mount，否則 `line.middleware` 拿不到 raw body 驗簽章 → 500。PR #22 的教訓。

4. 沙箱**無 GitHub 網路**（push/fetch 失敗）、**無法改 Vercel env vars**。本機 `origin/main` 追蹤指標會過時；線上狀態請用 `curl/web_fetch`。

5. 沙箱**不能刪 `.git/index.lock`**。lock 反覆出現多半是 VS Code 開著 repo 佔用 → 關閉編輯器後 Windows `del /f /q .git\index.lock`。

6. **終端機貼上會被洗掉**：使用者多行貼上曾把範例輸出當指令執行。盡量給**單行指令或 .bat**。

7. `firebase.js`：使用者/linter 改過，未經要求勿還原。

8. `COLLECTION_MODE=legacy`。切 canonical 需先跑 migrate 腳本再改環境變數重部署。

9. **機密**：Firebase service account 私鑰、LINE channel secret/token 一律由使用者本人輸入。`firebase-config.js` 的 apiKey 是公開的 Web 金鑰（放前端 OK）。`serviceAccountKey.json` 在 root（gitignored）— 本機可直接連 Firestore。

10. 前端載入順序（index.html 底部）：firebase CDN → LIFF SDK → `firebase-config.js` → `auth.js` → `app.js` → inline IIFE scripts。

11. **LINE OA Manager「自動回應訊息」**：必須關閉，否則訊息被攔截不送 webhook。LINE Developers Console 那邊的「Use webhook」是 ON、Webhook URL 是 `https://lineage-nine-sigma.vercel.app/webhook/line`。

---

## 9. 新 session 快速接手步驟

1. 讀本檔 + `DEPLOYMENT.md` + `SCHEMA.md`
2. 驗線上：`curl https://lineage-nine-sigma.vercel.app/api/status` → 應回 `storageMode: "firebase"`
3. 要改程式：**先同步本機**（§4 的 pull）
4. 部署：Windows `git push` 或 PR 流程（§5）
5. 接著可處理 §7 待辦（建議順序：#30 三位 admin 綁 LINE → #31 建第一筆成員 → #32 驗證廣播 → #33 commit HANDOFF）
6. **本機可直接查 Firestore**：`node scripts/inspect-line-data.js`（read-only，需要 `serviceAccountKey.json` 在 root）

---

## 10. 線上一鍵驗證命令

```bash
# 健康檢查（5 個端點）
for ep in status config line/status overview members; do
  echo "/api/$ep:"
  curl -s "https://lineage-nine-sigma.vercel.app/api/$ep" | head -c 200
  echo
done

# 應該看到：status:firebase / config:openMode:false / line/status:三項皆true /
# overview:完整聚合結構 / members:401 UNAUTHORIZED (要登入才看)
```

```bash
# 本機 Firestore 一覽（members、adminLineBinds、bindCodes、Auth users）
node scripts/inspect-line-data.js
```

---

完。
