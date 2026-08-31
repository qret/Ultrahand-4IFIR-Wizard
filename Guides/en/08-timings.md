<!-- i18n: source=Guides/ru/08-timings.md sha=12c1b0b6db52 self=81c431912399 -->
# Timings and fine tuning

<!-- nav:begin -->
[← RAM](07-ram.md) · [Contents](README.md) · [Profiles, backups and reset →](09-profiles.md)  
**English** · [Русский](../ru/08-timings.md)
<!-- nav:end -->

The deepest part of the tuner. Come here **last**, once the memory clock and voltages
have settled.

## What timings are

The delays with which memory answers requests. Shorter delay means faster work and less
margin for error.

Eight `Core Timings` entries in the `RAM` section.

## What the edge values mean

For seven of the eight, `0` is a **debug mode** and `1` an **automatic safe** one. Above
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

## The fifth timing and the first

In the firmware source the author recorded this link with an exclamation mark: what gets
applied is the **sum of the first and the fifth**. So raise the first and the fifth goes
up with it, even though you never touched it.

> [!NOTE]
> This is the author's own note, not something we verified on hardware. The question is
> on our list for the firmware author. The donor guide meanwhile claims timings do not
> affect one another — on that point it should not be trusted.

If freezes start after changing the first one, check the fifth.

## How to tune

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

The firmware can tune timings in real time, during a game — that lives in the 4IFIR
overlay, not here. This tuner writes values into the settings file, and they apply at the
next startup.

That is a boundary, not a shortcoming: we do not touch the other overlay and we do not
duplicate it.

---

<!-- nav:begin -->
[← RAM](07-ram.md) · [Contents](README.md) · [Profiles, backups and reset →](09-profiles.md)  
**English** · [Русский](../ru/08-timings.md)
<!-- nav:end -->
