const DEFAULT_STATE = {
  apiBaseUrl: "https://go.abvx.xyz",
  apiKey: "",
  apiKeyId: "",
  customSlug: "",
  overwrite: false,
  ttl: "",
  history: [],
};

const HISTORY_LIMIT = 20;
const STORAGE_KEY = "abvx_shortener_config_v2";
const HISTORY_KEY = "abvx_shortener_history_v2";
const LAST_SHORT_KEY = "abvx_shortener_last_short";

const $ = (id) => document.getElementById(id);
const nodes = {
  form: $("shortenForm"),
  apiBaseUrl: $("apiBaseUrl"),
  apiKey: $("apiKey"),
  apiKeyId: $("apiKeyId"),
  customSlug: $("customSlug"),
  overwrite: $("overwrite"),
  ttl: $("ttl"),
  urlInput: $("url"),
  shortenBtn: $("shortenBtn"),
  retryBtn: $("retryBtn"),
  copyBtn: $("copyBtn"),
  openBtn: $("openBtn"),
  openLastBtn: $("openLastBtn"),
  status: $("status"),
  previewWrap: $("previewWrap"),
  shortUrl: $("shortUrl"),
  resultMeta: $("resultMeta"),
  history: $("history"),
};

function setStatus(message, isError = false) {
  nodes.status.textContent = message;
  nodes.status.style.display = message ? "block" : "none";
  nodes.status.style.color = isError ? "#ffb4b4" : "#9df3b8";
}

function getStateFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, HISTORY_KEY, LAST_SHORT_KEY], (data) => {
      resolve({
        config: { ...DEFAULT_STATE, ...data[STORAGE_KEY], history: [], apiKey: data[STORAGE_KEY]?.apiKey || "" },
        history: data[HISTORY_KEY] || [],
        lastShort: data[LAST_SHORT_KEY] || null,
      });
    });
  });
}

function persistConfig(config) {
  return new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve));
}

function persistHistory(history) {
  return new Promise((resolve) => chrome.storage.local.set({ [HISTORY_KEY]: history }, resolve));
}

function shortHistory(history) {
  return [...history].slice(-HISTORY_LIMIT).reverse();
}

function renderHistory(history) {
  nodes.history.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No history yet.";
    nodes.history.append(empty);
    return;
  }

  history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const anchor = document.createElement("a");
    anchor.href = item.shortUrl;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = item.shortUrl;
    const target = document.createElement("div");
    target.className = "muted";
    target.textContent = `→ ${item.target}`;
    const created = document.createElement("div");
    created.className = "muted";
    created.textContent = new Date(item.createdAt).toLocaleString();
    row.append(anchor, target, created);
    row.addEventListener("click", (event) => {
      if (event.target && event.target.tagName === "A") return;
      openLink(item.shortUrl);
    });
    nodes.history.append(row);
  });
}

function fillForm(config) {
  nodes.apiBaseUrl.value = config.apiBaseUrl || DEFAULT_STATE.apiBaseUrl;
  nodes.apiKey.value = config.apiKey || "";
  nodes.apiKeyId.value = config.apiKeyId || "";
  nodes.customSlug.value = config.customSlug || "";
  nodes.overwrite.checked = Boolean(config.overwrite);
  nodes.ttl.value = String(config.ttl || "");
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.url || "";
}

function isHttps(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeApiBase(raw) {
  const trimmed = String(raw || "").trim().replace(/\/$/, "");
  if (!isHttps(trimmed)) {
    throw new Error("Shortener endpoint must be https://");
  }
  return trimmed;
}

async function ensureEndpointPermission(apiBaseUrl) {
  const origin = `${new URL(apiBaseUrl).origin}/*`;
  if (origin === "https://go.abvx.xyz/*") return;
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (granted) return;
  const approved = await chrome.permissions.request({ origins: [origin] });
  if (!approved) throw new Error("Permission to access this endpoint was not granted");
}

function buildShortenPayload(url, state) {
  const payload = { url };

  if (state.customSlug) payload.customSlug = state.customSlug;
  if (state.overwrite) payload.overwrite = true;
  if (state.ttl) {
    const ttl = Number(state.ttl);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new Error("TTL must be a positive number");
    }
    payload.ttl = ttl;
  }

  return payload;
}

function normalizeResponse(data) {
  return {
    shortUrl: data.shortUrl,
    created: data.created,
    alreadyExisted: Boolean(data.alreadyExisted),
    slug: data.slug,
    url: data.url,
    requestId: data.requestId,
  };
}

async function callShorten(state) {
  const payload = buildShortenPayload(nodes.urlInput.value.trim(), state);
  const res = await fetch(`${state.apiBaseUrl}/api/shorten`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": state.apiKey,
      ...(state.apiKeyId ? { "X-API-Key-Id": state.apiKeyId } : {}),
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const details = data?.details ? ` (${JSON.stringify(data.details)})` : "";
    throw new Error(`HTTP ${res.status}: ${data?.message || "request failed"}${details}`);
  }

  return normalizeResponse(data);
}

function updateOpenLastButton(lastShort) {
  if (!nodes.openLastBtn) return;
  nodes.openLastButtonState = Boolean(lastShort?.url);
  nodes.openLastBtn.disabled = !nodes.openLastButtonState;
}

function openLink(url) {
  if (!url) return;
  chrome.tabs.create({ url, active: true });
}

function showResult(response) {
  nodes.previewWrap.style.display = "block";
  nodes.shortUrl.textContent = response.shortUrl;
  nodes.shortUrl.href = response.shortUrl;

  nodes.resultMeta.textContent = response.created
    ? `created slug / requestId: ${response.requestId || "n/a"}`
    : `reused existing link / requestId: ${response.requestId || "n/a"}`;

  nodes.copyBtn.disabled = false;
  nodes.openBtn.disabled = false;
}

async function addToHistory(state, response) {
  const history = shortHistory([
    {
      shortUrl: response.shortUrl,
      target: state.url,
      createdAt: Date.now(),
    },
    ...(state.history || []),
  ]);

  const next = history.slice(0, HISTORY_LIMIT);
  state.history = next;
  await persistHistory(next);
  renderHistory(next);
  await chrome.storage.local.set({ [LAST_SHORT_KEY]: { url: response.shortUrl, createdAt: Date.now(), target: state.url } });
  updateOpenLastButton({ url: response.shortUrl });
}

async function refreshShortenerBase() {
  const { config, history, lastShort } = await getStateFromStorage();
  config.history = history;
  fillForm(config);
  if (history.length) {
    renderHistory(shortHistory(history));
  } else {
    renderHistory([]);
  }

  const activeTabUrl = await getActiveTabUrl();
  if (activeTabUrl) {
    nodes.urlInput.value = activeTabUrl;
  }

  updateOpenLastButton(lastShort);
}

nodes.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("", false);
  nodes.shortenerLoading = true;
  nodes.shortenBtn.disabled = true;

  try {
    const config = {
      apiBaseUrl: normalizeApiBase(nodes.apiBaseUrl.value),
      apiKey: nodes.apiKey.value.trim(),
      apiKeyId: nodes.apiKeyId.value.trim(),
      customSlug: nodes.customSlug.value.trim(),
      overwrite: Boolean(nodes.overwrite.checked),
      ttl: nodes.ttl.value.trim(),
      history: [],
    };

    if (!config.apiKey) {
      throw new Error("API key is required");
    }

    await ensureEndpointPermission(config.apiBaseUrl);

    const targetUrl = nodes.urlInput.value.trim();
    if (!targetUrl) {
      throw new Error("Tab URL is empty");
    }

    await persistConfig(config);
    const { history: previousHistory = [] } = await getStateFromStorage();
    config.history = previousHistory;

    const result = await callShorten(config);
    nodes.urlInput.value = targetUrl;
    showResult(result);

    await addToHistory(
      { ...config, url: targetUrl },
      result,
    );

    setStatus("Ready", false);
    nodes.shortenBtn.textContent = "Shorten & Copy";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    nodes.previewWrap.style.display = "none";
  } finally {
    nodes.shortenBtn.disabled = false;
    nodes.shortenBtn.textContent = "Shorten & Copy";
    nodes.shortenerLoading = false;
  }
});

nodes.copyBtn.addEventListener("click", async () => {
  if (!nodes.shortUrl.href) return;
  try {
    await navigator.clipboard.writeText(nodes.shortUrl.href);
    setStatus("Copied.");
  } catch (error) {
    setStatus("Copy failed", true);
  }
});

nodes.openBtn.addEventListener("click", () => {
  if (!nodes.shortUrl.href) return;
  openLink(nodes.shortUrl.href);
});

nodes.openLastBtn.addEventListener("click", async () => {
  const { lastShort } = await getStateFromStorage();
  if (!lastShort?.url) return;
  openLink(lastShort.url);
});

nodes.retryBtn.addEventListener("click", () => {
  nodes.form.requestSubmit();
});

refreshShortenerBase().catch(() => {
  setStatus("Failed to load extension config", true);
});
