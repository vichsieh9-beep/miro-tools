/* 同高貼齊 — Miro Web SDK 面板邏輯
 *
 * 幾何邏輯在 align-core.js（與 index.html 一鍵直跑共用）；
 * 這裡只剩面板 UI：讀間距、跑核心、顯示狀態。
 */

const $btn = document.getElementById('run');
const $gap = document.getElementById('gap');
const $status = document.getElementById('status');

function setStatus(msg, kind) {
  if (!$status) return;
  $status.textContent = msg;
  $status.className = 'status' + (kind ? ' ' + kind : '');
}

// 任何未捕捉錯誤都顯示在面板上，方便日後排查
window.addEventListener('error', (e) => setStatus('發生錯誤：' + e.message, 'err'));
window.addEventListener('unhandledrejection', (e) =>
  setStatus('發生錯誤：' + (e.reason && e.reason.message ? e.reason.message : e.reason), 'err'));

async function run() {
  setStatus('處理中…');
  $btn.disabled = true;

  try {
    if (typeof miro === 'undefined' || !miro.board) {
      setStatus('找不到 Miro，請重新打開面板再試。', 'err');
      return;
    }

    const gap = Math.max(0, Number($gap.value) || 0);

    const selection = await miro.board.getSelection();
    const images = selection.filter(isAlignable);

    if (images.length < 2) {
      setStatus('請先複選 2 張以上的圖片或連結卡。', 'err');
      return;
    }

    const r = await alignImagesSameHeight(images, gap);

    setStatus('完成：' + r.count + ' 張已統一為 ' + Math.round(r.targetH) + 'px 高並貼齊，共 ' + r.rows + ' 排。'
      + (r.unsized ? '（' + r.unsized + ' 張 Miro 不讓改大小，只排位置）' : ''), 'ok');
  } catch (e) {
    setStatus('執行失敗：' + (e && e.message ? e.message : String(e)), 'err');
  } finally {
    $btn.disabled = false;
  }
}

if ($btn) {
  $btn.addEventListener('click', run);
} else {
  setStatus('找不到按鈕元素（id=run）', 'err');
}
