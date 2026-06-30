-- ═══════════════════════════════════════════════════════════════════════════
--  Lineage AI 血盟管理系統 — PostgreSQL schema
--  取代 Firestore。所有「文件型」集合存在單一 documents 表（JSONB），
--  讓 lib/store-postgres.js 能以與 Firestore 相同的 API 對外服務。
--  這支 SQL 是冪等的（IF NOT EXISTS），store-postgres 啟動時也會自動執行一次，
--  所以即使沒有跑 initdb 也能自我修復。
-- ═══════════════════════════════════════════════════════════════════════════

-- 文件存放區：collection + doc_id 為主鍵，data 為整份文件（JSONB）。
-- 對應 Firestore 的 collection/document 模型；ID 一律以 TEXT 保存，與舊資料相容。
CREATE TABLE IF NOT EXISTS documents (
    collection  TEXT        NOT NULL,
    doc_id      TEXT        NOT NULL,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, doc_id)
);

-- 依集合掃描（getAllData 最常用）
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection);

-- JSONB 欄位查詢加速（where lineUserId == / settled == 之類；資料量小時非必要，但無妨）
CREATE INDEX IF NOT EXISTS idx_documents_data_gin ON documents USING GIN (data);

-- 後台管理員（公主）本地帳號 — 取代 Google 登入。
-- password_hash 為 bcrypt 雜湊；role_level 預設 5（公主）。
CREATE TABLE IF NOT EXISTS admin_users (
    username      TEXT        PRIMARY KEY,
    password_hash TEXT        NOT NULL,
    role_level    INTEGER     NOT NULL DEFAULT 5,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
