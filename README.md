# 天堂精典版管理系統 ⚔️

> 基於 Firebase Firestore + LINE Bot 的血盟管理系統，適用於《天堂經典版》公會日常運作。

## 功能特色

- 🛡️ **血盟成員管理** — 新增、查詢、刪除血盟成員
- ⚔️ **首領戰紀錄** — 記錄打王出席名單、拍賣天幣，自動計算每人分紅
- 🏰 **攻城戰紀錄** — 追蹤攻守城出席與獎金發放
- 🤝 **聯盟名單** — 管理同盟公會玩家
- 🤖 **LINE Bot 整合** — 在 LINE 群組內輸入指令查詢即時資訊

## 技術架構

| 分層 | 技術 |
|---|---|
| 後端伺服器 | Node.js + Express |
| 資料庫 | Firebase Cloud Firestore |
| LINE 整合 | @line/bot-sdk |
| 前端介面 | Vanilla HTML/CSS/JS |
| 部署平台 | Vercel / 區網自架 |

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

複製 `.env.example` 並填入您的設定：

```bash
cp .env.example .env
```

```env
LINE_CHANNEL_ACCESS_TOKEN=您的_LINE_Channel_Access_Token
LINE_CHANNEL_SECRET=您的_LINE_Channel_Secret
```

### 3. 設定 Firebase

前往 [Firebase Console](https://console.firebase.google.com/) 建立專案並下載服務帳戶金鑰，將其命名為 `serviceAccountKey.json` 放置於根目錄。

### 4. 啟動伺服器

```bash
node server.js
```

系統啟動後可透過：
- **本機**: http://localhost:3000
- **區網**: 由終端機顯示的區網 IP 連線

## LINE Bot 指令

| 指令 | 功能 |
|---|---|
| `名單` | 查詢血盟成員人數與清單 |
| `拍賣` | 查詢最新首領戰分紅結算 |
| `網頁` | 開啟管理系統網頁 |

## 部署至 Vercel

1. 推送到 GitHub
2. 在 Vercel 匯入專案
3. 設定以下環境變數：
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

## 注意事項

> ⚠️ **請勿將 `serviceAccountKey.json` 上傳至 GitHub！** 此檔案已加入 `.gitignore` 保護。
