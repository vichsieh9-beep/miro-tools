/* 同高貼齊 — 共用核心邏輯
 *
 * index.html（一鍵直跑）與 panel.html（app.js）共用同一份，
 * 行為改這裡，兩邊同時生效。
 *
 * 行為（已與需求確認，2026-07-23；2026-10-24 擴及連結卡）：
 *   適用物件 = 圖片、連結預覽卡（preview）、嵌入卡（embed，含影片）
 *   目標高度 = 固定 1024px
 *   排列順序 = 依目前畫面位置（由左到右）
 *   分排規則 = 每排最多 8 張，第 9 張起自動換到下一排
 *   垂直對齊 = 每排內底端對齊
 *   水平／垂直間距 = 呼叫端傳入同一個 gap（面板可調；一鍵直跑固定 0）
 */

const ALIGN_TARGET_HEIGHT = 1024;
const ALIGN_ITEMS_PER_ROW = 8;
const ALIGN_TYPES = ['image', 'preview', 'embed'];

function isAlignable(item) {
  return ALIGN_TYPES.includes(item.type);
}

// 把單一物件等比例縮放到 targetH 高，回傳同步後的最新物件（寬高＝Miro 實際給的）。
// 各類物件能改的邊不同：圖片只能改寬或高其中一個、連結預覽卡官方文件寫只能改寬、
// 嵌入卡文件寫寬高唯讀。所以依序試「只改高 → 只改寬（換算）→ 兩邊都改」，
// 高度到位就停；全部不行就維持原尺寸（照樣參與排列，只是不同高）。
async function resizeToHeight(item, targetH) {
  if (Math.abs(item.height - targetH) < 1) return item;
  const ratio = item.width / item.height;
  const attempts = [
    (it) => { it.height = targetH; },
    (it) => { it.width = targetH * ratio; },
    (it) => { it.width = targetH * ratio; it.height = targetH; },
  ];
  for (const apply of attempts) {
    // 每次都重抓：上一招失敗的物件可能帶著改到一半的值，拿它 sync 會把錯的尺寸寫回板上
    const fresh = await miro.board.getById(item.id);
    try {
      apply(fresh);
      await fresh.sync();
    } catch (e) {
      continue;
    }
    const after = await miro.board.getById(item.id);
    if (Math.abs(after.height - targetH) < 1) return after;
  }
  return miro.board.getById(item.id);
}

async function alignImagesSameHeight(selected, gap) {
  // 先擷取原始幾何（Miro 的 x/y 是物件中心點）
  const items = selected.map((item) => ({
    item,
    x: item.x,
    y: item.y,
    w: item.width,
    h: item.height,
  }));

  // 依畫面位置由左到右排序（用中心 x），再依此順序每 8 張切一排
  items.sort((a, b) => a.x - b.x);

  const targetH = ALIGN_TARGET_HEIGHT;

  // 錨點＝整體最左那張：它現在的左緣／底緣＝整個網格的起點
  const anchor = items[0];
  const startLeft = anchor.x - anchor.w / 2;
  let bottomY = anchor.y + anchor.h / 2;

  let rowCount = 0;
  let unsized = 0;
  for (let i = 0; i < items.length; i += ALIGN_ITEMS_PER_ROW) {
    // 整排先縮放，才知道這排實際多高（縮不動的物件可能比 1024 高，下一排要讓開）
    const row = [];
    for (const it of items.slice(i, i + ALIGN_ITEMS_PER_ROW)) {
      const sized = await resizeToHeight(it.item, targetH);
      if (Math.abs(sized.height - targetH) >= 1) unsized++;
      row.push(sized);
    }
    if (rowCount > 0) {
      bottomY += gap + Math.max(...row.map((s) => s.height));
    }

    let cursor = startLeft;
    for (const sized of row) {
      sized.x = cursor + sized.width / 2;
      sized.y = bottomY - sized.height / 2;   // 底端對齊
      await sized.sync();
      cursor += sized.width + gap;
    }
    rowCount++;
  }

  return { count: items.length, targetH, rows: rowCount, unsized };
}
