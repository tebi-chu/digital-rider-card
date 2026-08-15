/** @OnlyCurrentDoc */

const PROFILE_SHEET = "Profiles";
const SECURITY_SHEET = "Security";
const SESSION_SHEET = "PinSessions";
const PROFILE_HEADERS = [
  "slug", "name", "reading", "tagline", "organization", "role", "currentBike",
  "message", "pastBikes", "rallyHistory", "bikePhotoUrl", "phone", "email",
  "avatarUrl", "heroUrl", "backgroundUrl", "gradient", "accentColor", "websites",
  "instagram", "threads", "x", "youtube", "tiktok", "minkara", "facebook", "updatedAt", "line",
];
const SOCIAL_KINDS = ["instagram", "threads", "x", "youtube", "tiktok", "minkara", "facebook", "line"];
const PIN_SESSION_MS = 12 * 60 * 60 * 1000;
const PIN_ATTEMPT_SECONDS = 10 * 60;
const PIN_MAX_ATTEMPTS = 5;

function doGet(e) {
  if (e && e.parameter && e.parameter.mode === "admin") return adminPage_();
  return json_({ ok: true, service: "Digital Rider Card API" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (isLegacySync_(body)) return legacySync_(body);
    if (body.action === "status") return publicStatus_(body);
    if (body.action === "verifyPin") return publicVerifyPin_(body);
    if (body.action === "getProfile") return publicGetProfile_(body);
    return json_({ ok: false, error: "invalid_request" });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function spreadsheet_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, headers) {
  const spreadsheet = spreadsheet_();
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (name !== PROFILE_SHEET) sheet.hideSheet();
  return sheet;
}

function profileSheet_() { return sheet_(PROFILE_SHEET, PROFILE_HEADERS); }
function securitySheet_() { return sheet_(SECURITY_SHEET, ["slug", "pinHash", "updatedAt"]); }
function sessionSheet_() { return sheet_(SESSION_SHEET, ["tokenHash", "slug", "expiresAt"]); }

function findRow_(sheet, slug, column) {
  if (!slug || sheet.getLastRow() < 2) return -1;
  const finder = sheet.getRange(2, column || 1, sheet.getLastRow() - 1, 1).createTextFinder(String(slug)).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : -1;
}

function text_(value, max) {
  const valueText = value == null ? "" : String(value).trim();
  return max ? Array.from(valueText).slice(0, max).join("") : valueText;
}

function safeSlug_(value) {
  return text_(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function parseJson_(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
}

function socialCell_(profile, kind) {
  const social = (profile.socials || []).find(function(item) { return item.kind === kind; });
  return social ? JSON.stringify({ handle: text_(social.handle), url: text_(social.url) }) : "";
}

function profileRow_(profile) {
  return [
    profile.slug, profile.name, profile.reading || "", profile.tagline || "", profile.organization || "", profile.role || "",
    profile.currentBike || "", profile.message || "", profile.pastBikes || "", profile.rallyHistory || "", profile.bikePhotoUrl || "",
    profile.phone || "", profile.email || "", profile.avatarUrl || "", profile.heroUrl || "", profile.backgroundUrl || "",
    profile.gradient || "", profile.accentColor || "", JSON.stringify(profile.websites || []),
    socialCell_(profile, "instagram"), socialCell_(profile, "threads"), socialCell_(profile, "x"), socialCell_(profile, "youtube"),
    socialCell_(profile, "tiktok"), socialCell_(profile, "minkara"), socialCell_(profile, "facebook"), new Date(), socialCell_(profile, "line"),
  ];
}

function rowProfile_(values) {
  const row = {};
  PROFILE_HEADERS.forEach(function(header, index) { row[header] = values[index] == null ? "" : values[index]; });
  const socials = SOCIAL_KINDS.reduce(function(items, kind) {
    const social = parseJson_(row[kind], null);
    if (social && social.handle && social.url) items.push({ kind: kind, handle: String(social.handle), url: String(social.url) });
    return items;
  }, []);
  const websites = parseJson_(row.websites, []);
  return {
    slug: String(row.slug), name: String(row.name), reading: String(row.reading || ""), tagline: String(row.tagline || ""),
    organization: String(row.organization || ""), role: String(row.role || ""), currentBike: String(row.currentBike || ""),
    message: String(row.message || ""), pastBikes: String(row.pastBikes || ""), rallyHistory: String(row.rallyHistory || ""),
    bikePhotoUrl: String(row.bikePhotoUrl || ""), phone: String(row.phone || ""), email: String(row.email || ""),
    avatarUrl: String(row.avatarUrl || ""), heroUrl: String(row.heroUrl || ""), backgroundUrl: String(row.backgroundUrl || ""),
    gradient: String(row.gradient || ""), accentColor: String(row.accentColor || ""),
    websites: Array.isArray(websites) ? websites.filter(function(item) { return item && item.label && item.url; }) : [], socials: socials,
  };
}

function normalizeProfile_(payload) {
  const slug = safeSlug_(payload && payload.slug);
  const name = text_(payload && payload.name, 100);
  if (!slug || !name) throw new Error("URL IDと名前は必須です。");
  const websites = Array.isArray(payload.websites) ? payload.websites.map(function(item) { return { label: text_(item.label, 100), url: text_(item.url, 1000) }; }).filter(function(item) { return item.label && item.url; }) : [];
  const socials = Array.isArray(payload.socials) ? payload.socials.map(function(item) { return { kind: text_(item.kind, 20), handle: text_(item.handle, 100), url: text_(item.url, 1000) }; }).filter(function(item) { return SOCIAL_KINDS.indexOf(item.kind) >= 0 && item.handle && item.url; }) : [];
  return {
    slug: slug, name: name, reading: text_(payload.reading, 100), tagline: text_(payload.tagline, 150), organization: text_(payload.organization, 150), role: text_(payload.role, 150),
    currentBike: text_(payload.currentBike, 200), message: text_(payload.message, 100), pastBikes: text_(payload.pastBikes, 4000), rallyHistory: text_(payload.rallyHistory, 4000),
    bikePhotoUrl: text_(payload.bikePhotoUrl, 2000), phone: text_(payload.phone, 100), email: text_(payload.email, 200), avatarUrl: text_(payload.avatarUrl, 2000),
    heroUrl: text_(payload.heroUrl, 2000), backgroundUrl: text_(payload.backgroundUrl, 2000), gradient: text_(payload.gradient, 500), accentColor: text_(payload.accentColor, 20),
    websites: websites, socials: socials,
  };
}

function getProfile_(slug) {
  const sheet = profileSheet_();
  const row = findRow_(sheet, safeSlug_(slug), 1);
  if (row < 0) return null;
  return rowProfile_(sheet.getRange(row, 1, 1, PROFILE_HEADERS.length).getValues()[0]);
}

function pinRequired_(slug) { return findRow_(securitySheet_(), safeSlug_(slug), 1) > 0; }

function ensureMigrationLockdown_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("MIGRATION_LOCKDOWN_DONE") === "1") return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (properties.getProperty("MIGRATION_LOCKDOWN_DONE") === "1") return;
    const profiles = profileSheet_();
    const security = securitySheet_();
    if (profiles.getLastRow() >= 2) {
      profiles.getRange(2, 1, profiles.getLastRow() - 1, 1).getValues().forEach(function(row) {
        const slug = safeSlug_(row[0]);
        if (slug && findRow_(security, slug, 1) < 0) {
          security.appendRow([slug, "MIGRATION_LOCKED:" + digest_(randomToken_()), new Date()]);
        }
      });
    }
    properties.setProperty("MIGRATION_LOCKDOWN_DONE", "1");
  } finally {
    lock.releaseLock();
  }
}

function publicStatus_(body) {
  ensureMigrationLockdown_();
  const slug = safeSlug_(body.slug);
  return json_({ ok: true, exists: Boolean(getProfile_(slug)), pinRequired: pinRequired_(slug) });
}

function publicGetProfile_(body) {
  ensureMigrationLockdown_();
  const slug = safeSlug_(body.slug);
  const profile = getProfile_(slug);
  if (!profile) return json_({ ok: false, error: "指定されたDigitalCardが見つかりません。" });
  if (pinRequired_(slug) && !validSession_(slug, text_(body.token, 300))) return json_({ ok: false, error: "PIN認証が必要です。", code: "PIN_REQUIRED" });
  return json_({ ok: true, profile: profile });
}

function publicVerifyPin_(body) {
  ensureMigrationLockdown_();
  const slug = safeSlug_(body.slug);
  const pin = text_(body.pin, 4);
  if (!/^\d{4}$/.test(pin)) return json_({ ok: false, error: "PINコードは半角数字4桁で入力してください。" });
  const security = securitySheet_();
  const row = findRow_(security, slug, 1);
  if (row < 0) return json_({ ok: false, error: "PIN認証は設定されていません。" });
  const clientId = text_(body.clientId, 100) || "unknown";
  const cache = CacheService.getScriptCache();
  const attemptKey = "pin-attempt:" + digest_(slug + ":" + clientId).slice(0, 48);
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= PIN_MAX_ATTEMPTS) return json_({ ok: false, error: "入力回数が上限に達しました。10分後にもう一度お試しください。" });
  const stored = String(security.getRange(row, 2).getValue() || "");
  if (!constantEqual_(stored, pinHash_(slug, pin))) {
    cache.put(attemptKey, String(attempts + 1), PIN_ATTEMPT_SECONDS);
    return json_({ ok: false, error: "PINコードが違います。" });
  }
  cache.remove(attemptKey);
  const token = randomToken_();
  const expiresAt = Date.now() + PIN_SESSION_MS;
  const sessions = sessionSheet_();
  cleanupSessions_(sessions);
  sessions.appendRow([digest_(token), slug, expiresAt]);
  return json_({ ok: true, token: token, expiresAt: expiresAt });
}

function validSession_(slug, token) {
  if (!token) return false;
  const sheet = sessionSheet_();
  cleanupSessions_(sheet);
  const row = findRow_(sheet, digest_(token), 1);
  if (row < 0) return false;
  const values = sheet.getRange(row, 1, 1, 3).getValues()[0];
  return String(values[1]) === slug && Number(values[2]) > Date.now();
}

function cleanupSessions_(sheet) {
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let index = values.length - 1; index >= 0; index--) if (Number(values[index][2]) <= Date.now()) sheet.deleteRow(index + 2);
}

function pinHash_(slug, pin) {
  const properties = PropertiesService.getScriptProperties();
  let pepper = properties.getProperty("PIN_PEPPER");
  if (!pepper) { pepper = randomToken_() + randomToken_(); properties.setProperty("PIN_PEPPER", pepper); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(slug + ":" + pin, pepper));
}

function digest_(value) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))); }
function randomToken_() { return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, ""); }
function constantEqual_(left, right) { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i); return diff === 0; }

function isLegacySync_(body) {
  const expected = PropertiesService.getScriptProperties().getProperty("SYNC_SECRET");
  return Boolean(expected && body.secret === expected && (body.action === "upsert" || body.action === "delete"));
}

function legacySync_(body) {
  const sheet = profileSheet_();
  if (body.action === "delete") { const row = findRow_(sheet, body.slug, 1); if (row > 0) sheet.deleteRow(row); return json_({ ok: true }); }
  const profile = normalizeProfile_(body.profile || {});
  upsertProfile_(profile, body.slug);
  return json_({ ok: true, slug: profile.slug });
}

function adminPage_() {
  if (!isAdmin_()) return HtmlService.createHtmlOutput("<h1>アクセスできません</h1><p>管理者アカウントでログインしてください。</p>").setTitle("Digital Rider Card Admin");
  return HtmlService.createTemplateFromFile("Admin").evaluate().setTitle("Digital Rider Card Admin").addMetaTag("viewport", "width=device-width,initial-scale=1");
}

function adminEmail_() { return String(PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL") || "").trim().toLowerCase(); }
function isAdmin_() { const expected = adminEmail_(); return Boolean(expected && String(Session.getActiveUser().getEmail() || "").toLowerCase() === expected); }
function requireAdmin_() { if (!isAdmin_()) throw new Error("管理者権限がありません。"); }

function adminBootstrap() {
  requireAdmin_();
  ensureMigrationLockdown_();
  const protectedSlugs = {};
  const security = securitySheet_();
  if (security.getLastRow() >= 2) security.getRange(2, 1, security.getLastRow() - 1, 1).getValues().forEach(function(row) { protectedSlugs[String(row[0])] = true; });
  const sheet = profileSheet_();
  const profiles = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, PROFILE_HEADERS.length).getValues().map(rowProfile_).map(function(profile) { profile.pinEnabled = Boolean(protectedSlugs[profile.slug]); return profile; });
  return { profiles: profiles, adminEmail: adminEmail_(), publicBaseUrl: PropertiesService.getScriptProperties().getProperty("PUBLIC_CARD_BASE_URL") || "https://tebi-chu.github.io/digital-rider-card/" };
}

function adminSaveProfile(payload, previousSlug) {
  requireAdmin_();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const profile = normalizeProfile_(payload || {});
    const oldSlug = safeSlug_(previousSlug || "");
    const sheet = profileSheet_();
    const existing = findRow_(sheet, profile.slug, 1);
    if (existing > 0 && profile.slug !== oldSlug) throw new Error("このURL IDは使用済みです。");
    upsertProfile_(profile, oldSlug);
    if (oldSlug && oldSlug !== profile.slug) removePin_(oldSlug);
    if (payload.removePin === true) removePin_(profile.slug);
    else if (payload.pinCode) setPin_(profile.slug, String(payload.pinCode));
    profile.pinEnabled = pinRequired_(profile.slug);
    return profile;
  } finally { lock.releaseLock(); }
}

function upsertProfile_(profile, previousSlug) {
  const sheet = profileSheet_();
  if (previousSlug && previousSlug !== profile.slug) { const oldRow = findRow_(sheet, previousSlug, 1); if (oldRow > 0) sheet.deleteRow(oldRow); }
  const row = findRow_(sheet, profile.slug, 1);
  if (row > 0) sheet.getRange(row, 1, 1, PROFILE_HEADERS.length).setValues([profileRow_(profile)]);
  else sheet.appendRow(profileRow_(profile));
}

function adminDeleteProfile(slug) {
  requireAdmin_();
  const safe = safeSlug_(slug); const sheet = profileSheet_(); const row = findRow_(sheet, safe, 1);
  if (row > 0) sheet.deleteRow(row); removePin_(safe); return true;
}

function setPin_(slug, pin) {
  if (!/^\d{4}$/.test(String(pin))) throw new Error("PINコードは半角数字4桁で入力してください。");
  const sheet = securitySheet_(); const row = findRow_(sheet, slug, 1); const values = [[slug, pinHash_(slug, pin), new Date()]];
  if (row > 0) sheet.getRange(row, 1, 1, 3).setValues(values); else sheet.appendRow(values[0]);
  removeSessions_(slug);
}

function removePin_(slug) {
  const sheet = securitySheet_(); const row = findRow_(sheet, slug, 1); if (row > 0) sheet.deleteRow(row); removeSessions_(slug);
}

function removeSessions_(slug) {
  const sheet = sessionSheet_(); if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let index = values.length - 1; index >= 0; index--) if (String(values[index][1]) === slug) sheet.deleteRow(index + 2);
}

function adminUploadImage(base64, filename, mimeType) {
  requireAdmin_();
  if (!/^image\//.test(String(mimeType || ""))) throw new Error("画像ファイルを選択してください。");
  const bytes = Utilities.base64Decode(String(base64 || ""));
  if (bytes.length > 10 * 1024 * 1024) throw new Error("画像は10MB以内にしてください。");
  const properties = PropertiesService.getScriptProperties();
  let folderId = properties.getProperty("IMAGE_FOLDER_ID");
  let folder;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (_) {} }
  if (!folder) { folder = DriveApp.createFolder("Digital Rider Card Images"); folderId = folder.getId(); properties.setProperty("IMAGE_FOLDER_ID", folderId); }
  const blob = Utilities.newBlob(bytes, mimeType, String(filename || "image"));
  const file = folder.createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}
