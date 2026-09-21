<!-- i18n: source=Guides/ru/08-ram.md sha=87daae51ccb3 self=039b6b556892 -->
# RAM

<!-- nav:begin -->
[← GPU and stages](07-gpu.md) · [Contents](README.md) · [Timings and fine tuning →](09-timings.md)  
**English** · [Русский](../ru/08-ram.md)
<!-- nav:end -->

Section `Advanced → RAM`. The most rewarding part to tune: memory overclocking buys
the most speed and barely costs any battery life.

Also the fussiest: this is where most freezes come from.

## The order of steps

It is not arbitrary. Both 4IFIR guides and the firmware's own step-by-step wizard go in
the same order:

1. `Frequency` — the memory clock;
2. `EMC Balance`;
3. `Vddq` (Mariko only) and `Vdd2` — the voltages;
4. `EMC DVB Mode`;
5. `EBA-Shift`;
6. the timings — a topic of their own, [see their page](09-timings.md).

Timings **last**, and voltages **before** them: the sixth and seventh of our eight depend
directly on `Vdd2`.

## Frequency

`Frequency` sets the memory clock. The values are labelled with a number and with the
mode they belong to — on a Mariko, `1862MHz - Eco ST2 eb2`, for instance.

The clock in a label is a whole number of megahertz: the fraction is dropped, not
rounded, just as on the Magician page and in sys-clk — `1868MHz`, not `1869MHz`.
`Current Settings` shows it the same way.

1. Raise the clock one step.
2. Reboot.
3. Run a memory benchmark, then a game.
4. If it will not boot, or it crashes — go back.

## EMC Balance

Sets what matters more to the firmware: **speed at the clock you already have, or how
high a clock you can reach at all**.

The higher the value, the higher the clock you can take — and, less obviously, the
**lower** the memory voltage needed. The lower the value, the tighter the timings and the
faster the memory at low clocks, but a high clock will not hold.

> [!TIP]
> A clock that will not come up — set `EMC Balance` **by hand, above** what the automatic
> mode picked: `3`, then `4`, then `5`.
>
> **Do not take `1` or `2`** — those are maximum-speed modes for low clocks, and they
> stop you reaching a high one. The factory value is automatic selection.

In the list the levels are labelled with plain digits, and automatic selection with the
word `eBAMATIC`.

If a clock refuses to hold for no visible reason, the firmware has a control made for
exactly that case — `pMeh 1 divMB Supressor` in `Micro-Enhance Logic`.

## Memory voltages

- **`Vddq`** — the voltage on the memory data lines. **Mariko only:** the entry is not in
  the menu on an Erista;
- **`Vdd2`** — the second memory supply, on both revisions.

The firmware picks both itself from the clock + `EMC Balance` pair. These two entries let
you put your own number in instead. So change `EMC Balance` first, and only then the
voltages by hand.

> [!WARNING]
> **Too low a `Vddq` and the console will not boot.** The factory value is 650 mV.
>
> The 4IFIR guides additionally warn of a risk of damaging the EmuNand. We found no
> confirmation of that in the firmware itself, but the cost of being wrong is high enough
> that the warning is worth passing on as it stands.

## EMC DVB Mode

Sets the voltage of the part of the main chip where the memory controller sits.
**Mariko only.**

`Eco ST1/ST2/ST3` are stages at which the firmware lowers that voltage by itself, the
third lowering it most. You can also set a plain number.

For a starting point the 4IFIR guide suggests taking it from a hardware monitor: look at
the **main chip voltage (`SOC`)** under load and pick a value close to it. If it becomes unstable, put the automatic
mode back first.

## EBA-Shift

The firmware works a lot of things out from `EMC Balance`. `EBA-Shift` substitutes a
different value of it — not everywhere, only for part of those. In practice it is the
control for the **eighth timing**: the smaller the gap between `EMC Balance` and
`EBA-Shift`, the higher that timing can go.

> [!IMPORTANT]
> It counts **the other way round** from `EMC Balance`. Two neighbouring entries pulling
> in opposite directions — an easy trap.

Test both ways: the benchmark number and stability. Artefacts or freezes mean the value
should come down.

## Optimized Mode (1600 MHz)

A sub-section with five items belonging to the **4IFIR Optimized** profile. Three of
them are firmware fields: the same `sMeh 16`, `pMeh 20` and `sMeh 8` from
`Micro-Enhance Logic`, just under readable names. The other two are `VDDQ` and `VDD2`,
the memory voltages of that profile — see below.

They act **only in that profile** and are not a substitute for tuning the main clock.

> [!WARNING]
> `Efficiency Stages` in this sub-section is the very control that causes **stripes on
> the screen in the dock**. If you see stripes, put it back to zero. It is one field with
> `sMeh 8 E-Boost`; resetting either one does the job.

### VDDQ and VDD2 — the Optimized profile voltages

**Where it is.** `Advanced → RAM → Optimized Mode (1600 MHz)` — two drop-down lists,
`VDDQ` and `VDD2`, right under `Optimized Target` and above `VDDQ-VDD2 Voltage`.

**What they do.** They let you set the memory voltage **as your own number, in
millivolts**, instead of letting the firmware work it out. `VDDQ` is the memory bus,
300 to 750 mV in steps of 5 mV; `VDD2` is the memory supply, 950 to 1400 mV in steps
of 25 mV.

> [!IMPORTANT]
> **These are not the `Vddq` and `Vdd2` [higher up on this page](#memory-voltages).**
> Those are the general memory setting. These two act **inside the `Optimized` profile
> only**, and nowhere else.

Four things worth knowing before you touch them.

* **The items are not shown while `EMC Balance` is on automatic (`eBAMATIC`), and that
  is not a fault.** In their place the page shows `Set EMC Balance to use VDDQ/VDD2`.
  The firmware keeps memory settings in separate sets — one per combination of
  "clock + `EMC Balance`". While the balance is picked automatically, there is no telling
  which set to write to: the firmware chooses it at boot, and the tuner has no way to
  learn its choice. If you want to set a voltage, put `EMC Balance` on a number first and
  both items will appear.
* **What you pick applies after a restart**, not at once.
* **`eBAMATIC` is the first entry in both lists and the way back to automatic.** Pick it
  and the firmware works the voltage out itself again, heat included. When in doubt,
  pick `eBAMATIC`.
* **`Service → Restore Factory Defaults` puts both back to `eBAMATIC` as well.** With
  one exception: if `EMC Balance` is already on automatic, the reset leaves these
  voltages alone — in that mode there was no way to set them anyway. The `EMC Magician`
  timings the reset never touches.

> [!WARNING]
> Your number is used as given — **along with the headroom the firmware would otherwise
> keep**. It normally eases the voltage down as the memory heats up; with your number it
> will not. A high `VDD2` that never steps down is heat and wear.

**Where to see what you set.** Where the rest of this profile shows: on the **second
page** of `Current Settings`, in the `Optimized Mode (1600 MHz)` block, as the `VDDQ`
and `VDD2` rows under `Optimized Target`. The same block appears when you look at a
saved backup: a backup keeps both voltages and puts them back when restored
([Profiles, backups and reset](10-profiles.md#restoring)). A backup made before the tuner
started saving them has no voltages — there the block shows this console's values and
says so with the line `VDDQ/VDD2: this console - not the backup`.

**Where it is written.** These are the only items in the tuner that put a memory setting
**somewhere other than the firmware**: they write to `/config/4IFIR/emc_timings.ini` —
the file `EMC Magician` keeps its own settings in. That matters for exactly one reason:
if the console stops booting, the voltage is taken back by editing that file from a
computer.

### If the console will not boot after a voltage you picked

The voltage is applied at boot, so you cannot take it back from the menu: the console
never gets there. It is fixed from a computer, in about two minutes.

1. Switch the console off and take the memory card out.
2. On the computer open `/config/4IFIR/emc_timings.ini` from the card — any plain text
   editor will do.
3. Find the lines `eVDQ=` and `eVD2=` in it — those are the voltages you set.
4. Replace the number with a zero: `eVDQ=0` and `eVD2=0`. A zero means "work it out
   yourself" — the same thing `eBAMATIC` does in the menu. If you find more than one of
   each, zero them all.
5. Save the file, put the card back, switch the console on.

If you can still reach the menu, `Service → Restore Factory Defaults` does the same
(it zeroes only those of the two lines that already exist in the section for this clock and
`EMC Balance`, and leaves them alone with `EMC Balance` on `eBAMATIC`) — but it also
puts every other setting back to factory, so for one voltage editing the file is quicker.

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
