<!-- i18n: source=Guides/ru/04-ebamatic.md sha=ca7fbf2d9ea9 self=b975428ddcb5 -->
# eBAMATIC

<!-- nav:begin -->
[← Overclocking: where to start](03-overclock-basics.md) · [Contents](README.md) · [CPU →](05-cpu.md)  
**English** · [Русский](../ru/04-ebamatic.md)
<!-- nav:end -->

The first entry in the menu, and for most people the only one they need.

## What it is

**eBAMATIC is automatic selection based on your hardware.** The firmware identifies your
console — revision, manufacturer and model of the memory chips — and substitutes a value
suited to it.

It is not only about voltages. The memory clock, the balancing mode and the CPU boost
clock are chosen the same way.

That is why many entries have `eBAMATIC` or `Auto — eBAMATIC` as their first value. It
does not mean "off" or "default" — it means "let the firmware decide, it knows what chips
you have".

## When to leave it alone

**Almost always.** The firmware knows your memory chip model; you would be setting one
number blind. It will almost certainly do better.

Manual values are worth it in two cases:

- the automatic choice turned out generous and you want to go lower;
- it turned out stingy and high clocks are starved.

Both are found by experiment, and both need a way back if it does not work out.

## The eBAMATIC stage

`eBAMATIC Stage` sets **how boldly the automatic selection works**: stage `0` is calm,
`3` the most aggressive.

It is the fastest way to get an effect — one setting instead of a dozen.

**Same routine as everywhere:** one stage up, reboot, play, did not like it — back.

## What happens when you set a number by hand

Your number **overrides the automatic choice** for that entry. The rest keep being
chosen automatically.

> [!NOTE]
> One exception is worth knowing. For `Low MHz Undervolt` and `High MHz Undervolt` a
> special economy mode of the firmware kicks in **only when both are zero**. Set a number
> in one and the behaviour of both changes.

Hence a common confusion: someone sets a voltage by hand, gets freezes, puts the
automatic mode back and everything is fine. Not because the number was wrong, but because
one number does not fit every clock and every chip.

> [!TIP]
> If you do not know what you broke, put everything you set by hand back to automatic.
> `Low MHz Undervolt` and `High MHz Undervolt` have no `eBAMATIC` entry — for them, going
> back means the value `0`.

## How eBAMATIC differs from GPU stages

Easy to confuse, and they are different things:

| | What it does |
|---|---|
| **eBAMATIC Stage** | how boldly the automatic selection works |
| **GPU stage** (`Eco ST1…ST3`) | which voltage table the firmware reads for the GPU |

A GPU stage also changes the GPU clock ceiling — [details](06-gpu.md).

`eBAMATIC Stage` itself sets no ceilings. But individual entries left on automatic do
pick ceilings themselves — the memory clock and `Boost Clock` work exactly that way.

---

<!-- nav:begin -->
[← Overclocking: where to start](03-overclock-basics.md) · [Contents](README.md) · [CPU →](05-cpu.md)  
**English** · [Русский](../ru/04-ebamatic.md)
<!-- nav:end -->
