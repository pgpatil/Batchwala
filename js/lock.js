// Editing locks. Opening an editor on a saved record takes a lock that every device sees through sync; others can look but not edit
// until it is saved or closed. A lock lapses if its holder goes quiet (phone locked, app closed) so a record is never stuck for long.
// Sync between devices is periodic, so two people can still open the same record within seconds of each other while offline or
// between syncs; saving then checks whether someone else saved the record after it was opened, and asks before overwriting.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as R from "./roles.js";
import { esc } from "./util.js";
import { ui, ask } from "./ui.js";

const HOLD_MIN = 8, BEAT_MS = 2 * 60 * 1000;   // a lock lasts 8 minutes and is renewed every 2 while its editor is open
const keyOf = (kind, rid) => `${kind}:${rid}`;
const now = () => new Date().toISOString();
const later = m => new Date(Date.now() + m * 60000).toISOString();
const mine = l => l.dev === ev.device();
const nameOf = id => (ev.get("members", id) || {}).name || "Someone";
const when = t => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const live = l => l && l.until > now();
// Waits for a sync round so the lock check sees what other devices have done, but never more than a few seconds.
const fresh = () => sync.current() ? Promise.race([sync.syncNow(), new Promise(r => setTimeout(r, 4000))]).catch(() => {}) : Promise.resolve();

export const lockOf = (kind, rid) => { const l = ev.get("locks", keyOf(kind, rid)); return live(l) && !mine(l) ? l : null; };

// Before editing a saved record. Returns the fields to put on the editor's state ({ lock, lockKind, lockId, base }), or null when someone else is editing it.
export async function open(kind, rid, label) {
  if (!rid) return {};
  await fresh();
  const l = ev.get("locks", keyOf(kind, rid));
  if (live(l) && !mine(l)) {
    const take = await ask(`<p class="cq">${esc(nameOf(l.by))} is editing ${esc(label)}</p><div class="cdetail">Opened at ${esc(when(l.at))}. You can edit it once they save or close it${R.isAdmin() ? ", or take it over if they left it open (their unsaved changes will need checking when they save)" : ""}. The lock lapses ${HOLD_MIN} minutes after their app goes quiet.</div>`,
      [{ label: "OK", cls: "btn-primary", value: false }, ...(R.isAdmin() ? [{ label: "Take over", cls: "btn-danger", value: true }] : [])], R.isAdmin());
    if (!take) return null;
  }
  await take_(kind, rid);
  const rec = ev.get(kind, rid);
  return { lock: keyOf(kind, rid), lockKind: kind, lockId: rid, base: rec ? rec._at : "" };
}
async function take_(kind, rid) {
  await ev.put("locks", { id: keyOf(kind, rid), kind, rid, by: (R.me() || {}).id || "", dev: ev.device(), at: now(), until: later(HOLD_MIN) });
  if (sync.current()) sync.syncNow();
}
export async function release(key) {
  const l = ev.get("locks", key); if (!l || !mine(l) || !live(l)) return;
  await ev.put("locks", { ...l, until: now() }); if (sync.current()) sync.soon();
}
// Before saving an edited record: if someone else saved it after this editor opened, ask. Returns true to go ahead.
export async function saveOk(st) {
  if (!st || !st.lockKind || !st.lockId) return true;
  await fresh();
  const rec = ev.get(st.lockKind, st.lockId); const l = ev.get("locks", st.lock);
  const taken = live(l) && !mine(l);
  const last = ev.history(st.lockKind, st.lockId).at(-1); const changed = rec && st.base && rec._at > st.base && last && last.dev !== ev.device();
  if (!taken && !changed) return true;
  return !!await ask(`<p class="cq">${changed ? `${esc(nameOf(rec._by))} saved this after you opened it` : `${esc(nameOf(l.by))} has taken over this record`}</p><div class="cdetail">${changed ? `Their change was saved at ${esc(when(rec._at))}. Saving now replaces it with yours.` : "They may be changing it now."} Close this and reopen to see the latest, or save yours anyway.</div>`,
    [{ label: "Go back", cls: "btn-ghost", value: false }, { label: "Save mine anyway", cls: "btn-danger", value: true }], true);
}
// Locks follow the editor: released when it closes or another sheet replaces it, renewed while it stays open.
ui.release = key => { release(key); };
setInterval(() => { const st = ui.sheet; if (st && st.lock && document.visibilityState === "visible") { const l = ev.get("locks", st.lock); if (l && mine(l)) take_(st.lockKind, st.lockId); } }, BEAT_MS);
// A line for detail screens while someone else has the record open in an editor.
export const banner = (kind, rid) => { const l = lockOf(kind, rid); return l ? `<div class="banner warn">🔒 ${esc(nameOf(l.by))} is editing this (since ${esc(when(l.at))}). Changes open again once they save.</div>` : ""; };
