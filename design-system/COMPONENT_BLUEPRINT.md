# COMPONENT BLUEPRINT

## 1. AppShell
- **描述**: 最外層容器，包含全域背景、大氣光暈與粒子系統。
- **視覺**: 黑曜石背景，底部發散血紅色 `radial-gradient` 光暈。
- **結構**: 固定視窗大小 `100vh`，內部包含 Sidebar, TopNav, Hero, Main Grid。

## 2. Header / TopNav
- **描述**: 頂部導覽列，水平對齊。
- **視覺**: 無背景色（全透明），文字帶有微弱發光，作用中項目（DASHBOARD）下方帶有金色指示線。
- **結構**: `Flex` 佈局，`justify-content: space-between`。左側 Logo，中間 Menu，右側 Profile。

## 3. Sidebar
- **描述**: 左側全螢幕高度的圖示導覽列。
- **視覺**: 極低透明度的背景，分隔主畫面。
- **結構**: `Flex column`，置中對齊圖示。

## 4. Mobile Bottom Nav (RWD)
- **描述**: 針對手機版的替代導覽方案。
- **視覺**: 帶有極強毛玻璃模糊的底部懸浮列。
- **結構**: 固定於視窗底部 `fixed bottom-0`，將 Sidebar 的圖示水平展開。

## 5. Hero Emblem
- **描述**: 中央頂部的血盟徽章，視覺核心。
- **視覺**: 3D 金屬質感，強烈發光特效，寶石具備紅色光暈。
- **結構**: 絕對定位 `position: absolute` 或 負邊距 `margin-top: -XXpx` 懸浮於網格中心點。

## 6. Dashboard Cards (通用卡片)
- **視覺**: 
  - `background`: `rgba(25, 30, 40, 0.4)`
  - `backdrop-filter`: `blur(12px)`
  - `border`: `1px solid rgba(212, 175, 55, 0.2)`，可能帶有漸層。
  - `border-radius`: `16px`
  - `box-shadow`: 內部邊緣高光與外部深色陰影。
- **結構**: 內部統一 `padding: 24px`，使用 Flex 或 Grid 進行內容排版。

## 7. Legion Overview (卡片模組)
- **描述**: 左上角。
- **結構**: 包含 Rank (皇冠圖示 + 文字)、Clan Rating (皇冠圖示 + 文字)、Active Members (人群圖示 + 數字)。垂直排列 `Flex column`。

## 8. Recent Activity (卡片模組)
- **描述**: 中上。
- **結構**: 標題 + 可捲動的列表 `overflow-y: auto`。每個列表項包含頭像、敘述文字與右側獲得獎勵 (圖示 + 綠色數字)。

## 9. Upcoming Sieges (卡片模組)
- **描述**: 右上。
- **結構**: 標題帶有 "i" 圖示。列表項包含時鐘/皇冠圖示、任務名稱、倒數時間與交叉的劍圖示。

## 10. Top Contributors (卡片模組)
- **描述**: 左下。
- **結構**: 標題 + 前三名列表。列表項左側為帶有質感的圓形徽章(金/銀/銅)，右側為名稱。

## 11. Clan Bank (卡片模組)
- **描述**: 中下。
- **結構**: 金幣圖示 + 數字、水晶圖示 + 數字。底部為滿版寬度按鈕 `w-full`。

## 12. Guild Chat (卡片模組)
- **描述**: 右下。
- **結構**: 標題帶有收合箭頭。中間為訊息列表。底部為輸入框佈局 `Flex row`。

## 13. Buttons
- **視覺**: 漸層金色底 `linear-gradient`，深色文字，無毛玻璃，具有實體厚度感與陰影。
- **狀態**: `Hover` 時亮度增加，`Active` 時有按壓縮小特效。

## 14. Inputs
- **視覺**: 與卡片相同的毛玻璃質感，但邊框較細，背景更透明。
- **文字**: Placeholder 為低對比色。

## 15. Badges / Indicators
- **視覺**: 訊息通知的小紅點，帶有鮮豔的紅色背景與白色數字，形狀為圓形。
