# Thanks

This configurator did not appear out of nowhere. Almost everything in it was worked out by
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

**What we took:** `customize.cpp` became our primary source. When the two existing
packages disagreed, we went there and found the answer. A one-line comment giving the
Erista GPU voltage formula (`customize.cpp:83`) explained why one field behaves differently
on two revisions. The `mariko*` / `erista*` / `common*` prefixes in field names gave us
an exact revision map — more exact than the markup in either package.
A note flagged with an exclamation mark — that the kip adds the first memory timing into the
fifth (`customize.cpp:101`) — saved us a day and kept us from shipping advice that was
the reverse of the truth.

The overclocking itself, `loader.kip` and everything that makes 4IFIR a firmware are
Nadir's work and that of the Switch-OC-Suite authors. We did not touch it and do not
intend to: this configurator **writes into** the kip, it does not replace it.

---

## Vladislav — **EbalNX**

Author of the fork where the move to Ultrahand was already done and working.

We came from the outside and immediately stepped on the exact rakes he had walked around
a year earlier. His package was our textbook — and, more importantly, proof that the task
was solvable at all.

**What we took:**

- **Part of the value dictionaries** — entries his package offered and 4IFIR Wizard's
  did not.
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
- **Presets by memory chip model** rather than universal ones. This configurator ships no
  presets at all, but the reasoning — a set "for everyone" makes no sense — is his.
- And the general tone: short phrases written by hand, not generated.

Worth saying separately: **his help text is written by a human for a human.** We tried
generating ours and put "Linked with offsets 44, 5424, 5480, …" on screen. That was
a good lesson.

---

## **ppkantorski** — Ultrahand Overlay

The engine everything runs on. GPL v2, open source, actively developed.

**What we took:** the overlay itself (version 2.5.3), the menu description language, the
mechanics of `;mode=option`, `json_file_source`, `hex-by-custom-offset` and everything
else.

It is no longer an unmodified build. When an archive of ours carries an engine, that
engine is our fork of the same 2.5.3 with our own commits on top:
<https://github.com/qret/Ultrahand-Overlay>, branch `4ifir`. Some of those changes live
as patch files in `patches/` there, applied to the `lib/libultrahand` submodule; the rest
are ordinary commits. The `BUILD.txt` inside such an archive names the exact commit the
binary was built from, and that commit is on GitHub before the archive is.

The sources served as our reference manual: whenever the package behaved differently than
expected, the answer was in `main.cpp` or `utils.hpp`. Line references like
`main.cpp:7381` in our comments point into ppkantorski's own tree. **They go stale** —
his code moves between versions, and our patches move ours — so treat any such number as
a hint and confirm it by the surrounding function or string name.

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

- the field map, merged from the two donor packages and verified against a live
  `loader.kip`;
- a generator that derives the label and the write from the same map entry — so they
  cannot drift apart;
- a build gate of checks a package with a known defect cannot pass (they are in
  `scripts/check-generated.mjs` — this file deliberately keeps no count of its own);
- the bugs we found that both original packages shared: on Erista, writes into seven
  offsets that hold row 0 of the CPU frequency table there, not the GPU voltage curve —
  on Mariko the very same bytes *are* curve points, which is why we show them on one
  revision and not the other; and reset to defaults in one keypress, with no question
  and no backup.

Everything else here is someone else's, taken with gratitude.

---

## Licensing

Ultrahand Overlay — GPL v2 (ppkantorski), with CC BY 4.0 on part of the materials.
Our build of the engine is a derivative work and inherits GPL v2; sources are open.

Overclocking, `loader.kip`, 4IFIR and its components are **not included in this bundle
and are not modified** — they remain the work of their authors.
