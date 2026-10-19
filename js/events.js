// Event store. Every change is an immutable event; current state is the fold of all events.
// Event: { id, dev, seq, at, by, kind, rid, op: "put"|"del", data }
// For a record, the event with the latest (at, id) wins. Ledger kinds (payments, moves) are only ever added.
const DB = "batchwala", VER = 1;
export const KINDS = ["orders", "payments", "menu", "ingredients", "moves", "bakes", "config", "members", "grns", "transfers", "fg", "suppliers", "plans", "porders", "spays", "wos", "locks", "devices", "closes", "stocktakes", "preturns"];
const state = Object.fromEntries(KINDS.map(k => [k, new Map()]));   // kind -> rid -> { ev, data|null }
const byRecord = new Map();                                            // kind:rid -> [events]
const listeners = new Set();
const known = new Set();                                               // event ids already stored
let idb, dev = null, seq = 0, actor = () => "unknown", version = 0;
// Bumped whenever the folded state changes, so the model can reuse what it worked out until then.
export const dataVersion = () => version;

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function open() {
  const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("events", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "k" }); };
  return req(r);
}
const store = (name, mode = "readonly") => idb.transaction(name, mode).objectStore(name);
export const getMeta = async k => { const r = await req(store("meta").get(k)); return r ? r.v : undefined; };
export const setMeta = (k, v) => req(store("meta", "readwrite").put({ k, v }));
const newer = (a, b) => !b || a.at > b.at || (a.at === b.at && a.id > b.id);

function apply(ev) {
  known.add(ev.id);
  if (!state[ev.kind]) return false;
  const key = ev.kind + ":" + ev.rid; const list = byRecord.get(key) || []; list.push(ev); byRecord.set(key, list);
  const cur = state[ev.kind].get(ev.rid);
  if (cur && !newer(ev, cur.ev)) return false;
  state[ev.kind].set(ev.rid, { ev, data: ev.op === "del" ? null : ev.data }); version++;
  return true;
}
let queued = false;
function notify(src) { if (queued) return; queued = true; queueMicrotask(() => { queued = false; listeners.forEach(f => f(src)); }); }
export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
export const device = () => dev;
export const setActor = f => { actor = f; };

export async function init() {
  idb = await open();
  dev = await getMeta("device");
  if (!dev) { dev = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await setMeta("device", dev); }
  const evs = await req(store("events").getAll());
  evs.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1).forEach(apply);
  seq = evs.filter(e => e.dev === dev).reduce((m, e) => Math.max(m, e.seq), 0);
}

const clone = o => JSON.parse(JSON.stringify(o));
async function write(kind, rid, op, data) {
  seq++;
  const at = new Date().toISOString();
  const ev = { id: `${at}~${dev}~${seq}`, dev, seq, at, by: actor(), kind, rid, op, data: op === "put" ? clone(data) : null };
  await req(store("events", "readwrite").put(ev));
  apply(ev); notify("local"); return ev;
}
export const put = (kind, rec) => write(kind, rec.id, "put", { ...rec });
export const del = (kind, rid) => write(kind, rid, "del", null);
export const all = kind => [...state[kind].values()].filter(x => x.data).map(x => ({ ...clone(x.data), id: x.ev.rid, _at: x.ev.at, _by: x.ev.by }));
export const get = (kind, rid) => { const x = state[kind].get(rid); return x && x.data ? { ...clone(x.data), id: rid, _at: x.ev.at, _by: x.ev.by } : null; };
export const history = (kind, rid) => (byRecord.get(kind + ":" + rid) || []).slice().sort((a, b) => a.at < b.at ? -1 : 1);

// Sync support
export async function ownEvents(fromSeq = 0) { return (await req(store("events").getAll())).filter(e => e.dev === dev && e.seq > fromSeq).sort((a, b) => a.seq - b.seq); }
export async function allEvents() { return (await req(store("events").getAll())); }
export async function ingest(events) {
  const fresh = events.filter(ev => ev && ev.id && ev.kind && !known.has(ev.id));
  if (!fresh.length) return 0;
  const tx = idb.transaction("events", "readwrite"); const os = tx.objectStore("events");
  fresh.forEach(ev => os.put(ev));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  let changed = 0;
  fresh.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1).forEach(ev => { if (apply(ev)) changed++; });
  if (changed) notify("remote");
  return changed;
}
export async function wipe() { await req(store("events", "readwrite").clear()); KINDS.forEach(k => state[k].clear()); byRecord.clear(); known.clear(); seq = 0; version++; notify("local"); }
// Keeps the event log small: an event that a later change to the same record has replaced, and that is older than `days`,
// is dropped from this device. Current records, deletions and ledger entries (one event each) always stay. Returns how many went.
export async function prune(days = 120) {
  const cut = new Date(Date.now() - days * 864e5).toISOString(); const drop = [];
  byRecord.forEach((list, key) => { const k = key.split(":")[0]; if (!state[k]) return; const cur = state[k].get(key.slice(k.length + 1)); if (!cur) return;
    const keep = list.filter(e => e === cur.ev || e.at >= cut); if (keep.length < list.length) { list.filter(e => !keep.includes(e)).forEach(e => drop.push(e.id)); byRecord.set(key, keep); } });
  if (!drop.length) return 0;
  const tx = idb.transaction("events", "readwrite"); const os = tx.objectStore("events"); drop.forEach(id => os.delete(id));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return drop.length;
}
