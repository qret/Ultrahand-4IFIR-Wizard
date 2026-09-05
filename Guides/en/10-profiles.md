<!-- i18n: source=Guides/ru/10-profiles.md sha=0ed436441ffd self=3741dd45dd48 -->
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
> A reset changes the GPU undervolt mode but **does not touch the working voltage
> table**. If you were on a half stage, what you get afterwards is a combination the
> menu never offers. The tuner names it correctly, but if you want a clean state, pick
> a stage again.

## Backups

**`Service → Backup manager`** holds everything about copies on one page: create, pick,
see what is inside, apply or delete.

The first item, **`Create backup`**, stores your current overclock settings in a file.

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

If the copy was taken on the other console model, a red line above the buttons names
both sides outright. Such a copy cannot be applied: the Erista and Mariko setting lists
do not overlap.

> [!NOTE]
> Copies taken with tuner versions before 4 September 2026 do not carry the top seven
> points of the GPU curve — the tuner did not offer them yet. Restoring such a copy
> leaves those points as they were.
>
> The tuner now warns you about it: pick such a copy and the selection screen says the
> top curve points are missing and will have to be set by hand after restoring. Take a
> fresh copy on the new version and the question goes away entirely.

## Importing old profiles

If you used the old wizard, its profiles are stored elsewhere on the card.
**`Service → Import old 4IFIR backup`** converts them into our format.

The import carries over both the mode and the **whole GPU voltage curve** — points above
1190 MHz included — so the restored stage matches the one that was saved, rather than
turning into a neighbouring one. Before 4 September 2026 the top seven points were
silently dropped.

The imported copy records where its curve came from: the profile itself, or factory
values substituted in.

> [!NOTE]
> The old profile schema for Erista is thinner than the Mariko one: six settings are
> simply not in it. Those lines will be blank on an imported Erista copy — there is
> nowhere to take the values from, and we will not invent them.

## About ready-made presets

There is no presets section in the tuner, and that is a decision rather than an omission:
memory settings depend on the chip model, and a "one size fits all" set is meaningless.

Your starting point is importing your own old profile, or a backup taken while the
console was set up well. Numbers from someone else's screenshots are a bearing, not a
recipe: the power controllers differ per revision — [details](12-troubleshooting.md).

## Console info

**`Service → System info`** shows what console you have: revision, memory size and
manufacturer, firmware version.

The memory manufacturer matters more than you would think: identical-looking consoles
with different chips reach different clocks.

---

<!-- nav:begin -->
[← Timings and fine tuning](09-timings.md) · [Contents](README.md) · [Updating →](11-update.md)  
**English** · [Русский](../ru/10-profiles.md)
<!-- nav:end -->
