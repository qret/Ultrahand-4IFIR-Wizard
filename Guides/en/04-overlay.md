<!-- i18n: source=Guides/ru/04-overlay.md sha=dcb0d87b7ab3 self=c29a045c9a47 -->
# The 4IFIR overlay: where clocks are set

<!-- nav:begin -->
[← Overclocking: where to start](03-overclock-basics.md) · [Contents](README.md) · [eBAMATIC →](05-ebamatic.md)  
**English** · [Русский](../ru/04-overlay.md)
<!-- nav:end -->

This tuner configures the **firmware** — the settings the console starts from when it
boots. The clocks themselves, for the CPU, the GPU and the memory, are set somewhere else:
in the **4IFIR overlay** that ships with the build.

This page is about that overlay. It is not ours and we do not touch it, but tuning makes
no sense without it: this tuner decides **how** the hardware behaves at a given clock, and
the overlay decides **which clock** to set.

## How to open it

Hold **`L` + `R` + `↑`** to open the overlay menu — it is called **Uberhand**. Pick 4IFIR
from the list; it is labelled **`4IFIR Nextgen`** there.

It works on top of a running game, so there is no need to close anything. That is the
whole point: change a clock and see the result straight away.

## The line at the top

The first thing the overlay shows is what the console is doing right now:

| | what it is |
|---|---|
| `App ID` | the ID of the running game |
| `Profile` | which mode the console is in (see below) |
| `CPU` `GPU` `MEM` | current CPU, GPU and memory clocks |
| next to them | the voltages, in millivolts |
| `LCD` | screen refresh rate |
| `FPS` | frames per second |
| `EMC` | memory throughput |
| `SOC` `PCB` `TSN` | temperature — **one** figure, the hottest of three: chip, board, shell |

The label on the temperature changes to say which one is showing. `TSN` is not a sensor
on the board but the system's own estimate of how hot the **shell** is.

The voltages are right there next to the clocks: raise a clock and you see straight away
what it costs in power, without going anywhere else.

This is your main gauge while tuning. Raise the memory clock and watch `EMC`; touch the
voltages and watch the temperature.

## Three profiles, and they compete

Overclock settings live in three places at once, and it matters which one wins.

| profile | what it affects | how to open |
|---|---|---|
| **Temp** | every game, **until the next reboot** | the `Y` button |
| **Edit app profile** | only the running game, permanently | the `A` button |
| **Global** | every game, permanently | the `X` button |

The priority runs top to bottom: temporary beats per-game, per-game beats global. That
makes `Temp` the one to experiment with: set it, try it, reboot, and everything is back.

A separate button turns the overclock on and off entirely. When it is off, the profile
line says so.

> [!TIP]
> Setting up a new game? Start with `Temp`. If you get a clock wrong and the console
> hangs, a reboot puts everything back, with nothing to clean up.

> [!IMPORTANT]
> The flip side: while `Temp` is set, it **overrides** both of the others. If you forget
> about it, edit the per-game profile and nothing changes — clear `Temp` first.

## Console modes

Each game has five profiles, not one — one for each state the console can be in:

| label in the overlay | when it applies |
|---|---|
| `Handheld` | in your hands, on battery |
| `Charging` | in your hands, charging |
| `USB Chrgr` | in your hands, on a plain USB charger |
| `OfficialPD` | in your hands, on the official charger |
| `TELE4-mo` | **docked** |

The last label looks odd, but that really is the docked mode.

The modes have an order too: if the docked one is empty, the charging one is used, and if
that is empty, handheld. So `Handheld` is the one to fill first — it backs up the rest.

The split is not just for show: docked, the console cools better and power is more
generous, while on battery every extra megahertz costs minutes of runtime. They are worth
tuning separately.

## Four components

Inside each mode there are four rows: `CPU`, `GPU`, `EMC` (memory) and `LCD` (screen
refresh). They sit one under the other in a single list.

## Names instead of numbers

Clocks are labelled with names as well as numbers — `Optimized`, `Optimized S`,
`Maximized`, `Optimized E`, `Optimized E+` and others; the screen refresh has its own,
such as `Optimized 90` and `Optimized 120`. These are ready-made steps, and starting from
them is easier than starting from bare numbers.

**`Default`** deserves a note of its own. It does not mean "nothing": the value is taken
from the next profile down the order. That is how you clear a setting — set `Default`
rather than guessing what the number used to be.

## Governors

Three entries — `CPU Freq Governor`, `GPU Freq Governor`, `LCD Freq Governor` — turn on
automatic clocking: the clock follows the load instead of standing still.

They show up on two conditions: the general `Active Governors` setting is on, and you are
in **`Edit app profile`**. The global profile does not have them.

The gain is battery life: in menus and simple scenes the clock drops and the console
lasts longer. But turn them on **last**, once everything else is stable — automatic
clocking adds one more moving part to whatever you are debugging.

> [!NOTE]
> The 4IFIR guide warns that the GPU governor **costs frames** in some games instead of
> saving power. If the frame rate drops after you turn it on, turn it off first.

## What else is in there

All of this sits under `Advanced → Miscellaneous` — things you will not get to on day one
but are worth knowing about:

- **`Auto CPU Boost`** — a brief CPU clock bump under load;
- **`Reverse NX Sync`** — sync with the handheld/docked switch;
- **`Charging Current Limit (mA)`**, **`Charging Limit (%)`** — caps the charging current
  and the charge ceiling; useful if the console often sits on the charger, though the
  overlay itself warns that leaving the cap on for long makes the charge readout drift;
- **`Force Disable Charging`** — stops charging without unplugging the cable;
- **`Screen Backlight`** — turns the backlight off without turning the console off;
- **`Info`** — a summary: charge, current, and the voltages on the CPU, GPU, chip and memory.

**`EMC Magician`** sits in the same `Advanced` section, **next to** `Miscellaneous` — live
tuning of memory timings, covered separately on the
[Timings and fine tuning](09-timings.md) page.

## The boundary

The overlay is someone else's work, part of 4IFIR. We neither duplicate nor replace it:
this tuner and the overlay do different jobs, and you need both.

A simple rule for who does what:

- **which clock to set** — the overlay;
- **at what voltage and with what delays the hardware runs at that clock** — this tuner.

---

<!-- nav:begin -->
[← Overclocking: where to start](03-overclock-basics.md) · [Contents](README.md) · [eBAMATIC →](05-ebamatic.md)  
**English** · [Русский](../ru/04-overlay.md)
<!-- nav:end -->
