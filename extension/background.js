const STORAGE_KEY = "abvx_shortener_config_v2";
const LAST_SHORT_KEY = "abvx_shortener_last_short";

const DEFAULT_STATE = {
  apiBaseUrl: "https://go.abvx.xyz",
  apiKey: "",
  apiKeyId: "",
  customSlug: "",
  overwrite: false,
  ttl: "",
  history: [],
};

function getStorageConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, LAST_SHORT_KEY], (data) => {
      resolve({
        ...(DEFAULT_STATE),
        ...(data[STORAGE_KEY] || {}),
        lastShort: data[LAST_SHORT_KEY] || null,
      });
    });
  });
}

function setLastShort(url) {
  return new Promise((resolve) => chrome.storage.local.set({ [LAST_SHORT_KEY]: { url, createdAt: Date.now() } }, resolve));
}

function ensureBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULT_STATE.apiBaseUrl).replace(/\/$/, ""));
  if (parsed.protocol !== "https:") throw new Error("Shortener endpoint must be https://");
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

async function buildPayload(url, state) {
  const payload = { url };
  if (state.customSlug) payload.customSlug = state.customSlug;
  if (state.overwrite) payload.overwrite = true;
  if (state.ttl) {
    const ttl = Number(state.ttl);
    if (Number.isFinite(ttl) && ttl > 0) {
      payload.ttl = ttl;
    }
  }
  return payload;
}

async function callShorten(targetUrl) {
  const state = await getStorageConfig();
  if (!state.apiKey) {
    throw new Error("API key is required");
  }

  const payload = await buildPayload(targetUrl, state);
  const response = await fetch(`${ensureBaseUrl(state.apiBaseUrl)}/api/shorten`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": state.apiKey,
      ...(state.apiKeyId ? { "X-API-Key-Id": state.apiKeyId } : {}),
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const details = data?.details ? ` (${JSON.stringify(data.details)})` : "";
    throw new Error(`Shorten failed: ${data?.message || response.statusText}${details}`);
  }

  if (!data.shortUrl) {
    throw new Error("Invalid response from shortener");
  }

  await setLastShort(data.shortUrl);
  await chrome.storage.local.set({ [LAST_SHORT_KEY]: { url: data.shortUrl, createdAt: Date.now(), targetUrl } });
  return data;
}

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "abvx-shorten-page",
      title: "Shorten this page",
      contexts: ["page", "page_action", "tab"],
    });

    chrome.contextMenus.create({
      id: "abvx-shorten-link",
      title: "Shorten this link",
      contexts: ["link"],
      targetUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createMenu();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const target = info.linkUrl || info.pageUrl || tab?.url;
    const finalUrl = (info.selectionText || "").match(/https?:\/\//) ? info.selectionText : target;
    if (!finalUrl) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "ABVX Shortener",
        message: "No URL to shorten",
      });
      return;
    }

    await callShorten(finalUrl);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ABVX Shortener",
      message: "Link shortened successfully",
    });
  } catch (error) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ABVX Shortener",
      message: error instanceof Error ? error.message : "Shortening failed",
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "abvx-quick-shorten") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    await callShorten(tab.url);
    return;
  }

  if (command === "abvx-open-last-short") {
    const state = await getStorageConfig();
    if (state.lastShort?.url) {
      await chrome.tabs.create({ url: state.lastShort.url, active: true });
    }
  }
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const candidate = text.trim();
  if (!candidate) return;
  const withScheme = /^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`;
  const result = await callShorten(withScheme);
  await chrome.tabs.update({ url: result.shortUrl });
});
