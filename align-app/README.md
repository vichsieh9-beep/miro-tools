# 同高貼齊（Miro 小工具）

複選多張圖片或連結卡，一鍵：**固定統一為 1024px 高 → 依畫面位置由左到右貼齊、底端對齊；每排最多 8 張，第 9 張起自動換排**。

只影響圖片與連結卡（貼網址產生的預覽卡 `preview`、影片等嵌入卡 `embed`），其他物件（文字、便利貼、框）會被略過；等比例縮放不變形。Miro 不讓改大小的卡片只排位置。

`headless.js` 另外開了兩個函式給「Add to My Miro」擴充功能注入呼叫：
- `window.sameHeightPlaceItem(id, left, top, height)`：借 Web SDK 縮放＋擺位。實測（2026-10-24）代貼的原生預覽卡在 SDK 是 `embed`、寬高唯讀，縮不了，只會擺位置。
- `window.sameHeightGetViewport()`／`sameHeightSetZoom(zoom)`／`sameHeightSetViewport(rect)`（試做）：原生卡貼上的當下大小跟著縮放走，擴充功能貼上前先調縮放讓卡片一貼就是圖片高度，貼完調回。（`createPreview` 建的 preview 卡縮得動但沒有圖，V 10-24 否決，已拿掉。）

---

## 檔案

| 檔案 | 作用 |
|---|---|
| `index.html` | App 的 SDK 進入點（背景載入）。薄載入器：只負責用時間戳載 `headless.js`，本身永遠不用再改 |
| `headless.js` | 背景邏輯：右鍵選單 custom action ＋ 點圖示一鍵直跑；沒選夠圖才開面板 |
| `panel.html` | 面板 UI（要調間距、看說明時才用） |
| `align-core.js` | 同高＋貼齊的幾何核心（右鍵/一鍵直跑/面板三入口共用） |
| `app.js` | 面板 UI 邏輯（讀間距 → 呼叫核心 → 顯示狀態） |

---

## 一次性設定（約 5 分鐘）

### 1. 建立 Miro App
1. 到 <https://miro.com/app/settings/user-profile/apps>（或你的團隊 → **Profile settings → Your apps**）。
2. **Create new app** → 取名（例：`同高貼齊`）→ 選你的團隊 → Create。

### 2. 開權限（Permissions）
在 App 設定頁 **Permissions** 勾選：
- `boards:read`
- `boards:write`

### 3. 設定 Web SDK URL
在 **App URL / SDK URL** 欄位填入 `index.html` 的網址（見下方「怎麼放上網」）。
在 **App icon / Configure toolbar** 開啟工具列圖示，讓 App 出現在白板左側工具列。

### 4. 安裝到團隊
**Install app and get OAuth token** → 選團隊 → 安裝。

之後打開任何白板，左側工具列就會有這個 App 圖示。

---

## 怎麼放上網（index.html 要有網址）

Miro 只吃 **https**（或 `http://localhost`）。二選一：

### 方案 A：本機測試（最快，只有這台電腦能用）
```bash
cd ~/dev/miro-tools/align-app
npx serve -l 3000
```
SDK URL 填：`http://localhost:3000/index.html`
（要用工具時這個指令得開著。）

### 方案 B：GitHub Pages（永久網址，推薦長期用）
推到 `main` 後，`.github/workflows/pages.yml` 會自動把這個資料夾發布到 GitHub Pages。
SDK URL 填：
`https://vichsieh9-beep.github.io/miro-tools/index.html`

> 純靜態、無需 build，兩種方案都直接可用。

---

## 使用方式

**日常 A（右鍵選單，最快）**：
1. 複選 2 張以上圖片或連結卡。
2. 右鍵（或選取框的「⋯」選單）→ **同高貼齊** → 直接執行，右下角跳 Miro 通知顯示結果。

**日常 B（點工具列圖示一鍵直跑）**：
1. 複選 2 張以上圖片或連結卡。
2. 點左側工具列的「同高貼齊」App 圖示 → **直接執行**（間距 0），不開面板。

**要調間距**：什麼都不選（或只選 1 張）再點圖示 → 面板打開，照舊輸入間距後按按鈕。

> 為什麼不是鍵盤快捷鍵？Miro Web SDK 沒有開放自訂 hotkey 的 API（快捷鍵清單是官方寫死的），
> 第三方 App 最快的觸發方式就是右鍵 custom action 與圖示一鍵直跑。
> custom action 走 `miro.board.experimental.action.register`（實驗性 API、限私有 App——本 App 符合）。

---

## 想改行為？

都在 `align-core.js`：
- **改對齊方式**（現在是底端 `it.img.y = bottomY - targetH / 2`）：
  置中改成 `it.img.y = anchor.y`；頂端改成先算 `const topY = anchor.y - anchor.h / 2`，再 `it.img.y = topY + targetH / 2`。
- **改目標高度**（現在是固定常數 `ALIGN_TARGET_HEIGHT = 1024`）：改這個常數即可。
- **改每排張數**（現在是固定常數 `ALIGN_ITEMS_PER_ROW = 8`）：改這個常數即可。
- **改排序**（現在依畫面位置）：拿掉 `items.sort(...)` 就會用選取順序。
