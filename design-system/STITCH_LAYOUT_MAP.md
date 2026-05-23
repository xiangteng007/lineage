# STITCH LAYOUT MAP (UI Structure Master)

## 1. 總體網格 (Global Grid System)
- **佈局類型**: 全螢幕固定面板 (Fullscreen Fixed Dashboard) 與 兩欄/多欄網格。
- **邊距 (Margins/Padding)**: 四周留有均勻的外部邊距 (例如 `padding: 2rem`)。

## 2. 結構層次 (Component Hierarchy)

### A. 左側導覽列 (Sidebar Navigation)
- **位置**: 固定於畫面最左側，垂直排列。
- **內容**: 
  - 頂部：首頁/網格圖示 (Dashboard)。
  - 中間：武器/劍圖示 (Arsenal/Battles)。
  - 底部：獎盃/成就圖示 (Quests/Achievements)。
- **寬度**: 窄版 (Icon-only)，大約 `80px` 寬。

### B. 頂部導覽列 (Top Navigation)
- **位置**: 橫跨主要內容區塊的頂部。
- **內容結構 (由左至右)**:
  1. **Logo區**: 帶有紅寶石與龍的徽章 + 文字 "THE BLOODSTONE LEGION"。
  2. **選單區**: 水平排列字串 "DASHBOARD" (Active, 帶底線), "CLAN", "QUESTS", "ARSENAL", "FORUM", "STORE"。
  3. **個人檔案區 (Profile)**: 使用者名稱 "VON KARSTEIN", 階級 "Overlord", 加上圓形頭像與通知紅點 (1)。
- **分隔線**: 無明顯分隔線，透過排版與對齊產生結構。

### C. 主視覺區 (Hero Zone)
- **中心徽章 (Center Emblem)**: 巨大的 3D 血盟徽章，懸浮於網格的上方中央，穿透背景與卡片層，創造極強的視覺焦點。
- **右上角懸浮按鈕 (FAB - Messages)**: 位於徽章右側偏上，顯示 "MESSAGES" 與信封圖示及紅點 (3)。

### D. 儀表板卡片網格 (Dashboard Card Grid)
- **網格結構**: 3欄 x 2列 (3 Columns x 2 Rows)
- **欄寬比例**: 約 3 : 4 : 4 (目測比例)

#### 第一列 (Top Row)
1. **LEGION OVERVIEW (左側欄)**
   - 階級 (Rank): Royal Warlord
   - 評分 (Clan Rating): 9,850 SR
   - 活躍成員 (Active Members): 142/150
2. **RECENT ACTIVITY (中間欄)**
   - 帶有捲動區域的動態列表。
   - 包含成員頭像、事件描述與獲得獎勵 (如獎盃 +500, 寶石 +250)。
3. **UPCOMING SIEGES (右側欄)**
   - 包含 "i" 資訊圖示。
   - 兩個即將到來的攻城戰條目，顯示剩餘時間與劍圖示。

#### 第二列 (Bottom Row)
1. **TOP CONTRIBUTORS (左側欄)**
   - 排行榜列表。
   - 前三名玩家 (Aethelgard, Morvath, Elara)，帶有金銀銅皇冠圖示。
2. **CLAN BANK (中間欄)**
   - 金庫資源統整。
   - 1,250,000 Gold (金幣)。
   - 85 Rare Shards (稀有碎片)。
   - 底部有大型 "Donate" 按鈕。
3. **GUILD CHAT (右側欄)**
   - 帶有向上箭頭 (展開/收合) 的標題。
   - 捲動式的聊天視窗 (包含成員頭像、名稱、時間與訊息內容)。
   - 底部有輸入框 (Type a message...) 與送出箭頭。

## 3. 響應式策略 (RWD Strategy - 推斷)
- **Desktop (>1024px)**: 完整的 3x2 網格，側邊欄與頂部導覽列分離。
- **Tablet (768px-1024px)**: 網格可能轉為 2x3 或重新排列卡片順序，側邊欄可能隱藏或縮至頂部/底部。
- **Mobile (<768px)**: 網格轉為 1欄 (單行排列)，導覽列轉為漢堡選單或底部導覽列 (Bottom Nav)。
