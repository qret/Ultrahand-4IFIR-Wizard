<!-- i18n: source=Guides/ru/10-update.md sha=71da9f42d74c self=7f6cf2a29a36 -->
# Updating

<!-- nav:begin -->
[← Profiles, backups and reset](09-profiles.md) · [Contents](README.md) · [If something goes wrong →](11-troubleshooting.md)  
**English** · [Русский](../ru/10-update.md)
<!-- nav:end -->

The tuner can update itself without taking the card out.

## How to update

1. **`Check for updates`** in the root of the menu: the tuner asks GitHub whether a
   newer version exists.
2. If there is one, an **`Update`** entry appears. You have to **hold** it.
3. Restart the overlay. Overclock settings are applied when the console reboots, and
   `Reboot the console` is there for that.

Your overclock settings are **unaffected** by an update: they live in the firmware
settings file, which the update does not touch.

## What gets updated

Only the tuner itself. The firmware, the bootloader and the 4IFIR overlay stay as they
were. We do not touch them, at install or at update.

The overlay engine is updated separately, with a new archive.

## The order, if you are updating everything

When you update both the firmware and the tuner, keep to the order:

1. Firmware first.
2. The tuner second.

That way the tuner sees the new layout of the settings structure, not the old one.

> [!NOTE]
> The tuner checks the version of the settings structure and refuses to work with one it
> does not know. That is a safeguard: writing values using the wrong layout is a reliable
> way to end up with a console that will not boot.

## Before updating

Make a backup, **`Service → Create backup`**. The update will not touch your settings,
but the habit is cheap and pays off.

## If no update is found

Check your network connection. The tuner talks to GitHub directly; if your access is
restricted, download the update manually and unpack it onto the card as you did for the
first install.

---

<!-- nav:begin -->
[← Profiles, backups and reset](09-profiles.md) · [Contents](README.md) · [If something goes wrong →](11-troubleshooting.md)  
**English** · [Русский](../ru/10-update.md)
<!-- nav:end -->
