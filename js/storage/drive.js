// Google Drive storage adapter. Talks to the Drive REST API directly from the browser.
// Needs a Google OAuth client ID (see README). Data lives in one shared folder.
const SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3", UP = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error("Couldn’t load Google sign-in. Check the connection."));
    document.head.appendChild(s);
  });
}

export function createDriveAdapter({ clientId, folderName, folderId, onToken }) {
  let token = null, exp = 0, client = null, pending = null;
  const a = { id: "gdrive", account: "", folderId: folderId || null, folderName };

  // mode: "consent" (first connect), "gesture" (user tapped, no consent screen), false (background: never opens a popup)
  async function getToken(mode) {
    if (token && Date.now() < exp - 60000) return token;
    if (!mode) { const e = new Error("Google sign-in has expired. Tap Sync now to reconnect."); e.code = "reauth"; throw e; }
    await loadGis();
    if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    if (pending) return pending;
    pending = new Promise((res, rej) => {
      client.callback = r => { pending = null; if (r.error) { rej(new Error(r.error_description || r.error)); return; } token = r.access_token; exp = Date.now() + (r.expires_in || 3600) * 1000; onToken && onToken(); res(token); };
      client.error_callback = e => { pending = null; rej(new Error(e && e.message ? e.message : "Google sign-in was closed")); };
      client.requestAccessToken({ prompt: mode === "consent" ? "consent" : "" });
    });
    return pending;
  }
  async function call(url, opts = {}, raw = false) {
    const t = await getToken(false);
    const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + t, ...(opts.headers || {}) } });
    if (r.status === 401) { token = null; return call(url, opts, raw); }
    if (!r.ok) { let m = `Google Drive error ${r.status}`; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (_) {} throw new Error(m); }
    return raw ? r : r.json();
  }
  const q = s => encodeURIComponent(s);

  a.connect = async () => {
    await getToken("consent");
    const me = await call(`${API}/about?fields=user(emailAddress,displayName)`);
    a.account = me.user.emailAddress; a.name = me.user.displayName;
    return a.account;
  };
  a.reconnect = () => getToken("gesture");
  a.ready = async () => { await getToken(false); if (!a.account) { const me = await call(`${API}/about?fields=user(emailAddress,displayName)`); a.account = me.user.emailAddress; a.name = me.user.displayName; } if (!a.folderId) await a.findOrCreateFolder(); };
  a.findOrCreateFolder = async (create = true) => {
    const res = await call(`${API}/files?q=${q(`name='${folderName.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id,name,owners(emailAddress))&includeItemsFromAllDrives=true&supportsAllDrives=true`);
    if (res.files && res.files.length) { a.folderId = res.files[0].id; return a.folderId; }
    if (!create) throw new Error(`No folder named “${folderName}” is shared with this Google account yet.`);
    const f = await call(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }) });
    a.folderId = f.id; return a.folderId;
  };
  a.listFiles = async () => {
    const out = []; let page = "";
    do {
      const res = await call(`${API}/files?q=${q(`'${a.folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=1000${page ? "&pageToken=" + page : ""}&includeItemsFromAllDrives=true&supportsAllDrives=true`);
      res.files.forEach(f => out.push({ id: f.id, name: f.name, modified: f.modifiedTime, size: +f.size || 0 })); page = res.nextPageToken || "";
    } while (page);
    return out;
  };
  a.readFile = async id => (await call(`${API}/files/${id}?alt=media&supportsAllDrives=true`, {}, true)).text();
  async function upload(name, body, mime, existingId) {
    if (existingId) { await call(`${UP}/files/${existingId}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": mime }, body }); return existingId; }
    const boundary = "bw" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [a.folderId] });
    const blob = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, body, `\r\n--${boundary}--`]);
    const f = await call(`${UP}/files?uploadType=multipart&fields=id&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: blob });
    return f.id;
  }
  a.writeFile = (name, text, existingId) => upload(name, text, "application/x-ndjson", existingId);
  a.writeBinary = async (name, blob, mime) => { const files = await a.listFiles(); const ex = files.find(f => f.name === name); return upload(name, blob, mime, ex && ex.id); };
  a.shareWith = email => call(`${API}/files/${a.folderId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }) });
  // Takes a person off the folder (not its owner). Resolves to true when access was removed, false when they had none.
  a.unshareWith = async email => { const e = String(email || "").toLowerCase(); const r = await call(`${API}/files/${a.folderId}/permissions?fields=permissions(id,emailAddress,role)&supportsAllDrives=true`);
    const ps = (r.permissions || []).filter(x => String(x.emailAddress || "").toLowerCase() === e && x.role !== "owner"); for (const x of ps) await call(`${API}/files/${a.folderId}/permissions/${x.id}?supportsAllDrives=true`, { method: "DELETE" }, true); return ps.length > 0; };
  a.folderLink = () => a.folderId ? `https://drive.google.com/drive/folders/${a.folderId}` : "";
  return a;
}
