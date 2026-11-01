# miro-tools 專案規則

Miro 小工具的唯一正本：`align-app/`（同高貼齊）與 `extension/`（Add to My Miro）。

## 公開 Repo 紅線

本 Repo 公開，因為 GitHub Pages 從這裡發布。不得 commit Token、板子 ID、帳號或團隊名稱、
真實板子截圖；含這些內容的提案頁留在 Google Drive `96_Workspace/_小工具/`。

## 部署與驗證

- `align-app/`：推到 `main` 由 `.github/workflows/pages.yml` 發布，改完要讀回線上內容確認。
  Web SDK 行為只能由 V 在 Miro 實機操作驗證。
- `extension/`：V 在 `chrome://extensions` 重新載入才生效。真 Miro 行為要 V 按設定頁測試鈕驗證，
  AI 不從 Chrome 儲存區讀 Token。
- 改 `extension/manifest.json` 版號時，同步更新 `extension/README.md`。
- 改 Pages 網址時，`ALIGN_APP_URL` 與 Miro App URL 要一起改。
