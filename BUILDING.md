# Building 4IFIR Wizard

**English** · [Русский](BUILDING.ru.md) · [README](README.md)

## Building the package

Requires [Node.js](https://nodejs.org/) 18 or newer. No other dependencies.

```sh
git clone https://github.com/qret/Ultrahand-4IFIR-Wizard.git
cd Ultrahand-4IFIR-Wizard
node scripts/generate.mjs --clean
```

The result lands in `package/dist/` — copy it to your SD card as
`switch/.packages/4IFIR Wizard/`.

### Validating what you built

Four checks run from a clone, all of which must pass:

```sh
node scripts/uhlint package/dist       # DSL syntax
node scripts/check-menu.mjs            # every offset is reachable from exactly one item
node scripts/check-generated.mjs       # generated output matches intent
node scripts/make-guide.mjs --check    # the guide still matches the package
```

A full build runs two more that are not in this repository, because they read the live
`loader.kip` from the console this was developed against: one compares the field map
against the firmware actually installed, the other replays the old-profile importer.
`BUILD.txt` inside every release archive lists all six by name.

`uhlint` matters more than it sounds. **Both overlay engines swallow errors silently:**
an unknown command is simply ignored, and a failed kip write reports success. For an
overlay that changes CPU voltages, a partially applied profile is more dangerous than
one that never applied at all. The linter is the only thing standing between a typo
and a console that won't boot.

---

## Building the engine

The overlay binary (`ovlmenu.ovl`) is **not** part of this repository — it is built, not
committed. Whether it is part of a release depends on which release: the ordinary archive
carries the configurator alone, while a build **with** the engine carries the binary and
`config/ultrahand/` too, as [Installing](README.md#installing) describes. The engine is
maintained by the author of the firmware and comes with the 4IFIR build; this project's engine
changes live in a fork, and an archive that carries a binary is built from that fork.

So build it yourself if you want to modify the engine, to reproduce what is shipped, or to
see for yourself what you are running. The rest of this section covers that. It is
written for Windows with WSL, but the steps are the same on any Linux.

### What you need

| | |
|---|---|
| WSL 2 with Ubuntu | `wsl --install -d Ubuntu` from an elevated PowerShell |
| devkitPro / devkitA64 | the ARM64 toolchain for Switch homebrew |
| libnx **from master** | not the released version — see below |
| ~4 GB free space | toolchain and sources |

### Why libnx from master, and not a release

Ultrahand 2.5.3 reads `nacp.lang_data`. In libnx 4.12.0 — the current release —
`NacpStruct` still has the older `NacpLanguageEntry lang[16]` form, so the build fails with:

```
error: 'struct NacpStruct' has no member named 'lang_data'
```

This is the single most common reason people fail to build Ultrahand. Install the released
libnx first through the package manager, then replace it with a build from master.

### Steps

Install devkitPro's package manager, then the toolchain:

```sh
sudo apt-get update && sudo apt-get install -y wget gnupg xz-utils build-essential git
wget https://apt.devkitpro.org/install-devkitpro-pacman
chmod +x install-devkitpro-pacman && sudo ./install-devkitpro-pacman
sudo dkp-pacman -Sy --noconfirm switch-dev devkitA64
```

Build and install libnx from master, replacing the packaged one:

```sh
export DEVKITPRO=/opt/devkitpro
export DEVKITA64=$DEVKITPRO/devkitA64
export PATH=$DEVKITPRO/tools/bin:$DEVKITA64/bin:$PATH

git clone https://github.com/switchbrew/libnx.git
cd libnx && make -j$(nproc)
sudo -E make install
```

Clone the engine **with submodules** and build:

```sh
git clone --recurse-submodules https://github.com/ppkantorski/Ultrahand-Overlay.git
cd Ultrahand-Overlay
make -j$(nproc)
```

That is upstream, the engine itself. This project's engine changes live in a fork,
<https://github.com/qret/Ultrahand-Overlay>, branch `4ifir` — clone that one instead if
you want them. When a release archive carries a binary, that branch is what it was built
from, and it is pushed before the archive goes out: GPL v2 asks for the source of a
binary you hand out, not for the source of some later version of it.

### Two things that will bite you

**The submodule is not optional.** `lib/libultrahand` must be populated. Cloning without
`--recurse-submodules` leaves it empty and the build fails immediately. Fix with
`git submodule update --init --recursive`.

**No spaces in the path.** `ultrahand.mk` uses `$(subst …)`, and make splits the value on
spaces. A path like `~/My Projects/Ultrahand` breaks the build in a way that is hard
to read from the error message.

### Verifying the result

You get `ovlmenu.ovl`, roughly 1.0–2.2 MB. Two markers confirm it is a valid Ultrahand
overlay rather than something else:

```sh
xxd -s 16 -l 4 ovlmenu.ovl     # NRO0  — valid NRO header
tail -c 4 ovlmenu.ovl          # ULTR  — Ultrahand signature, added by the Makefile
```

The `ULTR` tail is what distinguishes Ultrahand from Uberhand builds.

**Byte-for-byte reproducibility is not guaranteed.** The Makefile passes `-flto=$(NPROC)`,
so the output depends on how many cores your machine has. Compare versions and behaviour,
not hashes.

### Putting it together

```
SD card root
├── switch/.overlays/ovlmenu.ovl        the engine — from the 4IFIR build, or built above
├── config/ultrahand/                   its config, themes, languages, sounds
│   └── config.ini                      the key combination — see below
└── switch/.packages/4IFIR Wizard/      package/dist from this repo  ─── the release archive
```

**If the combination is missing, take `config/ultrahand/config.ini` from this
repository.** A 4IFIR build already has one; a card you assembled yourself may not. The
engine then takes the combination from `config/tesla/config.ini`, and falls back to the
built-in `ZL + ZR + ▼` only when that file has none either — neither outcome is
guaranteed to be the `L + R + ▲` the README promises. The file is short and every line
in it is commented — it pins the key combination and keeps other overlays able to have
their own.

Do **not** copy `fuse.ini` from someone else's card — it holds calibration constants
specific to one console and is generated for yours on first run.

---

## How it works

The package is not written by hand. It is **generated from a field map**, and that is
the central idea of this project: the label a menu item displays and the value it writes
come from the same map entry, so they cannot drift apart.

Both original packages drifted. In one of them an item writes to offset `12448` while
displaying the value read from `12444` — a mismatch nobody noticed for years.

```
package/
  fields.json          field map: 129 offsets of the CUST block inside loader.kip —
                       address, length, units, console revision, value dictionary,
                       and what each entry is corroborated by
  menu.json            menu structure: where each parameter lives, help texts
  semantics-src/       subsystem semantics and cross-parameter dependencies
  backup-import.json   mapping of legacy 4IFIR Wizard backups onto the map's offsets

scripts/
  generate.mjs         builds the package from the map
  uhlint/              Ultrahand DSL linter
  check-menu.mjs       coverage check
  check-generated.mjs  intent check
```

### Console revisions

Fields in the `CUST` block are either common, Mariko-only or Erista-only. That split comes
from the primary source — `customize.cpp` by the 4IFIR authors, where the revision is
encoded in the field name itself: `common*`, `mariko*`, `erista*`. This is more reliable
than the markup inside the shipped packages, which contradicts itself in several places.

### Units

Three of them share one block: kilohertz for clocks, millivolts for CPU/GPU voltages and
the Mariko curve, microvolts for Vdd2, Vddq and the Erista curve. Getting them wrong means
being off by a factor of a thousand, so units live in the map rather than being guessed
from a field's name.
