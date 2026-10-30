# Jupiter-08 Librarian

A patch librarian (patch manager) for the Roland Jupiter-08, running in your browser. See what is
stored in every patch and preset slot, bring patches and presets in from other backups, put them
where you want, and build a new backup to restore. Two more tabs read the same backup:

- a **Patch Viewer/Editor** that shows where every control sits for a patch, and, in a browser that
  supports Web MIDI, can follow the edits made on the unit over MIDI and push patch settings from the
  browser to the unit.

- a **Preset Viewer** that shows the sequences stored in each preset, the patches associated with each
  preset, and the preset settings, including reverb and delay effect settings.

The Jupiter-08 has no SysEx, so the only way to move patches onto it in bulk is a whole-unit
restore. This tool edits the backup file so that a restore brings in exactly the patches you chose,
and nothing else changes.

> **Status: v0.2.** Human-designed and human-tested on a real Jupiter-08, and written with AI
> assistance. The design and interaction ideas are the author's, and each feature was tested by a
> person on the unit. Each hardware claim below was checked on the unit.
>
> No patches are transmitted or stored server-side.

## Using it

1. **Back up your Jupiter-08.** Hold **[MENU]** while switching it on, connect it over USB, and copy
   `BACKUP/JUPITER08Backup.svd` off the `JUPITER-08` drive. **Keep this original somewhere safe.**
2. **Open the tool** at <https://ryanmgilmore.github.io/jupiter-08-librarian/>, or download the repo
   (or just the `web/` folder) and open `web/index.html`, which works offline. Either way there is
   nothing to install, and your files never leave the browser.
3. **Drop your backup** onto the page (any tab), or use *Open backup…*. In the Patch/Preset Manager it
   appears as *Your memory*.
4. **Add sources** under *Bring in from*: someone else's backup, or a `.j08set` patch set.
5. **Select and place.** Click a slot, ⇧-click a range, ⌘/Ctrl-click to add slots, or click a row
   label (A1, A2…) or *select group* to take a whole bank or group. Point at a slot in *Your memory*
   to preview where the selection lands, then click to place it. *Keep layout* keeps gaps;
   *Pack together* fills consecutive slots.
6. **Build new backup**, then download it. Keep the name `JUPITER08Backup.svd`.
7. **Restore**: hold **[MENU]** while switching on, as for the backup. On the `JUPITER-08` drive,
   delete `BACKUP/`, copy the new file into `RESTORE/`, eject, and press **[PAGE/TIE]**. The display
   shows `donE` when it has finished. **A restore replaces everything on the unit**: patches,
   patterns and system settings.

You can also rename slots, and export a selection as a `.j08set` to share a handful of patches
without sharing your whole unit.

### Reorganizing your own memory

*Bring in from* starts on **Your backup (as loaded)**, so your own memory is also a source.

- **Drag one slot onto another** in *Your memory* to swap them. Dragging them back undoes it.
- To move patches, set the source to **Move**, select them on the right, and click where they
  should go. Each patch's old slot is emptied, unless that slot is itself one of the destinations,
  so you can shift a whole bank along by one. **Copy** leaves the originals where they are.
- The right-hand side always shows your backup as loaded, not as edited, so you can always see
  and take any original patch.

### Patterns play patches by slot number

A pattern is what the panel calls a **preset** (HOLD PRESET). It holds:

- the slot numbers of the two patches its LOWER and UPPER parts play, not the patches themselves
- the part settings a patch does not store, such as Poly Mode
- the sequence for each part
- the tempo
- the delay and reverb settings

Saving a pattern on the unit does not save edits to its patches; save each patch to its own slot as
well.

Because a pattern does not contain its patches, it plays whatever is in those slots. If you
copy a pattern without its patches, or overwrite a patch one of your patterns uses, that pattern
will sound different. The *Changes* list warns about every case. For an incoming pattern, **bring
along** copies the patch it needs into the same slot. That can displace a patch one of your own
patterns uses, and the tool will then warn about that one instead. These are warnings, not
blocks: you can always build anyway.

### Empty slots

Selecting a row, group or range skips empty slots by default, so anything under them in your memory
stays. Turn on **Include empty slots** to copy them too, which clears the destination.

## The viewers

Both viewers are read-only views of the backup you loaded. The Detail panel's **View** button opens
a patch or preset from your memory or from a source. They label how sure they are:
**Known** (checked against the manual or the unit), **Likely** (fits every observation so far) and
**Observed** (seen on the unit, not explained). Anything not yet decoded says so rather than
guessing.

### Patch Viewer/Editor

Lays out the panel and shows each control's stored value, in physical units where they have been
measured (a bound is shown where they have not), plus the menu settings and effects. Step through
patches with ↑/↓.

**MIDI (Chrome or Edge; Safari has no Web MIDI).** *Connect MIDI*, pick the channel (LOWER is
channel 2 on the unit this was tested on), and *follow the unit* shows the panel moving as you turn
knobs. *Send patch to unit* puts the patch's panel controls in the unit's **edit buffer**. Nothing is
sent unless you press it, and nothing is saved on the unit until you press its own save button.
Effects and menu settings have no MIDI control and are not sent. The Roland USB driver must be
installed.

### Preset Viewer

Shows a preset's two patches, each part's sequence (steps, length, resolution), and the settings it
stores: part volume, pan and sends, delay and reverb, shuffle, scale, direction, key split and
arpeggio. Not stored in a preset, and so not shown: key transpose and bend range. The motion
(CC) records are not decoded. Gate length is **Observed**: it fits gate/100 of a step, with a clock of
scatter nobody has explained.

These settings were decoded from one unit on firmware 1.00 and may differ on other firmware.

## Safety

- The tool **never modifies the file you load**. It builds a new one.
- Before offering a download it checks that **no byte changed outside the slots you edited**, and
  that the new file re-reads with the same structure as yours.
- It refuses to mix records from a backup whose format or version flags differ from yours.
- Patches are copied **verbatim**, as whole records. The tool does not decode or re-encode
  parameters, so it cannot get a parameter subtly wrong.

**Verified on hardware** (one Jupiter-08): an unmodified backup, a single patch copied to a new
slot, a whole group of 48 patches merged, and a file using move, swap, clearing a slot and copying a
pattern each restore and back up again byte-identical.

**Viewers and MIDI:** checked on the same unit: the viewers against its backups, and the MIDI follow
and send-to-edit-buffer (which does not save) from Chrome.

**Not yet verified:** restores from units on other firmware versions, and the viewers' decoding on
anything but firmware 1.00. If yours differs, the tool
will most likely refuse the file rather than guess. Please open an issue if it does.

There is no warranty (see the license). Keep your original backup.

## The file format, briefly

`JUPITER08Backup.svd` (2,000,908 bytes) is an `SVD5` container with four sections: `PRFa`
(128 patterns × 11,524 bytes), `PATa` (256 patches × 2,048 bytes), `SYSa` (system) and `DIFa`
(version flags). Patch slots 0–239 are A11–E86, and patterns 0–95 are PA1A–PB8F. The rest exist in
the file but cannot be reached from the panel, and the tool never writes them. Each record starts
with a 16-character name. A pattern stores its LOWER and UPPER patch at bytes 51–52 and 135–136,
as `(hi << 7) | lo = 384 + patch slot`. `web/svd.js` is the reference: it checks every one of these
assumptions when it parses a file.

## Development

`web/index.html` is the page. `web/svd.js` holds all the file logic, with no DOM; `web/preset-core.js`
and `web/panel-core.js` decode presets and patches for the viewers, and `web/panel-midi.js` is the
Web MIDI part. Nothing is fetched at runtime. `node web/test-svd.js path/to/JUPITER08Backup.svd`
runs its checks against a real backup. They expect a unit that still holds the factory patches.

## License

No patches are transmitted or stored server-side. I do not want to steal your patches.

GPL-3.0-or-later; see `LICENSE`. You may use, modify and share this tool, including for money. If
you distribute it or a modified version, including by hosting it on a website, you must make your
source available under the same license.

Not affiliated with or endorsed by Roland Corporation. "Roland", "Jupiter-8" and "Jupiter-08" are
trademarks of Roland Corporation, and are used here only to say which instrument this works with.
