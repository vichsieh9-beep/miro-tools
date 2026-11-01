const DEFAULT_SETTINGS = {
  accessToken: "",
  startX: 0,
  startY: 0,
  columns: 10,
  gap: 40,
  imageHeight: 1024
};

const POSITION_DEFAULTS = {
  cursorX: 0,
  cursorY: 0,
  rowCount: 0
};

const fields = [...Object.keys(DEFAULT_SETTINGS), ...Object.keys(POSITION_DEFAULTS)].reduce((acc, key) => {
  acc[key] = document.getElementById(key);
  return acc;
}, {});

let boardState = { boards: [], activeBoardId: "" };
let managing = false;
let renamingId = "";

document.addEventListener("DOMContentLoaded", loadSettings);
document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("validate").addEventListener("click", validateSettings);
document.getElementById("diagnose").addEventListener("click", diagnose);
document.getElementById("testUpload").addEventListener("click", testUpload);
document.getElementById("resetPosition").addEventListener("click", resetPosition);
document.getElementById("testLinks").addEventListener("click", testLinks);
document.getElementById("testGif").addEventListener("click", testGif);
document.getElementById("deleteTestLinks").addEventListener("click", deleteTestLinks);
document.getElementById("exportSettings").addEventListener("click", exportSettings);
document.getElementById("importSettings").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", importSettings);
document.getElementById("addBoard").addEventListener("click", addBoard);
document.getElementById("newBoardUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addBoard();
  }
});
document.getElementById("boards").addEventListener("click", onBoardsClick);

// The service worker also writes boards (cursor after each add, names, switching from the
// toolbar menu), so follow storage instead of trusting what this page last rendered.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes.testLinkItems) {
    renderTestCount(changes.testLinkItems.newValue || []);
  }
  if (area !== "local" || !(changes.boards || changes.activeBoardId)) {
    return;
  }

  boardState = await readBoardState();
  if (!renamingId) {
    renderBoards();
  }
  if (!Object.keys(POSITION_DEFAULTS).some((key) => document.activeElement === fields[key])) {
    renderPosition();
  }
});

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(settings)) {
    if (fields[key]) {
      fields[key].value = value;
    }
  }

  boardState = await readBoardState();
  renderBoards();
  renderPosition();

  if (settings.accessToken && boardState.boards.some((board) => !board.name)) {
    askBackground({ type: "FILL_BOARD_NAMES" });
  }

  const { lastResult, testLinkItems } = await chrome.storage.local.get({ lastResult: null, testLinkItems: [] });
  if (lastResult) {
    renderLastResult(lastResult);
    renderReport(lastResult.report);
  }
  renderTestCount(testLinkItems);
}

function renderTestCount(items) {
  const button = document.getElementById("deleteTestLinks");
  button.textContent = items.length ? `刪除測試卡片（${items.length}）` : "刪除測試卡片";
  button.disabled = !items.length;
}

function activeBoard() {
  return boardState.boards.find((board) => board.id === boardState.activeBoardId);
}

function renderBoards() {
  const host = document.getElementById("boards");
  host.replaceChildren();

  if (!boardState.boards.length) {
    managing = false;
    const empty = document.createElement("span");
    empty.className = "chips-empty";
    empty.textContent = "清單是空的，請在下方貼上 Miro 板子網址新增。";
    host.append(empty);
  }

  for (const board of boardState.boards) {
    const chip = document.createElement("span");
    chip.className = `chip${board.id === boardState.activeBoardId ? " on" : ""}`;
    chip.dataset.id = board.id;

    if (board.id === renamingId) {
      const input = document.createElement("input");
      input.value = boardLabel(board);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          finishRename(board.id, input.value);
        } else if (event.key === "Escape") {
          renamingId = "";
          renderBoards();
        }
      });
      input.addEventListener("blur", () => finishRename(board.id, input.value));
      chip.append(input);
      host.append(chip);
      continue;
    }

    const isActive = board.id === boardState.activeBoardId;
    chip.append(chipButton("chip-name", boardLabel(board), "use", isActive ? "使用中" : "切到這塊"));
    if (managing) {
      chip.append(chipButton("chip-rename", "✎", "rename", "改名"));
      chip.append(chipButton("chip-remove", "×", "remove", "從清單移除"));
    }
    host.append(chip);
  }

  if (boardState.boards.length) {
    host.append(chipButton(`manage${managing ? " on" : ""}`, managing ? "完成" : "管理", "manage", "改名或刪除板子"));
  }

  const renameInput = host.querySelector(".chip input");
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }

  const current = document.getElementById("currentBoard");
  const board = activeBoard();
  current.replaceChildren();
  if (board) {
    current.append(`使用中：${boardLabel(board)}・${board.id}`);
    const link = document.createElement("a");
    link.href = boardLink(board);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "在 Miro 開啟 ↗";
    current.append(link);
  }
}

function chipButton(className, text, action, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.dataset.action = action;
  button.title = title;
  return button;
}

function renderPosition() {
  const board = activeBoard();
  document.getElementById("positionFor").textContent = board ? `（${boardLabel(board)} 這塊板）` : "（尚未選擇板子）";

  fields.cursorX.value = board?.cursorX ?? numberValue("startX");
  fields.cursorY.value = board?.cursorY ?? numberValue("startY");
  fields.rowCount.value = board?.rowCount ?? 0;
}

async function onBoardsClick(event) {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.dataset.action === "manage") {
    managing = !managing;
    renamingId = "";
    renderBoards();
    return;
  }

  const id = button.closest(".chip")?.dataset.id;
  const board = boardState.boards.find((item) => item.id === id);
  if (!board) {
    return;
  }

  if (button.dataset.action === "use" && id !== boardState.activeBoardId) {
    await chrome.storage.local.set({ activeBoardId: id });
    boardState.activeBoardId = id;
    renderBoards();
    renderPosition();
    showStatus(`已切到「${boardLabel(board)}」。`);
  } else if (button.dataset.action === "rename") {
    renamingId = id;
    renderBoards();
  } else if (button.dataset.action === "remove") {
    await removeBoard(board);
  }
}

async function finishRename(id, value) {
  if (renamingId !== id) {
    return;
  }

  renamingId = "";
  const name = value.trim();
  if (name) {
    await updateBoard(id, { name });
    boardState = await readBoardState();
  }
  renderBoards();
  renderPosition();
}

async function removeBoard(board) {
  if (!confirm(`從清單移除「${boardLabel(board)}」？\n只會從這個清單拿掉，不會動到 Miro 上的板子或圖片。`)) {
    return;
  }

  const { boards, activeBoardId } = await readBoardState();
  const remaining = boards.filter((item) => item.id !== board.id);
  const nextActive = activeBoardId === board.id ? remaining[0]?.id || "" : activeBoardId;

  await chrome.storage.local.set({ boards: remaining, activeBoardId: nextActive });
  boardState = { boards: remaining, activeBoardId: nextActive };
  renderBoards();
  renderPosition();
  showStatus(`已從清單移除「${boardLabel(board)}」。`);
}

async function addBoard() {
  const input = document.getElementById("newBoardUrl");
  const url = input.value.trim();
  const id = extractBoardId(url);

  if (!id) {
    showAddMessage("看不出這是 Miro 板子網址，請貼像 https://miro.com/app/board/… 這樣的網址。", "err");
    return;
  }

  const existing = boardState.boards.find((board) => board.id === id);
  if (existing) {
    showAddMessage(`「${boardLabel(existing)}」已經在清單裡，不會重複新增。`, "warn");
    flashBoard(id);
    return;
  }

  // The lookup runs in the service worker with the stored token, so persist an edited one first.
  await chrome.storage.local.set({ accessToken: fields.accessToken.value.trim() });
  showAddMessage("檢查這塊板子能不能存取…", "info");

  const result = await askBackground({ type: "LOOKUP_BOARD", boardId: id });
  if (!result.ok) {
    showAddMessage(result.message, "err");
    return;
  }

  // Re-read: the list may have changed while the lookup was in flight.
  const { boards } = await readBoardState();
  if (boards.some((board) => board.id === id)) {
    boardState = await readBoardState();
    renderBoards();
    showAddMessage("這塊板子已經在清單裡，不會重複新增。", "warn");
    flashBoard(id);
    return;
  }

  const board = {
    id,
    name: result.name || "",
    url,
    cursorX: numberValue("startX"),
    cursorY: numberValue("startY"),
    rowCount: 0
  };

  boardState = { boards: [...boards, board], activeBoardId: id };
  await chrome.storage.local.set(boardState);
  input.value = "";
  renderBoards();
  renderPosition();
  showAddMessage(`已加入「${boardLabel(board)}」，並切換為使用中。`, "ok");
}

// Pages load straight from disk, but the service worker only updates when the extension is
// reloaded. An old worker ignores message types it does not know and answers nothing.
async function askBackground(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (result) {
      return result;
    }
  } catch (error) {
    console.warn("Background did not answer", message.type, error);
  }

  return {
    ok: false,
    message: "背景程式沒有回應。請到 chrome://extensions 在 Add to My Miro 按「重新載入」（↻），再試一次。"
  };
}

function flashBoard(id) {
  const chip = [...document.querySelectorAll(".chip")].find((element) => element.dataset.id === id);
  if (!chip) {
    return;
  }

  chip.classList.add("flash");
  setTimeout(() => chip.classList.remove("flash"), 1200);
}

function showAddMessage(message, kind) {
  const element = document.getElementById("addMessage");
  element.textContent = message;
  element.className = `toast ${kind}`;
  element.hidden = false;
}

async function saveSettings() {
  const settings = {
    accessToken: fields.accessToken.value.trim(),
    startX: numberValue("startX"),
    startY: numberValue("startY"),
    columns: Math.max(1, numberValue("columns")),
    gap: Math.max(0, numberValue("gap")),
    imageHeight: Math.max(20, numberValue("imageHeight"))
  };

  await chrome.storage.local.set(settings);

  const board = activeBoard();
  if (board) {
    await updateBoard(board.id, {
      cursorX: numberValue("cursorX"),
      cursorY: numberValue("cursorY"),
      rowCount: Math.max(0, numberValue("rowCount"))
    });
  }

  showStatus("已儲存。");
}

// Chrome ties storage to the extension id, and an unpacked extension's id comes from its folder,
// so loading it from a new folder starts empty. This file carries the boards and layout across.
// The token stays out of it on purpose: the file sits in Downloads, and the token is repasted by hand.
async function exportSettings() {
  const { accessToken, ...layout } = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const { boards, activeBoardId } = await readBoardState();
  const file = JSON.stringify({ app: "add-to-my-miro", layout, boards, activeBoardId }, null, 2);
  const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "add-to-my-miro-settings.json";
  link.click();
  URL.revokeObjectURL(url);
  showStatus(`已匯出 ${boards.length} 塊板子和排版設定（不含 Token）。`);
}

async function importSettings(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) {
    return;
  }

  try {
    const { app, layout, boards, activeBoardId } = JSON.parse(await file.text());
    if (app !== "add-to-my-miro" || !Array.isArray(boards)) {
      throw new Error("not a settings file");
    }

    const { startX, startY, columns, gap, imageHeight } = layout || {};
    const settings = Object.entries({ startX, startY, columns, gap, imageHeight })
      .filter(([, value]) => Number.isFinite(value));
    await chrome.storage.local.set({ ...Object.fromEntries(settings), boards, activeBoardId });
    await loadSettings();
    showStatus(`已匯入 ${boards.length} 塊板子和排版設定。Token 請另外貼上。`);
  } catch {
    showStatus("匯入失敗：這不是匯出的設定檔。", true);
  }
}

async function validateSettings() {
  await saveSettings();
  showStatus("測試中...");

  const result = await askBackground({ type: "VALIDATE_SETTINGS" });
  showStatus(result.message, !result.ok);

  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (lastResult) {
    renderLastResult(lastResult);
  }
}

async function diagnose() {
  await saveSettings();
  showStatus("診斷中...");

  const result = await askBackground({ type: "RUN_DIAGNOSTICS" });
  showStatus(result.message, !result.ok);
  renderReport(result.report);

  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (lastResult) {
    renderLastResult(lastResult);
  }
}

async function testUpload() {
  await saveSettings();
  showStatus("上傳測試圖中...");

  const result = await askBackground({ type: "TEST_UPLOAD" });
  showStatus(result.message, !result.ok);
  renderReport(result.report || result.message);

  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (lastResult) {
    renderLastResult(lastResult);
  }
}

async function testLinks() {
  await saveSettings();
  showStatus("貼測試網址中…（商品頁要先抓預覽圖，約需幾秒）");

  const result = await askBackground({
    type: "TEST_LINKS",
    video: document.getElementById("testVideoUrl").value.trim(),
    page: document.getElementById("testPageUrl").value.trim()
  });
  showStatus(result.message, !result.ok);
  renderReport(result.report || result.message);

  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (lastResult) {
    renderLastResult(lastResult);
  }
}

async function testGif() {
  await saveSettings();
  showStatus("放測試 GIF 中…（貼進 Miro 分頁那條最多等 20 秒）");

  const result = await askBackground({ type: "TEST_GIF", url: document.getElementById("testGifUrl").value.trim() });
  showStatus(result.message, !result.ok);
  renderReport(result.report || result.message);

  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (lastResult) {
    renderLastResult(lastResult);
  }
}

async function deleteTestLinks() {
  showStatus("刪除測試卡片中…");

  const result = await askBackground({ type: "DELETE_TEST_LINKS" });
  showStatus(result.message, !result.ok);
  renderReport(result.report || result.message);
}

function renderReport(report) {
  const element = document.getElementById("report");
  element.textContent = report || "";
  element.hidden = !report;
}

async function resetPosition() {
  const board = activeBoard();
  if (!board) {
    showStatus("請先新增或選擇一塊板子。", true);
    return;
  }

  const startX = numberValue("startX");
  const startY = numberValue("startY");

  fields.cursorX.value = startX;
  fields.cursorY.value = startY;
  fields.rowCount.value = 0;

  await updateBoard(board.id, { cursorX: startX, cursorY: startY, rowCount: 0 });
  showStatus(`「${boardLabel(board)}」的下一張位置已回到起點 x ${startX}, y ${startY}。`);
}

function numberValue(key) {
  const parsed = Number(fields[key].value);
  return Number.isFinite(parsed) ? parsed : { ...DEFAULT_SETTINGS, ...POSITION_DEFAULTS }[key];
}

function showStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.style.color = isError ? "#a33221" : "#236b42";
}

function renderLastResult(result) {
  const lastResult = document.getElementById("lastResult");
  const localTime = result.at ? new Date(result.at).toLocaleString() : "";
  lastResult.textContent = `最後結果：${result.ok ? "成功" : "失敗"} ${localTime} ${result.message}`;
  lastResult.style.color = result.ok ? "#236b42" : "#a33221";
}
