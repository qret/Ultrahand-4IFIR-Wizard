# Notice — what is whose

This project is released under the **GNU General Public License, version 2** — the full
text is in [LICENSE](LICENSE). This file explains, in plain words, what that covers and
what came from other people. It is not a licence itself; where the two disagree, the
LICENSE file wins.

---

## Ours, under GPL v2

- `scripts/` — the generator, the DSL linter, the checks, the build and publish tooling
- `package/fields.json` — the field map: offsets, lengths, units, console revisions
- `package/menu.json`, `package/semantics-src/`, `package/factory-defaults.json`
- `config/ultrahand/config.ini`
- `README.md` and the documentation

GPL v2 was chosen deliberately rather than something more permissive: the engine this
package runs on is GPL v2, and so is the surrounding ecosystem — Atmosphère, hekate,
Switch-OC-Suite. Picking a looser licence for work that sits this close to theirs would
have been, at best, impolite.

---

## Not ours

### Value dictionaries and part of the help texts

Which byte means which voltage, where the safe limit is, what `pMeh 8` actually does —
this is years of accumulated knowledge that cannot be reconstructed by hand. It comes
from the **4IFIR Wizard** package by **rashevskyv** and contributors:
<https://github.com/rashevskyv/4IFIR>

**That project states no licence for the package itself.** Its `docs/LICENSES.md` lists
licences for the programs it modifies, and the configuration package is not one of them.
We use this material with attribution and in the same spirit it was published — freely,
for the same community.

**If an author of that material asks us to remove it, we will.** No argument, no delay.

### The Ultrahand Overlay engine

The package runs on **Ultrahand Overlay** by **ppkantorski**, GPL v2:
<https://github.com/ppkantorski/Ultrahand-Overlay>

**This release archive carries a modified build of it**, version 2.5.3, alongside the
configurator. GPL v2 obliges us to name the corresponding source, and it is our fork —
<https://github.com/qret/Ultrahand-Overlay>, branch `4ifir`; `BUILD.txt` in the archive
records the exact commit and the sha256 of the binary.

This is the last release built this way. From the next one on the engine is maintained by
the author of the 4IFIR firmware and reaches people with the firmware build, and our
archives carry the configurator alone.

Our own engine changes live in a fork, and anything we build from it has its source
there:

> <https://github.com/qret/Ultrahand-Overlay>, branch `4ifir`

**Byte-for-byte reproduction is not possible:** the Makefile passes `-flto=$(NPROC)`, so
the result depends on the core count of the build machine. Compare version and behaviour,
not hashes.

### Overclocking itself

`loader.kip`, the `CustomizeTable` layout, the bootloader, `4IFIR.ovl` and the 4IFIR
firmware are the work of **Cooler3D (Nadir)** and the **Switch-OC-Suite** authors.

**None of it is included in this repository or in any archive we publish, and none of it
is modified.** This package *writes into* the kip; it never replaces it.

---

## Warranty

There is none. See sections 11 and 12 of the LICENSE.

Beyond the legal wording, the practical version: overclocking a Nintendo Switch beyond
its stock tables, with voltage adjustments, can damage the console. Voltage settings in
particular are not something a tool can make safe. Make a backup before your first
change, and change one thing at a time.

---

## Credits

Named individually in [THANKS.md](THANKS.md). Almost everything here was worked out by
someone else first, tested on their own console, and shared for free.
