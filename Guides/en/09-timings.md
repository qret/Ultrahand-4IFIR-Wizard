<!-- i18n: source=Guides/ru/09-timings.md sha=50b5bbbd65fe self=e70140d8f47c -->
# Timings and fine tuning

<!-- nav:begin -->
[← RAM](08-ram.md) · [Contents](README.md) · [Profiles, backups and reset →](10-profiles.md)  
**English** · [Русский](../ru/09-timings.md)
<!-- nav:end -->

The deepest part of tuning. Come here **last**, once the memory clock and voltages
have settled.

## What timings are

How long the memory takes to answer a request. A shorter delay means faster memory — and
less margin for error.

## Two layers, and ours is the lower one

Timings in 4IFIR are set in two places, and this is **not a choice between them**. Our
`Core Timings` lay the coarse groundwork; `EMC Magician` fine-tunes it on top. What you
set here keeps working.

| | Core Timings | EMC Magician |
|---|---|---|
| where | this tuner, `Advanced → RAM` | the **4IFIR** overlay |
| when it applies | after a reboot | **at once, live** |
| what it sets | steps from "softer" to "tighter" | each value and its "arbiter" |
| how many entries | eight | more, one per timing |
| where it is kept | in the firmware (`loader.kip`) | `/config/4IFIR/emc_timings.ini` |
| a set per profile | no, one for all | **yes**, per memory clock + eBal pair |

**Fine tuning goes through EMC Magician** — the 4IFIR guide of its own says so outright,
and keeps the description of the eight `Core Timings` as a reference for those who want
the old way.

The reason is simple: here you get eight steps and a reboot per change, there a value
applies at once and can be set more precisely.

## EMC Magician — tuning while the console runs

It is part of the firmware rather than a separate program: the 4IFIR system module does
the work and the **4IFIR** overlay displays it — `EMC Magician` is just one of its menu
entries.

The main difference: **a value applies immediately**. You can leave a memory benchmark
running, move a slider, and watch the numbers change. What costs a reboot per step the
old way takes seconds here.

The second difference: a separate set of timings **for each memory clock + eBal pair**.
Switch profile and its set comes with it — nothing to set up again.

The settings live in `/config/4IFIR/emc_timings.ini` — that is, **outside the firmware**.
Updating 4IFIR through AiO does not wipe them.

### How to tune

Measuring is done with `MicroMemBench` and `MicroMemTest`, both already in the build.

They have to run in **full memory mode** or they refuse to start. 4IFIR sets this up out
of the box: **hold `R` while launching any game** and the Homebrew Menu opens instead,
already in that mode. There is no need to install it separately, as older guides advise.

> [!TIP]
> You can put `MicroMemBench` on the home screen: the `games` folder on the card holds
> `MicroMemBench.nsp` — install it with `DBI` and the benchmark shows up among your games,
> launching straight into full memory mode.

1. **4IFIR overlay → EMC Magician**, turn on all three switches.
2. Start `MicroMemBench`. Before launching it, set the CPU to `4IFIR Maximized`.
3. Wait for the memory to move to `Optimized S`.
4. **Without leaving the benchmark**, open `EMC Magician`.
5. Move the first slider one step right. No gain — move it left instead. **Wait a few
   seconds** after every step and watch the numbers.
6. Once the numbers drop or the console freezes, the previous value is your limit. The
   stable value is the one circled in white; save it with `X`.
7. Verify: `MicroMemTest`, ten passes are enough, CPU at `4IFIR Optimised`.
8. Verify in a game — something heavy, docked.
9. Repeat from step 2 for the next slider.
10. Once they are all set, check the lot again: `MicroMemTest` with the CPU at
    `4IFIR Optimised`, then a game.
11. Set the CPU back to **`4IFIR Optimised`** and open `MicroMemBench` again. This matters:
    the arbiter has to be picked at the clock you actually play at, not the overclocked one.
12. Without leaving the benchmark, use `L` and `R` to pick the **arbiter** for each timing.
    Save with the same `X`.

One thing to know about the arbiter: it **does not affect stability, only speed**.
Speed drops both when it is set too high and when it is set too low, and the optimum is
usually not far from what the firmware worked out by itself.

> [!WARNING]
> **Freezes here are part of the procedure, not a fault.** You find the limit by pushing
> until the system locks up. Hold the power button for about twelve seconds to turn the
> console off.
>
> Tune on **EmuNAND** and back up your saves beforehand.

### How to reset

The order comes from the 4IFIR guide, step by step:

1. Turn `Magician` off.
2. Switch the memory to `Optimized S`.
3. Turn the overclock off with `+` in `Edit app profile`.
4. Turn `Magician` on.
5. Reset the switches you want with `Y`.
6. Turn the overclock on with `A` in `Edit app profile`.
7. Make it stick — switch to `Optimized`, or put the console to sleep and wake it.

Or, which comes to the same thing: delete the section matching your current memory
profile from `/config/4IFIR/emc_timings.ini` and reboot.

> [!IMPORTANT]
> **If Magician timings stop the console from booting, `KipTool` will not help** — it
> edits the firmware, and these values are not there. Take the SD card out, open
> `/config/4IFIR/emc_timings.ini` on a computer and delete the section for the current
> profile.

## Core Timings — the older way, in this tuner

Eight entries under `Advanced → RAM → Core Timings`.

They set the same thing differently: not the values themselves but **steps** — from soft
to tight — and the firmware works out the actual delays from them, with an eye on the
`eBal` mode. So the same step gives different delays under different `eBal`.

### What the edge values mean

For seven of the eight, `0` is a **debug mode** and `1` the **factory value**, where the
firmware works the delay out by itself. Above
that come steps: the higher the number, the tighter the timing.

Three caveats that are easy to trip over:

- **`Core Timings 3` is the exception.** It has no debug mode at all; zero there means
  automatic selection, and that is its factory value.
- **The top value of `Core Timings 2` and `Core Timings 3` falls out of the pattern** —
  it switches the algorithm rather than tightening the delay.
- **The upper bound differs for all eight.**

> [!TIP]
> In the list `0 — DEBUG` comes **last**, not first. Look for it at the end.

Start at `1` — that is the automatic mode.

### The fifth timing and the first

There is reason to believe these two are linked: what gets applied is the **sum of the
first and the fifth**. So raise the first and the fifth goes up with it, even though you
never touched it.

> [!NOTE]
> This is the author's own note, not something we verified on hardware. The question is
> on our list for the firmware author. The donor guide meanwhile claims timings do not
> affect one another — on that point it should not be trusted.

If freezes start after changing the first one, check the fifth.

### How to tune Core Timings

1. Make sure memory clock and voltages are already stable.
2. Raise **one** entry at a time.
3. Reboot, benchmark, play.
4. Worse or unstable — back.

The test is twofold: timings affect both stability and speed. Check both — the benchmark
for the number, a game for stability.

Benchmark noise is a few tens of megabytes per second and can be ignored. A drop of
several hundred is real.

## Micro-Enhance Logic

`Advanced → Micro-Enhance Logic` holds the raw firmware controls under their code names,
`pMeh` and `sMeh`.

**The numbering must not change, and we do not change it.** It is a contract with
KipTool: if the console will not boot, that is where you will look for a setting by its
number. The names, incidentally, have already drifted apart between KipTool and the
firmware — the numbers have not, and that is why they are the contract.

Most people never need these. What is genuinely worth adjusting has been moved into
readable entries in `RAM → Optimized Mode (1600 MHz)`.

> [!WARNING]
> **Stripes on the screen in the dock come from `sMeh 8 E-Boost`.** Put it back to `0`.
>
> The same control appears in `Optimized Mode (1600 MHz)` as `Efficiency Stages` — it is
> one field, resetting either one does the job.

## What we do not do

We do not do live tuning, and we will not — it lives in `EMC Magician`, [described above](#emc-magician--tuning-while-the-console-runs).
This tuner writes values into the firmware's settings file, and they apply at the next
boot.

That is a boundary, not a shortcoming: we do not touch the other overlay and we do not
duplicate it.

---

<!-- nav:begin -->
[← RAM](08-ram.md) · [Contents](README.md) · [Profiles, backups and reset →](10-profiles.md)  
**English** · [Русский](../ru/09-timings.md)
<!-- nav:end -->
