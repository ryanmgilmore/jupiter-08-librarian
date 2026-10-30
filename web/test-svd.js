// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
// node web/test-svd.js [path/to/JUPITER08Backup.svd]
// Exercises svd.js against a real backup. Read-only: never writes the input.
"use strict";
const fs = require("fs");
const assert = require("assert");
const SVD = require("./svd.js");

const path = process.argv[2];
if (!path || !fs.existsSync(path)) { console.error("usage: node web/test-svd.js JUPITER08Backup.svd  (a backup of a unit still holding the factory patches)"); process.exit(2); }
const raw = new Uint8Array(fs.readFileSync(path));
const base = SVD.parse(raw, "base");
let n = 0;
const ok = (msg) => { n++; console.log("ok", n, msg); };

assert.strictEqual(base.patch.length, 256); assert.strictEqual(base.pattern.length, 128);
assert.strictEqual(base.patch[0].loc, "A11"); assert.strictEqual(base.patch[128].loc, "C63");
assert.strictEqual(base.patch[239].loc, "E86"); assert.strictEqual(base.patch[240].loc, null);
assert.strictEqual(base.pattern[0].loc, "PA1A"); assert.strictEqual(base.pattern[95].loc, "PB8F");
for (let s = 0; s < 240; s++) assert.strictEqual(SVD.slotOf("patch", SVD.location("patch", s)), s);
for (let s = 0; s < 96; s++) assert.strictEqual(SVD.slotOf("pattern", SVD.location("pattern", s)), s);
ok("slot <-> location round-trips for all addressable slots");

assert.strictEqual(base.patch[0].name, "NEG SYNC"); assert.strictEqual(base.pattern[0].name, "Inn Out");
assert.strictEqual(base.patch.filter((p) => !p.isInit).length, 129);
ok("names read (129 named patches, NEG SYNC, Inn Out)");

const same = SVD.build(base, []);
assert.ok(Buffer.from(same.bytes).equals(Buffer.from(raw)));
assert.strictEqual(same.report.bytesChanged, 0);
ok("no-op build is byte-identical");

const e86 = SVD.slotOf("patch", "E86");
const one = SVD.build(base, [{ op: "place", kind: "patch", slot: e86, bytes: base.patch[0].bytes }]);
const r1 = SVD.parse(one.bytes);
assert.strictEqual(r1.patch[e86].name, "NEG SYNC");
assert.ok(Buffer.from(r1.patch[e86].bytes).equals(Buffer.from(base.patch[0].bytes)));
for (let i = 0; i < raw.length; i++) {
  const inside = i >= base.patch[e86].start && i < base.patch[e86].start + 2048;
  if (!inside) assert.strictEqual(one.bytes[i], raw[i]);
}
assert.deepStrictEqual(one.report.changes.map((c) => [c.loc, c.before, c.after]), [["E86", "INITIAL TONE", "NEG SYNC"]]);
ok("A11 -> E86 splice changes only E86's 2048 bytes (the SVD-FORMAT.md §5.3 test-2 file)");

const e11 = SVD.slotOf("patch", "E11");
const group = [];
for (let i = 0; i < 48; i++) group.push({ op: "place", kind: "patch", slot: e11 + i, bytes: base.patch[i].bytes });
const g = SVD.build(base, group);
const rg = SVD.parse(g.bytes);
for (let i = 0; i < 48; i++) assert.strictEqual(rg.patch[e11 + i].name, base.patch[i].name);
for (let i = 0; i < raw.length; i++) if (i < base.patch[e11].start || i >= base.patch[e11 + 47].start + 2048) assert.strictEqual(g.bytes[i], raw[i]);
assert.strictEqual(base.patch[e11].start, 0x1c8270);
ok("group A -> group E: names follow, nothing outside 0x1C8270-0x1E0270 changes");

const rn = SVD.build(base, [{ op: "rename", kind: "patch", slot: 0, name: "MY SYNC" }]);
const rr = SVD.parse(rn.bytes);
assert.strictEqual(rr.patch[0].name, "MY SYNC");
assert.strictEqual(rn.report.bytesChanged <= 16, true);
assert.throws(() => SVD.build(base, [{ op: "rename", kind: "patch", slot: 0, name: "x".repeat(17) }]));
assert.throws(() => SVD.build(base, [{ op: "rename", kind: "patch", slot: 0, name: "café" }]));
const pr = SVD.build(base, [{ op: "rename", kind: "pattern", slot: 0, name: "Inn Out 2" }]);
assert.strictEqual(SVD.parse(pr.bytes).pattern[0].name, "Inn Out 2");
ok("rename writes only the 16-byte name field, rejects bad names, works for patterns");

const pat = SVD.build(base, [{ op: "place", kind: "pattern", slot: 50, bytes: base.pattern[1].bytes }]);
assert.strictEqual(SVD.parse(pat.bytes).pattern[50].name, "Heart Return");
ok("pattern placement");

const set = SVD.encodeSet([base.patch[0], base.patch[5], base.pattern[2]]);
const ps = SVD.parseSet(set, "s");
assert.deepStrictEqual(ps.patch.map((p) => [p.name, p.slot]), [["NEG SYNC", 0], ["HONKY TONK", 5]]);
assert.strictEqual(ps.pattern[0].name, "Encounter");
assert.strictEqual(SVD.recordProblem(base, ps.patch[0]), null);
ok(".j08set round-trip");

assert.deepStrictEqual(SVD.compatible(base, SVD.parse(raw)), []);
const bad = new Uint8Array(raw); bad[0x1e87ec] ^= 1;
assert.ok(SVD.compatible(base, SVD.parse(bad)).length > 0);
const trunc = raw.subarray(0, raw.length - 1);
assert.throws(() => SVD.parse(trunc));
ok("compatibility check catches a DIFa change; truncated file refused");

const later = SVD.build(base, [{ op: "place", kind: "patch", slot: 200, bytes: base.patch[1].bytes }, { op: "place", kind: "patch", slot: 200, bytes: base.patch[2].bytes }]);
assert.strictEqual(SVD.parse(later.bytes).patch[200].name, base.patch[2].name);
ok("later op on the same slot wins");
const at = (loc) => SVD.slotOf("patch", loc);
assert.deepStrictEqual(SVD.patternRefs(base.pattern[0].bytes), { lower: at("B42"), upper: at("A11") });
assert.deepStrictEqual(SVD.patternRefs(base.pattern[10].bytes), { lower: 0, upper: 0 });
assert.strictEqual(SVD.linkIssues(base, []).length, 0);
ok("pattern references decode (Inn Out plays B42/A11); an untouched backup has no broken links");

// Issues carry whole parsed files; compare plain fields only, or a failing assert renders gigabytes.
// Overwriting a patch one of your own patterns plays is flagged; a rename is not.
const over = SVD.linkIssues(base, [{ op: "place", kind: "patch", slot: at("B42"), bytes: base.patch[5].bytes }]);
assert.deepStrictEqual(over.map((i) => [i.loc, i.part, i.refLoc, i.status, i.actual]), [["PA1A", "lower", "B42", "changed", "HONKY TONK"]]);
assert.strictEqual(over[0].expected.name, base.patch[at("B42")].name);
assert.strictEqual(SVD.linkIssues(base, [{ op: "rename", kind: "patch", slot: at("B42"), name: "RENAMED" }]).length, 0);
// INITIAL PATTERNs all point at A11 and are ignored; Inn Out and The 8 Rules All are not.
const a11 = SVD.linkIssues(base, [{ op: "place", kind: "patch", slot: 0, bytes: base.patch[5].bytes }]);
assert.deepStrictEqual(a11.map((i) => `${i.loc}:${i.part}`), ["PA1A:upper", "PA2E:lower", "PA2E:upper"]);
ok("overwriting a referenced patch is flagged; renames and INITIAL PATTERNs are not");

// A pattern brought in from another backup, whose patches differ in this one, then brought along.
const other = SVD.parse(SVD.build(base, [{ op: "place", kind: "patch", slot: at("B42"), bytes: base.patch[5].bytes }]).bytes, "other");
const inPat = { op: "place", kind: "pattern", slot: 50, bytes: base.pattern[0].bytes, origin: base };
const brk = SVD.linkIssues(other, [inPat]);
assert.deepStrictEqual(brk.map((i) => [i.loc, i.part, i.status]), [["PB1C", "lower", "changed"]]);
const along = { op: "place", kind: "patch", slot: brk[0].ref, bytes: brk[0].expected.bytes, origin: base };
// Bringing it along fixes the incoming pattern but breaks other's own PA1A, which played B42 too.
assert.deepStrictEqual(SVD.linkIssues(other, [inPat, along]).map((i) => [i.loc, i.part, i.status, i.actual, i.expected.name]),
  [["PA1A", "lower", "changed", base.patch[at("B42")].name, "HONKY TONK"]]);
ok("an incoming pattern whose patches differ here is flagged; bringing its patch along clears it and flags the resident pattern it displaces");

// From a patch set: the patch is unknown unless the set carries it.
const s1 = SVD.parseSet(SVD.encodeSet([base.pattern[0]]), "s1");
const u = SVD.linkIssues(base, [{ op: "place", kind: "pattern", slot: 50, bytes: s1.pattern[0].bytes, origin: s1 }]);
assert.deepStrictEqual(u.map((i) => [i.part, i.status]), [["lower", "unknown"], ["upper", "unknown"]]);
const s2 = SVD.parseSet(SVD.encodeSet([base.pattern[0], base.patch[at("B42")], base.patch[0]]), "s2");
assert.strictEqual(SVD.linkIssues(base, [{ op: "place", kind: "pattern", slot: 50, bytes: s2.pattern[0].bytes, origin: s2 }]).length, 0);
ok("patch-set patterns: unknown without their patches, clean with them");

// Copying an empty slot over a named one clears it (the "include empty slots" path).
const initRec = base.patch.find((p) => p.isInit && p.slot < 240);
const clr = SVD.build(base, [{ op: "place", kind: "patch", slot: 0, bytes: initRec.bytes }]);
assert.strictEqual(SVD.parse(clr.bytes).patch[0].isInit, true);
assert.deepStrictEqual(clr.report.changes.map((c) => [c.loc, c.before, c.after]), [["A11", "NEG SYNC", "INITIAL TONE"]]);
ok("placing an empty record clears a named slot");
console.log(`\n${n} checks passed`);
