(() => {
  "use strict";

  const config = window.DIGITAL_CARD_CONFIG || {};
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const profileId = sanitizeId(params.get("id") || location.hash.slice(1) || config.defaultProfileId || "chutatsu");
  const tokenKey = `digital-card-token:${profileId}`;
  const profileCacheKey = `digital-card-profile:${profileId}`;
  const PROFILE_CACHE_MS = 24 * 60 * 60 * 1000;
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

  function readCachedProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(profileCacheKey) || "null");
      if (!saved?.profile || saved.cachedAt + PROFILE_CACHE_MS <= Date.now()) {
        localStorage.removeItem(profileCacheKey);
        return null;
      }
      return saved.profile;
    } catch { return null; }
  }

  function saveCachedProfile(profile) {
    try { localStorage.setItem(profileCacheKey, JSON.stringify({ profile, cachedAt: Date.now() })); } catch {}
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
    const websites = (profile.websites || []).map((site) => `<a href="${safeUrl(site.url)}" target="_blank" rel="noopener noreferrer">${window.DRC_ICON("globe", "contact-icon")}<span><small>WEB ADDRESS</small>${escapeHtml(site.label)}</span><b>›</b></a>`).join("");
    const phoneHref = String(profile.phone || "").replace(/[^+\d]/g, "");
    const contacts = [
      profile.phone ? `<a href="${safeUrl(`tel:${phoneHref}`)}">${window.DRC_ICON("phone", "contact-icon")}<span><small>PHONE</small>${escapeHtml(profile.phone)}</span><b>›</b></a>` : "",
      profile.email ? `<a href="${safeUrl(`mailto:${profile.email}`)}">${window.DRC_ICON("email", "contact-icon")}<span><small>EMAIL</small>${escapeHtml(profile.email)}</span><b>›</b></a>` : "",
    ].join("");
    app.innerHTML = `<div class="profile-page" style="--accent:${accent};background-image:${background}"><div class="ambient"></div><article class="card-shell">
      <header class="hero" style="${heroImage ? `background-image:url('${heroImage}')` : ""}"><div class="hero-shade"></div><button class="share-button" id="share" aria-label="共有">↗</button><div class="identity">${avatarImage ? `<img class="avatar" src="${avatarImage}" alt="${escapeHtml(profile.name)}">` : `<div class="avatar fallback">${escapeHtml((profile.name || "R").slice(0,1))}</div>`}<div><p class="eyebrow">${escapeHtml(profile.tagline || "DIGITAL RIDER CARD")}</p><h1>${escapeHtml(profile.name)}</h1>${profile.reading ? `<p class="reading">${escapeHtml(profile.reading)}</p>` : ""}</div></div></header>
      <div class="content"><section class="profile-summary"><div class="summary-copy"><p class="tagline">DIGITAL RIDER CARD</p><div class="occupation">${window.DRC_ICON("motorcycle", "bike-symbol")}<div>${profile.organization ? `<strong>${escapeHtml(profile.organization)}</strong>` : ""}${profile.role ? `<span>${escapeHtml(profile.role)}</span>` : ""}${profile.currentBike ? `<span>${escapeHtml(profile.currentBike)}</span>` : ""}</div></div></div>${bikeImage ? `<img class="bike-photo" src="${bikeImage}" alt="愛車">` : ""}</section>
      ${profile.message ? `<p class="personal-message">${lines(profile.message)}</p>` : ""}${profile.pastBikes || profile.rallyHistory ? `<div class="ride-history">${profile.pastBikes ? `<p><small>PAST BIKES</small><span>${lines(profile.pastBikes)}</span></p>` : ""}${profile.rallyHistory ? `<p><small>TOURING RALLY</small><span>${lines(profile.rallyHistory)}</span></p>` : ""}</div>` : ""}
      <button class="save-button" id="vcard"><span>＋</span><span>連絡先に追加</span><small>vCard</small></button>
      ${contacts || websites ? `<section class="link-section"><div class="section-heading"><span>01</span><h2>CONTACT</h2></div><div class="link-list">${contacts}${websites}</div></section>` : ""}
      ${socials ? `<section class="link-section"><div class="section-heading"><span>02</span><h2>FOLLOW THE RIDE</h2></div><div class="social-grid">${socials}</div></section>` : ""}
      <footer>${window.DRC_ICON("motorcycle", "footer-bike-icon")}<span>Built for people who live to ride.</span></footer></div></article></div>`;
    document.getElementById("share")?.addEventListener("click", shareCard);
    document.getElementById("vcard")?.addEventListener("click", () => downloadVCard(profile));
  }

  async function shareCard() {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: document.title, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); alert("URLをコピーしました。"); }
  }

  function v(value) { return String(value || "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n"); }
  function vParam(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " "); }
  function foldVCardLine(line) {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    for (let offset = 75; offset < line.length; offset += 74) parts.push(` ${line.slice(offset, offset + 74)}`);
    return parts.join("\r\n");
  }

  async function imageForVCard(source) {
    const response = await fetch(source);
    if (!response.ok) throw new Error("連絡先画像を取得できませんでした。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = String(response.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
    let type = vCardImageType(mime);
    if (!type && bytes[0] === 0xff && bytes[1] === 0xd8) type = "JPEG";
    if (!type && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) type = "PNG";
    if (!type && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) type = "GIF";
    if (!type) throw new Error("電話帳が対応していない画像形式です。");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { type, base64: btoa(binary) };
  }

  function vCardImageType(mime) {
    return ({ "image/jpeg":"JPEG", "image/jpg":"JPEG", "image/png":"PNG", "image/gif":"GIF" })[String(mime || "").split(";")[0].toLowerCase()] || "";
  }

  async function contactPhoto(profile) {
    const avatar = imageUrl(profile.avatarUrl);
    if (avatar) {
      try {
        const result = await api("getContactPhoto", { token: readToken() });
        const type = vCardImageType(result.photo?.mimeType);
        if (type && result.photo?.base64) return { type, base64: result.photo.base64 };
      } catch {}
      try { return await imageForVCard(avatar); }
      catch { return { uri: avatar }; }
    }
    return imageForVCard(new URL("./phone-icon.png", location.href));
  }

  async function downloadVCard(profile) {
    const name = v(profile.name);
    // FNだけでは氏名を取り込まない端末があるため、構造化氏名のNにも基本情報の名前を設定する。
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${name};;;;`, `FN:${name}`];
    if (profile.organization) lines.push(`ORG:${v(profile.organization)}`);
    if (profile.role) lines.push(`TITLE:${v(profile.role)}`);
    if (profile.phone) lines.push(`TEL;TYPE=CELL:${v(profile.phone)}`);
    if (profile.email) lines.push(`EMAIL:${v(profile.email)}`);
    if (profile.websites?.[0]?.url) lines.push(`URL:${v(profile.websites[0].url)}`);
    // TYPEにサービス名を設定し、iPhoneのソーシャルプロフィール欄で各SNS名を表示する。
    // XはiOSの定義済みサービス名であるTwitterを使用する。
    const socialTypes = { instagram:"Instagram", threads:"Threads", x:"Twitter", youtube:"YouTube", tiktok:"TikTok", minkara:"みんカラ", facebook:"Facebook", line:"LINE" };
    (profile.socials || []).forEach((social, index) => {
      const type = socialTypes[social.kind];
      const url = safeUrl(social.url);
      if (!type || url === "#") return;
      const group = `item${index + 1}`;
      // X-USERが電話帳上のアカウント名、X-ABLabelがiPhone上のサービス名になる。
      lines.push(foldVCardLine(`${group}.X-SOCIALPROFILE;TYPE="${vParam(type)}";X-USER="${vParam(social.handle)}":${v(url)}`));
      lines.push(`${group}.X-ABLabel:${v(socialLabels[social.kind] || social.kind)}`);
    });
    // プロフィール画像を優先し、未設定・取得失敗時はサイト共通アイコンを直接埋め込む。
    try {
      const photo = await contactPhoto(profile);
      const photoLine = photo.uri
        ? `PHOTO;VALUE=URI:${v(photo.uri)}`
        : `PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`;
      lines.push(foldVCardLine(photoLine));
    } catch {}
    lines.push("END:VCARD");
    const blob = new Blob([lines.join("\r\n")], { type:"text/vcard;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${profileId}.vcf`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function loadProfile(token = "", cacheProfile = false) {
    const result = await api("getProfile", { token });
    if (cacheProfile) saveCachedProfile(result.profile);
    renderCard(result.profile);
  }

  async function start() {
    const cachedProfile = readCachedProfile();
    if (cachedProfile) renderCard(cachedProfile);
    else app.innerHTML = `<section class="state-card"><span class="loader" aria-hidden="true"></span><p>DigitalCardを読み込んでいます…</p></section>`;
    try {
      const token = readToken();
      if (token) {
        try { return await loadProfile(token); }
        catch { localStorage.removeItem(tokenKey); }
      }
      const status = await api("status");
      if (!status.exists) throw new Error("指定されたDigitalCardが見つかりません。");
      if (!status.pinRequired && status.profile) {
        saveCachedProfile(status.profile);
        return renderCard(status.profile);
      }
      if (!status.pinRequired) return await loadProfile("", true);
      localStorage.removeItem(profileCacheKey);
      renderPin();
    } catch (err) {
      // キャッシュ表示済みなら、一時的なAPI障害で画面をエラーに戻さない。
      if (!cachedProfile) renderError(err.message);
    }
  }

  start();
})();
