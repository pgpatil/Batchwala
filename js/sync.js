// Sync engine. Storage-agnostic: works with any adapter that can list, read and write named text files.
// Each device writes only its own files: events_<device>_<YYYY-MM>.jsonl. Everyone reads everyone's.
import * as ev from "./events.js";

let adapter = null, timer = null, busy = false;
const listeners = new Set();
export const status = { state: "off", last: null, error: "", account: "" };
const emit = () => listeners.forEach(f => f({ ...status }));
const set = (state, error = "") => { status.state = state; status.error = error; emit(); };
export const onStatus = f => { listeners.add(f); return () => listeners.delete(f); };
export const current = () => adapter;

export async function use(a) {
  stop(); adapter = a;
  if (!a) { set("off"); return; }
  // Bookmarks belong to one folder: a different folder starts from scratch, so it receives this device's whole history.
  const where = `${a.id}:${a.folderName || a.base || ""}`;
  if ((await ev.getMeta("sync.where")) !== where) { if (await ev.getMeta("sync.where")) { await ev.setMeta("sync.pushedSeq", 0); await ev.setMeta("sync.fileIds", {}); await ev.setMeta("sync.seen", {}); } await ev.setMeta("sync.where", where); }
  status.last = await ev.getMeta("sync.last") || null;
  status.account = a.account || "";
  set("idle"); start();
}

const monthOf = e => e.at.slice(0, 7);
const fileName = (dev, month) => `events_${dev}_${month}.jsonl`;

// While a sync runs, callers wait for that same round instead of returning before it lands.
let running = null;
export function syncNow() { if (!adapter) return Promise.resolve(); if (running) return running; running = round().finally(() => { running = null; }); return running; }
async function round() {
  if (!adapter || busy) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { set("offline"); return; }
  busy = true; set("syncing");
  try {
    await adapter.ready();
    status.account = adapter.account || status.account;
    const files = await adapter.listFiles();
    const dev = ev.device();
    // push: rewrite each of my month files that has events newer than what was pushed
    const pushed = await ev.getMeta("sync.pushedSeq") || 0;
    const mine = await ev.ownEvents(0);
    const newer = mine.filter(e => e.seq > pushed);
    if (newer.length) {
      const months = [...new Set(newer.map(monthOf))];
      const ids = await ev.getMeta("sync.fileIds") || {};
      for (const m of months) {
        const name = fileName(dev, m);
        const text = mine.filter(e => monthOf(e) === m).map(e => JSON.stringify(e)).join("\n") + "\n";
        // The folder's own listing wins over a remembered id (the file may have been moved, trashed or belong to an old folder).
        const listed = (files.find(f => f.name === name) || {}).id; const existing = listed || (files.some(f => f.id === ids[name]) ? ids[name] : undefined);
        ids[name] = await adapter.writeFile(name, text, existing);
      }
      await ev.setMeta("sync.fileIds", ids);
      await ev.setMeta("sync.pushedSeq", newer.at(-1).seq);
    }
    // After a restore: other devices' events from the backup go up as one file of this device's, once.
    if (await ev.getMeta("sync.publishForeign")) { const all = await ev.allEvents(); const foreign = all.filter(e => e.dev !== dev);
      if (foreign.length) await adapter.writeFile(`events_${dev}_restored.jsonl`, foreign.map(e => JSON.stringify(e)).join("\n") + "\n", (files.find(f => f.name === `events_${dev}_restored.jsonl`) || {}).id);
      await ev.setMeta("sync.publishForeign", false); }
    // pull: read other devices' files that changed since last seen
    const seen = await ev.getMeta("sync.seen") || {};
    let changed = 0;
    for (const f of files) {
      if (!/^events_.+\.jsonl$/.test(f.name) || f.name.startsWith(`events_${dev}_`)) continue;
      if (seen[f.id] && seen[f.id] === f.modified) continue;
      const text = await adapter.readFile(f.id);
      const evs = text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } });
      changed += await ev.ingest(evs);
      seen[f.id] = f.modified;
    }
    await ev.setMeta("sync.seen", seen);
    status.last = new Date().toISOString(); await ev.setMeta("sync.last", status.last);
    set("ok");
    return changed;
  } catch (e) { set("error", e && e.message ? e.message : String(e)); }
  finally { busy = false; }
}
let soonT = null;
export function soon() { if (!adapter) return; clearTimeout(soonT); soonT = setTimeout(syncNow, 2000); }
function start() {
  stop(); syncNow(); timer = setInterval(syncNow, 60000);
  if (typeof window !== "undefined") window.addEventListener("online", syncNow);
}
export function stop() { clearInterval(timer); timer = null; if (typeof window !== "undefined") window.removeEventListener("online", syncNow); }
