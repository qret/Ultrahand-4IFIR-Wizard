# Thanks

This tuner did not appear out of nowhere. Almost everything in it was worked out by
someone else first, tested on their own console and shared for free. Here is who,
and for what — honestly and without rounding up.

---

## Nadir, aka **Cooler3D** — 4IFIR

Author of the firmware this whole thing exists for.

Overclocking a Switch is not "move a slider". It is a `loader.kip` holding a
`CustomizeTable` where clocks in kilohertz sit next to voltages in millivolts and
microvolts, DVFS curves for two hardware generations, and the eBAMATIC logic that derives
voltages on its own. All of it written, debugged and given away — together with the
comments in `customize.cpp` that turned out to be the best documentation on the subject
in existence.

**What we took:** `customize.cpp` became our primary source. When the two existing tuner
packages disagreed, we went there and found the answer. The comment
`// ERISTA = eristaGpuDvfsTable uV - (12500 uV * marikoGpuUV)` explained why one field
behaves differently on two revisions. The `mariko*` / `erista*` / `common*` prefixes in
field names gave us an exact revision map — more exact than the markup in either package.
The line `// ! drochr05 = drochr01 + drochr05` saved us a day and kept us from shipping
advice that was the reverse of the truth.

The overclocking itself, `loader.kip` and everything that makes 4IFIR a firmware are
Nadir's work and that of the Switch-OC-Suite authors. We did not touch it and do not
intend to: this tuner **writes into** the kip, it does not replace it.

---

## Vladislav — **EbalNX**

Author of the fork where the move to Ultrahand was already done and working.

We came from the outside and immediately stepped on the exact rakes he had walked around
a year earlier. His package was our textbook — and, more importantly, proof that the task
was solvable at all.

**What we took:**

- **The help page layout.** Two `[@Section]` and `[@Info]` pages in one file, flipped with
  L/R. We first did it our own way and got a screen titled "Commands" with text running
  into the frame. Then we looked at his: `;alignment=left`, `;offset=10`, parameter name
  as a table row. Taken wholesale.
- **The kip inspection page.** `;mode=table` where the value is substituted into the cell
  straight from the file at draw time. An idea we would have been slow to reach.
- **The `mariko:` and `erista:` markers** in the middle of a table — branching by console
  revision without a single condition.
- **System Info** — a screen showing revision, memory and the console's calibration
  constants. A simple thought: show the person what hardware they are dealing with.
- **Presets by memory chip model** rather than universal ones. Ours is still a stub, but
  the direction is his.
- And the general tone: short phrases written by hand, not generated.

Worth saying separately: **his help text is written by a human for a human.** We tried
generating ours and put "Linked with offsets 44, 5424, 5480, …" on screen. That was
a good lesson.

---

## **ppkantorski** — Ultrahand Overlay

The engine everything runs on. GPL v2, open source, actively developed.

**What we took:** the overlay itself (version 2.5.3, built from source without a single
modification), the menu description language, the mechanics of `;mode=option`,
`json_file_source`, `hex-by-custom-offset` and everything else. The sources served as our
reference manual: whenever the package behaved differently than expected, the answer was
in `main.cpp` or `utils.hpp`. Line references like `main.cpp:7381` scattered through our
comments come from there.

It is also a pleasure that the code is readable. That is not a universal property of
projects in this space.

---

## **efosamark** — Uberhand Overlay

The Ultrahand fork that 4IFIR Wizard ran on all these years.

**What we took:** an understanding of how the old package works and why it was built that
way. Many decisions that looked strange at first turned out to be workarounds for engine
limitations of the time. Uberhand carried that load honestly, and without it there would
have been neither Wizard nor a reason for our work.

---

## **rashevskyv** and the 4IFIR Wizard authors

The configuration package we are replacing.

**What we took:** value dictionaries and help texts — years of accumulated knowledge that
cannot be reconstructed by hand. Which value corresponds to which clock, where the safe
limit is, what `pMeh 8` actually means. The file
`MICRO-ENHANCE LOGIC/sMeh 8 E-Boost.txt`, warning about screen striping in the dock, is
the kind of thing you only learn by running into it.

The `pMeh` / `sMeh` numbering is preserved here without a single change. That is not
a tribute — it is a necessity: those numbers are how a person fixes a console through
hekate's KIP tool when it stops booting. Such a contract must not be broken.

---

## The **Switch-OC-Suite** and **Atmosphère** authors

The foundation everything above stands on. `CustomizeTable`, the loader patching
mechanism, the very possibility of changing clocks and voltages on a locked console.

---

## Also

- **Redraz, sauliiin, B3711** — credited in Ebal Tuner; part of the code we used as
  a model comes from them.
- **devkitPro** — the toolchain the engine is built with. Special thanks for libnx:
  we needed the master branch, and it built on the first try.
- Everyone who ever posted "tried X, console won't boot" on a forum. A negative result
  saves other people's time just as well as a positive one.

---

## What in all this is ours

So as not to claim more than due. Our contribution is only this:

- the field map, merged from three sources and verified against a live `loader.kip`;
- a generator that derives the label and the write from the same map entry — so they
  cannot drift apart;
- six checks a package cannot pass with known defects (four of them from a clone);
- the bugs we found that both original packages shared: writes into seven offsets holding
  the CPU frequency table rather than the GPU voltage curve; reset to defaults in one
  keypress, with no question and no backup.

Everything else here is someone else's, taken with gratitude.

---

## Licensing

Ultrahand Overlay — GPL v2 (ppkantorski), with CC BY 4.0 on part of the materials.
Our build of the engine is a derivative work and inherits GPL v2; sources are open.

Overclocking, `loader.kip`, 4IFIR and its components are **not included in this bundle
and are not modified** — they remain the work of their authors.
