// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Draws the Jupiter-08 panel as SVG and moves its controls. Needs PanelCore (panel-core.js).
 *
 *   const view = PanelView.create(element);
 *   view.update(PanelCore.decode(record));       // whole patch
 *   view.set("cutoff", { pos, text, ... });       // one control, e.g. from an incoming CC
 *   view.onhover = (info) => ...;                 // { control, label, value, cc } or null
 *
 * Laid out as the panel is: narrow faders, wider knobs, slide switches sized to their labels. The
 * one departure is the ENV section, drawn as ENV-1 and ENV-2 side by side where the panel has one
 * set of sliders behind ENV SELECT. One row when the element is wide enough, else two (split
 * before HPF). Plain SVG and DOM, no libraries: any current browser, from file:// as well. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const P = root.PanelCore;

  const TOP = 34, ROW_H = 300, SLIDER_H = 144, SLIDER_Y = 92, GAP = 18, PAD = 10;
  const SWITCH_LABEL_DROP = 9;
  const SW_HEAD = 12, SW_STEP2 = 16;  // room above a vertical switch for its top position's label  // a switch's label down toward its switch
  const INSET = 6, SCALE = 12;  // inside a section band; room for a fader scale ("10 –") left of the first fader
  const WIDTH = { slider: 34, knob: 84 };

  /* Knob faces as printed on the panel (0° is
   * straight up, clockwise positive). Detented knobs: one angle and one marking per position, in
   * panel-core order. Continuous knobs: [value, angle] stops, interpolated. The VCO-2 waveform set is
   * rotated 60° anticlockwise from VCO-1's, as on the unit. */
  const KNOBS = {
    lfo_wave:   { angles: [-60, -30, 0, 30, 60, 90], marks: ["~sine", "~tri", "~sawdown", "~square", "RND", "~noise"] },
    vco1_range: { angles: [-60, -30, 0, 30, 60, 90], marks: ["32'", "16'", "8'", "4'", "2'", "1'"] },
    vco1_wave:  { angles: [-60, -30, 0, 30, 60, 90], marks: ["~sine", "~tri", "~saw", "~pulse", "~square", "NOISE"] },
    // NOISE nudged right so it clears the square symbol beside it (mark index: [dx, dy]).
    vco2_wave:  { angles: [-120, -90, -60, -30, 0, 30], marks: ["~sine", "~tri", "~saw", "~pulse", "~square", "NOISE"], nudge: { 5: [6, 0] } },
    // NORMAL: -12..+24 semitones over a linear 270° sweep, 90° per octave, so 16' 8' 4' 2' sit at
    // -135/-45/+45/+135 and every gap is 90°, the end-stop gap included (the panel
    // prints 8' and 4' at about ±54°). LO FREQ: 0..127 over the same sweep.
    vco2_range: { stops: [[-12, -135], [24, 135]], marks: [[-135, "16'"], [-45, "8'"], [45, "4'"], [135, "2'"]],
                  lo: { stops: [[0, -135], [127, 135]] } },
    vco2_fine:  { stops: [[-50, -150], [50, 150]], ticks: 11, marks: [[-150, "−"], [0, "0"], [150, "+"]] },
    mix:        { stops: [[0, -150], [1, 150]], ticks: 11, marks: [[-150, "1"], [150, "2"]] },
  };

  // Waveform symbols as on the panel, drawn in a 12 x 8 box around (0, 0).
  const GLYPH = {
    sine: "M-6 0 C-4.5 -4.4 -1.5 -4.4 0 0 C1.5 4.4 4.5 4.4 6 0",
    tri: "M-6 3 L-3 -3 L0 3 L3 -3 L6 3",
    saw: "M-6 3 L0 -3 L0 3 L6 -3 L6 3",
    sawdown: "M-6 -3 L0 3 L0 -3 L6 3",
    square: "M-6 3 V-3 H0 V3 H6 V-3",
    pulse: "M-6 3 V-3 H-2 V3 H6 V-3",
    noise: "M-6 0 L-5 -3 L-3.5 2 L-2 -2 L-0.5 3 L1 -3 L2.5 1 L4 -2 L6 2",
    envnormal: "M-8 4 L-5 -4 L-2 -1 L3 -1 L6 4",
    envinvert: "M-8 -4 L-5 4 L-2 1 L3 1 L6 -4",
  };
  /* Silkscreen, as printed on the panel: ↑ above a label, orange source tags under a
   * control with ↑ into it, and brackets where one control feeds another. Keys are control ids, with
   * ".env1"/".env2" for one half of a dual control. */
  const UP = new Set(["lfo_rate", "lfo_delay", "cross_mod", "vco1_range", "vco2_mode", "vco2_fine", "hpf", "cutoff", "res", "slope",
    "vcf_env", "vcf_lfo", "vcf_kf", "level", "vca_lfo", ...["a", "d", "s", "r", "kf"].flatMap((k) => [`env_${k}.env1`, `env_${k}.env2`])]);
  const TAGS = { vco_lfo_mod: ["LFO"], vco_env_mod: ["ENV-1"], cross_mod: ["VCO-2"], mix: ["VCO-1", "VCO-2"],
    vcf_lfo: ["LFO"], vcf_kf: ["KYBD"], level: ["ENV-2"], vca_lfo: ["LFO"] };
  const FADER_TAG = SLIDER_Y + SLIDER_H + 46;         // top of an orange tag under a fader, below its value and unit lines
  const LABEL_GLYPH = { env1_pol: ["envnormal", "envinvert"] };  // ENV-1 POL prints envelope shapes
  const TAG_POSITIONS = new Set(["vcf_env_sel"]);     // the VCF ENV switch's positions are orange ENV-1 / ENV-2 tags
  const CHAIN = [["mix", "hpf"], ["hpf", "vcf"], ["vcf", "vca"]];  // signal path drawn between section bands
  const SPLIT = [["lfo", "vcomod", "vco1", "vco2", "mix"], ["hpf", "vcf", "vca", "env1", "env2"]];
  // Panel orientation of the slide switches: these read bottom-up (FREQ MOD has VCO-1 at the top, VCA
  // LFO MOD has 3), and these two run left to right.
  const BOTTOM_UP = new Set(["freq_mod", "vca_lfo"]);
  const HORIZONTAL = new Set(["vco2_mode", "sync"]);

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor = "middle") {
    const t = el("text", { x, y, class: cls, "text-anchor": anchor }, parent);
    t.textContent = s;
    return t;
  }

  function arrow(parent, x1, y1, x2, y2) {
    el("line", { x1, y1, x2, y2, class: "silk-line" }, parent);
    const a = Math.atan2(y2 - y1, x2 - x1), h = 4;
    const p = (da) => `${x2 - h * Math.cos(a + da)},${y2 - h * Math.sin(a + da)}`;
    el("polygon", { points: `${x2},${y2} ${p(0.5)} ${p(-0.5)}`, class: "silk-head" }, parent);
  }
  function tag(parent, cx, y, s) {
    const w = s.length * 5.4 + 6;
    el("rect", { x: cx - w / 2, y, width: w, height: 12, rx: 2, class: "tag" }, parent);
    text(parent, cx, y + 9, s, "tag-text");
    return w;
  }

  /* Where each control sits, section by section, as on the panel:
   * columns left to right, and within a column the controls top to bottom. `oy` lowers a control
   * from the top of the control area; "env1"/"env2" pick one half of a dual control. The one
   * departure from the panel is ENV, drawn as ENV-1 and ENV-2 side by side. */
  // Printed differently on the panel: the VCO-2 RANGE switch and knob share one "RANGE" label.
  const PANEL_LABEL = { vco2_mode: "RANGE" };
  const MID = 46, LOW = 130;  // a knob level with the faders' centre; the lower of two stacked controls
  const LAYOUT = [
    ["lfo", "LFO", [["lfo_rate"], ["lfo_delay"], [["lfo_wave", MID]]]],
    ["vcomod", "VCO MODULATOR", [["vco_lfo_mod"], ["vco_env_mod"], ["freq_mod", ["pw_mode", 110]], ["pwm"]]],
    ["vco1", "VCO-1", [["cross_mod"], ["vco1_range", ["vco1_wave", LOW]]]],
    ["vco2", "VCO-2", [["vco2_mode", ["vco2_range", 44, "nolabel"], ["sync", 166]], ["vco2_fine", ["vco2_wave", LOW]]]],
    ["mix", "SOURCE", [[["mix", MID]]]],
    ["hpf", "HPF", [["hpf"]]],
    ["vcf", "VCF", [["cutoff"], ["res"], ["slope", ["vcf_env_sel", 110]], ["vcf_env"], ["vcf_lfo"], ["vcf_kf"]]],
    ["vca", "VCA", [["level"], [["vca_lfo", 40]]]],
    ["env1", "ENV-1", [["env_a.env1"], ["env_d.env1"], ["env_s.env1"], ["env_r.env1"], ["env_kf.env1", ["env1_pol", 130]]]],
    ["env2", "ENV-2", [["env_a.env2"], ["env_d.env2"], ["env_s.env2"], ["env_r.env2"], ["env_kf.env2"]]],
  ];

  function sections() {
    const byId = {};
    for (const s of P.SECTIONS) for (const c of s.controls) byId[c.id] = c;
    return LAYOUT.map(([id, label, cols]) => ({
      id, label,
      columns: cols.map((col) => {
        const items = col.map((e) => {
          const [ref, oy = 0, flag] = Array.isArray(e) ? e : [e];
          const [cid, env] = ref.split(".");
          return { c: byId[cid], env, oy, nolabel: flag === "nolabel" };
        });
        // Each control's hover area runs down to the next one in its column.
        items.forEach((it, k) => { it.h = (k + 1 < items.length ? items[k + 1].oy : ROW_H - TOP - 4) - it.oy; });
        return items;
      }),
    }));
  }

  /* A vertical switch sits centred under its name. A two-position one prints its positions above and
   * below the slot, as on the panel; three- and four-position ones (FREQ MOD, PW MODE, VCA LFO MOD)
   * keep every position beside the slot, which reads better. */
  const stacked = (labels) => labels.length === 2;
  const sideLabels = (labels) => (stacked(labels) ? [] : labels);
  function itemWidth(it) {
    if (it.c.kind !== "switch") return WIDTH[it.c.kind];
    if (HORIZONTAL.has(it.c.id)) return 76;
    const labels = P.positions(it.c, it.env), ends = stacked(labels) ? labels : [];
    const endW = LABEL_GLYPH[it.c.id] ? 24 : Math.max(0, ...ends.map((l) => l.length * 5.4 + (TAG_POSITIONS.has(it.c.id) ? 6 : 0) + 10));
    const side = sideLabels(labels), sideW = side.length ? 2 * (12 + Math.max(...side.map((l) => l.length)) * 5.2) : 0;
    return Math.max(40, endW, sideW);
  }

  /* Each control draws into its column (centre x, width w) and returns a setter for its value. */
  const DRAW = {
    slider(g, it, x, w, first) {
      const y0 = SLIDER_Y, y1 = SLIDER_Y + SLIDER_H;
      for (let i = 0; i <= 10; i++) {
        const y = y1 - (i * SLIDER_H) / 10;
        el("line", { x1: x - 11, x2: x - 6, y1: y, y2: y, class: i % 5 ? "tick" : "tick major" }, g);
        const s = it.c.id === "hpf" ? { 10: "HI", 0: "LO" }[i] : String(i);  // the HPF scale reads HI / LO
        if (first && i % 5 === 0 && s) text(g, x - 14, y + 3, s, "scale", "end");
      }
      el("rect", { x: x - 2.5, y: y0, width: 5, height: SLIDER_H, rx: 2, class: "track" }, g);
      const cap = el("g", { class: "cap" + (it.env ? ` ${it.env}` : "") }, g);
      el("rect", { x: x - 9, y: -6, width: 18, height: 12, rx: 1.5, class: "capbody" }, cap);
      el("line", { x1: x - 7, x2: x + 7, y1: 0, y2: 0, class: "capline" }, cap);
      const val = text(g, x, y1 + 24, "", "val");
      const unit = text(g, x, y1 + 36, "", "unit");  // measured physical value, where calibrated
      return (u) => {
        cap.setAttribute("transform", `translate(0 ${u.pos == null ? y1 : y1 - u.pos * SLIDER_H})`);
        cap.classList.toggle("unknown", u.pos == null);
        val.textContent = u.text;
        unit.textContent = u.unitText || "";
      };
    },

    knob(g, it, x) {
      const c = it.c, cy = SLIDER_Y + 28 + it.oy, r = 17, geo = KNOBS[c.id];
      const rad = (deg) => (deg * Math.PI) / 180;
      const at = (deg, d) => [x + Math.sin(rad(deg)) * d, cy - Math.cos(rad(deg)) * d];
      const tick = (deg, d0, d1, cls = "tick") => { const [x1, y1] = at(deg, d0), [x2, y2] = at(deg, d1); el("line", { x1, y1, x2, y2, class: cls }, g); };
      const mark = (deg, m, i) => {
        const [dx, dy] = (geo.nudge && geo.nudge[i]) || [0, 0];
        const [ax, ay] = at(deg, r + 17), mx = ax + dx, my = ay + dy;
        if (m.startsWith("~")) el("path", { d: GLYPH[m.slice(1)], transform: `translate(${mx} ${my})`, class: "glyph" }, g);
        else text(g, mx, my + 3, m, "mark");
      };
      if (geo.angles) geo.angles.forEach((deg, i) => { tick(deg, r + 2, r + 6); mark(deg, geo.marks[i], i); });
      else {
        const [lo, hi] = [geo.stops[0][1], geo.stops[geo.stops.length - 1][1]];
        for (let i = 0; i < (geo.ticks || 0); i++) tick(lo + (i * (hi - lo)) / (geo.ticks - 1), r + 2, r + 6);
        for (const [deg, m] of geo.marks) { tick(deg, r + 2, r + 7, "tick major"); mark(deg, m); }
      }
      el("circle", { cx: x, cy, r, class: "knobface" }, g);
      const ptr = el("line", { x1: x, y1: cy - 4, x2: x, y2: cy - r + 2, class: "pointer" }, g);
      // The value sits just under the knob, below the lowest marking printed beneath it (VCO-2 RANGE's
      // 16'/2', FINE TUNE's -/+); LFO and VCO-1 have none, so theirs sits close. MIX keeps its place.
      const degs = geo.angles || geo.marks.map(([deg]) => deg);
      const below = Math.max(r, ...degs.map((deg) => -Math.cos(rad(deg)) * (r + 17) + 5));
      const vy = c.id === "mix" ? cy + r + 30 : cy + below + 13;
      const val = text(g, x, vy, "", "val knobval");
      const sub = text(g, x, vy + 12, "", "sub");
      it.bottom = vy + 15;  // below the second value line, which hover areas must not cut through
      return (v) => {
        const deg = angle(geo, c, v);
        ptr.setAttribute("transform", `rotate(${deg == null ? 0 : deg} ${x} ${cy})`);
        ptr.classList.toggle("unknown", deg == null);
        val.textContent = v.text;
        sub.textContent = v.mode === "LO FREQ" ? ["LO FREQ", v.unitText].filter(Boolean).join(" · ")
          : c.id === "mix" ? "VCO-1 : VCO-2" : v.unitText || "";
      };
    },

    // A slide switch: a slot with a thumb at the stored position, labels to its right.
    switch(g, it, x, w) {
      const labels = P.positions(it.c, it.env), n = labels.length, top = SLIDER_Y + 8 + it.oy;
      const thumb = el("rect", { width: 8, height: 10, rx: 1.5, class: "thumb" + (it.env ? ` ${it.env}` : "") });
      let place;
      if (HORIZONTAL.has(it.c.id)) {
        // Two positions side by side, labels above, as VCO-2 RANGE and SYNC are on the panel.
        const step = 38, sx = x - step / 2;
        labels.forEach((s, i) => text(g, sx + i * step, top + 1, s, "pos small"));
        el("rect", { x: sx - 8, y: top + 7, width: step + 16, height: 12, rx: 2, class: "slot" }, g);
        thumb.setAttribute("width", 12); thumb.setAttribute("height", 8);
        place = (i) => thumb.setAttribute("transform", `translate(${sx + i * step - 6} ${top + 9})`);
        it.bottom = top + 22;
      } else {
        const two = stacked(labels), step = two ? SW_STEP2 : 20, sx = x, row = (i) => (BOTTOM_UP.has(it.c.id) ? n - 1 - i : i);
        const t0 = top + (two ? SW_HEAD : 0);
        const side = new Set(sideLabels(labels));
        el("rect", { x: sx - 5, y: t0 - 8, width: 10, height: (n - 1) * step + 16, rx: 2, class: "slot" }, g);
        labels.forEach((s, i) => {
          const r = row(i), ly = t0 + r * step;
          const [lx, lyy] = side.has(s) ? [sx + 9, ly] : r === 0 ? [sx, t0 - 14] : [sx, t0 + (n - 1) * step + 15];
          if (LABEL_GLYPH[it.c.id]) el("path", { d: GLYPH[LABEL_GLYPH[it.c.id][i]], transform: `translate(${lx} ${lyy})`, class: "glyph" }, g);
          else if (TAG_POSITIONS.has(it.c.id)) tag(g, lx, lyy - 6, s);
          else if (side.has(s)) text(g, lx, lyy + 3, s, "pos", "start");
          else text(g, lx, lyy + 3, s, "pos");
        });
        place = (i) => thumb.setAttribute("transform", `translate(${sx - 4} ${t0 + row(i) * step - 5})`);
        it.bottom = t0 + (n - 1) * step + (two ? 21 : 11);  // under the slot, or the label printed below it
      }
      g.appendChild(thumb);
      // The thumb beside its label is the value. When the patch holds no position (ENV-1 POL with ENV
      // MOD at 0), an empty outline sits between the positions; hovering says why.
      return (u) => {
        const known = u.index >= 0;
        place(known ? u.index : (n - 1) / 2);
        thumb.classList.toggle("unset", !known);
      };
    },
  };

  // Pointer angle for a decoded value: the detent's printed angle, or interpolated between stops.
  function angle(geo, c, v) {
    if (geo.angles) return v.index >= 0 ? geo.angles[v.index] : null;
    if (v.pos == null) return null;
    const stops = v.mode === "LO FREQ" ? geo.lo.stops : geo.stops;
    const x = c.id === "mix" ? v.pos : v.mode === "LO FREQ" ? v.stored : v.stored;
    for (let i = 1; i < stops.length; i++) {
      const [x0, a0] = stops[i - 1], [x1, a1] = stops[i];
      if (x <= x1 || i === stops.length - 1) return a0 + ((Math.min(Math.max(x, x0), x1) - x0) * (a1 - a0)) / (x1 - x0);
    }
    return null;
  }

  function create(container) {
    const view = { svg: null, onhover: null, values: {} };
    let setters = {}, groups = {}, rows = null, led = null, oneRowWidth = 0;

    function layout(nRows) {
      const secs = sections(), byId = Object.fromEntries(secs.map((s) => [s.id, s]));
      const rowIds = nRows === 1 ? [secs.map((s) => s.id)] : SPLIT;
      const colWidth = (col) => Math.max(...col.map(itemWidth));
      // The section's first fader carries the scale, so its column is wider by SCALE on the left.
      const hasScale = (s) => s.columns.some((col) => col.some((it) => it.c.kind === "slider"));
      const secWidth = (s) => s.columns.reduce((w, col) => w + colWidth(col), 0) + 2 * INSET + (hasScale(s) ? SCALE : 0);
      const rowWidth = (ids) => ids.reduce((w, id) => w + secWidth(byId[id]), 0) + (ids.length - 1) * GAP + 2 * PAD;
      const width = Math.max(...rowIds.map(rowWidth)), H = rowIds.length * ROW_H;
      const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, class: "jp-panel", role: "img", "aria-label": "Jupiter-08 panel" });
      el("rect", { x: 0, y: 0, width, height: H, rx: 8, class: "face" }, svg);
      setters = {}; groups = {};
      rowIds.forEach((ids, r) => {
        const row = el("g", { transform: `translate(${(width - rowWidth(ids)) / 2} ${r * ROW_H})` }, svg);
        let x = PAD, prev = null;
        for (const s of ids.map((id) => byId[id])) {
          const w = secWidth(s);
          el("rect", { x, y: TOP - 18, width: w, height: 16, rx: 2, class: "band" }, row);  // spans everything below it
          text(row, x + w / 2, TOP - 6, s.label, "band-label");
          let cx = x + INSET, firstSlider = true;
          const geo = {};
          for (const col of s.columns) {
           const scaled = firstSlider && col.some((it) => it.c.kind === "slider");
           const iw = colWidth(col) + (scaled ? SCALE : 0);
           // A one-control section (HPF, SOURCE) centres it under the band; the scale hangs to its left.
           const mid = s.columns.length === 1 ? x + w / 2 : cx + iw / 2 + (scaled ? SCALE / 2 : 0);
           for (const it of col) {
            const g = el("g", { class: `ctl is-${it.c.kind}`, "data-id": it.c.id }, row);
            it.hit = el("rect", { x: cx, y: TOP + it.oy, width: iw, height: it.h, class: "hit" }, g);
            // A switch's name sits just above the switch, as on the panel (FREQ MOD hangs below LFO MOD / ENV MOD).
            // As printed: a switch fed by a ↑ arrow keeps its name in the top row (VCO-2 RANGE, SLOPE, VCA LFO
            // MOD, ENV KEY FOLLOW); the others hang just above their switch (FREQ MOD, PW MODE, ENV-1 POL).
            const key = it.c.id + (it.env ? `.${it.env}` : "");
            const loy = it.c.kind === "switch" ? (UP.has(key) ? 0 : it.oy + SWITCH_LABEL_DROP) : it.oy;
            const lines = it.nolabel ? 0 : label(g, PANEL_LABEL[it.c.id] || it.c.label, mid, iw - (scaled ? SCALE : 0), loy);  // wrap to the control, not its scale
            geo[key] = { it, mid, left: cx, right: cx + iw, lines, loy };
            const set = DRAW[it.c.kind](g, it, mid, iw, it.c.kind === "slider" && firstSlider);
            if (it.c.kind === "slider") firstSlider = false;
            const sid = it.c.id, prev = setters[sid];
            // A dual control has one setter per envelope; the view's setter feeds each its half.
            setters[sid] = it.env ? (v) => { if (prev) prev(v); set(v[it.env]); } : set;
            (groups[sid] = groups[sid] || []).push(g);
            g.addEventListener("pointerenter", () => view.onhover && view.onhover(describe(it, view.values[sid])));
            g.addEventListener("pointerleave", () => view.onhover && view.onhover(null));
           }
           // A knob's value can hang past the next control's top (VCO-2 RANGE over SYNC, FINE TUNE over
           // WAVEFORM); the boundary between their hover areas moves down to clear it.
           for (let k = 1; k < col.length; k++) {
             const above = col[k - 1], it = col[k], y0 = TOP + it.oy, y = Math.max(y0, above.bottom || 0);
             it.hit.setAttribute("y", y); it.hit.setAttribute("height", it.h - (y - y0));
             above.hit.setAttribute("height", y - +above.hit.getAttribute("y"));
           }
           cx += iw;
          }
          silk(row, s, geo);
          if (s.id === "lfo") led = lfoLed(row, x + 12);
          const link = CHAIN.find(([a, b]) => b === s.id && prev === a);
          if (link) arrow(row, x - GAP + 1, TOP - 10, x - 1, TOP - 10);
          prev = s.id;
          x += w + GAP;
        }
      });
      svg.style.maxWidth = `${Math.round(width * 1.3)}px`;
      svg.style.minWidth = `${Math.round(width * 0.8)}px`;
      if (view.svg) view.svg.replaceWith(svg); else container.appendChild(svg);
      view.svg = svg;
      rows = nRows;
      if (nRows === 1) oneRowWidth = width;
      for (const id in view.values) if (setters[id]) setters[id](view.values[id]);
      if (led) led(view.values.lfo_rate, view.values.lfo_wave);
    }

    // One row only when it can be drawn at nearly full size; narrower, two rows (split before HPF).
    const fit = () => {
      const want = container.clientWidth >= oneRowWidth * 0.95 ? 1 : 2;
      if (want !== rows) layout(want);
    };
    layout(1);  // measures the one-row drawing
    fit();
    if (root.ResizeObserver) new ResizeObserver(fit).observe(container);
    else root.addEventListener("resize", fit);

    view.set = (id, v) => {
      view.values[id] = v;
      if (setters[id]) setters[id](v);
      if ((id === "lfo_rate" || id === "lfo_wave") && led) led(view.values.lfo_rate, view.values.lfo_wave);
    };
    view.update = (values) => { for (const id in values) view.set(id, values[id]); };
    view.highlight = (id, on) => (groups[id] || []).forEach((g) => g.classList.toggle("lit", on));
    return view;
  }

  // Wrap to the column (about 5.4 px per 9 px capital), up to three lines, bottom-aligned.
  function label(g, s, x, w, oy = 0) {
    const lines = [];
    for (const word of s.split(" ")) {
      const last = lines[lines.length - 1];
      if (last && (last + " " + word).length * 5.4 <= w - 8) lines[lines.length - 1] = last + " " + word;
      else lines.push(word);
    }
    lines.forEach((l, i) => text(g, x, TOP + 38 + oy - (lines.length - 1 - i) * 10, l, "ctl-label"));
    return lines.length;
  }

  // The LFO band's LED, flashing at the patch's LFO rate (measured curve; extended below its span).
  /* Its brightness follows the LFO WAVEFORM: SINE swells and fades, TRI ramps, SAW-DW fades then snaps
   * back, SQR switches, RND jumps to a new level each cycle and CHAOS wanders. The periodic shapes are
   * CSS animations (lfo-<wave> in panel.html); the random ones are stepped here. */
  const LED_WAVE = ["sine", "tri", "sawdown", "square", "random", "chaos"];
  function lfoLed(row, x) {
    el("circle", { cx: x, cy: TOP - 10, r: 4.2, class: "lfo-led-base" }, row);
    const c = el("circle", { cx: x, cy: TOP - 10, r: 4.2, class: "lfo-led" }, row);
    let timer = null;
    return (rate, wave) => {
      clearInterval(timer); timer = null;
      const hz = rate && rate.physical && rate.physical.raw, shape = wave && LED_WAVE[wave.index];
      const period = hz ? Math.max(1 / hz, 0.04) : 0;
      c.setAttribute("class", "lfo-led" + (hz ? ` lfo-${shape || "sine"}` : " off"));
      c.style.animationDuration = period ? `${period.toFixed(3)}s` : "";
      c.style.opacity = "";
      c.style.transitionDuration = shape === "chaos" ? `${period.toFixed(3)}s` : "0s";
      const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (period && (shape === "random" || shape === "chaos") && !reduced)
        timer = setInterval(() => { c.style.opacity = (0.08 + Math.random() * 0.92).toFixed(2); }, period * 1000);
    };
  }

  function silk(row, s, geo) {
    const g = el("g", { class: "silk" }, row);
    const labelTop = (k) => TOP + 38 + geo[k].loy - (geo[k].lines - 1) * 10 - 9;
    const sliderFoot = SLIDER_Y + SLIDER_H + 41;  // just under a fader's value and unit lines
    const foot = (k) => {
      const it = geo[k].it;
      if (it.c.kind === "slider") return sliderFoot;
      if (it.c.kind === "switch") {
        const n = P.positions(it.c, it.env).length;
        if (HORIZONTAL.has(it.c.id)) return SLIDER_Y + 8 + it.oy + 24;
        return n === 2 ? SLIDER_Y + 8 + SW_HEAD + it.oy + SW_STEP2 + 24  // under the bottom label
                       : SLIDER_Y + 8 + it.oy + (n - 1) * 20 + 12;
      }
      return SLIDER_Y + 28 + it.oy + 17 + 48;  // a knob: under its value and note
    };
    for (const k in geo) {
      const { mid, it } = geo[k];
      // All ↑ arrows share one tip height just under the band, and one tail height; a control lower in
      // its column extends its tail down to its own label.
      if (UP.has(k) && geo[k].lines) arrow(g, mid, geo[k].loy ? labelTop(k) - 1 : TOP + 10, mid, TOP - 1);
      const tags = TAGS[k];
      if (tags) tags.forEach((name, i) => {
        const tx = mid + (tags.length > 1 ? (i - 0.5) * 34 : 0);
        // Under a fader the tag sits just below its value; under a switch or knob, right below the control.
        const ty = it.c.kind === "slider" ? FADER_TAG : foot(k) + 10;
        tag(g, tx, ty, name);
        // A fader's tag points up at the fader; elsewhere a short arrow, as on the panel.
        arrow(g, tx, ty - 1, tx, ty - (it.c.kind === "slider" ? 7 : 9));
      });
    }
    // Brackets: one control feeding another.
    const bracket = (from, to) => {
      if (!geo[from] || !geo[to]) return;
      const y = FADER_TAG + 6, x1 = geo[from].mid, x2 = geo[to].mid;
      el("polyline", { points: `${x1},${foot(from)} ${x1},${y} ${x2},${y}`, class: "silk-line" }, g);
      arrow(g, x2, y, x2, FADER_TAG - 7);
    };
    bracket("pw_mode", "pwm");          // PW MODE's ENV-1 drives PULSE WIDTH MOD
    bracket("vcf_env_sel", "vcf_env");  // the chosen envelope drives VCF ENV MOD
    if (geo.vco_lfo_mod && geo.freq_mod) {  // LFO MOD and ENV MOD both go to FREQ MOD
      const y = TOP + 9, xl = geo.vco_lfo_mod.mid, xe = geo.vco_env_mod.mid, xf = geo.freq_mod.mid;
      el("polyline", { points: `${xl},${labelTop("vco_lfo_mod") - 1} ${xl},${y} ${xf},${y}`, class: "silk-line" }, g);
      el("line", { x1: xe, y1: labelTop("vco_env_mod") - 1, x2: xe, y2: y, class: "silk-line" }, g);
      arrow(g, xf, y, xf, labelTop("freq_mod") - 1);
    }
    for (const env of ["env1", "env2"]) {  // KYBD straight under ENV KEY FOLLOW, ↑ into the switch
      const k = `env_kf.${env}`;
      if (!geo[k]) continue;
      const sx = geo[k].mid, bottom = foot(k) - 2, ty = bottom + 12;
      tag(g, sx, ty, "KYBD");
      arrow(g, sx, ty - 1, sx, bottom);
    }
  }

  function describe(it, v) {
    if (!v) return null;
    const c = it.c, u = it.env ? v[it.env] : v;
    const ccs = it.env ? `CC ${c.dual[it.env].cc}` : c.id === "mix" ? "CC 16 / 17" : c.id === "vco2_range" ? `CC ${v.cc_number}`
      : c.id === "env1_pol" ? "CC 106" : `CC ${c.cc}`;
    const name = it.env ? `${it.env === "env1" ? "ENV-1" : "ENV-2"} ${c.label}` : c.label;
    return { control: c.id, env: it.env || null, label: name, value: u.unitText ? `${u.text} (${u.unitText})` : u.text, cc: ccs, stored: u.stored };
  }

  root.PanelView = { create };
})(this);
