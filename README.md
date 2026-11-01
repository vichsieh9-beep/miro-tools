# miro-tools

Vic's Miro tools. Both are changed and shipped together: the extension calls functions the
app exposes in the board tab, and it finds the app by its Pages URL.

| Folder | What it is | How it ships |
|---|---|---|
| [`align-app/`](align-app/README.md) | 同高貼齊, a Miro app that lines selected items up at the same height | Pushing to `main` publishes this folder to https://vichsieh9-beep.github.io/miro-tools/ |
| [`extension/`](extension/README.md) | Add to My Miro, a Chrome extension that adds images, links, videos and pages to a saved board | Loaded unpacked from this folder; reload it on `chrome://extensions` after a change |

If the Pages URL changes, update `ALIGN_APP_URL` in `extension/src/background.js` and the app
URL in the Miro developer settings together.

This repo is public because GitHub Pages serves from it. Never commit tokens, board IDs or
screenshots of real boards.
