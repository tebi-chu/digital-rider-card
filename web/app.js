(() => {
  "use strict";

  const config = window.DIGITAL_CARD_CONFIG || {};
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const profileId = sanitizeId(params.get("id") || location.hash.slice(1) || config.defaultProfileId || "chutatsu");
  const tokenKey = `digital-card-token:${profileId}`;
  const socialLabels = { instagram:"Instagram", threads:"Threads", x:"X", youtube:"YouTube", tiktok:"TikTok", minkara:"みんカラ", facebook:"Facebook", line:"LINE" };

  function sanitizeId(value) {
    const id = String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    return id || "chutatsu";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value), location.href);
      return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "#";
    } catch { return "#"; }
  }

  function imageUrl(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    try {
      const url = new URL(source, location.href);
      if (url.hostname === "drive.google.com") {
        const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
        const id = url.searchParams.get("id") || fileMatch?.[1];
        if (id && /^[a-zA-Z0-9_-]+$/.test(id)) {
          return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
        }
      }
      // ChatGPT Sites固有の画像はGitHub Pagesから取得できないため、壊れた画像を表示しない。
      if (url.origin === location.origin && url.pathname.startsWith("/api/assets/")) return "";
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  async function api(action, extra = {}) {
    if (!config.apiUrl) throw new Error("API URLが設定されていません。");
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, slug: profileId, ...extra }),
      redirect: "follow",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "データを取得できませんでした。");
    return data;
  }

  function readToken() {
    try {
      const saved = JSON.parse(localStorage.getItem(tokenKey) || "null");
      if (!saved?.token || saved.expiresAt <= Date.now()) { localStorage.removeItem(tokenKey); return ""; }
      return saved.token;
    } catch { return ""; }
  }

  function saveToken(token, expiresAt) {
    localStorage.setItem(tokenKey, JSON.stringify({ token, expiresAt }));
  }

  function renderError(message) {
    app.innerHTML = `<section class="state-card error"><p class="brand">DIGITAL RIDER CARD</p><h1>表示できませんでした</h1><p>${escapeHtml(message)}</p><button id="retry">もう一度試す</button></section>`;
    document.getElementById("retry")?.addEventListener("click", start);
  }

  function renderPin() {
    app.innerHTML = `<section class="pin-card" aria-labelledby="pin-title">
      <p class="brand">DIGITAL RIDER CARD</p><div class="pin-mark" aria-hidden="true">PIN</div>
      <h1 id="pin-title">4桁のPINコードを入力してください</h1>
      <p>セキュリティ保護のため、PINコードによる認証が必要です。</p>
      <p class="owner-note"><strong>PINコードはデジタル名刺の所有者ご本人が入力してください。</strong></p>
      <p>閲覧される方ではなく、所有者ご本人が周囲に見られないよう入力し、認証後にデジタル名刺をご覧ください。</p>
      <form id="pin-form"><label for="pin">PINコード</label><input id="pin" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" required><p id="pin-error" class="form-error" role="alert"></p><button type="submit">認証して名刺を表示</button></form>
      <small>認証情報はこのブラウザ内に保存され、有効期限後に無効になります。</small>
    </section>`;
    const form = document.getElementById("pin-form");
    const input = document.getElementById("pin");
    input.focus();
    input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 4); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      const error = document.getElementById("pin-error");
      if (!/^\d{4}$/.test(input.value)) { error.textContent = "半角数字4桁で入力してください。"; return; }
      button.disabled = true; button.textContent = "認証中…"; error.textContent = "";
      try {
        const clientId = getClientId();
        const result = await api("verifyPin", { pin: input.value, clientId });
        saveToken(result.token, result.expiresAt);
        await loadProfile(result.token);
      } catch (err) {
        error.textContent = err.message; input.value = ""; input.focus();
        button.disabled = false; button.textContent = "認証して名刺を表示";
      }
    });
  }

  function getClientId() {
    const key = "digital-card-client-id";
    let value = localStorage.getItem(key);
    if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
    return value;
  }

  function lines(value) { return escapeHtml(value).replace(/\r?\n/g, "<br>"); }

  function renderCard(profile) {
    const accent = /^#[0-9a-f]{6}$/i.test(profile.accentColor || "") ? profile.accentColor : "#d9a514";
    const backgroundImage = imageUrl(profile.backgroundUrl);
    const heroImage = imageUrl(profile.heroUrl);
    const avatarImage = imageUrl(profile.avatarUrl);
    const bikeImage = imageUrl(profile.bikePhotoUrl);
    const background = backgroundImage ? `url('${backgroundImage}')` : (profile.gradient || "linear-gradient(145deg,#090b10,#162b35,#933f23)");
    document.title = `Digital Rider Card | ${profile.reading || profile.name || "Rider"}`;
    const socials = (profile.socials || []).map((social) => `<a href="${safeUrl(social.url)}" target="_blank" rel="noopener noreferrer">${window.DRC_ICON(social.kind === "minkara" ? "motorcycle" : social.kind, "social-icon")}<span><small>${escapeHtml(socialLabels[social.kind] || social.kind)}</small>${escapeHtml(social.handle)}</span></a>`).join("");
    const websites = (profile.websites || []).map((site) => `<a href="${safeUrl(site.url)}" target="_blank" rel="noopener noreferrer"><span class="link-icon">↗</span><span><small>WEB ADDRESS</small>${escapeHtml(site.label)}</span><b>›</b></a>`).join("");
    const phoneHref = String(profile.phone || "").replace(/[^+\d]/g, "");
    const contacts = [
      profile.phone ? `<a href="${safeUrl(`tel:${phoneHref}`)}">${window.DRC_ICON("phone", "contact-icon")}<span><small>PHONE</small>${escapeHtml(profile.phone)}</span><b>›</b></a>` : "",
      profile.email ? `<a href="${safeUrl(`mailto:${profile.email}`)}">${window.DRC_ICON("email", "contact-icon")}<span><small>EMAIL</small>${escapeHtml(profile.email)}</span><b>›</b></a>` : "",
    ].join("");
    app.innerHTML = `<div class="profile-page" style="--accent:${accent};background-image:${background}"><div class="ambient"></div><article class="card-shell">
      <header class="hero" style="${heroImage ? `background-image:url('${heroImage}')` : ""}"><div class="hero-shade"></div><button class="share-button" id="share" aria-label="共有">↗</button><div class="identity">${avatarImage ? `<img class="avatar" src="${avatarImage}" alt="${escapeHtml(profile.name)}">` : `<div class="avatar fallback">${escapeHtml((profile.name || "R").slice(0,1))}</div>`}<div><p class="eyebrow">${escapeHtml(profile.tagline || "DIGITAL RIDER CARD")}</p><h1>${escapeHtml(profile.name)}</h1>${profile.reading ? `<p class="reading">${escapeHtml(profile.reading)}</p>` : ""}</div></div></header>
      <div class="content"><section class="profile-summary"><div class="summary-copy"><p class="tagline">${escapeHtml(profile.tagline || "RIDE. CONNECT. CREATE.")}</p><div class="occupation">${window.DRC_ICON("motorcycle", "bike-symbol")}<div>${profile.organization ? `<strong>${escapeHtml(profile.organization)}</strong>` : ""}${profile.role ? `<span>${escapeHtml(profile.role)}</span>` : ""}${profile.currentBike ? `<span>${escapeHtml(profile.currentBike)}</span>` : ""}</div></div></div>${bikeImage ? `<img class="bike-photo" src="${bikeImage}" alt="愛車">` : ""}</section>
      ${profile.message ? `<p class="personal-message">${lines(profile.message)}</p>` : ""}${profile.pastBikes || profile.rallyHistory ? `<div class="ride-history">${profile.pastBikes ? `<p><small>PAST BIKES</small><span>${lines(profile.pastBikes)}</span></p>` : ""}${profile.rallyHistory ? `<p><small>TOURING RALLY</small><span>${lines(profile.rallyHistory)}</span></p>` : ""}</div>` : ""}
      <button class="save-button" id="vcard"><span>＋</span><span>連絡先に追加</span><small>vCard</small></button>
      ${contacts || websites ? `<section class="link-section"><div class="section-heading"><span>01</span><h2>CONTACT</h2></div><div class="link-list">${contacts}${websites}</div></section>` : ""}
      ${socials ? `<section class="link-section"><div class="section-heading"><span>02</span><h2>SOCIAL</h2></div><div class="social-grid">${socials}</div></section>` : ""}
      <footer><span>◆</span> DIGITAL RIDER CARD</footer></div></article></div>`;
    document.getElementById("share")?.addEventListener("click", shareCard);
    document.getElementById("vcard")?.addEventListener("click", () => downloadVCard(profile));
  }

  async function shareCard() {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: document.title, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); alert("URLをコピーしました。"); }
  }

  function v(value) { return String(value || "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n"); }
  function downloadVCard(profile) {
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${v(profile.name)}`];
    if (profile.organization) lines.push(`ORG:${v(profile.organization)}`);
    if (profile.role) lines.push(`TITLE:${v(profile.role)}`);
    if (profile.phone) lines.push(`TEL;TYPE=CELL:${v(profile.phone)}`);
    if (profile.email) lines.push(`EMAIL:${v(profile.email)}`);
    if (profile.websites?.[0]?.url) lines.push(`URL:${v(profile.websites[0].url)}`);
    lines.push("END:VCARD");
    const blob = new Blob([lines.join("\r\n")], { type:"text/vcard;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${profileId}.vcf`; link.click(); URL.revokeObjectURL(link.href);
  }

  async function loadProfile(token = "") {
    const result = await api("getProfile", { token });
    renderCard(result.profile);
  }

  async function start() {
    app.innerHTML = `<section class="state-card"><span class="loader" aria-hidden="true"></span><p>DigitalCardを読み込んでいます…</p></section>`;
    try {
      const status = await api("status");
      if (!status.exists) throw new Error("指定されたDigitalCardが見つかりません。");
      if (!status.pinRequired) return await loadProfile();
      const token = readToken();
      if (token) { try { return await loadProfile(token); } catch { localStorage.removeItem(tokenKey); } }
      renderPin();
    } catch (err) { renderError(err.message); }
  }

  start();
})();
