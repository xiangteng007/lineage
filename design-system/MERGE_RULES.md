# MERGE RULES (Gamma Visuals + Stitch Layout)

## 1. 唯一真理來源 (Single Source of Truth)

### 視覺質感 (Visual Fidelity) ➔ 絕對以「圖1 (Reference Image)」為準
- 所有卡片的毛玻璃 (Glassmorphism) 特效。
- 所有發光 (Glow)、陰影 (Shadow) 與顏色代碼 (Color Hex)。
- 邊框圓角大小 (Border Radius) 與粗細。
- 粒子特效 (Particles) 與環境光暈 (Ambient Lighting)。
- 字體色彩層次 (亮金、暗金、半透明白)。

### 介面結構 (Layout & Structure) ➔ 絕對以「圖2 (Stitch Screenshots)」為準
- 畫面的 Flexbox 與 CSS Grid 結構。
- 卡片在畫面上的絕對順序與相對位置 (3欄2列)。
- 模組的包含關係 (例如：左側導覽列必定存在，不論視覺圖是否強調)。
- 內距 (Padding)、外距 (Margin) 的尺寸比例。
- RWD 斷點時的排列行為。

## 2. 衝突解決規則 (Conflict Resolution)

| 衝突情境 | 解決方案 | 範例說明 |
| :--- | :--- | :--- |
| **圖1的卡片比較寬，但圖2的卡片比較窄** | 遵循 **圖2 (Stitch)** 的欄位寬度比例。 | 若圖2規定了 3:4:4 的網格，則無視圖1的絕對寬度，將圖1的質感套用到圖2的寬度上。 |
| **圖2的元件太靠近，導致圖1的發光效果被切斷** | 遵循 **圖2 (Stitch)** 的 Grid，但允許微調 `gap` 或增加 `margin` 來容納光暈。 | 光暈(Glow)不能改變 DOM 結構，應使用 `box-shadow` 或絕對定位元素向外發散。 |
| **圖1沒有顯示某個圖2有的按鈕** | 遵循 **圖2 (Stitch)** 的結構。 | 將圖2的按鈕加上圖1的按鈕視覺風格 (例如金色漸層與發光)。 |
| **圖1的字體大小與圖2不同** | 視覺層級遵循 **圖1 (Reference)**，但文字排版遵循 **圖2 (Stitch)**。 | 將圖2的版面套用圖1的標題樣式。 |

## 3. 合併執行步驟 (Execution Protocol)
1. **結構優先 (Structure First)**: 先使用 HTML/CSS 刻出圖2的 100% 準確 Grid 與 Flex 佈局。所有元件先用純色佔位。
2. **底層氛圍 (Atmosphere Base)**: 套用圖1的黑曜石背景、底部紅光與 CSS 粒子系統。
3. **材質注入 (Material Injection)**: 將圖1的毛玻璃 CSS (backdrop-filter, rgba border) 套用到所有佔位卡片上。
4. **細節刻畫 (Detailing)**: 處理字體顏色、圖示發光、與金屬材質的漸層。
5. **最終校準 (Final Alignment)**: 確認所有功能區塊完全吻合圖2的規格，且視覺效果完全媲美圖1。
