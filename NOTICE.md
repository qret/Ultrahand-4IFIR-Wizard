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

Release archives contain a compiled `ovlmenu.ovl`. It is a build of **Ultrahand
Overlay** by **ppkantorski**, GPL v2:
<https://github.com/ppkantorski/Ultrahand-Overlay>

**It is a modified build.** We carry our own changes on top of upstream, so the
corresponding source is **our fork**, not upstream:

> <https://github.com/qret/Ultrahand-Overlay>, branch `4ifir`

That is where the source matching the shipped binary lives. Upstream does not
contain our changes and is therefore not the corresponding source for it.

`BUILD.txt` inside each archive names the repository, the branch, the exact commit
and the sha256 of the binary shipped in that archive — read there, not here: this
file cannot be re-generated per build, `BUILD.txt` is.

**Byte-for-byte reproduction is not possible:** the Makefile passes `-flto=$(NPROC)`, so
the result depends on the core count of the build machine. Compare version and behaviour,
not hashes.

### Themes, languages and sounds

`config/ultrahand/` in release archives carries assets from the Ultrahand project —
themes, language files, sounds, wallpapers. They are ppkantorski's work, distributed
under GPL v2 with **CC BY 4.0** on part of the materials, which asks for attribution.
This is it.

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
