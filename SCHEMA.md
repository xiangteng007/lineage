# Firestore 資料庫 Schema 設計

天堂經典版公會管理系統 — Lineage AI

---

## 成員分級設計（5 層，公會主可自訂名稱）

| roleLevel | 預設名稱           | 說明               |
|-----------|--------------------|--------------------|
| 5         | 公主 / 公會主      | Guild Master，最高權限 |
| 4         | 元帥               | Elder / Senior Officer，可管理成員 |
| 3         | 幹部               | Officer，可操作大多數功能 |
| 2         | 成員               | Member，一般登入者 |
| 1         | 新人               | Recruit，受限閱覽 |

> 階級名稱可在 `settings/roleDefinitions` 自訂，roleLevel 數字為系統內部使用不可更改。

---

## Collections

### `users` — Firebase Auth 使用者

Document ID = Firebase Auth UID

```
{
  lineId:           string,          // LINE User ID（綁定後填入）
  displayName:      string,          // 顯示名稱（LINE 名或自訂）
  role:             string,          // 階級名稱（對應 roleDefinitions）
  roleLevel:        number,          // 1–5，系統權限依此判斷
  guildCharacters:  [                // 此帳號綁定的遊戲角色列表
    {
      memberId:   string,            // 對應 members collection 的 doc ID
      charName:   string,            // 角色名稱（快取，避免跨表查詢）
      class:      string,            // 職業
      level:      number             // 等級（快取）
    }
  ],
  permissions: {                     // 細粒度權限覆蓋（選用）
    canManageMembers:   boolean,
    canManageTreasury:  boolean,
    canManageSieges:    boolean
  },
  bindCode:         string | null,   // 一次性綁定碼（LINE Bot 綁定流程）
  bindCodeExpiresAt: timestamp | null,
  createdAt:        timestamp,
  lastLogin:        timestamp
}
```

---

### `members` — 遊戲角色資料

Document ID = 自動生成

```
{
  ownerUid:     string,          // 外鍵 → users/{uid}（已綁定則填入）
  lineId:       string | null,   // LINE User ID（未綁定則 null）
  charName:     string,          // 角色名稱
  class:        string,          // 職業（e.g. 黑暗精靈, 妖精, 王族, 騎士, 法師, 龍騎士）
  level:        number,          // 角色等級
  role:         string,          // 公會階級名稱
  roleLevel:    number,          // 1–5
  joinDate:     string,          // 入會日期 YYYY-MM-DD
  notes:        string,          // 備註
  isActive:     boolean,         // 是否在籍
  createdAt:    timestamp,
  updatedAt:    timestamp
}
```

---

### `bossBattles` — 首領戰記錄

Document ID = 自動生成

```
{
  bossId:       string,          // Boss 識別碼（e.g. "ant_queen", "oren"）
  bossName:     string,          // Boss 中文名稱
  date:         string,          // 日期 YYYY-MM-DD
  time:         string,          // 時間 HH:MM
  status:       string,          // "scheduled" | "ongoing" | "completed" | "cancelled"
  result:       string | null,   // "victory" | "defeat" | null
  registrations: [               // 預報名名單（成員自行報名）
    {
      memberId:   string,
      charName:   string,
      class:      string,
      registeredAt: timestamp
    }
  ],
  attendance: [                  // 實際出席名單（幹部點名確認）
    {
      memberId:   string,
      charName:   string,
      class:      string,
      confirmedBy: string,       // 幹部 uid
      confirmedAt: timestamp
    }
  ],
  drops: [                       // 掉寶記錄
    {
      itemName:   string,
      quantity:   number,
      assignedTo: string | null  // memberId
    }
  ],
  settlement: {                  // 結算資料
    totalAdena:     number,      // 總獲得亞丁
    distributedTo:  string[],    // 獲得分配的 memberId 列表
    notes:          string,
    settledAt:      timestamp,
    settledBy:      string       // 幹部 uid
  } | null,
  createdBy:    string,          // 建立者 uid
  createdAt:    timestamp,
  updatedAt:    timestamp
}
```

---

### `sieges` — 攻城戰 / 守城戰記錄

Document ID = 自動生成

```
{
  type:         string,          // "attack" | "defend"
  castleName:   string,          // 城堡名稱（e.g. 銀月城, 肯特城）
  date:         string,          // 日期 YYYY-MM-DD
  time:         string,          // 時間 HH:MM
  opponent:     string,          // 對手公會名稱
  result:       string | null,   // "victory" | "defeat" | "draw" | null
  status:       string,          // "scheduled" | "ongoing" | "completed" | "cancelled"
  attendance: [
    {
      memberId:   string,
      charName:   string,
      class:      string,
      confirmedAt: timestamp
    }
  ],
  taxCollected: number,          // 本場攻城後徵收稅收（亞丁）
  notes:        string,
  createdBy:    string,
  createdAt:    timestamp,
  updatedAt:    timestamp
}
```

---

### `treasury` — 金庫交易記錄

Document ID = 自動生成

```
{
  type:         string,          // "income" | "expense"
  category:     string,          // "castle_tax" | "boss_drop" | "donation" | "equipment" | "event" | "other"
  amount:       number,          // 金額（亞丁）
  date:         string,          // 日期 YYYY-MM-DD
  description:  string,          // 說明
  relatedId:    string | null,   // 關聯文件 ID（bossBattleId / siegeId 等）
  relatedType:  string | null,   // "bossBattle" | "siege" | null
  castleName:   string | null,   // 城堡稅收時填入
  recordedBy:   string,          // 記錄者 uid
  createdAt:    timestamp
}
```

---

### `alliances` — 外交聯盟資料

Document ID = 自動生成

```
{
  guildName:    string,          // 對方公會名稱
  type:         string,          // "ally" | "enemy" | "neutral" | "vassal" | "suzerain"
  pledgeName:   string,          // 公約/誓約名稱（選用）
  leaderName:   string,          // 對方公會主名稱
  leaderClass:  string,          // 對方公會主職業
  server:       string,          // 伺服器
  notes:        string,
  startDate:    string,          // 關係建立日期 YYYY-MM-DD
  endDate:      string | null,   // 關係結束日期，null 表示進行中
  isActive:     boolean,
  createdBy:    string,
  createdAt:    timestamp,
  updatedAt:    timestamp
}
```

---

### `settings` — 公會設定

Document ID 為固定 key（e.g. `"guild"`, `"roles"`, `"modules"`）

#### `settings/guild` — 基本公會資訊
```
{
  guildName:    string,
  serverName:   string,
  castles:      string[],        // 目前持有城堡列表
  announcement: string,          // 公告欄
  updatedAt:    timestamp
}
```

#### `settings/roles` — 自訂階級名稱
```
{
  roleDefinitions: [
    { level: 5, name: string, color: string },   // e.g. { level: 5, name: "公主", color: "#FFD700" }
    { level: 4, name: string, color: string },
    { level: 3, name: string, color: string },
    { level: 2, name: string, color: string },
    { level: 1, name: string, color: string }
  ],
  updatedAt: timestamp
}
```

#### `settings/modules` — 模組權限設定
```
{
  modulePermissions: {
    members:    { minRead: number, minWrite: number },   // e.g. { minRead: 1, minWrite: 3 }
    bossBattles:{ minRead: number, minWrite: number },
    sieges:     { minRead: number, minWrite: number },
    treasury:   { minRead: number, minWrite: number },
    alliances:  { minRead: number, minWrite: number },
    settings:   { minRead: number, minWrite: number }
  },
  updatedAt: timestamp
}
```

---

## 索引（firestore.indexes.json）

| Collection   | Fields                          | 用途                     |
|--------------|---------------------------------|--------------------------|
| members      | lineId ASC, createdAt DESC      | LINE Bot 查詢角色         |
| bossBattles  | date DESC, status ASC           | 依日期篩選進行中/已完成   |
| treasury     | type ASC, date DESC             | 收支分類時間排序          |
