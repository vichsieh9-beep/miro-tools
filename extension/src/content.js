let lastImageCandidate = null;

document.addEventListener("contextmenu", (event) => {
  const image = event.target?.closest?.("img");
  if (!image) {
    return;
  }

  lastImageCandidate = buildImageCandidate(image);
}, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_LAST_IMAGE_CANDIDATE") {
    sendResponse(lastImageCandidate || message.fallback || null);
    return;
  }

  // Adding the open page itself: hand over its <meta> and <title> tags so the service worker
  // can read the Open Graph preview with the same parser it uses for fetched pages. Only the
  // tags, not the whole <head>: some heads carry megabytes of inline script.
  if (message?.type === "GET_PAGE_HEAD") {
    sendResponse({
      html: [...document.querySelectorAll("head meta, head title")].map((tag) => tag.outerHTML).join(""),
      title: document.title,
      url: location.href
    });
    return;
  }

  // A blob: URL belongs to this page; nothing outside it — not Miro, not the
  // service worker — can resolve one. Reading it has to happen right here.
  if (message?.type === "READ_IMAGE_IN_PAGE") {
    readImageInPage(message.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));

    return true;
  }
});

async function readImageInPage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    return { error: `頁面內下載失敗 HTTP ${response.status}` };
  }

  const blob = await response.blob();
  if (!blob.size) {
    return { error: "頁面內下載到 0 bytes。" };
  }

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("圖片轉檔失敗。"));
    reader.readAsDataURL(blob);
  });

  return { base64, type: blob.type || "image/png", size: blob.size };
}

function buildImageCandidate(image) {
  const pinLink = image.closest("a")?.href || location.href;
  const title = [
    image.alt,
    document.title,
    pinLink
  ].filter(Boolean).join(" | ").slice(0, 120);

  // currentSrc is what the browser actually loaded, so it is the most reliable of
  // the three. The srcset pick usually beats it on resolution, so try that first
  // and keep the rest as fallbacks.
  const urls = [
    getLargestSrcsetUrl(image.getAttribute("srcset")),
    image.currentSrc,
    image.src
  ].filter(Boolean);

  return {
    url: urls[0],
    urls: [...new Set(urls)],
    title,
    // Miro scales to the configured height, so the aspect ratio is what decides how
    // wide the item lands — and therefore where the next one can start.
    naturalWidth: image.naturalWidth || 0,
    naturalHeight: image.naturalHeight || 0,
    pageUrl: location.href,
    sourceLink: pinLink
  };
}

// Splitting srcset on "," corrupts URLs that themselves contain commas (Cloudinary
// transforms, for example). Per the HTML spec a candidate is a non-whitespace URL run
// followed by optional descriptors, terminated by a comma.
function getLargestSrcsetUrl(srcset) {
  if (!srcset) {
    return "";
  }

  const candidates = [];
  let index = 0;

  while (index < srcset.length) {
    while (index < srcset.length && /[\s,]/.test(srcset[index])) {
      index += 1;
    }
    if (index >= srcset.length) {
      break;
    }

    const start = index;
    while (index < srcset.length && !/\s/.test(srcset[index])) {
      index += 1;
    }

    const url = srcset.slice(start, index).replace(/,+$/, "");

    let descriptor = "";
    while (index < srcset.length && srcset[index] !== ",") {
      descriptor += srcset[index];
      index += 1;
    }
    index += 1;

    if (url) {
      const match = descriptor.match(/(\d+(?:\.\d+)?)\s*([wx])/);
      const value = match ? Number.parseFloat(match[1]) : 0;
      candidates.push({ url, score: match?.[2] === "x" ? value * 1000 : value });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}
