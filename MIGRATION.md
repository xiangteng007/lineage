# 脫離 GCP → 自架到 NAS 操作手冊

把本系統從 **Google Cloud（Firestore + Cloud Run + Firebase Auth + Google 登入）** 完整搬到
**自家 NAS（Docker + PostgreSQL + 本地 JWT + Cloudflare Tunnel）**，達成零 GCP 費用、零 GCP 依賴。

---

## 1. 改了什麼

| 項目 | 原本（GCP，計費/依賴） | 現在（本地，免費） |
|------|------------------------|--------------------|
| 資料庫 | Firestore | **PostgreSQL**（`documents` JSONB 表） |
| 主機 | Cloud Run / Artifact Registry / GCS | **Docker on NAS** |
| 成員登入 | Firebase Auth custom token | **本地 JWT**（`/api/line-auth`，LINE 登入不變） |
| 公主登入 | Google 登入（OAuth） | **本地帳號密碼**（bcrypt 存 Postgres） |
| 前端即時更新 | Firestore `onSnapshot` | **輪詢**（每 10 秒，分頁隱藏時暫停） |
| webhook 對外 | Cloud Run 公開網址 | **Cloudflare Tunnel**（免費、自動 HTTPS） |

程式上以 `STORAGE_DRIVER` 切換資料層：`postgres`（預設）/ `firestore`（僅供匯出舊資料）。
所有後端資料存取仍走同一組 API（`firebase.js` 選擇器），故商業邏輯未動。

---

## 2. 前置需求

- 一台支援 **Docker / Docker Compose** 的 NAS（Synology DSM 7+、QNAP 皆可）或任何 Linux 主機
- 一個 **Cloudflare 帳號**（免費方案即可）＋一個網域（可用 Cloudflare 免費提供的或自有網域）
- 你的開發機上仍保有 **Firebase 憑證**（用來把舊資料倒出來，做完即可作廢）

---

## 3. 步驟 A — 匯出舊的 Firestore 資料（在開發機，趁 GCP 還在）

```bash
# 1) 安裝相依（含 devDependency 的 firebase-admin）
npm install

# 2) 提供 Firebase 憑證（擇一）
#    - 放 serviceAccountKey.json 在專案根目錄，或
#    - 在 .env 設 FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY，或
#    - 設 FIREBASE_SERVICE_ACCOUNT_JSON

# 3) 匯出 → 產生 firestore-export/<collection>.json
npm run export-firestore
```

完成後會看到 `firestore-export/` 內每個 collection 一個 JSON 檔（Members、Battles、Sieges、
Alliances、Treasury、Transactions、activityLog、settings、bindCodes、adminLineBinds…）。

> 這個資料夾已列入 `.gitignore`（含成員個資，勿上傳）。把整個 `firestore-export/` 一起帶到 NAS。

---

## 4. 步驟 B — 在 NAS 上啟動服務

```bash
# 1) 取得專案（含 firestore-export/）到 NAS，進入專案目錄
cp .env.example .env

# 2) 編輯 .env，至少填好：
#    JWT_SECRET           ← 一段長亂數！產生方式：
#                            node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    PGPASSWORD           ← 自訂資料庫密碼
#    LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_LIFF_ID
#    CLOUDFLARE_TUNNEL_TOKEN  ← 步驟 F 取得（可先留空，之後再補並 up -d）

# 3) 啟動（首次會自動建表）
docker compose up -d --build

# 健康檢查
docker compose ps
docker compose logs -f app
```

---

## 5. 步驟 C — 匯入舊資料到 PostgreSQL

把開發機的 `firestore-export/` 放到 NAS 專案目錄後，掛載進 app 容器執行匯入：

```bash
# Linux / macOS
docker compose run --rm -v "$(pwd)/firestore-export:/app/firestore-export" app \
  node scripts/import-postgres.js

# Windows PowerShell
docker compose run --rm -v "${PWD}/firestore-export:/app/firestore-export" app `
  node scripts/import-postgres.js
```

> 重新匯入想先清空可加 `--truncate`。
> collection 名稱沿用大寫（Members/Battles…），對應預設 `COLLECTION_MODE=legacy`。

---

## 6. 步驟 D — 建立公主（最高管理員）帳號

```bash
docker compose run --rm app node scripts/create-admin.js <你的帳號> <你的密碼>
```

之後在網頁右上「登入」用這組帳密即可（取代 Google 登入）。

（選用）若沒有從舊資料帶 `settings/*`，可種一份預設：
```bash
docker compose run --rm app node scripts/seed-settings.js --commit
```

---

## 7. 步驟 E — 設定 Cloudflare Tunnel（讓 LINE 連得到 NAS）

1. 登入 **Cloudflare Zero Trust** → **Networks → Tunnels → Create a tunnel**（Cloudflared 類型）。
2. 建立後複製 **Tunnel Token**，填入 NAS 的 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`，再 `docker compose up -d`。
3. 在該 tunnel 的 **Public Hostname** 新增一筆：
   - Subdomain/Domain：例如 `lineage.yourdomain.com`
   - Service：`HTTP` → `app:3001`
4. 完成後 `https://lineage.yourdomain.com` 就會打到容器內的 app（自動 HTTPS、免開 router port）。

---

## 8. 步驟 F — 更新 LINE 設定

到 **LINE Developers Console**：
- **Messaging API → Webhook URL** 改成 `https://lineage.yourdomain.com/webhook/line`，按 Verify。
- **LIFF → Endpoint URL** 改成 `https://lineage.yourdomain.com/`（或原本 LIFF 頁面路徑）。

LINE 登入、綁定、報名、廣播都會走新網址；成員端完全無感（仍是 LINE 登入）。

---

## 9. 驗證清單

- [ ] `docker compose ps` 三個服務（db / app / cloudflared）皆 healthy/running
- [ ] 瀏覽器開 `https://你的網域/`，公主帳密可登入、看得到成員/戰役/金庫
- [ ] 數據與舊系統一致（成員數、金庫餘額…）
- [ ] LINE 傳「名單」「金庫」「我的資料」有正常回覆
- [ ] LINE「綁定」流程可完成；幹部「生成綁定碼」可用
- [ ] 一端改資料，另一端約 10 秒內自動刷新（輪詢）
- [ ] 確認可登出、重新登入（token 存在 localStorage）

---

## 10. 可移除的 GCP 檔案（確認新系統運作正常後）

下列檔案已不再使用，可刪除或封存：

| 檔案 | 說明 |
|------|------|
| `service.yaml` | Cloud Run 服務定義 |
| `.gcloudignore` | gcloud 部署忽略清單 |
| `deploy.ps1` | gcloud 部署腳本 |
| `firebase.json` / `firestore.rules` | Firebase Hosting / Firestore 規則 |
| `find-firebase-key.ps1` / `setup-firebase-key.bat` | 找/裝 Firebase 金鑰的工具 |
| `scripts/migrate-collections.js` | Firestore 內部 legacy→canonical 搬遷（僅 Firestore 用） |
| `scripts/inspect-line-data.js` | Firestore/Firebase Auth 偵錯工具（僅 Firestore 用） |

> 🔴 **資安：`cloud_run_env.yaml` 內含明文 `FIREBASE_PRIVATE_KEY` 與 `LINE_CHANNEL_SECRET`。**
> 它已被加入 `.gitignore`，但若曾經 commit 過，**請務必輪替這些金鑰**（Firebase 重新產生 service account 金鑰、LINE 重發 channel secret/token），並從 git 歷史移除：
> ```bash
> git rm --cached cloud_run_env.yaml
> ```
> 確認資料已匯出、不再需要 Firebase 後，也可移除 devDependency：`npm remove firebase-admin`。

---

## 11. 回滾 / 暫時切回雲端

資料層保留了 driver 切換能力：設 `STORAGE_DRIVER=firestore` 並提供 Firebase 憑證，即可讓後端
重新讀寫 Firestore（前端的本地 JWT 登入仍適用，只是資料來源換回雲端）。預設為 `postgres`。

---

## 12. 備份

資料都在 PostgreSQL 的 `pgdata` volume，備份只要：
```bash
docker compose exec db pg_dump -U lineage lineage > backup_$(date +%F).sql
# 還原：cat backup.sql | docker compose exec -T db psql -U lineage -d lineage
```
或直接備份 Docker volume `pgdata`。建議排程每日備份並異地存放。

---

## 13. （選用）字型離線化

`index.html` 仍從 `fonts.googleapis.com` 載入 Google Fonts（免費、非 GCP 計費）。
若 NAS 僅在內網或要完全離線，可把字型下載到 `public/` 自架，並改寫 `<link>` 指向本地檔案；
不影響功能，純屬美觀與離線可用性。
