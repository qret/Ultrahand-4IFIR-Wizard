<!-- i18n: source=Guides/ru/03-overclock-basics.md sha=53b3193fb8e1 self=5b43b651ed23 -->
# Overclocking: where to start

<!-- nav:begin -->
[← First run](02-first-run.md) · [Contents](README.md) · [eBAMATIC →](04-ebamatic.md)  
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

## The routine

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

Once you have a set of values you are happy with, use **`Service → Create backup`**.
After that you can experiment freely: a reset gives you the factory state, a backup
gives you **your** working setup. Two different buttons for two different situations.

## If the console stops booting

Do not panic and do not reinstall anything. The procedure is covered separately —
[If something goes wrong](11-troubleshooting.md).

In short: the settings live in one file, and that file can be edited from the
bootloader without starting the system.

---

<!-- nav:begin -->
[← First run](02-first-run.md) · [Contents](README.md) · [eBAMATIC →](04-ebamatic.md)  
**English** · [Русский](../ru/03-overclock-basics.md)
<!-- nav:end -->
