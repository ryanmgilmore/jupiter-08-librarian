// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ryan Gilmore
/* Web MIDI for the panel viewer: the Jupiter-08's USB port, on the channel its LOWER part answers.
 *
 *   const midi = await PanelMidi.connect({ channel: 2, onCC: (cc, v) => ..., onState: (s) => ... });
 *   midi.send([[cc, value], ...]);   // into the unit's edit buffer; the unit never saves from MIDI
 *
 * Browsers without Web MIDI (Safari) get available() === false and the page works as before. The
 * unit enumerates two ports, "JUPITER-08" and "JUPITER-08 CTRL"; panel CCs travel on the first.
 * No DOM. */
(function (root) {
  "use strict";
  const NAME = "JUPITER-08";
  const available = () => typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  const pick = (ports) => {
    const all = [...ports.values()];
    return all.find((p) => p.name === NAME) || all.find((p) => p.name.includes(NAME) && !/CTRL/i.test(p.name)) || null;
  };

  async function connect({ channel = 2, onCC = () => {}, onState = () => {} } = {}) {
    if (!available()) throw new Error("This browser has no Web MIDI (try Chrome or Edge)");
    const access = await navigator.requestMIDIAccess({ sysex: false });
    let input = null, output = null, ch = channel;
    const listen = (e) => {
      const [st, a, b] = e.data;
      if ((st & 0xf0) === 0xb0 && (st & 0x0f) === ch - 1) onCC(a, b);
    };
    const attach = () => {
      if (input) input.onmidimessage = null;
      input = pick(access.inputs);
      output = pick(access.outputs);
      if (input) input.onmidimessage = listen;
      onState({ input: input && input.name, output: output && output.name });
    };
    access.onstatechange = attach;  // the unit plugged in or switched on after the page opened
    attach();
    return {
      get connected() { return !!(input && output); },
      setChannel(c) { ch = c; },
      /** Send CCs, spaced 2 ms apart so a whole patch (about 50) never floods the unit. */
      send(ccs) {
        if (!output) return false;
        const t0 = performance.now();
        ccs.forEach(([cc, v], i) => output.send([0xb0 | (ch - 1), cc, v], t0 + 2 * i));
        return true;
      },
      close() { access.onstatechange = null; if (input) input.onmidimessage = null; },
    };
  }

  root.PanelMidi = { available, connect };
})(this);
