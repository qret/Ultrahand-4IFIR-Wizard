<!-- i18n: source=Guides/ru/08-ram.md sha=234a15f98807 self=c08392068325 -->
# RAM

<!-- nav:begin -->
[← GPU and stages](07-gpu.md) · [Contents](README.md) · [Timings and fine tuning →](09-timings.md)  
**English** · [Русский](../ru/08-ram.md)
<!-- nav:end -->

Section `Advanced → RAM`. The most rewarding part to tune: memory overclocking buys
the most speed and barely costs any battery life.

Also the fussiest: this is where most freezes come from.

## The order of steps

It is not arbitrary. Both donor guides and the firmware's own step-by-step wizard go in
the same order:

1. `Frequency` — the memory clock;
2. `EMC Balance`;
3. `Vddq` and `Vdd2` — the voltages;
4. `EMC DVB Mode`;
5. `EBA-Shift`;
6. the timings — a topic of their own, [see their page](09-timings.md).

Timings **last**, and voltages **before** them: the sixth and seventh of our eight depend
directly on `Vdd2`.

## Frequency

`Frequency` sets the memory clock. The values are labelled with a number and with the
mode they belong to — `1862MHz — 1862 — ECO ST2 eb2`, for instance.

1. Raise the clock one step.
2. Reboot.
3. Run a memory benchmark, then a game.
4. If it will not boot, or it crashes — go back.

## EMC Balance

Sets what matters more to the firmware: **throughput or reachable clock**.

The higher the value, the higher the clock you can take — and, less obviously, the
**lower** the memory voltage needed. The lower the value, the tighter the timings and the
better the throughput at low clocks, but a high clock will not hold.

> [!TIP]
> A clock that will not come up — set `EMC Balance` **by hand, above** what the automatic
> mode picked: `3`, then `4`, then `5`.
>
> **Do not take `1` or `2`** — those are maximum-throughput modes for low clocks, and they
> stop you reaching a high one. The factory value is automatic selection.

If a clock refuses to hold for no visible reason, the firmware has a control made for
exactly that case — `pMeh 1 divMB Supressor` in `Micro-Enhance Logic`.

## Memory voltages

- **`Vddq`** — the voltage on the memory data lines;
- **`Vdd2`** — the second memory supply.

The firmware picks both itself from the clock + `EMC Balance` pair. These entries are
an override. So change `EMC Balance` first, and only then the voltages by hand.

> [!WARNING]
> **Too low a `Vddq` and the console will not boot.** The factory value is 650 mV.
>
> The donor guides additionally warn of a risk of damaging the EmuNand. We found no
> confirmation of that in the firmware itself, but the cost of being wrong is high enough
> that the warning is worth passing on as it stands.

## EMC DVB Mode

Sets the voltage of the SoC domain the memory controller lives in. **Mariko only.**

`Eco ST1/ST2/ST3` are automatic undervolt stages, the third being the deepest. You can
also set a plain number.

For a starting point the donor guide suggests taking it from a hardware monitor: look at
the **SoC voltage** under load and pick a value close to it. If it becomes unstable, put the automatic
mode back first.

## EBA-Shift

Shifts the `EMC Balance` mode for some of the values derived from it. In practice it is the
control for the **eighth timing**: the smaller the gap between `EMC Balance` and
`EBA-Shift`, the higher that timing can go.

> [!IMPORTANT]
> Its axis is **reversed** relative to `EMC Balance`. Two neighbouring entries pulling in
> opposite directions — an easy trap.

Test both ways: the benchmark number and stability. Artefacts or freezes mean the value
should come down.

## Optimized Mode (1600 MHz)

A sub-section with three fields belonging to the **4IFIR Optimized** profile. They are
the same `sMeh 16`, `pMeh 20` and `sMeh 8` from `Micro-Enhance Logic`, just under
readable names.

They act **only in that profile** and are not a substitute for tuning the main clock.

> [!WARNING]
> `Efficiency Stages` in this sub-section is the very control that causes **stripes on
> the screen in the dock**. If you see stripes, put it back to zero. It is one field with
> `sMeh 8 E-Boost`; resetting either one does the job.

## Timings

Covered separately: [Timings and fine tuning](09-timings.md).

In short: touch them **last**, once the clock and voltages have settled. Our eight
`Core Timings` lay the coarse groundwork; the fine tuning goes through `EMC Magician` in
the 4IFIR overlay, where a value applies at once, with no reboot.

---

<!-- nav:begin -->
[← GPU and stages](07-gpu.md) · [Contents](README.md) · [Timings and fine tuning →](09-timings.md)  
**English** · [Русский](../ru/08-ram.md)
<!-- nav:end -->
