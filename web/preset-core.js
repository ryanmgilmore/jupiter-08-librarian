// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Jupiter-08 preset model: what a stored preset record (the manual's "pattern", PRFa) holds.
 * No DOM; loaded by panel.html and by web/test-preset.js under node (module.exports).
 *
 * Decoded (SVD-FORMAT.md §4.1): name, tempo, the LOWER/UPPER patch slots, each part's length and
 * step resolution, and its 64 steps (up to 8 notes each with velocity and gate, ties, pitch bend).
 * playback() turns the steps into timed notes the way the unit plays them; web/test-preset.js
 * checks that against the unit's own playback of the factory presets (a captured playback run).
 * Decoded from a round of one-change saves (26 saves into empty slots, so each
 * byte is pinned by a save that moved it): per-part volume, pan, delay and reverb send, shuffle, step
 * scale (incl. triplets), direction and CC-playback switch; for the preset, delay (on, level, time,
 * feedback), reverb (on, type, time), key split, arpeggio rate and transpose. Values are raw bytes
 * unless a unit is stated; where the round fixed a unit it is converted (pan, shuffle, delay ms).
 * The UPPER copy of each per-part byte is read at the same stride as its LOWER one (+84 in the part
 * area, +20 in the sequencer area); the round changed LOWER for pan, sends, direction and CC, so those
 * UPPER bytes are by stride only (volume and the sends vary in the factory set, which supports it).
 * Not decoded: Poly Mode (firmware 1.00 has no AdU; the round's UPPER save moved +46, not
 * +130, unexplained), recorded CC motion (+7012 on), KEY transpose and bend range (not stored in a preset). */
(function (root) {
  "use strict";

  const PARTS = [
    { id: "lower", label: "LOWER", ref: 51, last: 6876, res: 6881, steps: 6916, part: 0, seq: 0 },
    { id: "upper", label: "UPPER", ref: 135, last: 6896, res: 6901, steps: 9220, part: 84, seq: 20 },
  ];
  const STEP = 36, MAX_STEPS = 64, NONE = 255, TIE = 101, BEND = 127, REF_BASE = 384, PATCHES = 240;
  // MIDI clocks per step. 0 and 1 are checked against the unit's playback; 4 (8t) and 5 (16t) are the
  // codes the round saved for the SCAL menu's triplets, with clocks from the note values (24 per
  // quarter: 8 and 4), not yet heard on the unit.
  const CLOCKS = { 0: 12, 1: 6, 4: 8, 5: 4 };
  const RES_LABEL = { 0: "1/8", 1: "1/16", 4: "1/8 triplet", 5: "1/16 triplet" };
  const RES_INFERRED = new Set([4, 5]);
  const LOOP = 768;                          // clocks the capture ran: 8 bars at 24 per beat

  function tempo(b) { return (b[18] | (b[19] << 8)) / 100; }

  const s8 = (v) => (v > 127 ? v - 256 : v);

  /** Preset-level settings from the 2026-10-30 round. Delay time is milliseconds (u16 LE; the round
   * saved 777 ms as 9, 3); feedback, levels, sends and reverb time are the raw bytes the unit shows
   * as 0-127 (the round entered 77 and read 77). Reverb type is a raw code (2 -> 3 for HAL.2; the
   * factory set holds other values there, so no names). */
  function settings(b) {
    return {
      delay: { on: b[128] === 1, level: b[1138], time: b[1146] | (b[1147] << 8), feedback: b[1150] },
      reverb: { on: b[127] === 1, type: b[1188], time: b[1192] },
      keySplit: b[45],
      arpeggio: { rate: b[1267], transpose: s8(b[1263]) },
    };
  }

  function patchSlot(b, at) {
    const s = ((b[at] << 7) | b[at + 1]) - REF_BASE;
    return s >= 0 && s < PATCHES ? s : null;
  }

  /** One step: { notes: [{ pitch, velocity, gate, tie }], bend: null | -8192..8128 }. A rest has no notes. */
  function step(b, at) {
    const notes = [];
    for (let j = 0; j < 8; j++) {
      const pitch = b[at + j];
      if (pitch === NONE) continue;
      const gate = b[at + 16 + j];
      notes.push({ pitch, velocity: b[at + 8 + j], gate, tie: gate === TIE });
    }
    return { notes, bend: b[at + 24] === BEND ? (b[at + 28] - 128) * 64 : null };
  }

  function decode(b) {
    const parts = {};
    for (const p of PARTS) {
      const length = b[p.last] + 1, res = b[p.res];
      const steps = [];
      for (let i = 0; i < MAX_STEPS; i++) steps.push(step(b, p.steps + i * STEP));
      parts[p.id] = { label: p.label, patch: patchSlot(b, p.ref), length, resolution: res,
                      resolutionLabel: RES_LABEL[res] || `code ${res}`, clocksPerStep: CLOCKS[res] || null,
                      clocksInferred: RES_INFERRED.has(res), steps,
                      volume: b[53 + p.part], pan: s8(b[54 + p.part]),
                      delaySend: b[76 + p.part], reverbSend: b[75 + p.part],
                      shuffle: s8(b[6884 + p.seq]), direction: b[6882 + p.seq], ccPlayback: b[6886 + p.seq] === 1 };
    }
    return { tempo: tempo(b), parts, ...settings(b) };
  }

  /** Notes of one loop of a part, in steps: { pitch, velocity, start, end, open }. A tie carries a
   * note into the next step when that step holds the same pitch; a tie off the loop's end is `open`.
   * The gate's last step sounds gate/100 of a step (Likely, SVD-FORMAT.md §4.1). */
  function loopNotes(part) {
    const out = [];
    let active = new Map();
    for (let i = 0; i < part.length; i++) {
      const next = new Map();
      for (const n of part.steps[i].notes) {
        const start = active.has(n.pitch) ? active.get(n.pitch) : { pitch: n.pitch, velocity: n.velocity, start: i };
        active.delete(n.pitch);
        if (n.tie) next.set(n.pitch, start);
        else out.push({ ...start, end: i + Math.min(n.gate, 100) / 100, open: false });
      }
      for (const s of active.values()) out.push({ ...s, end: i, open: false });  // tied into a step without the pitch
      active = next;
    }
    for (const s of active.values()) out.push({ ...s, end: part.length, open: true });
    return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }

  /** Timed playback over `clocks` MIDI clocks, both parts looping on their own lengths, as the unit
   * plays them: notes { part, pitch, velocity, on, off } and bends { part, tick, value }. */
  function playback(b, clocks = LOOP) {
    const d = decode(b), notes = [], bends = [];
    for (const p of PARTS) {
      const part = d.parts[p.id], dt = part.clocksPerStep;
      if (!dt) continue;
      let active = new Map();
      for (let tick = 0; tick < clocks; tick += dt) {
        const s = part.steps[(tick / dt) % part.length];
        if (s.bend != null) bends.push({ part: p.id, tick, value: s.bend });
        const next = new Map();
        for (const n of s.notes) {
          const start = active.has(n.pitch) ? active.get(n.pitch) : { part: p.id, pitch: n.pitch, velocity: n.velocity, on: tick };
          active.delete(n.pitch);
          if (n.tie) next.set(n.pitch, start);
          else notes.push({ ...start, off: tick + dt * n.gate / 100 });
        }
        for (const s2 of active.values()) notes.push({ ...s2, off: tick });
        active = next;
      }
      for (const s of active.values()) notes.push({ ...s, off: clocks });
    }
    return { notes, bends };
  }

  const api = { PARTS, MAX_STEPS, decode, loopNotes, playback, tempo, settings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PresetCore = api;
})(this);
