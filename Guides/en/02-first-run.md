<!-- i18n: source=Guides/ru/02-first-run.md sha=e2520dcb316d self=4a51fb1252ca -->
# First run

<!-- nav:begin -->
[← Installation](01-install.md) · [Contents](README.md) · [Overclocking: where to start →](03-overclock-basics.md)  
**English** · [Русский](../ru/02-first-run.md)
<!-- nav:end -->

You opened the overlay (**`L` + `R` + `↑`**) and it shows the list of overlays. You pressed
**right** to get the list of packages and went into **4IFIR Wizard**. Here is what you
are looking at.

## How the menu is laid out

```
eBAMATIC Stage        ← the overall automatic mode
Advanced              ← everything per component
  ├ CPU
  ├ GPU
  ├ RAM
  ├ Micro-Enhance Logic  ← fine tuning and emergency access
  └ Fan Control          ← cooling curve
Service               ← backups, import, reset, console info
Current Settings      ← what is written right now
Check for updates     ← ask GitHub for a newer build
Update                ← appears only when a newer build exists
Reboot the console    ← reboot
```

The order is deliberate: what everyone needs is at the top, what few people need is
further down.

## The first thing worth opening

**`Current Settings`** is a summary of what is actually written in the settings file.

The distinction matters. A menu entry shows **what is selected**. The summary shows
**what is written**. If another tool has edited the console, or a backup was restored,
those two are exactly what will disagree.

The summary pages left and right: the second page holds the whole GPU voltage curve and
the fine memory controls, the third one the EMC Magician timings.

### Third page: EMC Magician timings

The `Magician` page shows the memory timings you saved in
[`EMC Magician`](09-timings.md#emc-magician--tuning-while-the-console-runs). The tuner does
not write them: the firmware keeps them in `/config/4IFIR/emc_timings.ini`, and the page
only reads that file.

- **What you see.** The set for the memory clock and the `eBAL` currently written in the
  firmware. Magician names a profile by `CL`, the page shows `eBAL` instead — they are the
  same thing: `CL = eBAL × 2 + 8`. The `1600 MHz` timings appear only when
  `sMeh 8 E-Boost` is set to `2`. A timing you never touched in Magician reads `Auto`.
- **`A`** shows or hides the arbiter (MC) values: they appear next to each timing, after
  a dot.
- **`Y`** turns to the saved profiles, in order of rising clock, a page of them at a time:
  each press shows the next page, and after the last one the current timings come back.
  The line on top says which profiles of how many you are looking at.
- **The view resets.** Page away, leave with `B`, come back in, or close the overlay — the
  page shows the current timings without MC again.
- **An empty page** with a note means nothing has been saved in Magician yet. With
  `eBAMATIC` the firmware picks the clock, so the current profile cannot be worked out —
  press `Y` to see every profile.

It works on both Mariko and Erista and reads old-format files too — such values are
marked `old format`.

> [!NOTE]
> The third page exists only on the engine from the first-install kit
> ([Installation](01-install.md)). On any other engine the summary keeps its two pages.

## The second thing: know how to go back

**`Service → Restore Factory Defaults`** returns every overclock setting to factory
values. The tuner shows you what will change before applying it.

That is enough while you have nothing of your own set up: there is nothing to lose, and
the factory state is always one press away.

A backup (`Service → Backup manager → Create backup`) comes later and serves a
different purpose:
**keeping a setup that works**, so you can come back to it after further experiments.
A reset gives you the factory state and throws your work away; a backup gives you your
own.

## What "applied" means

The tuner writes the value into the settings file. The firmware reads that file **at
startup**.

So every change needs a **reboot**. The `Reboot the console` entry at the bottom of the
menu is there for that.

> [!NOTE]
> Until you reboot, the console runs on the old settings while the summary already shows
> the new ones. That is not a bug: the summary reports exactly what is in the file.

## Console revision

The tuner detects whether you have a Mariko or an Erista and shows **only the settings
that apply to your console**. Some entries genuinely differ. The GPU voltage limit, for
instance, has a different range per revision.

So do not be surprised if a friend has an entry you do not. And do not copy their
numbers blindly.

## If something is unclear

Many entries carry built-in help explaining what the setting does and within what limits
it can be changed. That help is generated from the same map the tuner itself is built
from, so it cannot fall out of sync with the menu.

---

<!-- nav:begin -->
[← Installation](01-install.md) · [Contents](README.md) · [Overclocking: where to start →](03-overclock-basics.md)  
**English** · [Русский](../ru/02-first-run.md)
<!-- nav:end -->
