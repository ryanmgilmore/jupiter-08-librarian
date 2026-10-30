// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Patch Viewer/Editor and Preset Viewer, for web/app.html. The page owns the file, the tabs and which
 * records are shown (the backup with its pending changes, or an added source); this draws them.
 * Needs the markup in app.html (ids panelHost, slots, patTable, ...) and svd.js, jp08-curves.js,
 * jp08-mfx.js, panel-core.js, preset-core.js, panel-view.js and panel-midi.js loaded first. */
(function () {
"use strict";
const $ = (id) => document.getElementById(id);
const hooks = { showTab() {} };  // the page sets showTab
const view = PanelView.create($("panelHost"));
let patches = [], patterns = [], shown = [], current = -1, group = "A", presetAt = -1;
let live = null, midi = null;  // the shown patch as an edit buffer that follows the unit's CCs; the MIDI link

function renderPatterns(label) {
  $("patSrc").textContent = label ? `Presets · ${label}` : "Presets";
  $("patEmpty").hidden = patterns.length > 0;
  $("patTable").hidden = patterns.length === 0;
  $("patTable").tBodies[0].replaceChildren(...patterns.map((p, i) => {
    const tr = document.createElement("tr"), refs = SVD.patternRefs(p.bytes);
    tr.className = (p.isInit ? "init" : "") + ((p.slot / 6 | 0) % 2 ? " alt" : "");
    const tempo = PresetCore.tempo(p.bytes);
    tr.innerHTML = `<td class="loc"></td><td></td><td class="num"></td>`;
    tr.cells[0].textContent = p.loc.replace(/^P/, "");
    tr.cells[1].textContent = p.name;
    tr.cells[2].textContent = tempo ? tempo.toFixed(tempo % 1 ? 2 : 0) : "";
    tr.append(patchCell(refs.lower), patchCell(refs.upper));
    tr.onclick = (e) => { if (!e.target.closest("a")) selectPreset(i); };
    return tr;
  }));
  selectPreset(Math.max(0, patterns.findIndex((p) => !p.isInit)));
}

function patchLink(slot) {
  if (slot == null) return document.createTextNode("—");
  const loc = SVD.location("patch", slot), p = patches.find((x) => x.loc === loc);
  const a = document.createElement("a");
  a.innerHTML = `<span class="loc">${loc}</span>`;
  a.append(p ? p.name : "(not in this file)");
  if (p) a.onclick = () => openPatch(loc);
  return a;
}
function patchCell(slot) {
  const td = document.createElement("td");
  td.append(patchLink(slot));
  return td;
}

function selectPreset(i) {
  if (!patterns.length) { $("preset").hidden = true; return; }
  presetAt = Math.max(0, Math.min(patterns.length - 1, i));
  const rows = $("patTable").tBodies[0].rows;
  for (let k = 0; k < rows.length; k++) rows[k].classList.toggle("sel", k === presetAt);
  // Scroll only the list: scrollIntoView() would scroll the page too and push the header away.
  const list = $("presetList"), row = rows[presetAt], head = $("patTable").tHead.offsetHeight;
  if (row.offsetTop - head < list.scrollTop) list.scrollTop = row.offsetTop - head;
  else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  const p = patterns[presetAt], d = PresetCore.decode(p.bytes);
  $("preset").hidden = false;
  $("prLoc").textContent = p.loc.replace(/^P/, "");
  $("prName").textContent = p.name;
  $("prMeta").textContent = d.tempo ? `${d.tempo.toFixed(d.tempo % 1 ? 2 : 0)} BPM` : "";
  $("prSettings").replaceChildren(...presetGroups(d).map(([t, r]) => settingsBlock(t, r)));
  $("prParts").replaceChildren(...PresetCore.PARTS.map((P) => partView(d.parts[P.id])));
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;  // Roland: 60 = C4

/* Every setting a preset stores beyond its patches and steps (preset round 2026-10-30). Values that differ
 * from an empty preset (INITIAL PATTERN) are marked, so what was set stands out. Values are the unit's own
 * 0-127 readings unless a unit is shown. */
const signed = (n) => (n > 0 ? "+" : "") + n;
const row = (label, value, isDefault, title) => ({ label, value: String(value), changed: !isDefault, title });
function partRows(part) {
  return [
    row("Volume", part.volume, part.volume === 100),
    row("Pan", part.pan ? (part.pan < 0 ? "L" + -part.pan : "R" + part.pan) : "centre", part.pan === 0),
    row("Delay send", part.delaySend, part.delaySend === 32),
    row("Reverb send", part.reverbSend, part.reverbSend === 64),
    row("Shuffle", part.shuffle ? signed(part.shuffle) : "off", part.shuffle === 0),
    row("Scale", part.resolutionLabel + (part.clocksInferred ? " (length inferred)" : ""), part.resolution === 1),
    row("Direction", part.direction === 0 ? "forward" : part.direction === 1 ? "backward" : `code ${part.direction}`, part.direction === 0),
    row("Motion playback", part.ccPlayback ? "on" : "off", part.ccPlayback),
  ];
}
function presetGroups(d) {
  return [
    ["Delay", [row("State", d.delay.on ? "on" : "off", !d.delay.on), row("Time", d.delay.time + " ms", d.delay.time === 200),
      row("Feedback", d.delay.feedback, d.delay.feedback === 69), row("Level", d.delay.level, d.delay.level === 127)]],
    ["Reverb", [row("State", d.reverb.on ? "on" : "off", !d.reverb.on), row("Type", "code " + d.reverb.type, d.reverb.type === 2, "Type names are not decoded"),
      row("Time", d.reverb.time, d.reverb.time === 26)]],
    ["Keys and arpeggio", [row("Key split", noteName(d.keySplit), d.keySplit === 60), row("Arpeggio rate", "code " + d.arpeggio.rate, d.arpeggio.rate === 3, "Rate names are not decoded"),
      row("Arpeggio transpose", d.arpeggio.transpose ? signed(d.arpeggio.transpose) : "0", d.arpeggio.transpose === 0)]],
  ];
}
/* A titled block of label/value rows, shared by the preset settings and the patch menu settings. */
function settingsBlock(title, rows, wide) {
  const box = document.createElement("div");
  box.className = "sgroup" + (wide ? " wide" : "");
  const h = document.createElement("h3"); h.textContent = title; box.append(h);
  for (const r of rows) {
    const d = document.createElement("div");
    if (r.changed) d.className = "chg";
    if (r.title) d.title = r.title;
    const l = document.createElement("span"); l.textContent = r.label;
    if (r.badge) { const b = document.createElement("span"); b.className = "badge"; b.textContent = r.badge; b.title = `Offset ${r.badge.toLowerCase()}, not confirmed`; l.append(b); }
    const v = document.createElement("span"); v.className = "v"; v.textContent = r.value;
    d.append(l, v); box.append(d);
  }
  return box;
}

function partView(part) {
  const box = document.createElement("div");
  box.className = "part";
  const h = document.createElement("h3");
  const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = part.label;
  const info = document.createElement("span"); info.className = "sub";
  info.textContent = `${part.length} step${part.length > 1 ? "s" : ""} · ${part.resolutionLabel} notes`;
  h.append(lbl, patchLink(part.patch), info);
  box.append(h);
  const chips = document.createElement("div"); chips.className = "chips";
  for (const r of partRows(part)) {
    const c = document.createElement("span"); if (r.changed) c.className = "chg";
    c.textContent = `${r.label} ${r.value}`; chips.append(c);
  }
  box.append(chips);
  const notes = PresetCore.loopNotes(part);
  if (!notes.length) {
    const e = document.createElement("div"); e.className = "sub"; e.textContent = "No notes: every step is a rest.";
    box.append(e);
  } else box.append(roll(part, notes));
  return box;
}

/* Piano roll of one loop: steps across, pitch up. Beats every 4 sixteenths or 2 eighths, bars every 4 beats. */
function roll(part, notes) {
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.append(e);
    return e;
  };
  let lo = Math.min(...notes.map((n) => n.pitch)), hi = Math.max(...notes.map((n) => n.pitch));
  while (hi - lo < 11) { lo--; if (hi - lo < 11) hi++; }
  const rows = hi - lo + 1, rh = Math.max(6, Math.min(12, 300 / rows)), TOP = 6;
  const AX = 34, W = 900, cw = (W - AX) / part.length;
  const bends = part.steps.slice(0, part.length).map((s, i) => [i, s.bend]).filter(([, b]) => b != null);
  const BH = bends.length ? 22 : 0, H = TOP + rows * rh + BH + 14;
  const svg = mk("svg", { class: "roll", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${part.label} sequence` });
  mk("rect", { class: "bg", x: AX, y: TOP, width: W - AX, height: rows * rh }, svg);
  for (let n = lo; n <= hi; n++) {
    const y = TOP + (hi - n) * rh;
    if ([1, 3, 6, 8, 10].includes(n % 12)) mk("rect", { class: "row black", x: AX, y, width: W - AX, height: rh }, svg);
    if (n % 12 === 0) mk("text", { class: "axis", x: 2, y: y + rh - 1 }, svg).textContent = noteName(n);
  }
  const perBeat = part.clocksPerStep ? 24 / part.clocksPerStep : 2;  // steps per quarter note
  for (let i = 0; i <= part.length; i++) {
    if (i % perBeat) continue;
    const x = AX + i * cw;
    mk("line", { class: i % (perBeat * 4) ? "beat" : "bar", x1: x, x2: x, y1: TOP, y2: TOP + rows * rh + BH }, svg);
    if (i < part.length) mk("text", { class: "axis", x: x + 2, y: H - 2 }, svg).textContent = String(i + 1);
  }
  for (const n of notes) {
    const x = AX + n.start * cw, w = Math.max(2, (n.end - n.start) * cw - 1), y = TOP + (hi - n.pitch) * rh + 1;
    const r = mk("rect", { class: n.open ? "note open" : "note", x, y, width: w, height: rh - 2, rx: 1.5,
      "fill-opacity": n.open ? 0 : (0.3 + 0.7 * n.velocity / 127).toFixed(2) }, svg);
    if (n.open) mk("rect", { class: "note", x, y, width: Math.max(2, w - 6), height: rh - 2, rx: 1.5, "fill-opacity": (0.3 + 0.7 * n.velocity / 127).toFixed(2) }, svg);
    mk("title", {}, r).textContent = `${noteName(n.pitch)} · velocity ${n.velocity} · step ${n.start + 1}`
      + (n.open ? ", tied past the last step" : `, ${(n.end - n.start).toFixed(2).replace(/\.00$/, "")} step${n.end - n.start === 1 ? "" : "s"} long`);
  }
  if (BH) {
    const mid = TOP + rows * rh + BH / 2 + 1;
    mk("line", { class: "bendzero", x1: AX, x2: W, y1: mid, y2: mid }, svg);
    mk("text", { class: "axis", x: 2, y: mid + 3 }, svg).textContent = "bend";
    for (const [i, b] of bends) {
      const hgt = Math.max(1, Math.abs(b) / 8192 * (BH / 2 - 2));
      const r = mk("rect", { class: "bend", x: AX + i * cw + 1, y: b >= 0 ? mid - hgt : mid, width: Math.max(2, cw - 2), height: hgt }, svg);
      mk("title", {}, r).textContent = `step ${i + 1}: bend ${b > 0 ? "+" : ""}${b}`;
    }
  }
  return svg;
}

// From the Preset Viewer: show a patch in the Patch Viewer.
function openPatch(loc) {
  hooks.showTab("patches");
  group = loc[0]; $("filter").value = "";
  renderGroups(); renderList();
  select(shown.findIndex((p) => p.loc === loc));
}

view.onhover = (h) => {
  $("info").textContent = h ? `${h.label}: ${h.value}   ·   ${h.cc}   ·   stored ${h.stored}` : "";
};

/* The page hands over the records to show: { label, patches, patterns }, each record { slot, loc, name,
 * bytes, isInit }. The selection stays on the same slot when it is still there. */
function setSource(src) {
  const keepPatch = shown[current] && shown[current].loc, keepPreset = patterns[presetAt] && patterns[presetAt].loc;
  patches = src.patches.filter((p) => p.loc).sort((a, b) => a.slot - b.slot);
  patterns = src.patterns.filter((p) => p.loc).sort((a, b) => a.slot - b.slot);
  $("srcName").textContent = src.label;
  const any = patches.length > 0;
  $("drop").hidden = any;
  $("view").hidden = $("menuCard").hidden = !any;
  const first = patches.find((p) => p.loc === keepPatch) || patches.find((p) => !p.isInit) || patches[0];
  group = first ? first.loc[0] : "A";
  $("filter").value = "";
  renderGroups();
  renderList();
  if (any) select(Math.max(0, shown.findIndex((p) => p === first)));
  renderPatterns(src.label);
  if (keepPreset) { const k = patterns.findIndex((p) => p.loc === keepPreset); if (k >= 0) selectPreset(k); }
}

// Group tabs: A-E, disabled where the file holds nothing (a .j08set may cover only some groups).
function renderGroups() {
  $("groups").replaceChildren(...[..."ABCDE"].map((g) => {
    const b = document.createElement("button");
    b.textContent = g;
    b.className = g === group ? "on" : "";
    b.disabled = !patches.some((p) => p.loc[0] === g);
    b.onclick = () => { group = g; $("filter").value = ""; renderGroups(); renderList(); select(0); $("slots").focus({ preventScroll: true }); };
    return b;
  }));
}

function renderList() {
  const q = $("filter").value.trim().toLowerCase();
  // Typing searches every group; otherwise the list is the selected group.
  shown = q ? patches.filter((p) => p.loc.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q))
            : patches.filter((p) => p.loc[0] === group);
  $("slots").replaceChildren(...shown.map((p, i) => {
    const li = document.createElement("li");
    li.className = (p.isInit ? "init" : "") + (Number(p.loc[1]) % 2 === 0 ? " alt" : "");
    li.innerHTML = `<span class="loc">${p.loc}</span><span></span>`;
    li.lastChild.textContent = p.name;
    li.onclick = () => select(i);
    return li;
  }));
  current = -1;
}

/* The unit's menu settings, grouped as the manual's menus group them rather than in storage order. */
const MENU_GROUPS = [
  ["Voice", ["Solo / poly / unison", "Portamento", "Portamento time", "Portamento curve"]],
  ["Tone and character", ["Vintage filter type", "Coarse tune", "Pitch drift", "Condition", "Param expansion"]],
  ["Bender", ["Bend pitch", "Bend filter"]],
  ["Mod wheel", ["Modulation LFO"]],
  ["Aftertouch", ["Aftertouch LFO", "Aftertouch freq", "Aftertouch level"]],
];
/* "JUNO-106 Chorus, off: ju106 mode 0, ju106 noise level 4": a name, a state, then parameter/value pairs
 * that share a prefix. Anything that does not fit this shape is shown as the unit reported it. */
function effectRows(text) {
  const parts = text.split(", ");
  if (parts.length < 2) return { name: text, rows: [] };
  const name = parts.shift();
  let state = null;
  const m = /^(on|off): /.exec(parts[0]);
  if (m) { state = m[1]; parts[0] = parts[0].slice(m[0].length); }
  const pairs = parts.map((x) => { const k = x.lastIndexOf(" "); return k > 0 ? [x.slice(0, k), x.slice(k + 1)] : null; });
  if (pairs.some((x) => !x)) return { name: text, rows: [] };
  const first = pairs[0][0].split(" ")[0];
  const shared = pairs.length > 1 && pairs.every(([k]) => k.startsWith(first + " "));
  const rows = pairs.map(([k, v]) => ({ label: shared ? k.slice(first.length + 1) : k, value: v }));
  if (state) rows.unshift({ label: "State", value: state });
  return { name, rows };
}
function menuGroups(items) {
  const by = new Map(items.map((m) => [m.label, m]));
  const toRow = (m) => ({ label: m.label, value: m.text, badge: m.confidence !== "Known" ? m.confidence : null });
  const out = [];
  for (const [title, labels] of MENU_GROUPS) {
    const rows = labels.filter((l) => by.has(l)).map((l) => { const m = by.get(l); by.delete(l); return toRow(m); });
    if (rows.length) out.push(settingsBlock(title, rows));
  }
  const fx = by.get("Effect"); by.delete("Effect");
  if (by.size) out.push(settingsBlock("Other", [...by.values()].map(toRow)));
  if (fx) { const e = effectRows(fx.text); out.push(settingsBlock("Effect · " + e.name, e.rows.length ? e.rows : [{ label: "Setting", value: fx.text }], true)); }
  return out;
}

function select(i) {
  if (!shown.length) return;
  i = Math.max(0, Math.min(shown.length - 1, i));
  const lis = $("slots").children;
  if (lis[current]) lis[current].classList.remove("sel");
  current = i;
  lis[i].classList.add("sel");
  // Scroll only the list: scrollIntoView() would scroll the page too, and the panel would jump.
  const list = $("slots"), li = lis[i];
  if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
  else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
  const p = shown[i];
  $("pLoc").textContent = p.loc;
  $("pName").textContent = p.name;
  live = PanelCore.editBuffer(p.bytes);
  $("pEdited").hidden = true;
  if (midi) $("midiSend").disabled = !midi.connected;
  view.update(PanelCore.decode(p.bytes));
  $("menu").replaceChildren(...menuGroups(PanelCore.decodeMenu(p.bytes)));
}

$("filter").oninput = () => { renderList(); if (shown.length) select(0); };
$("slots").onkeydown = (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); select(current + (e.key === "ArrowDown" ? 1 : -1)); }
};
document.addEventListener("keydown", (e) => {
  if (e.target === $("filter") || e.target === $("slots")) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.target.closest && e.target.closest("input, select, textarea")) return;
  const d = e.key === "ArrowDown" ? 1 : -1;
  if (!$("presetsTab").hidden) selectPreset(presetAt + d);
  else if (!$("patchesTab").hidden) select(current + d);
  else return;
  e.preventDefault();
});
/* MIDI. Follow: the unit's panel moves (CCs on the chosen channel) move the drawing, units included,
 * through the same edit-buffer rules the tests check against every factory patch. Send: the shown
 * patch's panel controls into the unit's edit buffer. Nothing here saves on the unit. */
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
$("midiCh").replaceChildren(...Array.from({ length: 16 }, (_, i) => new Option(String(i + 1), String(i + 1))));
$("midiCh").value = store.get("jp08.midiChannel") || "2";  // LOWER answers on channel 2 as the unit ships
if (!PanelMidi.available()) {
  $("midiStatus").textContent = "MIDI needs Chrome or Edge";
  $("midiConnect").hidden = true;
}
const flash = (id) => { view.highlight(id, true); setTimeout(() => view.highlight(id, false), 400); };
$("midiConnect").onclick = async () => {
  try {
    midi = await PanelMidi.connect({
      channel: Number($("midiCh").value),
      onState: (s) => {
        const ok = s.input && s.output;
        $("midiStatus").textContent = ok ? "JUPITER-08 connected" : "JUPITER-08 not found (USB, powered on?)";
        $("midiStatus").className = ok ? "on" : "";
        $("midiSend").disabled = !ok || current < 0;
      },
      onCC: (cc, v) => {
        if (!$("midiFollow").checked || !live || $("view").hidden) return;
        const id = live.apply(cc, v);
        if (!id) return;
        view.update(PanelCore.decode(live.rec));
        $("pEdited").hidden = false;
        flash(id);
      },
    });
    $("midiConnect").hidden = true;
    $("midiChLabel").hidden = $("midiFollowLabel").hidden = $("midiSend").hidden = false;
  } catch (e) {
    $("midiStatus").textContent = `MIDI: ${e.message}`;
  }
};
$("midiCh").onchange = () => { store.set("jp08.midiChannel", $("midiCh").value); if (midi) midi.setChannel(Number($("midiCh").value)); };
$("midiSend").onclick = () => {
  if (!midi || !live) return;
  const ccs = PanelCore.patchCCs(live.rec);
  if (midi.send(ccs)) $("midiStatus").textContent = `sent ${ccs.length} CCs to the edit buffer (not saved)`;
};

/* What the page uses. */
function open(kind, loc) {
  if (kind === "patch") openPatch(loc);
  else { const k = patterns.findIndex((p) => p.loc === loc); if (k >= 0) selectPreset(k); }
}
window.Viewer = { setSource, open, hooks, midiState: () => ({ connected: !!(midi && midi.connected) }) };
})();
