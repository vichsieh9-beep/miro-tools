/* 同高貼齊 — 背景（headless）邏輯，由 index.html 以時間戳載入
 *
 * 兩個免面板入口：
 *   1. 右鍵選單：選取 ≥2 張圖片／連結卡 → 右鍵（或「⋯」）→「同高貼齊」→ 直接執行
 *   2. 工具列圖示：選取 ≥2 張圖片／連結卡時點圖示 → 直接執行；選取不足才開面板
 * 兩者都固定間距 0；要調間距走面板（什麼都不選再點圖示）。
 *
 * 另外開幾個 window.sameHeight* 函式給「Add to My Miro」擴充功能注入呼叫（見下）。
 */

(async () => {
  // 共用核心（幾何邏輯）同樣加時間戳，避開 GitHub Pages 快取
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'align-core.js?cb=' + Date.now();
    s.onload = resolve;
    s.onerror = () => reject(new Error('align-core.js 載入失敗'));
    document.body.appendChild(s);
  });

  // 給「Add to My Miro」擴充功能用：它代貼連結後，Miro 原生預覽卡的大小 REST API 改不了，
  // 擴充功能會注入本 App 的 iframe 呼叫這裡，用 Web SDK 縮放到圖片高度並把左上角擺到 (left, top)。
  window.sameHeightPlaceItem = async (id, left, top, targetH) => {
    const sized = await resizeToHeight(await miro.board.getById(id), targetH);
    sized.x = left + sized.width / 2;
    sized.y = top + sized.height / 2;
    await sized.sync();
    return { type: sized.type, width: sized.width, height: sized.height };
  };

  // 試做（2026-10-24）：代貼的原生卡貼上後大小改不了，但貼的當下大小跟著板子縮放走。
  // 擴充功能會先讀現在的畫面、把縮放調到剛好讓卡片一貼就是圖片高度，貼完再把畫面調回來。
  window.sameHeightGetViewport = async () => ({
    viewport: await miro.board.viewport.get(),
    zoom: await miro.board.viewport.getZoom(),
  });
  window.sameHeightSetZoom = async (zoom) => {
    await miro.board.viewport.setZoom(zoom);
    return { zoom: await miro.board.viewport.getZoom() };
  };
  window.sameHeightSetViewport = async (viewport) => {
    await miro.board.viewport.set({ viewport, animationDurationInMs: 0 });
    return { ok: true };
  };

  async function runOnImages(images) {
    if (images.length < 2) {
      await miro.board.notifications.showError('同高貼齊：請先複選 2 張以上的圖片或連結卡。');
      return;
    }
    const r = await alignImagesSameHeight(images, 0);
    await miro.board.notifications.showInfo(
      '同高貼齊完成：' + r.count + ' 張已統一為 ' + Math.round(r.targetH) + 'px 高，共 ' + r.rows + ' 排。'
        + (r.unsized ? '（' + r.unsized + ' 張 Miro 不讓改大小，只排位置）' : '')
    );
  }

  function notifyError(e) {
    return miro.board.notifications.showError(
      '同高貼齊失敗：' + (e && e.message ? e.message : String(e))
    );
  }

  // ── 入口 1：右鍵選單（custom action，experimental API）────────────────
  await miro.board.ui.on('custom:same-height-align', async (payload) => {
    try {
      // 文件說 payload＝選取項陣列；部分版本包成 {items}，兩種都接
      const items = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      await runOnImages(items.filter(isAlignable));
    } catch (e) {
      await notifyError(e);
    }
  });

  // 註冊右鍵選單動作。icon 用官方文件示範過的 chat-two（自訂名單沒有公開清單，
  // 亂試會因同 event 重複註冊被擋）；欄位保持最小合法集合。
  // 失敗時直接彈紅色通知顯示原因（headless 看不到 console，V 才有得回報）。
  try {
    await miro.board.experimental.action.register({
      event: 'same-height-align',
      ui: {
        label: { en: '同高貼齊' },
        icon: 'chat-two',
        description: '圖片與連結卡固定 1024px 高、底端對齊，每排最多 8 張、由左到右貼齊換排',
      },
      scope: 'local',
      predicate: { type: { $in: ALIGN_TYPES } },
      contexts: { item: {} },
    });
  } catch (e) {
    await miro.board.notifications.showError(
      '同高貼齊：右鍵選單註冊失敗——' + (e && e.message ? e.message : String(e))
    );
  }

  // ── 入口 2：工具列圖示一鍵直跑 ──────────────────────────────────────
  miro.board.ui.on('icon:click', async () => {
    try {
      const selection = await miro.board.getSelection();
      const images = selection.filter(isAlignable);

      if (images.length < 2) {
        // 沒選夠＝當作要看說明/調間距，走原本的面板
        await miro.board.ui.openPanel({ url: 'panel.html?cb=' + Date.now() });
        return;
      }
      await runOnImages(images);
    } catch (e) {
      await notifyError(e);
    }
  });
})().catch((e) => console.error('同高貼齊 headless 初始化失敗', e));
