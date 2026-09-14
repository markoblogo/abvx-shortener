export const LANDING_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Shorten links on your own domain with a private Cloudflare Worker." />
    <meta property="og:title" content="ABVX Shortener" />
    <meta property="og:description" content="Your domain. Deterministic short links. No tracking by default." />
    <title>ABVX Shortener — links on your domain</title>
    <style>
      :root { color-scheme:dark; --bg:#080b0f; --panel:#10151c; --line:#273140; --text:#f3f7fb; --muted:#95a2b3; --mint:#66f0c2; --blue:#7ca8ff; --danger:#ff9494; }
      * { box-sizing:border-box; }
      body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 15% 0%,#12352f 0,transparent 34rem),radial-gradient(circle at 90% 20%,#17274a 0,transparent 38rem),var(--bg); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      a { color:inherit; }
      .shell { width:min(1080px,calc(100% - 32px)); margin:auto; padding:28px 0 56px; }
      header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:64px; }
      .brand { display:flex; align-items:center; gap:12px; font-weight:750; letter-spacing:.01em; text-decoration:none; }
      .mark { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; color:#08100e; background:linear-gradient(135deg,var(--mint),var(--blue)); font-size:20px; }
      nav { display:flex; gap:18px; color:var(--muted); font-size:14px; }
      nav a:hover { color:var(--text); }
      main { display:grid; grid-template-columns:minmax(0,1fr) minmax(340px,470px); gap:64px; align-items:center; }
      .eyebrow { color:var(--mint); font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; }
      h1 { max-width:700px; margin:18px 0; font-size:clamp(42px,7vw,76px); line-height:.98; letter-spacing:-.055em; }
      .lede { max-width:610px; color:var(--muted); font-size:18px; }
      .proof { display:flex; flex-wrap:wrap; gap:10px; margin-top:28px; }
      .chip { border:1px solid var(--line); border-radius:999px; padding:7px 11px; color:#c3ccd8; background:#0c1117; font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
      .card { border:1px solid var(--line); border-radius:22px; padding:24px; background:linear-gradient(180deg,rgba(21,28,37,.97),rgba(12,17,23,.97)); box-shadow:0 30px 80px rgba(0,0,0,.38); }
      .card h2 { margin:0 0 4px; font-size:20px; }
      .card-intro { margin:0 0 22px; color:var(--muted); font-size:13px; }
      label { display:block; margin:14px 0 6px; color:#c9d1dc; font-size:13px; }
      input { width:100%; border:1px solid var(--line); border-radius:12px; padding:12px 13px; color:var(--text); background:#090d12; font:inherit; outline:none; }
      input:focus { border-color:var(--mint); box-shadow:0 0 0 3px rgba(102,240,194,.12); }
      .columns { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      details { margin-top:8px; }
      summary { cursor:pointer; color:var(--muted); font-size:13px; }
      .remember { display:flex; align-items:center; gap:8px; margin:14px 0; color:var(--muted); }
      .remember input { width:auto; accent-color:var(--mint); }
      button { width:100%; border:0; border-radius:12px; padding:13px 16px; color:#07110e; background:linear-gradient(100deg,var(--mint),var(--blue)); font:750 15px/1.2 inherit; cursor:pointer; }
      button:disabled { cursor:wait; opacity:.65; }
      .status { min-height:22px; margin:12px 0 0; color:var(--muted); font-size:13px; }
      .status.error { color:var(--danger); }
      .result { display:none; gap:10px; margin-top:12px; padding:12px; border:1px solid #315647; border-radius:12px; background:#0b1c17; }
      .result.visible { display:grid; grid-template-columns:1fr auto; align-items:center; }
      .result a { overflow:hidden; color:var(--mint); text-overflow:ellipsis; white-space:nowrap; }
      .result button { width:auto; padding:9px 12px; font-size:13px; }
      .privacy { margin:14px 0 0; color:var(--muted); font-size:12px; }
      .features { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:72px; }
      .feature { padding:20px; border-top:1px solid var(--line); }
      .feature strong { display:block; margin-bottom:7px; }
      .feature p { margin:0; color:var(--muted); font-size:14px; }
      footer { display:flex; justify-content:space-between; gap:18px; margin-top:54px; padding-top:22px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
      @media (max-width:820px) { header { margin-bottom:38px; } main { grid-template-columns:1fr; gap:38px; } h1 { font-size:clamp(44px,13vw,68px); } .features { grid-template-columns:1fr; margin-top:48px; } .feature { padding:16px 0; } }
      @media (max-width:500px) { nav { display:none; } .shell { width:min(100% - 22px,1080px); padding-top:18px; } .card { padding:18px; } .columns { grid-template-columns:1fr; gap:0; } footer { flex-direction:column; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <a class="brand" href="/"><span class="mark" aria-hidden="true">↗</span><span>ABVX Shortener</span></a>
        <nav aria-label="Project links"><a href="/health">Health</a><a href="https://github.com/markoblogo/abvx-shortener">GitHub</a></nav>
      </header>
      <main>
        <section>
          <div class="eyebrow">Self-hosted · Cloudflare Workers</div>
          <h1>Your links.<br />Your domain.</h1>
          <p class="lede">Create deterministic short links without handing your audience or clickstream to another platform. API, CLI and Chrome extension included.</p>
          <div class="proof" aria-label="Product attributes"><span class="chip">NO THIRD-PARTY TRACKING</span><span class="chip">DETERMINISTIC SLUGS</span><span class="chip">MIT LICENSED</span></div>
        </section>
        <section class="card" aria-labelledby="form-title">
          <h2 id="form-title">Shorten a link</h2>
          <p class="card-intro">The API key stays in this browser session unless you choose to remember it.</p>
          <form id="shorten-form">
            <label for="url">Destination URL</label>
            <input id="url" name="url" type="url" inputmode="url" placeholder="https://example.com/long/path" required autocomplete="url" />
            <label for="api-key">API key</label>
            <input id="api-key" name="apiKey" type="password" required autocomplete="off" />
            <details>
              <summary>Optional link settings</summary>
              <div class="columns">
                <div><label for="slug">Custom alias</label><input id="slug" name="customSlug" pattern="[A-Za-z0-9_-]{3,64}" placeholder="launch" /></div>
                <div><label for="ttl">Expires in seconds</label><input id="ttl" name="ttl" type="number" min="1" max="31536000" placeholder="86400" /></div>
              </div>
            </details>
            <label class="remember"><input id="remember" type="checkbox" /> Remember the API key on this device</label>
            <button id="submit" type="submit">Shorten and copy</button>
          </form>
          <div id="status" class="status" role="status" aria-live="polite"></div>
          <div id="result" class="result"><a id="short-url" href="#" target="_blank" rel="noreferrer"></a><button id="copy" type="button">Copy</button></div>
          <p class="privacy">This page has no analytics. Self-hosters can point the extension and CLI at their own endpoint.</p>
        </section>
      </main>
      <section class="features" aria-label="Capabilities">
        <article class="feature"><strong>Predictable</strong><p>The same normalized URL returns the same short link. Custom aliases and expiry are optional.</p></article>
        <article class="feature"><strong>Controllable</strong><p>List, update, disable and export links through authenticated management endpoints.</p></article>
        <article class="feature"><strong>Portable</strong><p>One Worker, one KV namespace and documented migration tools. Your domain remains the durable interface.</p></article>
      </section>
      <footer><span>ABVX Shortener v0.4.0</span><span>Cloudflare Workers + KV · MIT</span></footer>
    </div>
    <script>
      (() => {
        const form = document.querySelector("#shorten-form");
        const keyInput = document.querySelector("#api-key");
        const remember = document.querySelector("#remember");
        const submit = document.querySelector("#submit");
        const status = document.querySelector("#status");
        const result = document.querySelector("#result");
        const shortUrl = document.querySelector("#short-url");
        const copy = document.querySelector("#copy");
        const storageKey = "abvx-shortener-api-key";
        keyInput.value = sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey) || "";
        remember.checked = Boolean(localStorage.getItem(storageKey));
        function show(message, error) { status.textContent = message; status.classList.toggle("error", Boolean(error)); }
        async function copyResult() { if (!shortUrl.href) return; await navigator.clipboard.writeText(shortUrl.href); show("Copied to clipboard.", false); }
        copy.addEventListener("click", () => copyResult().catch(() => show("Copy failed. Open the link and copy it manually.", true)));
        form.addEventListener("submit", async (event) => {
          event.preventDefault(); result.classList.remove("visible"); submit.disabled = true; show("Creating link…", false);
          const data = new FormData(form); const apiKey = String(data.get("apiKey") || "").trim();
          const payload = { url: String(data.get("url") || "").trim() };
          const customSlug = String(data.get("customSlug") || "").trim(); const ttl = String(data.get("ttl") || "").trim();
          if (customSlug) payload.customSlug = customSlug; if (ttl) payload.ttl = Number(ttl);
          sessionStorage.setItem(storageKey, apiKey); if (remember.checked) localStorage.setItem(storageKey, apiKey); else localStorage.removeItem(storageKey);
          try {
            const response = await fetch("/api/shorten", { method:"POST", headers:{ "content-type":"application/json", "X-API-Key":apiKey }, body:JSON.stringify(payload) });
            const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || "Request failed with HTTP " + response.status);
            const parsed = new URL(body.shortUrl); if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("The service returned an invalid short URL");
            shortUrl.href = parsed.href; shortUrl.textContent = parsed.href; result.classList.add("visible");
            try { await copyResult(); } catch { show("Link ready. Use Copy if clipboard access is unavailable.", false); }
          } catch (error) { show(error instanceof Error ? error.message : "Could not create the link.", true); } finally { submit.disabled = false; }
        });
      })();
    </script>
  </body>
</html>`;
