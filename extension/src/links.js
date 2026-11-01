// URL classification and page-metadata parsing for adding links (not images) to a board.
// Pure functions, shared by the service worker (importScripts) and the Node tests.

// Recognised video hosts become a playable embed (mode "inline") with a known 16:9 or 9:16
// frame. Anything else is treated as an ordinary page.
function videoInfo(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (error) {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const path = url.pathname;

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id = "";
    let vertical = false;

    if (host === "youtu.be") {
      id = path.split("/")[1] || "";
    } else if (path === "/watch") {
      id = url.searchParams.get("v") || "";
    } else {
      const match = path.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (match) {
        id = match[2];
        vertical = match[1] === "shorts";
      }
    }

    if (!/^[\w-]{6,}$/.test(id)) {
      return null;
    }

    // Embedly only knows the canonical watch URL; shorts/embed/youtu.be are rewritten to it,
    // and playlist/tracking parameters are dropped. A start time is kept.
    const start = url.searchParams.get("t") || url.searchParams.get("start");
    return {
      provider: "YouTube",
      url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${encodeURIComponent(start)}` : ""}`,
      previewUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      ratio: vertical ? 9 / 16 : 16 / 9
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const match = path.match(/(?:^|\/)(\d{5,})(?:\/|$)/);
    return match
      ? { provider: "Vimeo", url: `https://vimeo.com/${match[1]}`, previewUrl: "", ratio: 16 / 9 }
      : null;
  }

  if (host === "dailymotion.com" || host === "dai.ly") {
    const match = host === "dai.ly" ? path.match(/^\/(\w+)/) : path.match(/^\/video\/(\w+)/);
    return match
      ? { provider: "Dailymotion", url: `https://www.dailymotion.com/video/${match[1]}`, previewUrl: "", ratio: 16 / 9 }
      : null;
  }

  if (host === "tiktok.com" && /\/video\/\d+/.test(path)) {
    return { provider: "TikTok", url: `https://www.tiktok.com${path}`, previewUrl: "", ratio: 9 / 16 };
  }

  if (host === "bilibili.com" && /^\/video\/(BV\w+|av\d+)/i.test(path)) {
    return { provider: "Bilibili", url: `https://www.bilibili.com${path.match(/^\/video\/[^/]+/)[0]}/`, previewUrl: "", ratio: 16 / 9 };
  }

  return null;
}

function isWebUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

// Pulls title / description / preview image out of a page's <head>. Regex rather than a DOM
// parser because the service worker has no DOMParser. Open Graph first, then Twitter, then
// the plain <title>.
function parsePageMeta(html, pageUrl) {
  // The whole document, not just its start: Pinterest, for one, puts its og: tags well past
  // the first megabyte of inline script.
  const head = String(html || "");
  const metas = {};

  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = attribute(tag, "property") || attribute(tag, "name") || attribute(tag, "itemprop");
    const content = attribute(tag, "content");
    if (key && content && !(key.toLowerCase() in metas)) {
      metas[key.toLowerCase()] = decodeEntities(content).trim();
    }
  }

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const image = metas["og:image:secure_url"] || metas["og:image"] || metas["og:image:url"]
    || metas["twitter:image"] || metas["twitter:image:src"] || metas.image || "";

  return {
    imageWidth: Number(metas["og:image:width"]) || 0,
    imageHeight: Number(metas["og:image:height"]) || 0,
    title: (metas["og:title"] || metas["twitter:title"] || decodeEntities(titleTag || "")).replace(/\s+/g, " ").trim(),
    description: (metas["og:description"] || metas["twitter:description"] || metas.description || "").replace(/\s+/g, " ").trim(),
    image: absoluteUrl(image, pageUrl),
    siteName: metas["og:site_name"] || ""
  };
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : "";
}

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return String(text).replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

function absoluteUrl(value, base) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function hostLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (error) {
    return String(value || "");
  }
}

// Width of text in "font sizes": CJK and other full-width characters take a whole em, the
// rest about 0.6 em (bold Latin is a little wider than regular).
function textUnits(text) {
  let units = 0;
  for (const char of String(text || "")) {
    units += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/.test(char) ? 1 : 0.6;
  }
  return units;
}

// Shortens text to at most `units` (see textUnits), ending in "…" when cut.
function fitText(text, units) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (textUnits(clean) <= units) {
    return clean;
  }
  let out = "";
  for (const char of clean) {
    if (textUnits(out + char) + 1 > units) {
      break;
    }
    out += char;
  }
  return `${out.trimEnd()}…`;
}

// The link card: one Miro shape holding a bold title, the description and the site as a
// clickable link, `height` tall like the images in the row. Miro does not shrink text to fit
// a shape, so pick the largest font size at which the whole title (up to three lines), the
// whole site name, and some description fit, and cut the rest. Miro pads shape text, hence the
// generous margins.
function textCardLayout(height, { title = "", description = "", host = "" } = {}) {
  const width = Math.round(height * 0.85);
  const usableWidth = width * 0.8;
  const usableHeight = height * 0.8;
  const titleUnits = textUnits(title || host);
  const descUnits = textUnits(description);
  const minSize = Math.max(10, Math.round(height * 0.022));
  let best = null;

  for (let size = Math.min(288, Math.round(height * 0.065)); size >= minSize; size -= 1) {
    const perLine = usableWidth / size;
    const rows = Math.floor(usableHeight / (size * 1.5));
    const titleLines = Math.min(3, Math.ceil(titleUnits / perLine));
    const descNeeded = description ? Math.ceil(descUnits / perLine) : 0;
    // Title, a spare row between paragraphs, and the link line.
    const descRoom = rows - titleLines - 2;
    const descLines = Math.max(0, Math.min(descNeeded, descRoom, 6));
    best = { size, perLine, titleLines, descLines };
    const titleFits = titleUnits <= perLine * 3;
    const hostFits = textUnits(host) <= perLine;
    const enoughDescription = descLines >= Math.min(2, descNeeded);
    if (titleFits && hostFits && enoughDescription && descRoom >= 0) {
      break;
    }
  }

  return {
    width,
    height,
    fontSize: best.size,
    title: fitText(title || host, best.perLine * best.titleLines),
    description: best.descLines ? fitText(description, best.perLine * best.descLines) : "",
    host: fitText(host, best.perLine)
  };
}

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);
}

if (typeof module !== "undefined") {
  module.exports = { videoInfo, isWebUrl, parsePageMeta, decodeEntities, absoluteUrl, hostLabel, textUnits, fitText, textCardLayout, escapeHtml };
}
