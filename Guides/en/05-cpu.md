<!-- i18n: source=Guides/ru/05-cpu.md sha=8b0131bdea50 self=55e176cdbfb6 -->
# CPU

<!-- nav:begin -->
[← eBAMATIC](04-ebamatic.md) · [Contents](README.md) · [GPU and stages →](06-gpu.md)  
**English** · [Русский](../ru/05-cpu.md)
<!-- nav:end -->

Section `Advanced → CPU`. A sensible place to start: the CPU has the fewest ties to
everything else.

> [!IMPORTANT]
> **Which entries you see depends on the console revision.** On Mariko: `Boost Clock`,
> `Min Voltage`, `Max Voltage`, `dCPUv`, `Low MHz Undervolt`, `High MHz Undervolt`,
> `Speed Shift`. On Erista: only `Boost Clock`, `Min Voltage`, `Voltage Limit` and
> `Speed Shift`.
>
> If you have an Erista and half the entries are missing — the package is not broken.
> They are not supposed to be there.

## What is here

| Entry | What it is | Where |
|---|---|---|
| `Boost Clock` | clock in boost mode — loading a game, downloading | both |
| `Min Voltage` | lower voltage bound | both |
| `Max Voltage` | upper voltage bound | Mariko |
| `Voltage Limit` | upper voltage bound | Erista |
| `dCPUv` | the second voltage floor — for middle and high clocks | Mariko |
| `Low MHz Undervolt` | undervolt for clocks up to roughly 1600 MHz | Mariko |
| `High MHz Undervolt` | undervolt for clocks above 1600 MHz | Mariko |
| `Speed Shift` | shifts the whole voltage curve — the main saving lever | both |

Most of them have `eBAMATIC` as their first value — automatic selection. Start there,
[why](04-ebamatic.md).

## The upper bound: one field under two names

`Max Voltage` and `Voltage Limit` are **the same thing**, the field is simply named
differently per revision. They are never shown together.

It is not a safety catch or an emergency limit. The firmware's own help says it plainly:
**the higher the value, the higher the clocks the CPU can reach**. It is a performance
lever, and you raise it when you are short of clock.

## How to tune it

Lowering voltage usually buys more than raising clocks: cooler, quieter, longer on
battery. But cut too much and the console will not reach its clocks — that is the price.

Order on Mariko:

1. `Low MHz Undervolt` — one level at a time.
2. `High MHz Undervolt` — the same for high clocks. Test with a **heavy** game; a light
   one never reaches them.
3. `Boost Clock` — if you want faster loading. It does not affect frames in a game.

On Erista only `Boost Clock` of these is available; voltage there is tuned through
`Min Voltage`, `Voltage Limit` and `Speed Shift`.

Reboot and fifteen minutes of play after each step.

> [!WARNING]
> **`Low MHz Undervolt` is not harmless.** It covers clocks up to roughly 1600 MHz —
> that is nearly all ordinary work, including booting the system. Overdo it and the
> console may never reach the home screen.
>
> Raise it one level at a time and keep a way back within reach.

## There is one tie to memory after all

If you set `Min Voltage` as a number in millivolts rather than as a stage, you will have
to raise it along with the memory clock — roughly **20 mV for every extra 200 MHz**.
That is what the entry's own help says.

The stages (`Auto — Eco ST1…ST3`) do not need this: they work the threshold out
themselves.

## Telling what you overdid

**A freeze right after the Atmosphere logo** most often means the CPU — the lower
voltage bound or the low-clock undervolt.

But memory behaves the same way: both the clock and the fine controls produce the same
picture. So the rule is the same as everywhere: **roll back what you changed last**,
not what you suspect.

## The voltage bounds

- **`Min Voltage`** — the CPU will not go below this under any load.
- **`dCPUv`** (Mariko only) — the second floor, for middle and high clocks.
- **`Max Voltage`** / **`Voltage Limit`** — the upper bound, and the lever for reachable
  clock.

> [!TIP]
> The CPU `Min Voltage` list is wider than the GPU one: it offers both automatic stages
> and specific millivolts. The GPU keeps stages only.

## Speed Shift

The name is misleading: this is **not** about how fast the CPU changes clock. It shifts
the whole CPU voltage curve one way or the other.

**The higher the value, the lower the consumption** — that is what the firmware's help
says.

| Entry | Side |
|---|---|
| `Sport` | adds voltage: more headroom at high clocks, more power draw |
| `ECO Stage 1…4` | saving: the further you go, the lower the draw and the smaller the margin |
| `eBAMATIC`, `Auto` | two different automatic modes, both off this scale |

The firmware accepts values from 25 to 175; the tuner offers eight named points out of
those, with no free entry.

### How to tune it

1. Start with `eBAMATIC`.
2. Want savings — go up a step at a time: `ECO Stage 1`, then `2`, then `3`.
3. Short of stability at high clocks — the other way, towards `Sport`.

> [!TIP]
> Touch this **after** `Low MHz Undervolt` and `High MHz Undervolt` are settled. Those
> work per clock range, while Speed Shift moves everything at once — adjust them together
> and you will not know which one did what.

---

<!-- nav:begin -->
[← eBAMATIC](04-ebamatic.md) · [Contents](README.md) · [GPU and stages →](06-gpu.md)  
**English** · [Русский](../ru/05-cpu.md)
<!-- nav:end -->
