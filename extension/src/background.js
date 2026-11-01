importScripts("boards.js", "links.js");

// Kept from the image-only versions so the menu id stays stable across upgrades.
const MENU_ADD = "add-image-to-my-miro";
const MENU_ADD_TAB = "add-tab-to-my-miro";
const MENU_OPEN_OPTIONS = "open-add-to-my-miro-options";
const MENU_SWITCH_BOARD = "switch-board";
const MENU_BOARD_PREFIX = "board:";

// The 同高貼齊 Miro app (../align-app) loads in a frame of every board tab where it is
// installed, and exposes window.sameHeightPlaceItem for resizing through the Web SDK.
const ALIGN_APP_URL = "https://vichsieh9-beep.github.io/miro-tools/";

const DEFAULT_SETTINGS = {
  accessToken: "",
  startX: 0,
  startY: 0,
  columns: 10,
  gap: 40,
  imageHeight: 1024
};

chrome.runtime.onInstalled.addListener(() => {
  rebuildMenus();
  fillMissingBoardNames();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildMenus();
});

// Every image add rewrites `boards` (the cursor lives there), so only rebuild when
// something the menus actually show has changed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.boards || changes.activeBoardId)) {
    rebuildMenus();
  }
});

let menuQueue = Promise.resolve();
let menuSignature = "";

// Builds are chained: two overlapping removeAll()/create() passes would collide on ids.
function rebuildMenus() {
  menuQueue = menuQueue.then(buildMenus, buildMenus);
  return menuQueue;
}

async function buildMenus() {
  const { boards, activeBoardId } = await readBoardState();
  const signature = JSON.stringify([activeBoardId, boards.map((board) => [board.id, board.name])]);
  if (signature === menuSignature) {
    return;
  }
  menuSignature = signature;

  const active = boards.find((board) => board.id === activeBoardId);

  // The page menu keeps a single item on purpose: a second one would make Chrome fold
  // both into an "Add to My Miro ▸" submenu and cost an extra click on every add. So images,
  // links, videos and the page itself all share this one item, and the click handler decides
  // what was meant. (An image inside a link would otherwise show two items and fold.)
  // Switching lives on the toolbar icon's right-click menu instead.
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  await createMenu({
    id: MENU_ADD,
    title: active ? `📌 加到我的 Miro（${boardLabel(active)}）` : "📌 加到我的 Miro（尚未設定板子）",
    contexts: ["image", "link", "video", "page"]
  });
  await createMenu({ id: MENU_ADD_TAB, title: "📌 把這一頁加到 Miro", contexts: ["action"] });
  await createMenu({ id: MENU_SWITCH_BOARD, title: "切換板子", contexts: ["action"] });

  if (!boards.length) {
    await createMenu({
      id: `${MENU_BOARD_PREFIX}none`,
      parentId: MENU_SWITCH_BOARD,
      title: "（清單是空的，請到設定頁新增）",
      enabled: false,
      contexts: ["action"]
    });
  }

  for (const board of boards) {
    await createMenu({
      id: `${MENU_BOARD_PREFIX}${board.id}`,
      parentId: MENU_SWITCH_BOARD,
      title: boardLabel(board),
      type: "radio",
      checked: board.id === activeBoardId,
      contexts: ["action"]
    });
  }

  await createMenu({ id: MENU_OPEN_OPTIONS, title: "設定 Add to My Miro", contexts: ["action"] });
}

function createMenu(properties) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) {
        console.warn("contextMenus.create failed", properties.id, chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

// Boards carried over from 0.4.x have no name yet; ask Miro once the token is available.
async function fillMissingBoardNames() {
  const { accessToken } = await chrome.storage.local.get({ accessToken: "" });
  if (!accessToken) {
    return { ok: true };
  }

  const { boards } = await readBoardState();
  for (const board of boards.filter((item) => !item.name)) {
    const result = await lookupBoard({ boardId: board.id });
    if (result.ok && result.name) {
      await updateBoard(board.id, { name: result.name });
    }
  }

  return { ok: true };
}

async function lookupBoard({ boardId }) {
  const { accessToken } = await chrome.storage.local.get({ accessToken: "" });
  if (!accessToken) {
    return { ok: false, message: "請先填 Access Token 並儲存，才能檢查板子。" };
  }

  const settings = { accessToken, boardId };
  const response = await miroGet(`https://api.miro.com/v2/boards/${encodeBoardId(boardId)}`, settings);
  if (response.status === 200) {
    return { ok: true, name: response.body?.name || "" };
  }

  return {
    ok: false,
    message: response.status === 0
      ? `連不到 Miro：${response.body}`
      : `${describeMiroStatus(response.status, settings)}（Miro API ${response.status}）`
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Null prototype: a message of {type:"constructor"} must not resolve to Object.prototype.constructor.
  const handlers = Object.assign(Object.create(null), {
    VALIDATE_SETTINGS: validateCurrentSettings,
    RUN_DIAGNOSTICS: runDiagnostics,
    TEST_UPLOAD: runUploadTest,
    TEST_LINKS: runLinkTest,
    TEST_GIF: runGifTest,
    DELETE_TEST_LINKS: deleteLinkTestItems,
    LOOKUP_BOARD: lookupBoard,
    FILL_BOARD_NAMES: fillMissingBoardNames
  });

  const handler = typeof message?.type === "string" ? handlers[message.type] : null;
  if (typeof handler !== "function") {
    return;
  }

  handler(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, message: messageText });
    });

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (String(info.menuItemId).startsWith(MENU_BOARD_PREFIX)) {
    const boardId = String(info.menuItemId).slice(MENU_BOARD_PREFIX.length);
    const { boards } = await readBoardState();
    if (boards.some((board) => board.id === boardId)) {
      await chrome.storage.local.set({ activeBoardId: boardId });
    }
    return;
  }

  if (info.menuItemId === MENU_ADD_TAB) {
    await addLinkFromMenu({ url: tab?.url, tab, pageUrl: tab?.url });
    return;
  }

  if (info.menuItemId !== MENU_ADD) {
    return;
  }

  // One menu item covers every context, so pick what was meant:
  //   a link to a video wins even over its thumbnail image (YouTube lists, search results);
  //   otherwise an image is added as an image, as before;
  //   otherwise the link; otherwise the page itself (also for an HTML5 <video>).
  const linkUrl = info.linkUrl || "";
  if (linkUrl && videoInfo(linkUrl)) {
    await addLinkFromMenu({ url: linkUrl, tab, pageUrl: info.pageUrl });
  } else if (info.mediaType === "image") {
    await addImageFromMenu(info, tab);
  } else {
    await addLinkFromMenu({ url: linkUrl || info.pageUrl || tab?.url, tab, pageUrl: info.pageUrl });
  }
});

async function addImageFromMenu(info, tab) {
  let candidates = [];

  try {
    const settings = await getSettings();
    validateSettings(settings);

    const image = await getImageCandidate(info, tab);
    const width = expectedWidth(settings, image);
    const position = getNextPosition(settings, width);

    candidates = (image.urls?.length ? image.urls : [image.url]).filter(Boolean);
    if (!candidates.length) {
      throw new Error("抓不到這張圖的 URL。");
    }

    const created = await sendImageToMiro({ settings, candidates, title: image.title, position, tabId: tab?.id });

    await advanceCursor(settings, position, toNumber(created?.geometry?.width, width));

    notify(`已加到 Miro（${settings.boardName}）`, `位置：x ${position.x}, y ${position.y}`);
    await rememberResult({ ok: true, message: `已加到 Miro（${settings.boardName}）：x ${position.x}, y ${position.y}` });
    await setBadge("OK", "#236b42");
    console.info("Created Miro image item", created);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const report = [
      "右鍵加圖：失敗 ❌",
      "",
      `頁面：${info.pageUrl || "(未知)"}`,
      "",
      candidates.length
        ? `這張 <img> 上找到的圖片網址（依序嘗試）：\n${candidates.map((url, i) => `  ${i + 1}. ${url}`).join("\n")}`
        : `右鍵選單給的網址：${info.srcUrl || "(沒有)"}\n（連候選網址都沒取得，代表 content script 沒抓到這個元素）`,
      "",
      "── 失敗原因 ──",
      message,
      "",
      "網址開頭是 blob: 代表圖片只存在於該頁面記憶體中，只有頁面本身讀得到；",
      "開頭是 https: 但每一步都失敗，通常是來源網站擋下載。"
    ].join("\n");

    notify("Add to My Miro 失敗", message);
    await rememberResult({ ok: false, message, report });
    await setBadge("ERR", "#a33221");
    console.error(error);

    // Notifications are easy to miss (and macOS may suppress them), so surface the
    // full report where it cannot be overlooked.
    chrome.runtime.openOptionsPage();
  }
}

async function addLinkFromMenu({ url, tab, pageUrl }) {
  try {
    const settings = await getSettings();
    validateSettings(settings);

    const { items, kind, failures } = await sendLinkToMiro({ settings, url, tab, pageUrl });

    notify(`已加到 Miro（${settings.boardName}）`, `${kind}：${shortenUrl(url)}`);
    await rememberResult({
      ok: true,
      message: [`已加到 Miro（${settings.boardName}）：${kind} ${url}`, ...failures.map((failure) => `備註：${failure}`)].join("\n")
    });
    await setBadge("OK", "#236b42");
    console.info("Created Miro link items", items);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = [
      "右鍵加網址：失敗 ❌",
      "",
      `網址：${url || "(沒有)"}`,
      `頁面：${pageUrl || "(未知)"}`,
      "",
      "── 失敗原因 ──",
      message
    ].join("\n");

    notify("Add to My Miro 失敗", message);
    await rememberResult({ ok: false, message, report });
    await setBadge("ERR", "#a33221");
    console.error(error);
    chrome.runtime.openOptionsPage();
  }
}

// Flattens the active board into the old single-board shape (boardId, cursorX, ...) so the
// upload, diagnostics and test paths read settings the same way they always have.
async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const { boards, activeBoardId } = await readBoardState();
  const board = boards.find((item) => item.id === activeBoardId);
  const startX = toNumber(stored.startX, DEFAULT_SETTINGS.startX);
  const startY = toNumber(stored.startY, DEFAULT_SETTINGS.startY);

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    startX,
    startY,
    columns: Math.max(1, toNumber(stored.columns, DEFAULT_SETTINGS.columns)),
    gap: Math.max(0, toNumber(stored.gap, DEFAULT_SETTINGS.gap)),
    imageHeight: Math.max(20, toNumber(stored.imageHeight, DEFAULT_SETTINGS.imageHeight)),
    boardId: board?.id || "",
    boardName: boardLabel(board),
    cursorX: board?.cursorX == null ? startX : toNumber(board.cursorX, startX),
    cursorY: board?.cursorY == null ? startY : toNumber(board.cursorY, startY),
    rowCount: Math.max(0, toNumber(board?.rowCount, 0))
  };
}

function validateSettings(settings) {
  if (!settings.accessToken) {
    throw new Error("還沒有設定 Miro Access Token。請點 Extension 圖示開設定頁。");
  }

  if (!settings.boardId) {
    throw new Error("還沒有選擇 Miro 板子。請點 Extension 圖示開設定頁，新增板子。");
  }
}

async function getImageCandidate(info, tab) {
  const fallback = {
    url: info.srcUrl,
    title: info.pageUrl || "Web image"
  };

  if (!tab?.id) {
    return fallback;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_LAST_IMAGE_CANDIDATE",
      fallback
    });

    if (response?.url) {
      return response;
    }
  } catch (error) {
    console.warn("Content script image lookup failed; using context menu srcUrl.", error);
  }

  if (!fallback.url) {
    throw new Error("抓不到這張圖的 URL。");
  }

  return fallback;
}

// Every item is scaled to imageHeight, so its width is decided purely by aspect ratio.
// Falls back to a square when the source dimensions are unknown.
function expectedWidth(settings, image) {
  const width = toNumber(image?.naturalWidth, 0);
  const height = toNumber(image?.naturalHeight, 0);

  return width > 0 && height > 0
    ? settings.imageHeight * (width / height)
    : settings.imageHeight;
}

// position is a centre point, but the cursor tracks the left edge of the next slot.
function getNextPosition(settings, width) {
  return {
    x: settings.cursorX + width / 2,
    y: settings.cursorY + settings.imageHeight / 2,
    origin: "center"
  };
}

// Advance off the item's real right edge, so an inaccurate width estimate cannot
// accumulate into creeping overlap further along the row.
async function advanceCursor(settings, position, actualWidth) {
  const filled = settings.rowCount + 1;

  if (filled >= settings.columns) {
    await updateBoard(settings.boardId, {
      cursorX: settings.startX,
      cursorY: settings.cursorY + settings.imageHeight + settings.gap,
      rowCount: 0
    });
    return;
  }

  await updateBoard(settings.boardId, {
    cursorX: position.x + actualWidth / 2 + settings.gap,
    cursorY: settings.cursorY,
    rowCount: filled
  });
}

// geometry defaults to the row height; images keep their ratio, so only one side is given.
async function createMiroImage({ settings, imageUrl, title, position, geometry }) {
  const response = await fetch(`https://api.miro.com/v2/boards/${encodeBoardId(settings.boardId)}/images`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${settings.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        url: imageUrl,
        title: title || "Web image"
      },
      position,
      geometry: geometry || { height: settings.imageHeight }
    })
  });

  if (!response.ok) {
    throw await miroError(response, settings);
  }

  return response.json();
}

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MIN_REAL_GIF_BYTES = 200;

async function uploadMiroImage({ settings, blob, title, position, geometry }) {
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`圖片 ${(blob.size / 1024 / 1024).toFixed(1)} MB 超過 Miro 上傳上限 6 MB。`);
  }

  const metadata = {
    title: title || "Web image",
    position,
    geometry: geometry || { height: settings.imageHeight }
  };

  // Built by hand rather than with FormData: appending a Blob always stamps a filename on
  // the part, and Miro then binds "data" as an uploaded file and 500s ("Failed to convert
  // 'data' ... MultipartFile[filename=blob]"). The "data" part must carry a Content-Type of
  // application/json and NO filename, matching Miro's documented curl form.
  const boundary = `----AddToMyMiro${crypto.randomUUID().replaceAll("-", "")}`;
  const encoder = new TextEncoder();
  const body = new Blob([
    encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="resource"; filename="${imageFileName(blob.type)}"\r\n` +
      `Content-Type: ${blob.type || "image/png"}\r\n\r\n`
    ),
    blob,
    encoder.encode(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}--\r\n`
    )
  ]);

  const response = await fetch(`https://api.miro.com/v2/boards/${encodeBoardId(settings.boardId)}/images`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${settings.accessToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) {
    throw await miroError(response, settings);
  }

  return response.json();
}

function imageFileName(mimeType) {
  const extension = String(mimeType || "").split("/")[1]?.split("+")[0] || "png";
  return `web-image.${extension.slice(0, 5)}`;
}

async function miroError(response, settings) {
  const text = (await response.text().catch(() => "")).trim();
  const error = new Error(`${describeMiroStatus(response.status, settings)}（Miro API ${response.status}）${text ? `\n${text}` : ""}`);
  error.status = response.status;
  return error;
}

function describeMiroStatus(status, settings, { includeHint = true } = {}) {
  const boardId = settings?.boardId || "(未設定)";

  switch (status) {
    case 401:
      return "Access Token 無效或已過期，請到 Miro 開發者後台重新產生後貼回設定頁。";
    case 403:
      return `Token 本身有效，但這顆 Miro App 沒有板子 ${boardId} 的存取權。通常是 App 裝在別的 team、板子搬到別的 team，或板子沒分享給裝 App 的帳號。${includeHint ? "按設定頁的「診斷」看 Token 實際掛在哪個 team。" : ""}`.trim();
    case 404:
      return `Miro 找不到板子 ${boardId}，請確認 Board URL 是否正確或板子已被刪除。`;
    case 413:
      return "圖片太大，Miro 拒絕接收。";
    case 429:
      return "Miro API 觸發流量限制，等一下再試。";
    default:
      return "Miro API 回傳錯誤。";
  }
}

function isAccessError(error) {
  return [401, 403, 404, 429].includes(error?.status);
}

async function validateCurrentSettings() {
  const settings = await getSettings();
  validateSettings(settings);

  const response = await fetch(`https://api.miro.com/v2/boards/${encodeBoardId(settings.boardId)}`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${settings.accessToken}`
    }
  });

  if (!response.ok) {
    throw await miroError(response, settings);
  }

  const board = await response.json();
  const message = `設定可讀取：${board.name || settings.boardName}`;
  await rememberResult({ ok: true, message });
  await setBadge("OK", "#236b42");
  return { ok: true, message };
}

// Three ways in, cheapest first: let Miro pull the URL, else download it here, else ask
// the page to read it. Every candidate URL gets tried before giving up.
async function sendImageToMiro({ settings, candidates, title, position, geometry, tabId }) {
  const failures = [];

  const remoteUrl = candidates.find((url) => /^https?:/i.test(url));
  if (remoteUrl) {
    try {
      return await createMiroImage({ settings, imageUrl: remoteUrl, title, position, geometry });
    } catch (error) {
      if (isAccessError(error)) {
        throw error;
      }
      failures.push(`Miro 直接抓 ${shortenUrl(remoteUrl)}：${error.message}`);
    }
  }

  for (const url of candidates) {
    let blob;
    try {
      blob = await downloadImage(url, tabId);
    } catch (error) {
      failures.push(`下載 ${shortenUrl(url)}：${error.message}`);
      continue;
    }

    const format = await imageFormat(blob);
    if (format === "gif") {
      const created = await sendGifToMiro({ settings, blob, url, position, geometry, failures });
      if (created) {
        return created;
      }
      continue;
    }

    try {
      const upload = format === "webp" ? await webpToPng(blob) : blob;
      return await uploadMiroImage({ settings, blob: upload, title, position, geometry });
    } catch (error) {
      if (isAccessError(error)) {
        throw error;
      }
      failures.push(`上傳 ${shortenUrl(url)}：${error.message}`);
    }
  }

  throw new Error(`這張圖送不進 Miro。試過的方式：\n${failures.map((line, i) => `${i + 1}. ${line}`).join("\n")}`);
}

// Goes by the file's first bytes: servers often label images with a generic type.
async function imageFormat(blob) {
  const head = String.fromCharCode(...new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (head.startsWith("GIF8")) {
    return "gif";
  }
  return head.startsWith("RIFF") && head.slice(8) === "WEBP" ? "webp" : "";
}

// Miro's upload takes only jpeg, png and svg. PNG keeps transparency and every pixel;
// an animated WebP comes out as its first frame.
async function webpToPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return await canvas.convertToBlob({ type: "image/png" });
}

// Miro's upload and data URLs both refuse GIF, and redrawing one would flatten it, so a GIF
// Miro could not pull by URL goes over untouched as a file pasted into the board's open Miro
// tab. Returns null, with the reason in `failures`, when that did not work — a GIF is never
// quietly turned into a still image.
async function sendGifToMiro({ settings, blob, url, position, geometry, failures }) {
  // Pages use tiny transparent GIFs as lazy-load placeholders; those are not the picture.
  if (blob.size < MIN_REAL_GIF_BYTES) {
    failures.push(`略過 ${shortenUrl(url)}：只是網頁的占位小圖。`);
    return null;
  }

  return await pasteGifIntoMiro({ settings, blob, position, geometry, failures });
}

// Same idea as pasteIntoMiro, with the file instead of a URL. Returns null — with the reason
// in `failures` — unless Miro took the paste; after that it throws rather than trying again,
// because another attempt would leave two copies on the board.
async function pasteGifIntoMiro({ settings, blob, position, geometry, failures }) {
  const tab = await findBoardTab(settings.boardId);
  if (!tab) {
    failures.push("GIF 代貼：這塊板子目前沒有在任何分頁開著。");
    return null;
  }

  const before = new Set((await listItems(settings, "image")).map((item) => item.id));

  let outcome;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pasteFileInPage,
      args: [await blobToBase64(blob), "image/gif", "web-image.gif"]
    });
    outcome = injection?.result;
  } catch (error) {
    failures.push(`GIF 代貼：進不了 Miro 分頁（${error.message}）。`);
    return null;
  }

  if (outcome === "typing") {
    failures.push("GIF 代貼：Miro 分頁裡正在編輯文字，沒有貼上。");
    return null;
  }
  if (outcome !== "taken") {
    failures.push("GIF 代貼：Miro 沒有接受這次貼上。");
    return null;
  }

  const pasted = await waitForNewImage(settings, before);
  if (!pasted) {
    throw new Error("GIF 已在 Miro 分頁貼上，但 20 秒內在板上找不到它，沒辦法排到位置。請到板上看看落在哪裡，手動拖過去。");
  }

  try {
    return await miroSend("PATCH", `${boardApi(settings)}/images/${pasted.id}`, settings, {
      position,
      geometry: geometry || { height: settings.imageHeight }
    });
  } catch (error) {
    throw new Error(`GIF 已貼到板上，但搬不到排版位置：${error.message}`);
  }
}

// Runs inside the Miro page (serialized by executeScript, so it must be self-contained).
function pasteFileInPage(base64, type, name) {
  const active = document.activeElement;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName))) {
    return "typing";
  }
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], name, { type }));
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  (active || document.body).dispatchEvent(event);
  return event.defaultPrevented ? "taken" : "ignored";
}

// Miro uploads a pasted file asynchronously; look for an image that was not there before.
async function waitForNewImage(settings, before) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    let items;
    try {
      items = await listItems(settings, "image");
    } catch (error) {
      continue;
    }
    const fresh = items.filter((item) => !before.has(item.id));
    if (fresh.length) {
      return fresh[fresh.length - 1];
    }
  }
  return null;
}

// Adds a right-clicked link at the layout cursor, then moves the cursor past it.
async function sendLinkToMiro({ settings, url, tab, pageUrl }) {
  const onThisPage = Boolean(tab?.id) && sameDocument(url, pageUrl || tab?.url);
  const result = await createLinkItem({
    settings,
    url,
    metaTabId: onThisPage ? tab.id : null,
    left: settings.cursorX,
    top: settings.cursorY
  });
  await advanceCursor(settings, { x: settings.cursorX + result.width / 2 }, result.width);
  return result;
}

// A video becomes Miro's own player embed, exactly like pasting the link by hand.
// Any other page should look like pasting it by hand too — Miro's own link preview card
// (title, description, picture), which is really an embed Miro fills in itself, something
// the REST API cannot do. So the URL is pasted into the board's open Miro tab and the card
// Miro makes is then moved into the row. If the board is not open, or Miro does not take the
// paste, fall back to an embed with the page's share image as its preview, or — with no
// share image — a text card with the title and a clickable link. Always a single item.
// Places the item with its top-left at (left, top) and leaves the cursor alone.
async function createLinkItem({ settings, url, metaTabId, left, top }) {
  const video = videoInfo(url);
  const target = video ? video.url : String(url || "");
  if (!isWebUrl(target)) {
    throw new Error(`這不是網頁網址，加不進 Miro：${url || "(沒有)"}`);
  }

  const failures = [];

  if (video) {
    try {
      const { created, width } = await createEmbed({ settings, data: { url: target, mode: "inline" }, ratio: video.ratio, left, top });
      return { kind: `${video.provider} 影片`, target, width, items: [{ endpoint: "embeds", id: created?.id, label: `${video.provider} 影片` }], detail: created?.data || {}, failures };
    } catch (error) {
      if (isAccessError(error)) {
        throw error;
      }
      failures.push(`影片嵌入：${error.message.split("\n")[0]}，改成文字卡片。`);
      const card = await createTextCard({ settings, url: target, meta: { title: `${video.provider} 影片` }, left, top });
      return { kind: `${video.provider} 影片（文字卡片）`, target, width: card.width, items: [{ endpoint: "shapes", id: card.created?.id, label: "文字卡片" }], detail: {}, failures };
    }
  }

  const pasted = await pasteIntoMiro({ settings, url: target, left, top, failures });
  if (pasted) {
    const sized = Math.abs(pasted.height - settings.imageHeight) < 1;
    return { kind: sized ? "網頁（Miro 原生預覽卡）" : "網頁（Miro 原生預覽卡，大小沒改成）", target, width: pasted.width, height: pasted.height, items: [{ endpoint: "embeds", id: pasted.created.id, label: "網頁" }], detail: pasted.created.data || {}, failures };
  }

  const meta = await getPageMeta(target, metaTabId);
  if (meta.image) {
    const ratio = meta.imageWidth > 0 && meta.imageHeight > 0 ? meta.imageWidth / meta.imageHeight : 16 / 9;
    try {
      const { created, width } = await createEmbed({ settings, data: { url: target, mode: "modal", previewUrl: meta.image }, ratio, left, top });
      return { kind: "網頁（嵌入卡＋預覽圖）", target, width, items: [{ endpoint: "embeds", id: created?.id, label: "網頁" }], detail: { ...(created?.data || {}), title: meta.title || "" }, failures };
    } catch (error) {
      if (isAccessError(error)) {
        throw error;
      }
      failures.push(`嵌入卡：${error.message.split("\n")[0]}，改成文字卡片。`);
    }
  } else {
    failures.push("這一頁沒有分享圖（og:image），用文字卡片（標題＋可點的網址）。");
  }

  const card = await createTextCard({ settings, url: target, meta, left, top });
  return { kind: "網頁（文字卡片）", target, width: card.width, items: [{ endpoint: "shapes", id: card.created?.id, label: "文字卡片" }], detail: { title: meta.title || "" }, failures };
}

async function createEmbed({ settings, data, ratio, left, top }) {
  const guessedWidth = settings.imageHeight * ratio;
  const created = await miroSend("POST", `${boardApi(settings)}/embeds`, settings, {
    data,
    position: { x: left + guessedWidth / 2, y: top + settings.imageHeight / 2, origin: "center" },
    // Embeds keep their own aspect ratio, so only one dimension may be given.
    geometry: { height: settings.imageHeight }
  });
  const width = await settleWidth(settings, "embeds", created, left, top + settings.imageHeight / 2, guessedWidth);
  return { created, width };
}

// Pastes the URL into the board's open Miro tab, finds the card Miro made, and moves it into
// the row. Returns null — with the reason in `failures` — whenever another way should be
// tried instead. Throws only when Miro took the paste but the card cannot be found, because
// then trying another way would leave two cards on the board.
async function pasteIntoMiro({ settings, url, left, top, failures }) {
  const tab = await findBoardTab(settings.boardId);
  if (!tab) {
    failures.push("代貼：這塊板子目前沒有在任何分頁開著，改用嵌入卡。（開著 Miro 板子就會是原生預覽卡）");
    return null;
  }

  let before;
  try {
    before = await listEmbedIds(settings);
  } catch (error) {
    if (isAccessError(error)) {
      throw error;
    }
    failures.push(`代貼：讀不到板上現有卡片（${error.message.split("\n")[0]}），改用嵌入卡。`);
    return null;
  }

  let outcome;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pasteUrlInPage,
      args: [url]
    });
    outcome = injection?.result;
  } catch (error) {
    failures.push(`代貼：進不了 Miro 分頁（${error.message}），改用嵌入卡。`);
    return null;
  }

  if (outcome === "typing") {
    failures.push("代貼：Miro 分頁裡正在編輯文字，為了不把網址貼進你的文字，改用嵌入卡。");
    return null;
  }
  if (outcome !== "taken") {
    failures.push("代貼：Miro 沒有接受這次貼上，改用嵌入卡。");
    return null;
  }

  const pastedAt = Date.now();
  const created = await waitForNewEmbed(settings, before, url) || await findRecentItem(settings, pastedAt, url);
  if (!created) {
    throw new Error("已在 Miro 分頁貼上網址，但 10 秒內在板上找不到新卡片，沒辦法排到位置。請到板上看看卡片落在哪裡，手動拖過去。");
  }

  return { created, ...await placePastedCard(settings, created, left, top, tab.id, failures) };
}

// Runs inside the Miro page (serialized by executeScript, so it must be self-contained).
// A synthetic paste carrying the URL as text is what Miro turns into its link preview card.
function pasteUrlInPage(url) {
  const active = document.activeElement;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName))) {
    return "typing";
  }
  const data = new DataTransfer();
  data.setData("text/plain", url);
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  (active || document.body).dispatchEvent(event);
  return event.defaultPrevented ? "taken" : "ignored";
}

async function findBoardTab(boardId) {
  const tabs = await chrome.tabs.query({ url: "https://miro.com/app/board/*" });
  const matching = tabs.filter((tab) => extractBoardId(tab.url || "") === boardId);
  // Prefer the tab the user last looked at.
  return matching.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

async function listEmbeds(settings) {
  return await listItems(settings, "embed");
}

async function listItems(settings, type = "") {
  const items = [];
  let cursor = "";
  do {
    const query = `limit=50${type ? `&type=${type}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetch(`${boardApi(settings)}/items?${query}`, {
      headers: { "Accept": "application/json", "Authorization": `Bearer ${settings.accessToken}` }
    });
    if (!response.ok) {
      throw await miroError(response, settings);
    }
    const page = await response.json();
    items.push(...(page.data || []));
    cursor = page.cursor || "";
  } while (cursor);
  return items;
}

async function listEmbedIds(settings) {
  return new Set((await listEmbeds(settings)).map((item) => item.id));
}

// Miro creates the card asynchronously; look for an embed that was not there before,
// preferring one whose URL is the one pasted.
async function waitForNewEmbed(settings, before, url) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    let items;
    try {
      items = await listEmbeds(settings);
    } catch (error) {
      continue;
    }
    const fresh = items.filter((item) => !before.has(item.id));
    if (fresh.length) {
      return fresh.find((item) => sameDocument(item.data?.url || "", url)) || fresh[fresh.length - 1];
    }
  }
  return null;
}

// In case Miro's card does not show up as an embed through the API: one pass over every
// item, taking what was created in the last minute (the one carrying the URL, if any).
async function findRecentItem(settings, pastedAt, url) {
  try {
    const recent = (await listItems(settings))
      .filter((item) => Date.parse(item.createdAt || "") >= pastedAt - 60000 && item.type !== "image" && item.type !== "shape")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return recent.find((item) => sameDocument(item.data?.url || "", url)) || recent[recent.length - 1] || null;
  } catch (error) {
    return null;
  }
}

// Moves the pasted card so its top-left sits at (left, top), scaled to the row height.
// Tried in turn: the 同高貼齊 app's Web SDK (when that app is loaded on the board), then the
// REST API with the height, then with the width. Miro reports these cards as embeds, whose
// size the Web SDK treats as read-only, so the REST attempts are what usually matters. If
// nothing takes, the card keeps Miro's size and the reasons go into `failures`.
// Returns the size the card ended up with.
async function placePastedCard(settings, created, left, top, tabId, failures) {
  const target = settings.imageHeight;
  const placed = await placeViaAlignApp(tabId, created.id, left, top, target);
  if (placed && Math.abs(placed.height - target) < 1) {
    return { width: placed.width, height: placed.height };
  }

  // The listing may leave out the height, so read the card's size fresh before scaling.
  const fresh = await miroGet(`${boardApi(settings)}/items/${created.id}`, settings);
  const geometry = (fresh.status === 200 && fresh.body?.geometry) || created.geometry || {};
  const width = toNumber(placed?.width, toNumber(geometry.width, target));
  const height = toNumber(placed?.height, toNumber(geometry.height, target));
  const scaledWidth = width * (target / height);
  const reasons = [placed ? "同高貼齊 App：Miro 不讓改大小" : "同高貼齊 App：這塊板子上沒載入"];

  for (const [label, size] of [["REST 改高", { height: target }], ["REST 改寬", { width: scaledWidth }]]) {
    try {
      const moved = await miroSend("PATCH", `${boardApi(settings)}/embeds/${created.id}`, settings, {
        position: { x: left + scaledWidth / 2, y: top + target / 2, origin: "center" },
        geometry: size
      });
      const movedHeight = toNumber(moved?.geometry?.height, target);
      if (Math.abs(movedHeight - target) < 1) {
        return { width: toNumber(moved?.geometry?.width, scaledWidth), height: movedHeight };
      }
      reasons.push(`${label}：Miro 回應成功但高度是 ${Math.round(movedHeight)}`);
    } catch (error) {
      if (isAccessError(error)) {
        throw error;
      }
      // Keep Miro's own explanation (the body after the first line) — it says which field it refused.
      reasons.push(`${label}：${error.message.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  }

  failures.push(`大小沒改成（卡片類型 ${created.type || "未知"}，維持 ${Math.round(width)}×${Math.round(height)}）：${reasons.join("；")}`);
  await miroSend("PATCH", `${boardApi(settings)}/items/${created.id}`, settings, {
    position: { x: left + width / 2, y: top + height / 2, origin: "center" }
  });
  return { width, height };
}

async function placeViaAlignApp(tabId, itemId, left, top, height) {
  const result = await callAlignApp(tabId, "sameHeightPlaceItem", [itemId, left, top, height]);
  return toNumber(result?.width, 0) > 0 ? result : null;
}

// Calls a function the 同高貼齊 app exposes on its window. Null when that app is not loaded
// in the tab (or is an older version without the function); {error} when the call threw.
async function callAlignApp(tabId, name, args) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frameIds = (frames || []).filter((frame) => (frame.url || "").startsWith(ALIGN_APP_URL)).map((frame) => frame.frameId);
    if (!frameIds.length) {
      return null;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      world: "MAIN",
      func: callInAlignApp,
      args: [name, args]
    });
    return results.map((entry) => entry?.result).find(Boolean) || null;
  } catch (error) {
    console.warn(`同高貼齊 app call ${name} failed.`, error);
    return null;
  }
}

// Runs inside the 同高貼齊 app's frame (serialized by executeScript, so it must be self-contained).
function callInAlignApp(name, args) {
  if (typeof window[name] !== "function") {
    return null;
  }
  return Promise.resolve(window[name](...args)).catch((error) => ({ error: String(error?.message || error) }));
}

async function createTextCard({ settings, url, meta, left, top }) {
  const card = textCardLayout(settings.imageHeight, {
    title: meta.title,
    description: meta.description,
    host: hostLabel(url)
  });
  const content = [
    `<p><strong>${escapeHtml(card.title)}</strong></p>`,
    card.description ? `<p>${escapeHtml(card.description)}</p>` : "",
    `<p><a href="${escapeHtml(url)}">${escapeHtml(card.host)}</a></p>`
  ].join("");

  const created = await miroSend("POST", `${boardApi(settings)}/shapes`, settings, {
    data: { shape: "round_rectangle", content },
    style: {
      fillColor: "#ffffff",
      borderColor: "#d9dee3",
      borderWidth: "2",
      color: "#1b1f24",
      fontSize: String(card.fontSize),
      textAlign: "left",
      textAlignVertical: "middle"
    },
    position: { x: left + card.width / 2, y: top + card.height / 2, origin: "center" },
    geometry: { width: card.width, height: card.height }
  });
  return { created, width: toNumber(created?.geometry?.width, card.width) };
}

function boardApi(settings) {
  return `https://api.miro.com/v2/boards/${encodeBoardId(settings.boardId)}`;
}

function sameDocument(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = "";
    right.hash = "";
    return left.href === right.href;
  } catch (error) {
    return false;
  }
}

// The open page is read through the content script (it sees what the user sees, logged-in
// pages included); a linked page is fetched here. Either way a failure just means no preview.
async function getPageMeta(url, tabId) {
  if (tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_HEAD" });
      if (response?.html) {
        const meta = parsePageMeta(response.html, response.url || url);
        return { ...meta, title: meta.title || response.title || "" };
      }
    } catch (error) {
      console.warn("Content script page lookup failed; fetching instead.", error);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok || !/html/i.test(response.headers.get("content-type") || "")) {
      return {};
    }
    return parsePageMeta(await response.text(), response.url || url);
  } catch (error) {
    console.warn("Page metadata fetch failed", url, error);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

// The width was a guess because the real ratio is only known once Miro answers. If it was
// off, slide the item so its left edge still sits where it should.
async function settleWidth(settings, endpoint, created, left, centreY, guessedWidth) {
  const actualWidth = toNumber(created?.geometry?.width, guessedWidth);
  if (Math.abs(actualWidth - guessedWidth) > 1 && created?.id) {
    try {
      await miroSend("PATCH", `${boardApi(settings)}/${endpoint}/${created.id}`, settings, {
        position: { x: left + actualWidth / 2, y: centreY, origin: "center" }
      });
    } catch (error) {
      console.warn("Could not re-centre item", error);
    }
  }
  return actualWidth;
}

async function miroSend(method, url, settings, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${settings.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await miroError(response, settings);
  }

  return response.json();
}

async function downloadImage(url, tabId) {
  // blob: only resolves inside the page that minted it, so go straight there.
  if (url.startsWith("blob:")) {
    return await downloadImageViaPage(url, tabId);
  }

  try {
    return await fetchImageBlob(url);
  } catch (error) {
    if (!tabId) {
      throw error;
    }

    // The page carries cookies and referrer the service worker does not.
    return await downloadImageViaPage(url, tabId);
  }
}

async function downloadImageViaPage(url, tabId) {
  if (!tabId) {
    throw new Error("沒有可用的分頁，無法從頁面內讀取這張圖。");
  }

  const response = await chrome.tabs.sendMessage(tabId, { type: "READ_IMAGE_IN_PAGE", url });
  if (!response || response.error) {
    throw new Error(response?.error || "頁面內讀取沒有回應。");
  }

  return base64ToBlob(response.base64, response.type || "image/png");
}

function shortenUrl(url) {
  return url.length > 70 ? `${url.slice(0, 67)}...` : url;
}

async function fetchImageBlob(url) {
  const response = await fetch(url, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`圖片下載失敗 ${response.status}: ${response.statusText}`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("圖片下載到 0 bytes，來源網站可能擋了直接下載。");
  }

  return blob;
}

async function runDiagnostics() {
  const settings = await getSettings();
  const lines = [];

  if (!settings.accessToken) {
    return { ok: false, message: "還沒有設定 Access Token。", report: "還沒有設定 Access Token。" };
  }

  const token = await miroGet("https://api.miro.com/v1/oauth-token", settings);
  lines.push(`Token 檢查：HTTP ${token.status}`);

  if (token.status === 401) {
    const report = [
      ...lines,
      "",
      "判定：Access Token 已失效或被撤銷。",
      "處理：到 https://miro.com/app/settings/user-profile/apps 的 App 設定重新產生 token，貼回設定頁後儲存。"
    ].join("\n");
    await rememberResult({ ok: false, message: "診斷：Token 已失效。" });
    return { ok: false, message: "診斷：Token 已失效。", report };
  }

  if (token.body && typeof token.body === "object") {
    const teamName = token.body.team?.name || "(未回報)";
    const teamId = token.body.team?.id || "(未回報)";
    lines.push(`Token 掛在 team：${teamName}（id ${teamId}）`);
    lines.push(`Token 型別：${token.body.type || "(未回報)"}`);
    lines.push(`Scopes：${(token.body.scopes || []).join(", ") || "(未回報)"}`);
    lines.push(`使用者：${token.body.user?.name || "(未回報)"}`);
    lines.push(`到期：${token.body.expiresAt || "不過期"}`);

    const scopes = token.body.scopes || [];
    const missing = ["boards:read", "boards:write"].filter((scope) => !scopes.includes(scope));
    if (scopes.length && missing.length) {
      lines.push(`⚠️ 缺少 scope：${missing.join(", ")}`);
    }
  }

  if (!settings.boardId) {
    lines.push("", "還沒有選擇板子：請先在設定頁新增板子，再按一次診斷。");
    const message = "診斷：Token 可用，但還沒有選擇板子。";
    await rememberResult({ ok: false, message });
    return { ok: false, message, report: lines.join("\n") };
  }

  const boards = await miroGet("https://api.miro.com/v2/boards?limit=50", settings);
  lines.push("", `可存取板子清單：HTTP ${boards.status}`);

  let boardListed = null;
  let fullyEnumerated = false;
  if (Array.isArray(boards.body?.data)) {
    const items = boards.body.data;
    const total = boards.body.total ?? items.length;
    fullyEnumerated = items.length >= total;
    boardListed = items.some((board) => board.id === settings.boardId);

    lines.push(`這個 token 看得到 ${total} 塊板子${fullyEnumerated ? "，全部列出" : `，以下列出抓到的 ${items.length} 塊`}：`);
    for (const board of items) {
      const marker = board.id === settings.boardId ? "→ " : "  ";
      lines.push(`${marker}${board.id}  ${board.name || "(無名稱)"}`);
    }
    if (!fullyEnumerated) {
      lines.push(`（還有 ${total - items.length} 塊沒抓到，比對只涵蓋上面這 ${items.length} 塊）`);
    }
  }

  const board = await miroGet(`https://api.miro.com/v2/boards/${encodeBoardId(settings.boardId)}`, settings);
  lines.push("", `目標板子 ${settings.boardId}：HTTP ${board.status}`);

  let ok = false;
  if (board.status === 200) {
    ok = true;
    lines.push(`板子名稱：${board.body?.name || "(無名稱)"}`);
    lines.push("", "判定：設定正常，右鍵加圖應該可以用。");
  } else {
    lines.push("", `判定：${describeMiroStatus(board.status, settings, { includeHint: false })}`);

    if (board.status === 403) {
      lines.push(
        "",
        boardListed === false && fullyEnumerated
          ? "佐證：這塊板子不在上面那份完整清單裡，代表 token 所屬的 App 根本沒被授權到這塊板子所在的 team。"
          : boardListed === false
            ? "佐證：抓到的那幾塊裡沒有這塊板子，但清單沒列完，還不算鐵證。"
            : "佐證：清單查詢沒回傳可比對的結果。",
        "",
        "處理順序：",
        "1. 對照上面「Token 掛在 team」與板子實際所在的 team 是否同一個。",
        "2. 不同 team：到 Miro 開發者後台把 App 重新 install 到板子所在的 team，拿新 token。",
        "3. 同 team 仍失敗：用裝 App 的那個 Miro 帳號開這塊板子，確認該帳號真的有編輯權。"
      );
    }
  }

  const message = ok ? "診斷：設定正常。" : `診斷：${describeMiroStatus(board.status, settings, { includeHint: false })}`;
  const report = lines.join("\n");
  await rememberResult({ ok, message });
  await setBadge(ok ? "OK" : "ERR", ok ? "#236b42" : "#a33221");
  return { ok, message, report };
}

// 240x160 PNG, generated offline and embedded so the write test needs no external host.
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAACTklEQVR42u3bMQqAMBREwRxEsNCTeB3PH21tbcSghcQdSD+w/7Up" +
  "wzh73m9eMYEnaM8TtOcJ2vME7Qn69KZ1aXx12x+/doXLvXqC5gra0FxBOzBX0FyuoLmCFjRX0IbmCtqBuYLmcgXNFbSguYI2NFfQ" +
  "Dsz9LmhjcXtxBc0VtKG5gnZgrqC5XEFzBS1orqANzRW0A3MFzeUKmitoQXMFbWiuoB2YK2guV9BcQQuaK2hDcwXtwFxBc7nvgjYW" +
  "169vQ3MF7cBcQXO5guYK2tBcQRuaK2gH5gqayxU0V9CG5gragbmC5nIFzRW0oLmCNjRX0A7MFTSXK2iuoAXNzQjaWFy/vg3NFbQD" +
  "cwXN5QqaK2hDcwVtaK6gHZgraC5X0FxBG5oraAfmCprLFTRX0ILmCtrQXEE7MFfQXK6guYIWNDcjaGNx/fo2NFfQDswVNJcraK6g" +
  "Dc0VtKG5gnZgrqC5XEFzBW1orqAdmCtoLlfQXEELmitoQ3MF7cBcQXO5guYKWtDcjKCNxfXr29BcQTswV9BcrqC5gjY0V9CG5gra" +
  "gbmC5nIFzRW0obmCdmCuoLlcQXMFLWiuoA3NFbQDcwXN5QqaK2hBczOCNhbXr29DcwXtwFxBc7mC5gra0FxBG5oraAfmCprLFTRX" +
  "0IbmCtqBuYLmcgXNFbSguYI2NFfQDswVNJcraK6gBc3NCNpYXL++Dc0VtANzBc3lCporaENzBW1orqAdmCtoLlfQXEEbmitoB+YK" +
  "mssVNFfQd0F7Xr9P0J6gPU/QnidozxO0F/wOZxhZx+3iDzkAAAAASUVORK5CYII=";

async function runUploadTest() {
  const settings = await getSettings();
  validateSettings(settings);

  // Sits one gap above the first row, so the probe never collides with real images
  // and does not disturb the layout cursor.
  const width = settings.imageHeight * (240 / 160);
  const position = {
    x: settings.startX + width / 2,
    y: settings.startY - settings.gap - settings.imageHeight / 2,
    origin: "center"
  };

  const blob = base64ToBlob(TEST_IMAGE_BASE64, "image/png");

  let created;
  try {
    created = await uploadMiroImage({
      settings,
      blob,
      title: "Add to My Miro 寫入測試",
      position
    });
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    const hint = error?.status === 403
      ? "讀得到卻寫不進去，通常是 token 少了 boards:write，或帳號對這塊板子只有檢視權。"
      : "這一步不經過任何外部網站，所以失敗代表問題出在 Miro 端的權限或連線，跟來源圖片無關。";

    const report = ["寫入測試：失敗 ❌", "", failure, "", hint].join("\n");
    await rememberResult({ ok: false, message: `寫入測試失敗：${failure}` });
    await setBadge("ERR", "#a33221");
    return { ok: false, message: `寫入測試失敗：${failure}`, report };
  }

  const message = `寫入成功：測試圖已放到 x ${position.x}, y ${position.y}`;
  const report = [
    "寫入測試：成功 ✅",
    "",
    `板子：${settings.boardName}（${settings.boardId}）`,
    `位置：x ${position.x}, y ${position.y}（起始位置上方一格，不會壓到你的格線）`,
    `item id：${created?.id || "(未回報)"}`,
    "",
    "代表 boards:write 權限、板子存取權、上傳管線都正常。",
    "去 Miro board 上看一眼那張綠白格子測試圖，確認後可以直接刪掉。",
    "",
    "接著右鍵實測一張真圖：若這裡成功但右鍵失敗，問題就在抓圖那段，不是 Miro 權限。"
  ].join("\n");

  await rememberResult({ ok: true, message });
  await setBadge("OK", "#236b42");
  return { ok: true, message, report };
}

const DEFAULT_TEST_LINKS = {
  video: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  page: "https://www.pinterest.com/pin/904097693963053625/"
};

// Adds one video and one product page through exactly the code path a right-click uses, but
// on the probe row above the start position (right of where 測試加圖 puts its image) and
// without moving the layout cursor. Created item ids are kept so they can be removed later.
async function runLinkTest({ video, page } = {}) {
  const settings = await getSettings();
  validateSettings(settings);

  const top = settings.startY - settings.gap - settings.imageHeight;
  let left = settings.startX + settings.imageHeight * (240 / 160) + settings.gap;
  const lines = ["測試加網址", "", `板子：${settings.boardName}（${settings.boardId}）`];
  const made = [];
  let allOk = true;

  for (const [label, url] of [["影片", video || DEFAULT_TEST_LINKS.video], ["商品頁", page || DEFAULT_TEST_LINKS.page]]) {
    lines.push("", `── ${label}：${url}`);
    try {
      const result = await createLinkItem({ settings, url, metaTabId: null, left, top });
      const detail = result.detail || {};
      made.push(...result.items.map((item) => ({ boardId: settings.boardId, ...item })));

      lines.push(
        `結果：成功 ✅，做成「${result.kind}」`,
        ...result.failures.map((failure) => `備註：${failure}`),
        `網址：${result.target}`,
        `Miro 回報：類型 ${result.detail.type || "(無)"}、來源 ${result.detail.providerName || "(無)"}、標題 ${result.detail.title || "(無)"}`,
        `寬 ${Math.round(result.width)} × 高 ${Math.round(result.height ?? settings.imageHeight)}（圖片高 ${settings.imageHeight}），板上是 ${result.items.length} 個物件`,
        `在 Miro 打開：${boardLink({ id: settings.boardId })}?moveToWidget=${result.items[0]?.id}`
      );
      left += result.width + settings.gap;
    } catch (error) {
      allOk = false;
      lines.push(`結果：失敗 ❌`, error instanceof Error ? error.message : String(error));
      if (isAccessError(error)) {
        break;
      }
    }
  }

  // Trial: the fallback used when the board is not open — an embed carrying the page's share
  // image (og:image) — made on purpose so it can be compared with Miro's own card. Its height
  // is set at creation, so unlike the pasted card it comes out imageHeight tall.
  const trialUrl = page || DEFAULT_TEST_LINKS.page;
  lines.push("", `── 試做嵌入卡＋預覽圖：${trialUrl}`);
  try {
    const meta = await getPageMeta(trialUrl, null);
    if (!meta.image) {
      lines.push("結果：沒做，讀不到這一頁的分享圖（og:image）。");
    } else {
      const ratio = meta.imageWidth > 0 && meta.imageHeight > 0 ? meta.imageWidth / meta.imageHeight : 16 / 9;
      const { created, width } = await createEmbed({ settings, data: { url: trialUrl, mode: "modal", previewUrl: meta.image }, ratio, left, top });
      made.push({ boardId: settings.boardId, endpoint: "embeds", id: created?.id, label: "試做嵌入卡＋預覽圖" });
      lines.push(
        `結果：成功 ✅，寬 ${Math.round(width)} × 高 ${Math.round(toNumber(created?.geometry?.height, settings.imageHeight))}（圖片高 ${settings.imageHeight}）`,
        `預覽圖：${meta.image}`,
        `在 Miro 打開：${boardLink({ id: settings.boardId })}?moveToWidget=${created?.id}`
      );
    }
  } catch (error) {
    if (isAccessError(error)) {
      throw error;
    }
    lines.push(`結果：失敗 ❌，${error instanceof Error ? error.message : String(error)}`);
  }

  const { testLinkItems } = await chrome.storage.local.get({ testLinkItems: [] });
  await chrome.storage.local.set({ testLinkItems: [...testLinkItems, ...made.filter((item) => item.id)] });

  lines.push(
    "",
    "去板上看：影片應該跟手動貼網址一樣，上面有 YouTube 標題、按下去能播放；",
    "網頁：Miro 板子有開著時，應該跟你手動貼網址一模一樣（圖、標題、說明），並排進同一排；",
    "沒開著時是一個有預覽圖的嵌入卡，或沒分享圖時的文字卡片。不管哪種都只有一個物件、點了能開網頁。",
    "試做嵌入卡＋預覽圖：排在商品頁原生卡的右邊，跟圖片同高、只有分享圖沒有標題說明，點了在 Miro 裡開網頁。",
    "看完按「刪除測試卡片」把這幾張移掉。"
  );

  const message = allOk ? `測試加網址：${made.length} 張已放上板子，請到板上確認外觀。` : "測試加網址：有失敗，看下方報告。";
  await rememberResult({ ok: allOk, message });
  await setBadge(allOk ? "OK" : "ERR", allOk ? "#236b42" : "#a33221");
  return { ok: allOk, message, report: lines.join("\n") };
}

// 120x120 six-frame GIF, generated offline and embedded so the test needs no local file.
const TEST_GIF_BASE64 = "R0lGODlheAB4AIEAAP///9w8PAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAEAAAACwAAAAAeAB4AAAI/wABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DD5gxAtqzZs2jTls2qtq1bs2zfyk0bd65dsnXvzs2r9y3fvm3/AqaLdbBcwYbhFk4ceDFjwlcfq0X8mDJjy4kxG9Y8mDNgz31B6xV9l7Rd03sdS1YcefVZ1IdVuw4A269s17Xd5m7cejbe26t3TwYuWThkq77XEq+8/HLzzGKjS59Ovbr169iza9/Ovbv37+DDixsfT768+fPo06tfz769+/fw48ufT7++/fs6AwIAIfkEARAAAgAsCgAoAC8AKQCB////8KAoAAAAAAAACJAAAQgcSLAggAAIEypcyLBhQoMQBzqcSFFhxIgVMzq8CFGjR4scC34cGVLkSI8lCZ5EmVLgSo0tXb6sGPPgTIo1b+KMqXNizp4NfwJdKHToQ55GQbZMqjQl06NLnwYompSqUatDsQLV2pOrTq83wc4U+5LsSrMn0ZJE+lTtR7cso7ZlyxQuTLpV8V7Vm5Uv0IAAIfkEARAAAgAsGgAoAC8AKQCB////8Nw8AAAAAAAACJAAAQgcSLAggAAIEypcyLBhQoMQBzqcSFFhxIgVMzq8CFGjR4scC34cGVLkSI8lCZ5EmVLgSo0tXb6sGPPgTIo1b+KMqXNizp4NfwJdKHToQ55GQbZMqjQl06NLnwYompSqUatDsQLV2pOrTq83wc4U+5LsSrMn0ZJE+lTtR7cso7ZlyxQuTLpV8V7Vm5Uv0IAAIfkEARAAAgAsKgAoAC8AKQCB////RrRaAAAAAAAACJAAAQgcSLAggAAIEypcyLBhQoMQBzqcSFFhxIgVMzq8CFGjR4scC34cGVLkSI8lCZ5EmVLgSo0tXb6sGPPgTIo1b+KMqXNizp4NfwJdKHToQ55GQbZMqjQl06NLnwYompSqUatDsQLV2pOrTq83wc4U+5LsSrMn0ZJE+lTtR7cso7ZlyxQuTLpV8V7Vm5Uv0IAAIfkEARAAAgAsOgAoAC8AKQCB////PIzcAAAAAAAACJAAAQgcSLAggAAIEypcyLBhQoMQBzqcSFFhxIgVMzq8CFGjR4scC34cGVLkSI8lCZ5EmVLgSo0tXb6sGPPgTIo1b+KMqXNizp4NfwJdKHToQ55GQbZMqjQl06NLnwYompSqUatDsQLV2pOrTq83wc4U+5LsSrMn0ZJE+lTtR7cso7ZlyxQuTLpV8V7Vm5Uv0IAAIfkEARAAAgAsSgAoAC4AKQCB////eFDIAAAAAAAACI8AAQgcSLAggAAIEypcyLAhQoMQBzqcSDFhxIgVMza8CFGjR4scC378GFLkSI0lCZ5EmVLgyowtXb6kGPPgzIk1b+KMqdNhzp4MfwJVKHToQ55GQbZMqjQl06NLnxY1OnVoVaBXe2bVufVm15lfX4ZdOfZk2ZFnSSJlmtZjW5ZR2a5N+hbmXKp3rebFurdnQAA7";

const DEFAULT_TEST_GIF = "https://upload.wikimedia.org/wikipedia/commons/d/d3/Newtons_cradle_animation_book_2.gif";

// Puts one GIF on the board by each route, so which ones keep the animation can be seen side
// by side. Sits one row above 測試加網址 and leaves the layout cursor alone; the items are
// removed with 刪除測試卡片.
async function runGifTest({ url } = {}) {
  const settings = await getSettings();
  validateSettings(settings);

  const blob = base64ToBlob(TEST_GIF_BASE64, "image/gif");
  const gifUrl = url || DEFAULT_TEST_GIF;
  const y = settings.startY - 2 * settings.gap - 1.5 * settings.imageHeight;
  const routes = [
    ["Miro 直接抓網址", (position) => createMiroImage({ settings, imageUrl: gifUrl, title: "Add to My Miro GIF 測試：網址", position })],
    ["貼進 Miro 分頁", (position, failures) => pasteGifIntoMiro({ settings, blob, position, failures })]
  ];

  const lines = ["測試 GIF", "", `板子：${settings.boardName}（${settings.boardId}）`];
  const made = [];
  let left = settings.startX;

  for (const [label, send] of routes) {
    lines.push("", `── ${label}`);
    const failures = [];
    try {
      const created = await send({ x: left + settings.imageHeight / 2, y, origin: "center" }, failures);
      if (created?.id) {
        made.push({ boardId: settings.boardId, endpoint: "images", id: created.id, label: `GIF 測試（${label}）` });
        lines.push("結果：放上板子了 ✅，請到板上看會不會動（可能要點播放箭頭）", `在 Miro 打開：${boardLink({ id: settings.boardId })}?moveToWidget=${created.id}`);
        left += toNumber(created.geometry?.width, settings.imageHeight) + settings.gap;
      } else {
        lines.push("結果：失敗 ❌", ...failures);
      }
    } catch (error) {
      lines.push("結果：失敗 ❌", error instanceof Error ? error.message : String(error));
      if (isAccessError(error)) {
        break;
      }
    }
  }

  const { testLinkItems } = await chrome.storage.local.get({ testLinkItems: [] });
  await chrome.storage.local.set({ testLinkItems: [...testLinkItems, ...made] });

  lines.push("", "看完按「刪除測試卡片」把這幾張移掉。");

  const ok = made.length > 0;
  const message = ok ? `測試 GIF：${made.length} 條路放上板子，請到板上看哪幾張會動。` : "測試 GIF：兩條路都失敗，看下方報告。";
  await rememberResult({ ok, message });
  await setBadge(ok ? "OK" : "ERR", ok ? "#236b42" : "#a33221");
  return { ok, message, report: lines.join("\n") };
}

async function deleteLinkTestItems() {
  const { accessToken } = await getSettings();
  const { testLinkItems } = await chrome.storage.local.get({ testLinkItems: [] });
  if (!testLinkItems.length) {
    return { ok: true, message: "沒有要刪的測試卡片。" };
  }

  const kept = [];
  const lines = ["刪除測試卡片", ""];
  for (const item of testLinkItems) {
    let status = 0;
    try {
      const response = await fetch(`https://api.miro.com/v2/boards/${encodeBoardId(item.boardId)}/${item.endpoint}/${item.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      status = response.status;
    } catch (error) {
      status = 0;
    }

    // 404 means it is already gone (deleted by hand on the board), which is just as good.
    if (status === 204 || status === 200 || status === 404) {
      lines.push(`已刪：${item.label || item.endpoint} ${item.id}${status === 404 ? "（板上已經沒有）" : ""}`);
    } else {
      kept.push(item);
      lines.push(`沒刪掉：${item.label || item.endpoint} ${item.id}（HTTP ${status || "連線失敗"}），清單保留，可再按一次。`);
    }
  }

  await chrome.storage.local.set({ testLinkItems: kept });
  const ok = !kept.length;
  const message = ok ? `已刪除 ${testLinkItems.length} 張測試卡片。` : `還有 ${kept.length} 張沒刪掉，看下方報告。`;
  await rememberResult({ ok, message });
  return { ok, message, report: lines.join("\n") };
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

async function miroGet(url, settings) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${settings.accessToken}`
      }
    });

    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text;
    }

    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

// A relative iconUrl resolves against this script's folder (src/), where there is no icons/,
// and Chrome then drops the notification with "Unable to download all specified images".
// The result is already on the badge and the settings page, so a lost notification is ignored.
function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message
  }).catch((error) => console.warn("Notification not shown", error));
}

async function rememberResult(result) {
  await chrome.storage.local.set({
    lastResult: {
      ...result,
      at: new Date().toISOString()
    }
  });
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

function encodeBoardId(boardId) {
  return encodeURIComponent(boardId).replaceAll("%3D", "=");
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
