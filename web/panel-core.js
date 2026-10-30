// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Jupiter-08 panel model: where every panel control sits for a stored patch record.
 * No DOM; loaded by panel.html and by tests under node (module.exports).
 *
 * Each control decodes to { pos, cc, text } and, for the ENV sliders, one per envelope:
 *   pos   0..1, how far along its travel the control sits (what the panel view draws)
 *   cc    0..127, the CC value the unit sends at that position (what a MIDI editor exchanges)
 *   text  the value as the manual shows it ("87", "-24dB", "16'")
 * Offsets and CC numbers come from maps/jp08-to-core.json and maps/jp08-round2-offsets.json;
 * web/test-panel.js checks them against those maps. Position order and labels are the manual's
 * (reference manual pp. 4-10). Where a map holds two copies, the last is the panel field. */
(function (root) {
  "use strict";

  const read = {
    u8: (b, o) => b[o],
    s8: (b, o) => (b[o] << 24) >> 24,
    u16: (b, o) => b[o] | (b[o + 1] << 8),
    s16: (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16,
  };
  const field = (at, type) => ({ at, type });
  const get = (rec, f) => read[f.type](rec, f.at);

  // A continuous control: stored [lo, hi] maps linearly onto the panel's [dlo, dhi] display.
  const lin = (lo, hi, dlo = 0, dhi = 127) => ({ kind: "linear", lo, hi, dlo, dhi });
  // A switch or detented knob: stored codes in panel order, with the manual's labels.
  const opts = (pairs, ccMode = "round") => ({ kind: "options", ccMode, options: pairs.map(([v, label]) => ({ v, label })) });

  const WAVES = ["SINE", "TRI", "SAW", "PW", "SQR", "NOISE"];
  const ENVS = ["env1", "env2"];

  /* Sections left to right as on the panel. `dual` controls hold one value per envelope (the panel
   * has one set of A/D/S/R sliders and an ENV SELECT switch). `custom` controls decode themselves. */
  const SECTIONS = [
    { id: "lfo", label: "LFO", controls: [
      { id: "lfo_rate", label: "RATE", kind: "slider", cc: 29, f: field(1650, "u16"), map: lin(0, 1023), unit: "lfo_hz" },
      { id: "lfo_delay", label: "DELAY TIME", kind: "slider", cc: 27, f: field(1652, "u16"), map: lin(0, 1023), unit: "lfo_delay_s" },
      // Stored codes 1 and 8 were not reached by the round-1 sweep; their places follow panel order
      // and the six codes found across every saved patch (0, 1, 3, 4, 7, 8).
      { id: "lfo_wave", label: "WAVEFORM", kind: "knob", cc: 35, f: field(1649, "u8"),
        map: opts([[0, "SINE"], [1, "TRI"], [3, "SAW-DW"], [4, "SQR"], [7, "RANDOM"], [8, "CHAOS"]]) },
    ] },
    { id: "vcomod", label: "VCO MODULATOR", controls: [
      { id: "vco_lfo_mod", label: "LFO MOD", kind: "slider", cc: 26, f: field(1654, "u8"), map: lin(0, 100, 0, 100), unit: "vco_lfo_mod_cents" },
      { id: "vco_env_mod", label: "ENV MOD", kind: "slider", cc: 25, f: field(1655, "s8"), map: lin(0, 100, 0, 100), magnitude: true, unit: "vco_env_mod_cents" },
      // Measured on the unit: 0 modulates VCO-2.
      { id: "freq_mod", label: "FREQ MOD", kind: "switch", cc: 60, f: field(1656, "u8"),
        map: opts([[0, "VCO-2"], [1, "BOTH"], [2, "VCO-1"]]) },
      // Its unit (duty cycle) holds only with PW MODE on MAN.; with LFO or ENV-1 PWM is a depth, unmeasured.
      { id: "pwm", label: "PULSE WIDTH MOD", kind: "slider", cc: 18, f: field(1666, "u8"), map: lin(0, 127), unit: "pulse_width_pct" },
      { id: "pw_mode", label: "PW MODE", kind: "switch", cc: 19, f: field(1667, "u8"),
        map: opts([[0, "LFO"], [1, "MAN."], [2, "ENV-1"]], "floor") },  // the panel prints "M"; MAN. reads clearer
    ] },
    { id: "vco1", label: "VCO-1", controls: [
      { id: "cross_mod", label: "CROSS MOD", kind: "slider", cc: 59, f: field(1688, "u16"), map: lin(0, 10800), unit: "cross_mod_cents" },
      { id: "vco1_range", label: "RANGE", kind: "knob", cc: 20, f: field(1660, "u8"),
        map: opts([[0, "32'"], [1, "16'"], [2, "8'"], [3, "4'"], [4, "2'"], [5, "1'"]]) },
      { id: "vco1_wave", label: "WAVEFORM", kind: "knob", cc: 46, f: field(1658, "u8"), map: opts(WAVES.map((w, i) => [10 + i, w])) },
    ] },
    { id: "vco2", label: "VCO-2", controls: [
      { id: "vco2_mode", label: "RANGE MODE", kind: "switch", cc: 57, f: field(1676, "u8"),
        map: opts([[0, "NORMAL"], [1, "LO FREQ"]], "floor") },
      { id: "vco2_range", label: "RANGE", kind: "knob", custom: "vco2_range" },
      { id: "vco2_wave", label: "WAVEFORM", kind: "knob", cc: 61, f: field(1670, "u8"), map: opts(WAVES.map((w, i) => [10 + i, w])) },
      { id: "sync", label: "SYNC", kind: "switch", cc: 87, f: field(1690, "u8"), map: opts([[3, "OFF"], [1, "ON"]], "floor") },
      { id: "vco2_fine", label: "FINE TUNE", kind: "knob", cc: 56, f: field(1674, "s8"), map: lin(-50, 50, -50, 50), unit: "fine_tune_cents", signedUnit: true },
    ] },
    { id: "mix", label: "SOURCE", controls: [
      { id: "mix", label: "MIX", kind: "knob", custom: "mix" },
    ] },
    { id: "hpf", label: "HPF", controls: [
      { id: "hpf", label: "CUTOFF FREQ", kind: "slider", cc: 79, f: field(1700, "u16"), map: lin(0, 1023), unit: "hpf_hz" },
    ] },
    { id: "vcf", label: "VCF", controls: [
      { id: "cutoff", label: "CUTOFF FREQ", kind: "slider", cc: 3, f: field(1702, "u16"), map: lin(0, 1023), unit: "cutoff_hz" },
      { id: "res", label: "RES", kind: "slider", cc: 9, f: field(1704, "u16"), map: lin(0, 1023), unit: "resonance_db" },
      { id: "slope", label: "SLOPE", kind: "switch", cc: 13, f: field(1709, "u8"), map: opts([[0, "-12dB"], [2, "-24dB"]], "floor") },
      { id: "vcf_env_sel", label: "ENV", kind: "switch", cc: 84, f: field(1708, "u8"), map: opts([[0, "ENV-1"], [1, "ENV-2"]], "floor") },
      // The stored sign is the filter envelope's polarity; it is shown on the value, not the cap.
      { id: "vcf_env", label: "ENV MOD", kind: "slider", cc: 81, f: field(1706, "s16"), map: lin(0, 1023), magnitude: true, signed: true },
      { id: "vcf_lfo", label: "LFO MOD", kind: "slider", cc: 28, f: field(1712, "u8"), map: lin(0, 100, 0, 100) },
      { id: "vcf_kf", label: "KEY FOLLOW", kind: "slider", cc: 82, f: field(1710, "u8"), map: lin(0, 200) },
    ] },
    { id: "vca", label: "VCA", controls: [
      { id: "level", label: "LEVEL", kind: "slider", cc: 110, f: field(1714, "u8"), map: lin(0, 127), unit: "level_db" },
      { id: "vca_lfo", label: "LFO MOD", kind: "switch", cc: 109, f: field(1716, "u8"),
        map: opts([[0, "0"], [1, "1"], [2, "2"], [3, "3"]], "floor"), unit: "vca_lfo_db", zeroIsOff: true },
    ] },
    { id: "env", label: "ENV", controls: [
      { id: "env_a", label: "A", kind: "slider", dual: { env1: { cc: 83, f: field(1718, "u16"), unit: "env1_attack_s" }, env2: { cc: 89, f: field(1728, "u16"), unit: "attack_s" } }, map: lin(0, 1023) },
      { id: "env_d", label: "D", kind: "slider", dual: { env1: { cc: 80, f: field(1720, "u16"), unit: "env1_decay_s" }, env2: { cc: 90, f: field(1730, "u16"), unit: "decay_s" } }, map: lin(0, 1023) },
      { id: "env_s", label: "S", kind: "slider", dual: { env1: { cc: 85, f: field(1722, "u16"), unit: "percent" }, env2: { cc: 102, f: field(1732, "u16"), unit: "percent" } }, map: lin(0, 1023) },
      { id: "env_r", label: "R", kind: "slider", dual: { env1: { cc: 86, f: field(1724, "u16"), unit: "env1_release_s" }, env2: { cc: 103, f: field(1734, "u16"), unit: "release_s" } }, map: lin(0, 1023) },
      { id: "env_kf", label: "KEY FOLLOW", kind: "switch",
        dual: { env1: { cc: 104, f: field(1727, "u8"), map: opts([[0, "OFF"], [5, "ON"]], "floor") },
                env2: { cc: 105, f: field(1738, "u8"), map: opts([[0, "OFF"], [2, "ON"]], "floor") } } },
      { id: "env1_pol", label: "ENV-1 POL", kind: "switch", custom: "env1_pol" },
    ] },
  ];

  /* Settings reached through MENU, not the panel. `confidence` is the map's; anything short of
   * Known is shown as such. Offsets are maps/jp08-round2-offsets.json unless noted. */
  const MENU = [
    { id: "filter_type", label: "Vintage filter type", f: field(1698, "u8"), confidence: "Observed",
      format: (v) => ({ 1: "1 Jupiter", 2: "2 (Moog?)", 3: "3 (Sequential?)" })[v] || String(v) },
    { id: "coarse", label: "Coarse tune", f: field(41, "s8"), confidence: "Known", format: signed },
    { id: "drift", label: "Pitch drift", f: field(1742, "u8"), confidence: "Known" },
    { id: "condition", label: "Condition", f: field(1753, "u8"), confidence: "Known" },
    { id: "exp", label: "Param expansion", f: field(1752, "u8"), confidence: "Known", format: (v) => (v ? "On" : "OFF") },
    { id: "porta_sw", label: "Portamento", cc: 118, f: field(1750, "u8"), confidence: "Likely", format: (v) => (v ? "on" : "off") },
    { id: "porta_time", label: "Portamento time", f: field(1748, "u16"), confidence: "Known" },
    { id: "porta_curve", label: "Portamento curve", f: field(1754, "u8"), confidence: "Known",
      format: (v) => ["orG", "LinE", "E.1", "E.2"][v] || String(v) },
    { id: "poly", label: "Solo / poly / unison", cc: 119, f: field(1751, "u8"), confidence: "Likely",
      format: (v) => ["poly", "solo", "unison", "solo"][v] || String(v) },
    { id: "bend_pitch", label: "Bend pitch", cc: 41, f: field(57, "u8"), confidence: "Known" },  // maps/jp08-to-core.json
    { id: "bend_filter", label: "Bend filter", f: field(1744, "s8"), confidence: "Known", format: signed },
    { id: "mod_lfo", label: "Modulation LFO", f: field(1745, "s8"), confidence: "Known", format: signed },
    { id: "aft_lfo", label: "Aftertouch LFO", f: field(1755, "s8"), confidence: "Known", format: signed },
    { id: "aft_freq", label: "Aftertouch freq", f: field(1756, "s8"), confidence: "Known", format: signed },
    { id: "aft_level", label: "Aftertouch level", f: field(1757, "s8"), confidence: "Known", format: signed },
    // CHORUS/MFX as ZEN-Core stores it (maps/jp08-mfx.json): +80 type, +81 switch, then the type's
    // parameters as u16 from +96 in the unit's register order.
    { id: "effect", label: "Effect", f: field(80, "u8"), confidence: "Known", formatRec: effectText },
  ];

  function signed(v) { return v > 0 ? `+${v}` : String(v); }

  const MFX = typeof module !== "undefined" && module.exports ? require("./jp08-mfx.js") : root.PanelMfx;
  function effectText(rec) {
    const t = MFX && MFX[rec[80]];
    if (!t) return `type ${rec[80]} (unknown)`;
    const params = t.params.map(([name, o]) => `${name.toLowerCase().replace(/_/g, " ")} ${rec[o] | (rec[o + 1] << 8)}`);
    return `${t.name}${t.in_menu ? "" : " (not in the menu)"}, ${rec[81] ? "on" : "off"}: ${params.join(", ")}`;
  }

  /* Physical units from the calibration measured on the unit (CALIBRATION.md; curves embedded in
   * jp08-curves.js by tools/build_web_curves.py). The same interpolation as tools/physcurves.py
   * to_physical, so the viewer and the converter agree. Param Expansion picks the curve where both
   * were measured; the ENV curves exist for EXP off only and are used for both, as physcurves does.
   * Outside the measured span the value is shown as a bound ("< 0.11 Hz"), never extrapolated. */
  const CURVES = typeof module !== "undefined" && module.exports ? require("./jp08-curves.js") : root.PanelCurves;

  function physical(metric, native, exp) {
    if (metric === "percent") return { value: (native / 1023) * 100, raw: (native / 1023) * 100, unit: "%" };
    const modes = CURVES && CURVES.metrics[metric];
    if (!modes) return null;
    const c = (exp && modes.on) || modes.off || modes.default;
    const [lo, hi] = c.measured_span || [c.points[0][0], c.points[c.points.length - 1][0]];
    const bound = native < lo ? "<" : native > hi ? ">" : "";
    const x = Math.min(Math.max(native, lo), hi);
    const log = c.interpolate === "log", pts = c.points.map(([px, py]) => [px, log ? Math.log(py) : py]);
    let [a, b] = [pts[0], pts[1]];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { [a, b] = [pts[i - 1], pts[i]]; break; } else [a, b] = [pts[i - 1], pts[i]];
    const at = (u) => (b[0] !== a[0] ? a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]) : a[1]);
    const y = at(x), yRaw = at(native);  // raw: the end segment extended, for animation only (the LFO LED)
    return { value: log ? Math.exp(y) : y, raw: log ? Math.exp(yRaw) : yRaw, unit: c.unit, bound };
  }

  function fmtPhysical(p) {
    if (!p) return "";
    const v = p.value, n = (x, d) => (x >= 100 || d === 0 ? Math.round(x) : Number(x.toFixed(d))).toString();
    let t;
    if (p.unit === "Hz") t = v >= 1000 ? `${n(v / 1000, v >= 10000 ? 0 : 1)} kHz` : `${n(v, v < 1 ? 2 : v < 10 ? 1 : 0)} Hz`;
    else if (p.unit === "s") t = v < 1 ? `${n(v * 1000, v < 0.01 ? 1 : 0)} ms` : `${n(v, 1)} s`;
    else if (p.unit === "dB") t = `${n(v, v < 10 ? 1 : 0)} dB`;
    else if (p.unit === "%") t = `${Math.round(v)}%`;
    else if (p.unit === "cents") { const r = Math.round(v); t = `${r < 0 ? "−" : p.signed && r > 0 ? "+" : ""}${Math.abs(r)} ct`; }
    else t = `${n(v, 2)} ${p.unit}`;
    return (p.bound ? `${p.bound} ` : "") + t;
  }

  const ccOf = (pos) => Math.round(pos * 127);

  function linear(stored, m, opt = {}) {
    const neg = stored < 0, s = opt.magnitude ? Math.abs(stored) : stored;
    const pos = Math.min(1, Math.max(0, (s - m.lo) / (m.hi - m.lo)));
    const shown = Math.round(m.dlo + pos * (m.dhi - m.dlo));
    const text = (opt.signed && neg && shown ? "−" : "") + String(shown);
    return { pos, cc: ccOf(pos), text, stored, negative: neg };
  }

  function option(stored, m) {
    const i = m.options.findIndex((o) => o.v === stored), n = m.options.length;
    if (i < 0) return { pos: null, cc: null, index: -1, text: `? (${stored})`, stored, unknown: true };
    return { pos: i / (n - 1), cc: Math.round((i * 127) / (n - 1)), index: i, text: m.options[i].label, stored };
  }

  function decodeOne(rec, f, m, opt) {
    const v = get(rec, f);
    return m.kind === "linear" ? linear(v, m, opt) : option(v, m);
  }

  const CUSTOM = {
    // NORMAL mode: -12..+24 semitones at +1673 (CC 62). LO FREQ: 0..127 at +1675 (CC 63).
    vco2_range(rec) {
      if (rec[1676] === 1) {
        const p = physical("lo_freq_hz", read.u8(rec, 1675));
        return Object.assign(linear(read.u8(rec, 1675), lin(0, 127)), { cc_number: 63, mode: "LO FREQ", physical: p, unitText: fmtPhysical(p) });
      }
      // Semitones from 8', with the footage when the knob sits on a printed mark: "16' (−12 st)".
      const r = linear(read.s8(rec, 1673), lin(-12, 24, -12, 24)), st = Number(r.text);
      const feet = { "-12": "16'", 0: "8'", 12: "4'", 24: "2'" }[st];
      const semis = `${st > 0 ? "+" : st < 0 ? "−" : ""}${Math.abs(st)} st`;
      return Object.assign(r, { text: feet ? `${feet} (${semis})` : semis, semitones: st, cc_number: 62, mode: "NORMAL" });
    },
    // One knob on the panel, two stored levels (+1691 VCO-1, +1692 VCO-2; CC 16/17), 255:0 to 0:255.
    mix(rec) {
      const a = rec[1691], b = rec[1692];
      const pos = (255 - a + b) / 510;
      return { pos, cc: null, levels: { vco1: a, vco2: b, cc16: Math.round((a * 127) / 255), cc17: Math.round((b * 127) / 255) }, text: `${a}:${b}` };
    },
    /* The switch sets the sign of ENV-1's pitch depth (+1655, CC 106). When that depth is 0 the
     * sign is not stored, so the position is unknown. */
    env1_pol(rec) {
      // With ENV MOD at 0 the pitch depth carries no sign, but VCF ENV does while ENV-1 drives it: the unit
      // signs both from the one switch, and no saved patch has them disagree (jp08_engine.py).
      const v = read.s8(rec, 1655), vcf = read.s16(rec, 1706);
      const s = v || (rec[1708] === 0 ? vcf : 0);
      if (s === 0) return { pos: null, cc: null, index: -1, text: "no position saved (ENV MOD and VCF ENV are 0)", unknown: true, stored: v };
      const i = s < 0 ? 1 : 0;
      return { pos: i, cc: i ? 127 : 0, index: i, text: i ? "INVERT" : "NORMAL", stored: v, fromVcf: !v };
    },
  };
  CUSTOM.env1_pol.options = ["NORMAL", "INVERT"];
  CUSTOM.vco2_range.options = null;

  /** Decode a 2048-byte patch record into { controlId: value } (dual controls: { env1, env2 }). */
  function decode(rec) {
    if (!rec || rec.length !== 2048) throw new Error("expected a 2048-byte patch record");
    const out = {}, exp = rec[1752] === 1;  // Param Expansion (round 2, Known)
    const withUnit = (v, metric, signed) => {
      if (!metric) return v;
      const p = physical(metric, signed ? v.stored : Math.abs(v.stored), exp);
      if (p) p.signed = !!signed;
      return Object.assign(v, { physical: p, unitText: fmtPhysical(p) });
    };
    for (const s of SECTIONS) for (const c of s.controls) {
      if (c.custom) out[c.id] = CUSTOM[c.custom](rec);
      else if (c.dual) {
        out[c.id] = {};
        for (const e of ENVS) out[c.id][e] = withUnit(decodeOne(rec, c.dual[e].f, c.dual[e].map || c.map, c), c.dual[e].unit);
      } else out[c.id] = withUnit(decodeOne(rec, c.f, c.map, c), c.unit, c.signedUnit);
    }
    if (out.pw_mode.text !== "MAN.") Object.assign(out.pwm, { physical: null, unitText: "" });
    // Lowest setting is no modulation on every machine (physical-metrics.json shared_minimum); the
    // curve's 0.9 dB there is measurement noise, not tremolo.
    for (const s of SECTIONS) for (const c of s.controls) if (c.zeroIsOff && out[c.id].stored === 0) Object.assign(out[c.id], { unitText: "off" });
    return out;
  }

  function decodeMenu(rec) {
    return MENU.map((m) => {
      const v = get(rec, m.f);
      return { id: m.id, label: m.label, confidence: m.confidence, stored: v,
               text: m.formatRec ? m.formatRec(rec) : m.format ? m.format(v) : String(v) };
    });
  }

  /** Labels of a switch/knob's positions, in panel order (null for continuous controls). */
  function positions(c, env) {
    if (c.custom) return CUSTOM[c.custom].options;
    const m = c.dual ? c.dual[env || "env1"].map || c.map : c.map;
    return m.kind === "options" ? m.options.map((o) => o.label) : null;
  }

  /** Every CC the panel exchanges: [{ cc, control, env }], for a MIDI layer to route by number. */
  function ccTable() {
    const t = [];
    for (const s of SECTIONS) for (const c of s.controls) {
      if (c.dual) for (const e of ENVS) t.push({ cc: c.dual[e].cc, control: c.id, env: e });
      else if (c.cc != null) t.push({ cc: c.cc, control: c.id });
    }
    t.push({ cc: 62, control: "vco2_range", mode: "NORMAL" }, { cc: 63, control: "vco2_range", mode: "LO FREQ" },
           { cc: 16, control: "mix", level: "vco1" }, { cc: 17, control: "mix", level: "vco2" },
           { cc: 106, control: "env1_pol" });
    return t;
  }

  /* The unit's edit buffer as a record that follows CCs the way the unit stores them
   * (maps/jp08-cc-offsets.json): a continuous control stores round(lo + (hi - lo) * cc / 127); a switch
   * takes the bin holding the CC, floor(cc * n / 128), and a detented knob the nearest position; VCO-2
   * RANGE stores round(36 * cc / 127 - 12) semitones and the MIX levels round(255 * cc / 127). ENV-1 POL
   * (CC 106, >= 64 inverts) signs VCO ENV MOD (+1655) and, while ENV-1 drives the VCF, VCF ENV (+1706);
   * the sign is kept even while a depth is 0, as the unit keeps the switch. */
  const write = {
    u8: (b, o, v) => { b[o] = v & 255; },
    u16: (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; },
  };
  write.s8 = write.u8; write.s16 = write.u16;

  function editBuffer(rec) {
    const b = Uint8Array.from(rec);
    const pitch = read.s8(b, 1655), vcf = read.s16(b, 1706);
    let pol = pitch < 0 || (pitch === 0 && b[1708] === 0 && vcf < 0) ? -1 : 1;
    const byCC = new Map();
    for (const s of SECTIONS) for (const c of s.controls) {
      if (c.dual) for (const e of ENVS) byCC.set(c.dual[e].cc, { c, f: c.dual[e].f, map: c.dual[e].map || c.map });
      else if (c.cc != null && c.f) byCC.set(c.cc, { c, f: c.f, map: c.map });
    }
    const signs = () => {
      write.s8(b, 1655, pol * Math.abs(read.s8(b, 1655)));
      write.s16(b, 1706, (b[1708] === 0 ? pol : 1) * Math.abs(read.s16(b, 1706)));
    };
    /** Apply one CC (0..127); returns the control id it moved, or null for a CC the panel does not have. */
    function apply(cc, v) {
      if (cc === 106) { pol = v >= 64 ? -1 : 1; signs(); return "env1_pol"; }
      if (cc === 62) { write.s8(b, 1673, Math.round((36 * v) / 127 - 12)); return "vco2_range"; }
      if (cc === 63) { b[1675] = v; return "vco2_range"; }
      if (cc === 16 || cc === 17) { b[cc === 16 ? 1691 : 1692] = Math.round((255 * v) / 127); return "mix"; }
      const e = byCC.get(cc);
      if (!e) return null;
      const m = e.map;
      if (m.kind === "linear") {
        write[e.f.type](b, e.f.at, Math.round(m.lo + ((m.hi - m.lo) * v) / 127));
        if (e.c.magnitude) signs();  // a depth's sign is ENV-1 POL's, not the CC's
      } else {
        const n = m.options.length;
        const i = m.ccMode === "floor" ? Math.min(n - 1, Math.floor((v * n) / 128)) : Math.round((v * (n - 1)) / 127);
        write[e.f.type](b, e.f.at, m.options[i].v);
        if (cc === 84) signs();  // VCF ENV takes POL's sign only while ENV-1 drives it
      }
      return e.c.id;
    }
    return { get rec() { return b; }, apply };
  }

  /** The CCs that put the unit's panel where this record has it, in an order that lets switches
   * (VCO-2 RANGE mode, VCF ENV source) land before the values they qualify and ENV-1 POL last. */
  function patchCCs(rec) {
    const v = decode(rec), out = [];
    for (const s of SECTIONS) for (const c of s.controls) {
      const d = v[c.id];
      if (c.dual) { for (const e of ENVS) if (d[e].cc != null) out.push([c.dual[e].cc, d[e].cc]); continue; }
      if (c.id === "mix") { out.push([16, d.levels.cc16], [17, d.levels.cc17]); continue; }
      if (c.id === "vco2_range") { out.push([d.cc_number, d.cc]); continue; }
      if (c.id === "env1_pol") { if (d.cc != null) out.push([106, d.cc]); continue; }
      if (d.cc != null) out.push([c.cc, d.cc]);
    }
    return out;
  }

  const api = { SECTIONS, MENU, ENVS, decode, decodeMenu, positions, ccTable, read, physical, fmtPhysical, editBuffer, patchCCs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PanelCore = api;
})(this);
