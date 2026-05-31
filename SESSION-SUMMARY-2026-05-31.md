# Lineage AI — 階段總結文件

> 期間：2026-05-30 ～ 2026-05-31
> 模式：Chrome 代操 + 後端修復 + 文件/素材產出
> 正式環境：<https://lineage-nine-sigma.vercel.app/> ｜ GitHub `main` @ `ca0e9c4`

---

## 1. 一句話總結

本階段完成 **第一筆成員建檔**、**修好 LINE 廣播**（並實機驗收）、**補上整套 RBAC 權限設定**，並產出**給其他 admin 的綁定指引（文字＋手機圖卡）**。系統功能面已完整可用，**剩餘都是「資料／營運」缺口**，無程式層級未完成項。

---

## 2. 本階段完成事項

| 項目 | 內容 | 產出 |
|---|---|---|
| 後台登入代操 | 透過 Chrome 以 Google 帳號登入（token 約 1 小時，期間重登 3 次）| — |
| **建立第一筆成員** | 小箱子（Lv40／法師／核心 Core／備註「召喚/魅法」）| Firestore Members +1 |
| **RBAC 權限初始化** | `settings/permissions｜modules｜roles｜guild` 原本全為 null → 已 seed | `seed-settings.js --commit` |
| **修復 LINE 廣播 400 bug** | Flex 的 `styles` 屬性誤置於 footer box（應在 bubble 層級）→ LINE 回 400 | [PR #25](https://github.com/xiangteng007/lineage/pull/25) → `c0068b1` |
| 廣播實機驗收 | 登記「測試首領」→ 廣播 → 手機實收 Flex（`sent:1`）| ✅ |
| HANDOFF 更新 | 記錄本階段修復＋3 條新雷點 | [PR #26](https://github.com/xiangteng007/lineage/pull/26) → `ca0e9c4` |
| admin 綁定指引 | 純文字版＋手機直式圖卡（加好友 QR＋綁定 6 步驟二合一）| `line-bind-guide.html` |

### 本階段釐清的 3 個關鍵雷點（已寫入 HANDOFF §8）
1. **action 權限走 `x-google-token` header**，不是 `Authorization: Bearer`（手動測 API 易踩）。
2. **RBAC 必須先 seed**，否則 `requireAction` 一律 403。
3. **LINE Flex `styles` 是 bubble 層級屬性**，放進 box 會 400。

---

## 3. 系統現況（2026-05-31 排查）

### 線上端點（全部正常）
| 端點 | 狀態 |
|---|---|
| `/api/status` | 200（`storageMode: firebase`）|
| `/api/config` | 200 |
| `/api/line/status` | 200 |
| `/api/overview` | 200 |
| `/api/settings` | 200（roles/modules/permissions 已 seed）|

### 資料現況（Firestore）
- **成員**：1 筆（小箱子），其中 0 筆有 `lineUserId`
- **adminLineBinds**：1 筆（xiangteng007 → 湘騰）— 應有 4 筆
- **bindCodes**：無待用綁定碼
- **Auth users（LINE）**：1

### 程式碼掃描
- 全專案 `TODO/FIXME/未實作/stub/not implemented` 掃描 → **無真正未完成標記**（命中項皆為正常的使用者提示字串與表單 placeholder）。功能面完整。

---

## 4. 排查結果：需要補完的缺口

### 🔴 必要（影響核心流程）
| # | 缺口 | 說明 | 誰做 |
|---|---|---|---|
| A | **3 位 admin 未綁定 LINE** | adminLineBinds 僅 1/4。未綁的人收不到召集通知 | tang851206 / Gary19890130 / emmashiu **本人**（指引圖卡已備妥）|
| B | **成員未綁 lineUserId** | 小箱子無 lineUserId → 出席統計、戰利品分紅、廣播都觸及不到該成員 | 後台成員列「LINE Bind」操作填入該成員 uid |

### 🟡 建議（資料品質 / 整潔）
| # | 缺口 | 說明 |
|---|---|---|
| C | **清除測試資料** | production 仍有測試用「測試首領」首領戰紀錄，建議刪除（避免污染統計）|
| D | **公會基本資料補完** | `settings/guild` 已 seed 名稱「長途夜車」/伺服器「水蛇」，但 `castles=[]`、`announcement=''` 可補 |
| E | **建立其餘成員檔** | 目前僅 1 筆成員；實際公會成員應陸續建檔，attendance/分紅才有意義 |

### 🟢 可選（環境 / 整潔，不影響運作）
| # | 缺口 | 說明 |
|---|---|---|
| F | **本機 main 落後** | 本機在 `7bb028e`（webhook 分支），origin/main 在 `ca0e9c4`。建議 `git checkout main && git pull origin main` 同步 |
| G | **untracked 工作產物** | `line-bind-guide.html`、`SESSION-SUMMARY-*.md`、`.claude/`、`scripts/inspect-line-data.js` 等未進 git，視需要納入或忽略 |

---

## 5. 下一步建議順序

1. **發指引圖卡到幹部群** → 3 位 admin 完成綁定（缺口 A）→ adminLineBinds 達 4 筆
2. 後台陸續**建立成員檔 + 綁 lineUserId**（缺口 B、E）
3. **清掉測試首領**紀錄（缺口 C）
4. 視需要補**城堡清單/公告**（缺口 D）
5. 本機 `git pull origin main` 同步（缺口 F）

---

## 6. 本階段交付物

- 程式：[PR #25](https://github.com/xiangteng007/lineage/pull/25)（廣播修復）、[PR #26](https://github.com/xiangteng007/lineage/pull/26)（HANDOFF 更新）
- 設定：Firestore `settings/*` 四份文件（seed）
- 文件：`HANDOFF.md`（已更新）、本 `SESSION-SUMMARY-2026-05-31.md`
- 素材：`line-bind-guide.html`（手機直式 LINE 通知設定圖卡，可重出）

---

完。
