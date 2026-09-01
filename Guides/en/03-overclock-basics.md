<!-- i18n: source=Guides/ru/03-overclock-basics.md sha=c64e680d086f self=bef8978ef692 -->
# Overclocking: where to start

<!-- nav:begin -->
[← First run](02-first-run.md) · [Contents](README.md) · [The 4IFIR overlay: where clocks are set →](04-overlay.md)  
**English** · [Русский](../ru/03-overclock-basics.md)
<!-- nav:end -->

Three things worth knowing before you touch anything. They will save you an evening.

## What overclocking means here

Not "unlock higher clocks". Overclocking in 4IFIR means **matching voltage to clock**
for each component: the CPU, the GPU, the memory.

Hence the benefit: a properly tuned console runs **cooler and longer** at the same
clocks. And hence the risk: give it too little voltage and it freezes.

## Where to begin

**Memory gives the most, and almost for free.**

Memory is the bottleneck on this console. Overclocking it barely affects battery life.
The CPU and GPU are the opposite: every extra megahertz is paid for in heat and
running time.

A sensible starting point:

1. Memory — as high as it is stable.
2. CPU and GPU — around the middle.
3. After that, add only what a particular game is actually short of.

> [!TIP]
> Clock numbers reflect neither performance nor power draw. The only measure of a good
> setup is **that the game feels right to you**.

## The order of components

**CPU first.** It does not depend on memory or on the GPU. Tune it once and you will
not come back to it, even if you redo everything else later.

Then the GPU, then memory — the fussiest of the three, and the one that depends least
on the others.

## What to watch with

Tuning blind is guesswork. The build already ships with instruments that show what the
hardware is actually doing.

**Readings over the game** — the `Status Monitor` overlay. Clocks, load per component,
frames per second, temperatures, battery drain. It comes in several sizes, from a full
screen of data down to a tiny line in the corner that does not get in the way.

**Voltages and drain** — the `InfoNX` overlay. It shows the clock and the voltage of each
component together, plus the fan speed. It also names the memory chip your console has —
and that decides how far this particular console can go at all.

Both open from the same overlay menu as 4IFIR.

## What to load it with

A game is the honest test, but a slow one that never repeats itself exactly. For a quick
check there are separate programs, already in the build, launched from the Homebrew Menu —
hold `R` while starting any game.

| what you are checking | what with |
|---|---|
| memory, speed | `MicroMemBench` |
| memory, stability | `MicroMemTest` |
| the GPU | `MicroVramTest` |
| the CPU | `RaytracingNX` |

> [!NOTE]
> `RaytracingNX` measures the **CPU**, despite the name: it renders the scene on the
> processor and never touches the GPU. For the GPU, use `MicroVramTest`.
>
> And if you run its sweep across all clocks, turn the overclock **off** first — otherwise
> it measures a single fixed clock.

A quick test does not replace a game: it cannot reproduce the way a game loads everything
at once. The order is — sift out what plainly does not work with a test, then confirm with
a game.

## How to check

The same one for any setting:

1. Change **one step**.
2. **Reboot** — nothing applies without it.
3. Play something demanding for fifteen minutes.
4. Something is off — **step back**.

One parameter at a time. Change two and you will not know which one was at fault.

## Telling what you overdid

The symptom usually names the culprit:

| What you see | What is at fault |
|---|---|
| freezes right after the logo | CPU |
| texture artefacts, flickering dots, an orange screen | GPU |
| freezes and crashes in games with no visual garbage | memory |
| stripes on the screen in the dock | fine memory settings |

## How to get back if it does not work out

All at once — **`Service → Restore Factory Defaults`**: factory state, one step.

Once you have a set of values you are happy with, use
**`Service → Backup manager → Create backup`**.
After that you can experiment freely: a reset gives you the factory state, a backup
gives you **your** working setup. Two different buttons for two different situations.

## If the console stops booting

Do not panic and do not reinstall anything. The procedure is covered separately —
[If something goes wrong](12-troubleshooting.md).

In short: the settings live in one file, and that file can be edited from the
bootloader without starting the system.

---

<!-- nav:begin -->
[← First run](02-first-run.md) · [Contents](README.md) · [The 4IFIR overlay: where clocks are set →](04-overlay.md)  
**English** · [Русский](../ru/03-overclock-basics.md)
<!-- nav:end -->
