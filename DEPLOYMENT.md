# Lineage AI — 上線部署手冊 (Go-Live Deployment Guide)

> 天堂經典版 公會管理系統 ｜ Node.js + Express + Firebase Firestore + LINE Bot/LIFF + Vercel
> 本手冊涵蓋從零到上線的完整步驟、上線後驗收清單與回滾程序。

---

## 0. 系統架構速覽

| 層 | 技術 | 說明 |
|---|---|---|
| 後端 API | Node.js / Express (`server.js`) | 所有寫入經此，使用 Firebase Admin SDK |
| 資料庫 | Firebase Firestore | 集合命名支援 legacy / canonical 雙模式 |
| 通知 / 登入 | LINE Messaging API + LIFF | 成員以 LINE 登入、Bot 指令與召集推播 |
| 擁有者登入 | Google OAuth | `ADMIN_EMAILS` 名單 = roleLevel 5 |
| 前端 | 靜態 SPA (`public/`) | 由 server.js 提供，Firestore client 即時同步 |
| 部署 | Vercel（API）+ Firebase（規則/索引） | 亦可改用 Cloud Run（`service.yaml`） |

**權限分層**：會主(5) / 元帥(4) / 幹部(3) / 成員(2) / 新人(1)。擁有者(Google)恆為 5；成員(LINE)依其 `tier` 或 `roleLevel` 對應。各動作最低階級可由擁有者在「金庫 → 權限設定」線上調整（存於 `settings/permissions`）。

---

## 1. 前置需求

- Node.js 18+ 與 npm
- Firebase 專案（已啟用 Firestore）＋ Service Account 金鑰
- LINE Developers：一個 **Messaging API channel**（Bot）＋ 一個 **LINE Login channel**（建立 LIFF）
- Google Cloud：OAuth 2.0 用戶端 ID（網頁應用程式）— 供擁有者登入
- Vercel 帳號（或 Cloud Run）＋ `firebase-tools`（`npm i -g firebase-tools`）

---

## 2. 環境變數 (`.env`)

複製 `.env.example` 為 `.env` 並填入：

```ini
# LINE Bot (Messaging API channel)
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
# LIFF App ID (LINE Login channel 內建立的 LIFF)
LINE_LIFF_ID=2000000000-xxxxxxxx

# Firebase Admin —— 雲端部署建議用單一 JSON 變數
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"lineage-b0156",...}
#（本機開發可改放 serviceAccountKey.json 於專案根目錄，已被 .gitignore 忽略）

# Google OAuth（擁有者登入）
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
# 擁有者 Gmail（逗號分隔）；留空 = 開放模式（所有人皆 admin，僅供測試）
ADMIN_EMAILS=owner@gmail.com

# 集合命名模式：legacy=現有大寫(Members/Battles…) / canonical=遷移後小寫
COLLECTION_MODE=legacy

PORT=3001
NODE_ENV=production
```

> ⚠️ `ADMIN_EMAILS` 一定要填正式擁有者信箱；留空會進入「開放模式」讓所有請求視為管理員。

---

## 3. LINE 設定

### 3.1 Messaging API（Bot）
1. LINE Developers → 建立 Provider → 建立 **Messaging API** channel。
2. 取得 **Channel access token** 與 **Channel secret** → 填入 `.env`。
3. Webhook URL 設為：`https://<你的網域>/api/webhook`，啟用 Webhook、關閉自動回覆。
4. （選用）設定圖文選單，連結到下方 LIFF 網址。

### 3.2 LIFF（成員登入）
1. 建立或選一個 **LINE Login** channel → LIFF → 新增 LIFF app。
2. Size：**Full**；Endpoint URL：`https://<你的網域>/`（部署後的網址）。
3. Scopes 勾選 `profile`、`openid`。
4. 取得 **LIFF ID** → 填入 `.env` 的 `LINE_LIFF_ID`。
5. 成員從 LINE（圖文選單或連結）開啟此 LIFF 網址即自動以 LINE 身分登入。

---

## 4. Google OAuth（擁有者登入）
1. Google Cloud Console → API 與服務 → 憑證 → 建立 OAuth 2.0 用戶端 ID（網頁應用程式）。
2. 已授權的 JavaScript 來源：`https://<你的網域>`。
3. 取得用戶端 ID → 填入 `GOOGLE_CLIENT_ID`，並把擁有者 Gmail 填入 `ADMIN_EMAILS`。

---

## 5. Firebase（規則與索引）

```bash
firebase login
firebase use <your-project-id>          # 例 lineage-b0156

# 部署 Firestore 安全規則（已涵蓋 legacy + canonical 集合 + transactions/activityLog）
firebase deploy --only firestore:rules

# 部署複合索引（members/bossBattles/sieges/transactions/activityLog）
firebase deploy --only firestore:indexes
```

> 規則設計：所有特權**寫入走後端 Admin SDK（繞過規則）**；前端只**讀取**（onSnapshot / 個人檔案），讀取規則僅需 `isSignedIn()`，故 LINE 成員登入後即可即時同步。`settings` 僅擁有者(5)可由前端寫入。

---

## 6. 集合命名與資料遷移（選用，但建議）

目前程式預設 `COLLECTION_MODE=legacy`（沿用既有 `Members/Battles/...`）。若要遷移到 schema 文件的 canonical 小寫命名：

```bash
# 1) 預覽（不寫入）
npm run migrate -- --dry-run
# 2) 正式複製（不刪來源，可回滾）
npm run migrate -- --commit
# 3) 切換程式指向新集合（免改碼）
#    .env 設 COLLECTION_MODE=canonical 後重新部署
# 4) 確認穩定後再人工清理舊集合
```

> 不遷移也能正常上線；規則已同時涵蓋兩種命名。

---

## 7. 初始化設定（權限 / 階級 / 模組）

```bash
# 預覽
npm run seed
# 寫入缺少的 settings 文件（idempotent，不覆蓋既有）
npm run seed -- --commit
```

建立的文件：`settings/permissions`（action 權限預設）、`settings/modules`（模組讀寫階級）、`settings/roles`（5 階級定義）、`settings/guild`（公會基本資料）。

---

## 8. 本機驗證

```bash
npm install
npm test                 # 單元測試（聚合 + 權限）應 31 passing
node --check server.js   # 語法檢查
npm run dev              # 本機啟動 http://localhost:3001
```

---

## 9. 部署（Vercel）

```bash
npm i -g vercel
vercel link              # 綁定專案
# 於 Vercel 專案 Settings → Environment Variables 設定第 2 節所有變數
vercel --prod
```

部署後：
- 將 LINE Webhook URL、LIFF Endpoint、Google OAuth 來源都改成正式網域。
- 確認 `FIREBASE_SERVICE_ACCOUNT_JSON`（單一變數）已設定（雲端不放金鑰檔）。

> 替代方案：Cloud Run 使用 `service.yaml` 與 `deploy.ps1`；Firebase Hosting 可托管 `public/` 靜態檔（`firebase.json` 已含 hosting 設定）。

---

## 10. 上線後驗收清單 (Smoke Test)

| # | 項目 | 預期 |
|---|---|---|
| 1 | `GET /api/status` | `{ ok:true, storageMode:"firebase" }` |
| 2 | `GET /api/config` | 含 `liffId`、`googleClientId`、`openMode:false` |
| 3 | 擁有者 Google 登入 | 看到全部模組與管理按鈕 |
| 4 | 成員從 LINE 開 LIFF | 自動登入，預設導向「我的檔案」 |
| 5 | 階級檢視 | 低階成員看不到金庫/權限設定 |
| 6 | 幹部建立/結算首領戰 | 結算精靈三步可完成、金庫更新 |
| 7 | 金庫收入/支出登記 | 依「權限設定」分別生效 |
| 8 | LINE 指令 | 名單/金庫/出席排行/攻城報名/我的記錄 正常回覆 |
| 9 | 即時同步 | 一端變更，另一端 onSnapshot 自動刷新 |
| 10 | 概覽 | KPI、職業分布圖、金庫趨勢圖、動態 feed 有資料 |

---

## 11. 權限初始化與線上調整

擁有者登入 → 進「金庫」→「權限設定 Access Control」：可逐項設定各動作（收入/支出/城堡稅、新增/刪除成員、刪除首領/攻城、LINE 召集）的最低階級，存檔即時生效（前端按鈕 + 後端 `requireAction` 同步）。預設：刪除成員=會主、刪除戰役=元帥、支出=元帥，其餘=幹部。

成員階級：幹部以上可在「成員」編輯成員 `tier`；或設定 `roleLevel` 明確指定（防越權：非擁有者不得升到高於自己）。

---

## 12. 回滾與故障排除

| 狀況 | 處理 |
|---|---|
| 程式需回退 | `git revert <commit>` 後重新部署（變更皆有保留歷史） |
| 集合遷移要回退 | `.env` 設 `COLLECTION_MODE=legacy` 重新部署；新集合可保留或刪除 |
| 餘額與記錄不符 | `GET /api/treasury` 看 `reconciled`；以交易加總為準，必要時人工對帳 |
| 成員 onSnapshot 無資料 | 確認已部署最新 `firestore.rules`、成員確由 LIFF 登入（有 Firebase session） |
| LINE 召集失敗 | 檢查 `LINE_CHANNEL_ACCESS_TOKEN`、成員是否已綁定 LINE |
| 索引錯誤 | `firebase deploy --only firestore:indexes` 並等索引建立完成 |

---

## 13. 維運建議
- 定期匯出 Firestore 備份（Firebase 主控台 / `gcloud firestore export`）。
- 監看 Vercel Function Logs 觀察 API 錯誤。
- 重大操作會寫入 `activityLog`，可於概覽「最近動態」追蹤。

---

_Lineage AI — Deployment Guide ｜ 對應系統版本：全模組深化 + 雙軌登入 + 可配置 RBAC_
