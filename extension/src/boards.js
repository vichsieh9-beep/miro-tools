// Board list shared by the service worker (importScripts) and the options page.
//
// Storage shape since 1.0.0:
//   boards: [{ id, name, url, cursorX, cursorY, rowCount }]  — each board keeps its own layout cursor
//   activeBoardId: id of the board right-click adds go to
// Token and layout settings (startX, columns, gap, ...) stay as top-level keys shared by all boards.

function extractBoardId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const boardMatch = trimmed.match(/\/board\/([^/?#]+)/);
  if (boardMatch) {
    return decodeURIComponent(boardMatch[1]);
  }

  return trimmed.includes("/") ? "" : trimmed;
}

// 0.4.x stored one board as boardId/boardUrl/cursorX/cursorY/rowCount. Fold it into the list
// on first read. The old keys are left in place so rolling back to 0.4.x still works.
async function readBoardState() {
  const stored = await chrome.storage.local.get({
    boards: null,
    activeBoardId: "",
    boardId: "",
    boardUrl: "",
    cursorX: null,
    cursorY: null,
    rowCount: 0,
    startX: 0,
    startY: 0
  });

  if (Array.isArray(stored.boards)) {
    const boards = stored.boards;
    const activeBoardId = boards.some((board) => board.id === stored.activeBoardId)
      ? stored.activeBoardId
      : boards[0]?.id || "";
    return { boards, activeBoardId };
  }

  const boards = stored.boardId
    ? [{
        id: stored.boardId,
        name: "",
        url: stored.boardUrl || "",
        cursorX: stored.cursorX ?? stored.startX,
        cursorY: stored.cursorY ?? stored.startY,
        rowCount: stored.rowCount || 0
      }]
    : [];
  const state = { boards, activeBoardId: boards[0]?.id || "" };
  await chrome.storage.local.set(state);
  return state;
}

async function updateBoard(id, patch) {
  const { boards } = await readBoardState();
  await chrome.storage.local.set({
    boards: boards.map((board) => (board.id === id ? { ...board, ...patch } : board))
  });
}

function boardLabel(board) {
  return board?.name || board?.id || "";
}

function boardLink(board) {
  return `https://miro.com/app/board/${board.id}/`;
}
