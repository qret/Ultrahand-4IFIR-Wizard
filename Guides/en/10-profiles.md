<!-- i18n: source=Guides/ru/10-profiles.md sha=317145f0bfd4 self=38b238f4f541 -->
# Profiles, backups and reset

<!-- nav:begin -->
[← Timings and fine tuning](09-timings.md) · [Contents](README.md) · [Updating →](11-update.md)  
**English** · [Русский](../ru/10-profiles.md)
<!-- nav:end -->

Everything that helps you not lose a setup and get back to a known state.

## Reset to defaults

**`Service → Restore Factory Defaults`** returns every overclock setting to what it was out
of the box. The tuner shows a preview of what will change before applying it.

This is the simplest way back, and it needs nothing prepared in advance. While you have
nothing of your own set up, it is all you need.

> [!IMPORTANT]
> A reset changes the GPU voltage stage but **does not touch the working voltage
> table**. If you were on a half stage, what you get afterwards is a combination the
> menu never offers. The tuner names it correctly, but if you want a clean state, pick
> a stage again.

The reset also puts the `VDDQ` and `VDD2` voltages of the Optimized profile back to
`eBAMATIC` — for the memory clock and `EMC Balance` set right now. If nobody set them there,
the `EMC Magician` file stays as it was: automatic is in effect anyway. With `EMC Balance` on
`eBAMATIC` the reset leaves them alone, and the `EMC Magician` timings it never touches.
[More in the RAM chapter](08-ram.md#vddq-and-vdd2--the-optimized-profile-voltages).

## Backups

**`Service → Backup manager`** holds everything about copies on one page: create, pick,
see what is inside, apply or delete.

The first item is **`Choose backup`**, for picking a copy you already made. The second,
**`Create backup`**, stores your current overclock settings in a file.

The result shows to the right of the entry at once, without leaving the page. `saved`
means the copy was written and the tuner checked what it wrote against your current
settings. `not saved` means the write failed; the tuner deletes the half-written file
straight away, so it never turns up in `Choose backup`.

Result labels (`saved`, `restored` and the rest) and the chosen copy last until you
leave: every time you open the wizard again they are cleared, and a copy is picked anew.

A backup is not a firmware image, it is a list of values. That means it:

- takes a few kilobytes;
- **survives a firmware update** — it is applied on top of the new firmware, not
  instead of it;
- does not drag someone else's bootloader along with it.

Backups are kept separately per console revision, so a Mariko copy will never land on
an Erista, nor the other way round.

**What a backup is for:** keeping a setup that works. A reset gives you the factory
state and throws your work away; a backup gives you back exactly what you had.

## Restoring

**`Service → Backup manager`** — pick a copy and the tuner shows a **preview**: what
will be written, before anything is applied.

Read it. The GPU stage line in particular names the stage, so you can see at a glance
whether you picked the right copy.

Applying is a separate press; it will not happen by accident.

**The `VDDQ` and `VDD2` voltages** (`Advanced → RAM → Optimized Mode`) are kept in the
copy too: timings without their own voltages are a combination nobody has tested. The copy
records the ones set, when it is made, for the current memory clock and `EMC Balance`; unset
ones are recorded as `eBAMATIC`. On
restore they are written to the `EMC Magician` file for the memory clock and `eBal` stored
in the copy — over whatever is there. `eBAMATIC` (zero) is written only where the file
already holds a value of its own for that clock and `eBal`: where it does not, the firmware
is on automatic anyway, and the tuner does not create an empty profile there. Nothing else in
that file is touched. If the copy has `EMC Balance` at `eBAMATIC`, the voltages do not apply and are not
written. Copies made earlier, and profiles brought over by importing from the old wizard, do
not hold the voltages and restore as before: the `EMC Magician` file stays as it is. As when
picked in the menu, the voltages take effect after a restart. Page two of the preview shows which case it is: under
the `Optimized Mode` block of an older copy stands the line
`VDDQ/VDD2: this console - not the backup`.

If the copy was taken on the other console model, a red line above the buttons names
both sides outright. Such a copy cannot be applied: the Erista and Mariko setting lists
do not overlap.

**The third page shows the EMC Magician timings for the chosen copy.** It works like
[the one in `Current Settings`](02-first-run.md#third-page-emc-magician-timings), except that the
memory clock, `eBAL` and `sMeh 8 E-Boost` come from the chosen copy. The timings themselves are
not in the copy: they are read from the Magician file on this console, and a line at the top
says so. If Magician holds nothing for the copy's clock and `eBAL`, a short note says that
instead of the table. The page is just as plain when no copy is chosen or the copy does not
record the clock and `eBAL` (this happens with imported ones). `A` and `Y` work as in
`Current Settings`; the page exists only on the engine from the first-install kit.

> [!NOTE]
> Not every copy holds everything. If the one you picked is short of something, a line on
> the selection screen says so before anything is applied. On Mariko it names the top
> points of the GPU voltage curve; on Erista it simply says some settings are missing.
>
> Whatever is missing keeps its current value after restoring: set those by hand, or take
> a fresh copy and the question goes away entirely.

## Importing old profiles

If you used the old wizard, its profiles are stored elsewhere on the card.
**`Service → Import old 4IFIR backup`** converts them into our format.

The import carries over both the mode and the **whole GPU voltage curve** — points above
1190 MHz included — so the restored stage matches the one that was saved, rather than
turning into a neighbouring one.

The imported copy records where its curve came from: the profile itself, or factory
values substituted in.

> [!NOTE]
> The old profile format for Erista is thinner than the Mariko one: six settings are
> simply not in it. Those lines will be blank on an imported Erista copy — there is
> nowhere to take the values from, and we will not invent them.
>
> The GPU undervolt mode is not carried over either: on Erista, set it by hand after
> applying such a copy — the tuner reminds you with a line on the copy's screen.

## About ready-made presets

There is no presets section in the tuner, and that is a decision rather than an omission:
memory settings depend on the chip model, and a "one size fits all" set is meaningless.

Your starting point is importing your own old profile, or a backup taken while the
console was set up well. Numbers from someone else's screenshots are a bearing, not a
recipe: the power controllers differ per revision — [details](12-troubleshooting.md).

## Console info

**`Service → System Info`** shows what console you have: revision, memory size and
manufacturer, firmware version.

The memory manufacturer matters more than you would think: identical-looking consoles
with different chips reach different clocks.

---

<!-- nav:begin -->
[← Timings and fine tuning](09-timings.md) · [Contents](README.md) · [Updating →](11-update.md)  
**English** · [Русский](../ru/10-profiles.md)
<!-- nav:end -->
