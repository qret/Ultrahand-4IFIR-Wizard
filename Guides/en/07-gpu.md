<!-- i18n: source=Guides/ru/07-gpu.md sha=e8844d09cf06 self=d3a855d50e65 -->
# GPU and stages

<!-- nav:begin -->
[← CPU](06-cpu.md) · [Contents](README.md) · [RAM →](08-ram.md)  
**English** · [Русский](../ru/07-gpu.md)
<!-- nav:end -->

Section `Advanced → GPU`. This holds the most useful setting in the tuner — and the
least obvious one.

> [!IMPORTANT]
> **This page is about Mariko** — the v2, Lite and OLED consoles. On Erista the GPU
> works in a fundamentally different way: [separate section below](#on-erista-it-all-works-differently).
>
> `Service → System Info` tells you which console you have.

## What an undervolt stage is

The GPU needs voltage, and the higher the clock, the more of it. The firmware keeps that
relationship in a **table**: thirty-one rows of "clock — voltage".

**A stage is a choice of table.** The higher the number, the lower the voltages:

| Stage | Voltage at the lowest clock |
|---|---|
| Eco ST1 | 485 mV |
| Eco ST2 | 465 mV |
| Eco ST3 | 445 mV |

Lower voltage means less heat and longer battery. Drop too far and the GPU runs short of
power, which shows up as artefacts.

> [!TIP]
> Stages differ at the **bottom** of the curve. The top row is the same for all three —
> 960 mV, the limit of the GPU rail. Looking for the difference at the top will never
> find it.

## A stage also changes the clock ceiling

This is the part almost nobody knows.

The last row of the table sets the **maximum GPU clock**, and it differs per stage:

| Stage | Clock ceiling |
|---|---|
| Eco ST1 | 1459 MHz |
| Eco ST2 | 1536 MHz |
| Eco ST3 | 1613 MHz |

So switching stage "to save power" silently changes **how far you can overclock**.
And the other way round: the advertised 1613 MHz is only available on ST3.

> [!IMPORTANT]
> Set a GPU clock above the ceiling of the current stage and the excess will not apply.
> Stage first, clock second.
>
> The GPU clock itself is set by the 4IFIR overlay, not by this tuner.

## Five stages instead of three

The firmware has three, and the distance between neighbours is **not constant**: about
twenty millivolts at low clocks, widening to fifty-five at high ones. A stage is not the
same curve shifted by a fixed amount, it is a separately tuned curve.

And even twenty millivolts is a lot: the gap between "comfortably stable" and
"artefacts" is often smaller.

This tuner adds two in between — **Eco ST1.5** and **Eco ST2.5**. Each sits roughly
halfway between its neighbours, closer to the lower one: about ten millivolts below on
average, though at high clocks the gap reaches twenty-five.

**The top row does not change** — it stays at those same 960 mV. The GPU rail limit must
not be lowered, so "halfway" applies to the curve, not to its peak.

**A half stage inherits the clock ceiling of the stage below it:**

| Stage | Ceiling |
|---|---|
| Eco ST1 | 1459 MHz |
| **Eco ST1.5** | **1459 MHz** |
| Eco ST2 | 1536 MHz |
| **Eco ST2.5** | **1536 MHz** |
| Eco ST3 | 1613 MHz |

That is deliberate: a half stage should be safer than the stage above it in every
respect, not only in voltage.

## How it works underneath — briefly

You do not need this, but without it KipTool's behaviour makes no sense.

A stage is **two things at once**: a mode number and the contents of a table. ST1 and ST3
have tables of their own, which the tuner never touches. ST1.5, ST2 and ST2.5 **share one
mode number** and differ only in what is written into the working table.

When you pick a stage, the tuner writes **both the number and the whole table**. That is
why switching works immediately, with no intermediate steps.

## If the console will not boot because of a stage

The tuner is not available at that point — only the bootloader is:

1. Boot into **hekate**, run the **KipTool** payload, open **KIP Wizard**.
2. Find the GPU mode setting and choose **`ECO ST1`**.
3. Apply and boot.
4. Set the stage you actually want from the tuner.

> [!WARNING]
> **Only `ECO ST1`. Not `ECO ST3`, and not `MANUAL`.**
>
> `ECO ST3` is the **deepest undervolt in the firmware**, 25–60 mV below ST1.5. If the
> console failed to boot for want of voltage, ST3 makes it worse, and raises the clock
> ceiling as well.
>
> `MANUAL` is the manual table, [see below](#the-manual-table). If the console will not
> boot, the offending value is most likely sitting in that very table, so it is no use as
> a way back.
>
> `ECO ST2` is useless: **the table that holds the entire difference between ST1.5, ST2
> and ST2.5 is not shown by KipTool at all** — it is not in its list of fields. To it all
> three look identical and are labelled `ECO ST2`. Picking it changes nothing.

For the same reason half stages are not visible in KipTool and never will be — there is
nothing to tell apart in the number it shows.

KipTool can edit other tables — the `Custom Table` array, timings, the `pMeh` and `sMeh`
rows. Just not this one.

## Minimum voltage

`Min Voltage` sets a **floor**: the GPU will not go below it at any clock. It acts from
below, the stage acts above it.

The choices are the same three Eco stages. That is deliberate: a fixed number would hit
both memory clock modes at once, while a stage works out the floor for each separately.

## How to tune

1. Pick a stage — start from the one you have and step down one at a time.
2. **Reboot** after each change.
3. Play something demanding for fifteen minutes.
4. Artefacts, flickering dots, an orange screen — **step back up**.

> [!TIP]
> An overdone GPU shows itself in the picture: texture artefacts, flickering dots.
> A console that freezes right after the logo is usually **not** the GPU — look at the
> CPU and memory.

## The manual table

**Custom Table** — the manual table mode: you set the voltage of every frequency point
by hand. There are thirty-one points; the top one is 1459.2 MHz, shown in the menu as
`Max Clock`. That same point sets the GPU clock ceiling in this mode. Changes apply
after a reboot.

> [!NOTE]
> Earlier editions of this guide said the manual table must not go above 1190 MHz.
> That was wrong: the firmware reads all thirty-one rows. What actually happened was
> that the tuner did not offer the top seven points, so they kept another table's
> leftovers. They are now filled like any other point.

**Where the table starts.** The tuner fills it with the `Eco ST1` values — 485…960 mV,
all thirty-one points. It does so in two places: when you **switch the mode** to
`Custom Table`, and when you **open `GPU Voltage Table`** with the mode already on.
Either one is enough, and the order does not matter.

That is a one-off starting point: edit any point afterwards and the tuner will never
write there again. The test is simple — if a single cell differs from the factory
content, you have already tuned it, and the tuner touches nothing.

> [!NOTE]
> It used to happen only when you opened the table. Anyone who followed the hint to
> "turn the mode on" and never came back to the table was left with the top of the
> curve unfilled. Switching the mode is now enough.

Without it your first visit would show the factory ladder of 395…1020 mV, whose bottom
point sits below the safe minimum, and seven top cells holding another table's leftovers.

## On Erista it all works differently

On Erista — the first-generation console — the GPU is built differently, and almost
nothing above applies.

| | Mariko | Erista |
|---|---|---|
| voltage tables | three | **one** |
| rows in the table | 31 | **29** |
| what a stage does | picks a table | **shifts the single curve down** |
| step per stage | its own curve | −12.5 mV per stage |
| clock ceiling | changes with the stage | **fixed**, around 1266 MHz |
| bottom of the curve | 485 / 465 / 445 mV | around 675 mV |
| top of the curve | 960 mV | 1150 mV |
| half stages | yes | **no** |

Practical consequences:

- **A stage on Erista does not change the overclocking limit.** The ceilings section
  above is not about you.
- **`Min Voltage` on Erista does not show the voltage you will get.** The firmware adds
  100 mV to whatever you pick: an entry reading "610 mV" actually gives 710.
- **KipTool on Erista can edit the curve itself**, not only the mode number. Be careful
  though: from the second row on, the clock labels it shows do not match reality.
- **KipTool shows the Erista stages shifted by one.** Its `ECO ST1` is in fact no
  undervolt at all, `ECO ST2` is the first stage, `ECO ST3` the second. The third stage
  cannot be reached from there.

  For emergency recovery that is convenient: **the first entry in KipTool is the safest
  thing you can pick.** But the statement above that "`ECO ST2` changes nothing" applies
  to Mariko only. On Erista it gives you a real first stage.
- **This tuner has no `Custom Table` entry on Erista.** There is no manual table on that
  revision, and the entry quietly gave you the deepest voltage offset instead of the editor
  it promised — so it was taken out of the list. If you meet it in another tool, do not
  pick it.

---

<!-- nav:begin -->
[← CPU](06-cpu.md) · [Contents](README.md) · [RAM →](08-ram.md)  
**English** · [Русский](../ru/07-gpu.md)
<!-- nav:end -->
