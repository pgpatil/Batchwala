// Sheets, confirm dialogs and toasts.
import { $ } from "./util.js";
export const ui = { sheet: null, confirmOpen: false, onClose: null };

export function toast(msg, actionHtml = "") {
  const t = $("#toast"); t.innerHTML = `<span></span>${actionHtml}`; t.firstChild.textContent = msg;
  t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), actionHtml ? 5000 : 2600);
}
export function openSheet(state, html, full = false) {
  ui.sheet = state;
  const s = $("#sheet"); s.className = "sheet" + (full ? " full" : ""); s.innerHTML = `<div class="grab"></div>` + html;
  if (!s.dataset.keep) s.scrollTop = 0; delete s.dataset.keep;
  requestAnimationFrame(() => { if (ui.sheet === state) s.classList.add("open"); });   // not if it was closed meanwhile
  $("#scrim").classList.add("open"); document.body.style.overflow = "hidden";
}
export function closeSheet() {
  $("#scrim").classList.remove("open"); $("#sheet").classList.remove("open"); document.body.style.overflow = "";
  ui.sheet = null; ui.onClose && ui.onClose();
}
export function ask(html, buttons, pair = false) {
  return new Promise(res => {
    const box = $("#cbox");
    box.innerHTML = html + `<div class="cbtns${pair ? " pair" : ""}">${buttons.map((b, i) => `<button class="btn ${b.cls}" data-c="${i}">${b.label}</button>`).join("")}</div>`;
    $("#confirm").classList.add("open"); ui.confirmOpen = true;
    const done = v => { $("#confirm").classList.remove("open"); ui.confirmOpen = false; $("#confirm").onclick = null; document.removeEventListener("keydown", key); res(v); };
    const key = e => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", key);
    $("#confirm").onclick = e => { const b = e.target.closest("[data-c]"); if (b) done(buttons[+b.dataset.c].value); else if (e.target.id === "confirm") done(null); };
    setTimeout(() => { const f = box.querySelector("input") || box.querySelector("[data-c]"); f && f.focus(); }, 30);
  });
}
export const yesNo = (html, yes, cls = "btn-primary", no = "Cancel") => ask(html, [{ label: no, cls: "btn-ghost", value: false }, { label: yes, cls, value: true }], true);
