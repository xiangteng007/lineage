# ── Lineage AI 血盟管理系統 — 應用程式映像 ──────────────────────────────
# Node.js + Express。資料庫為外部 PostgreSQL（見 docker-compose.yml）。
# 以 --omit=dev 安裝，故不會帶入 firebase-admin（僅匯出舊資料時才需要）。
FROM node:20-alpine

WORKDIR /app

# 先複製 manifest 以善用 layer 快取
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 複製其餘程式碼
COPY . .

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
