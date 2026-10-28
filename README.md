# Jupiter-08 Librarian

A patch librarian (patch manager) for the Roland Jupiter-08, running in your browser. See what is
stored in every patch and pattern slot, bring patches and patterns in from other backups, put them
where you want, and build a new backup to restore.

The Jupiter-08 has no SysEx, so the only way to move patches onto it in bulk is a whole-unit
restore. This tool edits the backup file so that a restore brings in exactly the patches you chose,
and nothing else changes.

> **Status: v0.1.** Human-designed and human-tested on a real Jupiter-08, and written with AI
> assistance. Each hardware claim below was checked on the unit.
>
> No patches are transmitted or stored server-side.

## Using it

1. **Back up your Jupiter-08.** Hold **[MENU]** while switching it on, connect it over USB, and copy
   `BACKUP/JUPITER08Backup.svd` off the `JUPITER-08` drive. **Keep this original somewhere safe.**
2. **Open the tool** at <https://ryanmgilmore.github.io/jupiter-08-librarian/>, or download the repo
   (or just the `web/` folder) and open `web/index.html`, which works offline. Either way there is
   nothing to install, and your files never leave the browser.
3. **Drop your backup** onto *Your memory*.
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

A pattern does not contain its patches; it stores which slot its LOWER and UPPER parts play. If you
copy a pattern without its patches, or overwrite a patch one of your patterns uses, that pattern
will sound different. The *Changes* list warns about every case. For an incoming pattern, **bring
along** copies the patch it needs into the same slot. That can displace a patch one of your own
patterns uses, and the tool will then warn about that one instead. These are warnings, not
blocks: you can always build anyway.

### Empty slots

Selecting a row, group or range skips empty slots by default, so anything under them in your memory
stays. Turn on **Include empty slots** to copy them too, which clears the destination.

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

**Not yet verified:** restores from units on other firmware versions. If yours differs, the tool
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

`web/svd.js` holds all the file logic, with no DOM. `node web/test-svd.js path/to/JUPITER08Backup.svd`
runs its checks against a real backup. They expect a unit that still holds the factory patches.

## License

No patches are transmitted or stored server-side. I do not want to steal your patches.

GPL-3.0-or-later; see `LICENSE`. You may use, modify and share this tool, including for money. If
you distribute it or a modified version, including by hosting it on a website, you must make your
source available under the same license.

Not affiliated with or endorsed by Roland Corporation. "Roland", "Jupiter-8" and "Jupiter-08" are
trademarks of Roland Corporation, and are used here only to say which instrument this works with.
