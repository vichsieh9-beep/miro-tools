# Add to My Miro

Chrome extension: right-click a web image, link, video or page and add it to one of your saved Miro boards.

## How It Knows Which Miro Board

The settings page keeps a list of boards (`我的板子`). Paste a board URL under `新增板子`;
the extension checks the token can reach that board, takes the board's name from Miro, and
makes it the active board. A board already in the list is not added twice.

- Click a board's button to make it the active board.
- `管理` reveals rename (✎, display name only) and remove (×, list only — nothing on Miro is touched).
- The toolbar icon's right-click menu has `切換板子` for switching without opening settings.
- The image right-click item names its target, e.g. `加到我的 Miro（Lexis）`.

The Access Token and layout settings are shared by all boards. The placement cursor
(`下一張 X/Y`, `本排已放`) is kept per board, so switching back resumes where that board left off.

The page menu deliberately has a single item: with two or more, Chrome folds them into
an `Add to My Miro ▸` submenu and every add costs an extra click. That is why switching lives
on the toolbar icon instead, and why images, links, videos and the page share one item.

## Moving to Another Folder (1.8.7)

Chrome ties storage to the extension id, and an unpacked extension's id comes from its folder,
so the same code loaded from a new folder starts empty. `匯出設定` on the settings page saves
the boards, each board's position and the layout settings to a JSON file; `匯入設定` in the
newly loaded copy restores them. The token is not in the file and has to be pasted again.

## WebP and GIF (1.8.6)

Miro's upload endpoint takes only jpeg, png and svg, and Miro cannot pull WebP by URL either.

- **WebP** is always redrawn as PNG before uploading (lossless, keeps transparency). An
  animated WebP comes out as its first frame.
- **GIF** is never redrawn, because that would flatten it to one frame. Miro pulls a public
  URL itself; otherwise the file is pasted, intact, into the board's open Miro tab, so a
  local or logged-in GIF needs the board open. Both routes keep the animation (tested on a
  real board, 2026-11-01). A base64 data URL did not work. If neither route works the add
  fails with `ERR` rather than quietly placing a still image. Tiny placeholder GIFs (under
  200 bytes) are skipped.
- `測試 GIF` on the settings page places one GIF by each route, one row above the link
  test. `刪除測試卡片` removes them.

The format is read from the file's first bytes, not the server's Content-Type.

## Links, Videos and Pages (1.8.4)

The same right-click item works on more than images. What gets added depends on where you click:

| Right-click on | Added as |
|---|---|
| A link to a video (YouTube, Vimeo, Dailymotion, TikTok, Bilibili) — even its thumbnail | Miro's own video player |
| An image (not linking to a video) | Image, as before |
| Any other link | Miro's own link preview card (picture, title, description), pasted into your open board tab; see below |
| Empty space on a page, or an HTML5 video | The page itself (video player on a video page) |

The toolbar icon's right-click menu also has `把這一頁加到 Miro`.

Everything is `圖片高度` tall, so links sit in the same row as images. The cursor advances off
the width Miro actually gave the item.

Videos are created as an embed with no preview image of our own, which is what Miro makes
when a video link is pasted by hand (provider header, YouTube's own frame). YouTube `shorts/`,
`youtu.be/` and `embed/` links are rewritten to the canonical watch URL.

An ordinary page should look exactly like pasting its URL into Miro by hand: Miro's own
link preview card with the page's picture, title and description. That card is an embed Miro
fills in itself, which the REST API cannot do. So when the active board is **open in a Chrome
tab**, the extension pastes the URL into that tab (a synthetic paste via `chrome.scripting`,
in the page's own world), waits for the new card to appear in the board's item list, then
moves it into the row and scales it to `圖片高度`. Three ways are tried in turn: the 同高貼齊
Miro app (`../align-app`), which runs in a frame of the board tab with the Web SDK (the
extension calls its `window.sameHeightPlaceItem`; needs the `webNavigation` permission to find
that frame); then the REST API with the height; then with the width. Miro reports these cards as
embeds, whose size the Web SDK treats as read-only, so the REST attempts are what usually decide
it. If none takes, the card keeps Miro's size, the notification says `大小沒改成`, and the
settings page shows what each attempt answered. The paste is skipped while a text box in the Miro tab has focus, so it never types the
URL into your text.

When the board is not open, or Miro does not take the paste, the page falls back to:

1. an embed with the page's share image (`og:image`) as its preview — one item, click opens
   the page; or, when the page has no share image,
2. a text card (one shape): bold title, description, and the site as a clickable link, at the
   largest font size that fits (`textCardLayout` in `src/links.js`).

If Miro took the paste but the card cannot be found within 10 seconds, the extension stops
and says so rather than adding a second card. Every outcome is a single item on the board.

To check what Miro actually makes of a link, use `測試加網址` on the settings page. It adds
the video and product page in its two fields through the same code as a right-click, on the
probe row above the start position, without moving the layout cursor, and reports what Miro
returned. `刪除測試卡片` removes only the items that button created.

The test also adds a third, trial card (1.8.4): the not-open fallback — an embed with the page's
share image — placed right of Miro's own card for comparison, since its height can be set at
creation. Miro's own card cannot be made `圖片高度` tall by any route tried on 2026-10-24: the
Web SDK (an embed, size read-only), REST (a geometry PATCH answers 200 and changes nothing), or
zooming the board before pasting (the card comes out the same size). A `createPreview` card
could be resized but shows no picture.

An image that is itself a link to a non-video page is still added as an image. To add that
page instead, right-click the text link, empty space, or use the toolbar icon's menu.

## Install

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this `extension` folder.

## Use

1. Click the extension icon to open settings.
2. Paste an access token and save.
3. Paste a Miro board URL under `新增板子` and press `加入`. Repeat for other boards.
4. On Pinterest or another website, right-click an image, a link, or empty space on the page.
5. Choose `📌 加到我的 Miro（board name）`.

## Troubleshooting

Press `診斷` on the settings page. It reports which Miro team the token is actually
installed on, its scopes, which boards it can see, and the status of the configured
board — then names the fix.

Reading the status code:

| Status | Meaning | Fix |
|---|---|---|
| 401 | Token invalid, expired, or revoked | Regenerate the token and paste it back |
| 403 `insufficientPermissions` | Token is valid, but the app has no data access to that board | Reinstall the app on the team that owns the board, then use the new token |
| 404 | Board ID wrong or board deleted | Re-paste the board URL |
| 429 | Rate limited | Wait, then retry |

The 401/403 distinction is the important one: 401 is about the token, 403 is about
which team the app was installed on. A 403 is never fixed by regenerating a token
from the same installation.

## Notes

Layout is a flow, not a fixed grid. Every image is scaled to a fixed **height**
(default 1024) and its width follows the source aspect ratio, so widths vary per image —
a fixed cell width would either overlap wide images or strand narrow ones. The extension
tracks a cursor and butts each image against the previous one's real right edge, leaving
`圖片間距`. After `每排張數` images it returns to `起始 X` and drops one row.

The width is predicted from the `<img>`'s natural dimensions, then the cursor advances off
the width Miro actually applied, so an imprecise estimate cannot accumulate into drift.

Getting an image across is tried three ways, cheapest first:

1. **Miro pulls the URL** — one API call, no image data through the browser.
2. **Extension downloads, then uploads** as `multipart/form-data` — for hotlink-blocking
   CDNs (Pinterest). Miro's 6 MB cap applies.
3. **The page reads it** via the content script — the only route that works for `blob:`
   URLs, which are scoped to the page that created them and are invisible to both Miro
   and the service worker. ChatGPT-generated images can land here.

Every candidate URL from the `<img>` (largest `srcset` entry, `currentSrc`, `src`) is
tried before giving up, and a failure reports what each attempt said.

Auth failures (401/403/404/429) short-circuit the whole chain, since retrying cannot help.

Two remaining caveats:

- Some websites serve only a small thumbnail, so that is all that reaches the board.
- The token is stored in local Chrome extension storage. This is acceptable for a private
  tool, but OAuth is better for a shared/published version.
