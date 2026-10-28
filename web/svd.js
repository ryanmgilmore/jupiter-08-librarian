// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Jupiter-08 backup (.svd) core: parse, address, rebuild with verification.
 * No DOM; loaded by index.html and by tests under node (module.exports).
 * Layout per SVD-FORMAT.md. Everything structural is checked, nothing assumed. */
(function (root) {
  "use strict";

  const MAGIC = [0x4e, 0x00, 0x53, 0x56, 0x44, 0x35]; // "N\0SVD5"
  const TAGS = ["PRFa", "PATa", "SYSa", "DIFa"];
  const KINDS = {
    patch:   { tag: "PATa", count: 256, size: 2048, nameAt: 16, addressable: 240, groups: "ABCDE" },
    pattern: { tag: "PRFa", count: 128, size: 11524, nameAt: 0, addressable: 96, groups: "AB" },
  };
  const NAME_LEN = 16;
  const INIT_NAMES = { patch: "INITIAL TONE", pattern: "INITIAL PATTERN" };

  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const ascii = (b) => String.fromCharCode(...b);

  function fail(msg) { throw new Error(msg); }

  /** Parse an .svd ArrayBuffer/Uint8Array. Throws on any structural surprise. */
  function parse(input, label) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length < 0x50 || !MAGIC.every((v, i) => b[i] === v)) fail(`${label || "file"}: not a Jupiter-08 backup (no SVD5 header)`);
    const sections = {};
    for (let i = 0; i < 4; i++) {
      const e = 0x10 + 16 * i;
      const tag = ascii(b.subarray(e, e + 4));
      if (tag !== TAGS[i] || ascii(b.subarray(e + 4, e + 8)) !== "DD25") fail(`unexpected table-of-contents entry ${i}: ${tag}`);
      const offset = u32(b, e + 8), size = u32(b, e + 12);
      const count = u32(b, offset), recsize = u32(b, offset + 4), hdr = u32(b, offset + 8);
      if (hdr !== 0x10 || 16 + count * recsize !== size || offset + size > b.length) fail(`section ${tag} header inconsistent`);
      sections[tag] = { offset, size, count, recsize, data: offset + 16 };
    }
    const end = Math.max(...Object.values(sections).map((s) => s.offset + s.size));
    if (end !== b.length) fail("sections do not tile the file");
    for (const [kind, k] of Object.entries(KINDS)) {
      const s = sections[k.tag];
      if (s.count !== k.count || s.recsize !== k.size) fail(`${kind} section is ${s.count}×${s.recsize}, expected ${k.count}×${k.size} — different firmware?`);
    }
    const file = { bytes: b, label: label || "", sections, patch: [], pattern: [] };
    for (const kind of Object.keys(KINDS)) {
      for (let slot = 0; slot < KINDS[kind].count; slot++) file[kind].push(record(file, kind, slot));
    }
    return file;
  }

  function record(file, kind, slot) {
    const k = KINDS[kind], start = file.sections[k.tag].data + slot * k.size;
    const bytes = file.bytes.subarray(start, start + k.size);
    const name = ascii(bytes.subarray(k.nameAt, k.nameAt + NAME_LEN)).replace(/ +$/, "");
    return { kind, slot, start, bytes, name, isInit: name === INIT_NAMES[kind], loc: location(kind, slot) };
  }

  /** Panel address: patches A11..E86 (group, bank 1-8, number 1-6); patterns PA1A..PB8F. */
  function location(kind, slot) {
    const k = KINDS[kind];
    if (slot >= k.addressable) return null;
    const g = k.groups[Math.floor(slot / 48)], bank = Math.floor((slot % 48) / 6) + 1, n = slot % 6;
    return kind === "patch" ? `${g}${bank}${n + 1}` : `P${g}${bank}${"ABCDEF"[n]}`;
  }

  function slotOf(kind, loc) {
    const k = KINDS[kind];
    const m = kind === "patch" ? /^([A-E])([1-8])([1-6])$/i.exec(loc) : /^P([AB])([1-8])([A-F])$/i.exec(loc);
    if (!m) return null;
    const n = kind === "patch" ? +m[3] - 1 : "ABCDEF".indexOf(m[3].toUpperCase());
    const g = k.groups.indexOf(m[1].toUpperCase());
    return g * 48 + (+m[2] - 1) * 6 + n;
  }

  /** Identical container shape and version flags — the precondition for copying records between files. */
  function compatible(a, b) {
    const problems = [];
    if (!eq(a.bytes.subarray(0, 0x50), b.bytes.subarray(0, 0x50))) problems.push("file header / table of contents differ");
    for (const t of TAGS) {
      const sa = a.sections[t], sb = b.sections[t];
      if (!eq(a.bytes.subarray(sa.offset, sa.offset + 16), b.bytes.subarray(sb.offset, sb.offset + 16))) problems.push(`${t} section header differs`);
    }
    const da = a.sections.DIFa, db = b.sections.DIFa;
    if (!eq(a.bytes.subarray(da.offset, da.offset + da.size), b.bytes.subarray(db.offset, db.offset + db.size))) problems.push("DIFa (version flags) differ");
    if (!eq(a.patch[0].bytes.subarray(0, 16), b.patch[0].bytes.subarray(0, 16))) problems.push("patch record header differs");
    return problems;
  }

  /** For a lone record (from a .j08set): does its fixed header match the destination's records? */
  function recordProblem(base, rec) {
    if (rec.kind === "patch" && !eq(rec.bytes.subarray(0, 16), base.patch[0].bytes.subarray(0, 16))) return "patch record header differs from this backup's (different firmware?)";
    return null;
  }

  function eq(x, y) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /** Validate a name for writing: printable ASCII, at most 16 characters. */
  function nameProblem(name) {
    if (name.length > NAME_LEN) return `longer than ${NAME_LEN} characters`;
    if (!/^[\x20-\x7e]*$/.test(name)) return "only plain ASCII letters, digits, spaces and punctuation";
    if (!name.trim()) return "empty";
    return null;
  }

  /**
   * Build a new file: base + ops. ops are
   *   { op: "place", kind, slot, bytes, from }   — overwrite one record verbatim (name included)
   *   { op: "rename", kind, slot, name }         — rewrite only the 16-byte name field
   * Later ops on the same record win. Returns { bytes, report }; throws if verification fails.
   */
  function build(base, ops) {
    const out = new Uint8Array(base.bytes);
    const touched = new Map(); // "kind:slot" -> {kind, slot}
    for (const o of ops) {
      const k = KINDS[o.kind];
      if (!k || !(o.slot >= 0 && o.slot < k.count)) fail(`bad target ${o.kind} ${o.slot}`);
      const start = base.sections[k.tag].data + o.slot * k.size;
      if (o.op === "place") {
        if (o.bytes.length !== k.size) fail(`record for ${o.kind} must be ${k.size} bytes`);
        out.set(o.bytes, start);
      } else if (o.op === "rename") {
        const p = nameProblem(o.name);
        if (p) fail(`name "${o.name}": ${p}`);
        const padded = o.name.padEnd(NAME_LEN, " ");
        for (let i = 0; i < NAME_LEN; i++) out[start + k.nameAt + i] = padded.charCodeAt(i);
      } else fail(`unknown op ${o.op}`);
      touched.set(`${o.kind}:${o.slot}`, { kind: o.kind, slot: o.slot, start, end: start + k.size });
    }
    // Verification: every changed byte lies inside a touched record, and the result re-parses.
    const ranges = [...touched.values()].sort((x, y) => x.start - y.start);
    let changed = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== base.bytes[i]) {
        changed++;
        if (!ranges.some((r) => i >= r.start && i < r.end)) fail(`internal error: byte 0x${i.toString(16)} changed outside the edited records`);
      }
    }
    const reparsed = parse(out, "result");
    if (compatible(base, reparsed).length) fail("internal error: result structure differs from base");
    const changedRecords = ranges.filter((r) => !eq(out.subarray(r.start, r.end), base.bytes.subarray(r.start, r.end)));
    return {
      bytes: out,
      report: {
        bytesChanged: changed,
        recordsTouched: ranges.length,
        recordsChanged: changedRecords.length,
        changes: changedRecords.map((r) => ({
          kind: r.kind, slot: r.slot, loc: location(r.kind, r.slot),
          before: base[r.kind][r.slot].name, after: reparsed[r.kind][r.slot].name,
        })),
      },
    };
  }

  /* Pattern → patch references (SVD-FORMAT.md §4.1): LOWER at +51/+52, UPPER at +135/+136,
   * (hi << 7) | lo = 384 + patch slot. Returns the patch slot, or null if out of range. */
  const REF_AT = { lower: 51, upper: 135 }, REF_BASE = 384;
  function patternRefs(bytes) {
    const out = {};
    for (const [part, at] of Object.entries(REF_AT)) {
      const slot = ((bytes[at] << 7) | bytes[at + 1]) - REF_BASE;
      out[part] = slot >= 0 && slot < KINDS.patch.addressable ? slot : null;
    }
    return out;
  }

  /** The sound of a patch record: everything but the 16-byte name, so a rename is not a change. */
  const sound = (b) => b.subarray(KINDS.patch.nameAt + NAME_LEN);

  /** Patch bytes at `slot` as the pattern's origin file saw them; null if the origin does not hold it. */
  function originPatch(origin, slot) {
    if (!origin) return null;
    if (origin.set) { const r = origin.patch.find((p) => p.slot === slot); return r ? r.bytes : null; }
    return origin.patch[slot].bytes;
  }

  /**
   * Which named, addressable patterns in base+ops would play a different patch than in the file the
   * pattern came from? A place op's `origin` is the parsed backup or set it was taken from; patterns
   * left alone have base as origin. Returns issues:
   *   { pattern, loc, name, part, ref, refLoc, status: "changed"|"unknown"|"invalid",
   *     expected?: {name, bytes}, actual?: name, origin }
   * "changed" — the output holds a different sound at ref; "unknown" — the origin (a patch set)
   * does not include the referenced patch; "invalid" — the reference is not a slot.
   */
  function linkIssues(base, ops) {
    const last = (kind, slot) => {
      let place = null, name = null;
      for (const o of ops) if (o.kind === kind && o.slot === slot) { if (o.op === "place") { place = o; name = null; } else name = o.name; }
      return { place, name };
    };
    const nameOf = (b) => ascii(b.subarray(KINDS.patch.nameAt, KINDS.patch.nameAt + NAME_LEN)).replace(/ +$/, "");
    const issues = [];
    const k = KINDS.pattern;
    for (let p = 0; p < k.addressable; p++) {
      const { place, name: renamed } = last("pattern", p);
      const bytes = place ? place.bytes : base.pattern[p].bytes;
      const name = renamed || ascii(bytes.subarray(k.nameAt, k.nameAt + NAME_LEN)).replace(/ +$/, "");
      if (name === INIT_NAMES.pattern) continue; // 116 factory empties all point at A11
      const origin = place ? place.origin || null : base;
      const refs = patternRefs(bytes);
      for (const part of Object.keys(REF_AT)) {
        const ref = refs[part];
        const issue = { pattern: p, loc: location("pattern", p), name, part, ref, refLoc: ref == null ? null : location("patch", ref), origin };
        if (ref == null) { issues.push({ ...issue, status: "invalid" }); continue; }
        const exp = originPatch(origin, ref);
        const lp = last("patch", ref).place, act = lp ? lp.bytes : base.patch[ref].bytes;
        if (!exp) issues.push({ ...issue, status: "unknown", actual: nameOf(act) });
        else if (!eq(sound(exp), sound(act))) issues.push({ ...issue, status: "changed", expected: { name: nameOf(exp), bytes: exp }, actual: nameOf(act) });
      }
    }
    return issues;
  }

  /* Patch set (.j08set): a shareable handful of records, so a bank need not travel as a whole-unit
   * backup. Layout: "J08SET" 0x00 0x01 | u32 count | per entry: u8 kind (0 patch, 1 pattern),
   * u8 0, u16 source slot, u32 record size, record bytes. Little-endian. */
  const SET_MAGIC = [0x4a, 0x30, 0x38, 0x53, 0x45, 0x54, 0x00, 0x01];

  function encodeSet(records) {
    let size = 12;
    for (const r of records) size += 8 + r.bytes.length;
    const b = new Uint8Array(size), dv = new DataView(b.buffer);
    b.set(SET_MAGIC, 0); dv.setUint32(8, records.length, true);
    let o = 12;
    for (const r of records) {
      dv.setUint8(o, r.kind === "pattern" ? 1 : 0); dv.setUint16(o + 2, r.slot, true); dv.setUint32(o + 4, r.bytes.length, true);
      b.set(r.bytes, o + 8); o += 8 + r.bytes.length;
    }
    return b;
  }

  function isSet(b) { return b.length >= 12 && SET_MAGIC.every((v, i) => b[i] === v); }

  function parseSet(input, label) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isSet(b)) fail(`${label || "file"}: not a .j08set`);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(8, true);
    const recs = [];
    let o = 12;
    for (let i = 0; i < n; i++) {
      const kind = dv.getUint8(o) === 1 ? "pattern" : "patch", slot = dv.getUint16(o + 2, true), size = dv.getUint32(o + 4, true);
      if (size !== KINDS[kind].size || o + 8 + size > b.length) fail(`${label}: entry ${i} has bad size`);
      const bytes = b.subarray(o + 8, o + 8 + size), k = KINDS[kind];
      const name = ascii(bytes.subarray(k.nameAt, k.nameAt + NAME_LEN)).replace(/ +$/, "");
      recs.push({ kind, slot, bytes, name, isInit: name === INIT_NAMES[kind], loc: location(kind, slot) });
      o += 8 + size;
    }
    if (o !== b.length) fail(`${label}: trailing bytes`);
    return { label: label || "", set: true, patch: recs.filter((r) => r.kind === "patch"), pattern: recs.filter((r) => r.kind === "pattern") };
  }

  const api = { KINDS, INIT_NAMES, NAME_LEN, parse, location, slotOf, compatible, recordProblem, nameProblem, build, encodeSet, parseSet, isSet, patternRefs, linkIssues };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SVD = api;
})(this);
