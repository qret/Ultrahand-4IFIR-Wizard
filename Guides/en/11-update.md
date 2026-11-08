<!-- i18n: source=Guides/ru/11-update.md sha=2516f9423792 self=9adce56dc092 -->
# Updating

<!-- nav:begin -->
[← Profiles, backups and reset](10-profiles.md) · [Contents](README.md) · [If something goes wrong →](12-troubleshooting.md)  
**English** · [Русский](../ru/11-update.md)
<!-- nav:end -->

The configurator can update itself without taking the card out.

## How to update

1. **`Check for updates`** in the root of the menu: the configurator asks GitHub whether a
   newer version exists.
2. If there is one, an **`Update`** entry appears. You have to **hold** it.
3. Restart the overlay. Overclock settings are applied when the console reboots, and
   `Reboot the console` is there for that.

The answer is shown to the right of the entry: `available`, `up to date`, or
✗ if the check could not be made. The next time you open the wizard that
label is gone — just check again.

Updating **the configurator** leaves your overclock settings alone: they live in the firmware
settings file, and the configurator's archive does not touch it.

> [!WARNING]
> Updating **4IFIR itself** is the opposite case: there that file is replaced wholesale
> and the overclock goes back to factory. [See below](#if-you-are-updating-4ifir-itself).

## What gets updated

The firmware, the bootloader and the 4IFIR overlay stay as they were. The configurator
does not touch them, at install or at update.

**The overlay engine is maintained by the author of the firmware**, and it is
updated together with the 4IFIR build. An ordinary configurator archive does not carry the engine.
The kit with the engine comes out as a separate release — it is what the configurator is installed
from on 4IFIR 2.5 and 2.6 ([Installation](01-install.md)). The release page says which kind this is.

- **Configurator only.** The archive holds one directory, `switch/.packages/4IFIR Wizard/`,
  plus install notes, a build passport and the licence files. Neither the engine nor
  `config/ultrahand/` is in it, so an update
  like that changes nothing about your key combination, theme, overlay order or sounds.
- **With the engine.** Besides the configurator it brings the overlay engine itself — the file
  in `switch/.overlays/` — and the whole `config/ultrahand/` directory: languages,
  themes, wallpapers, images and sounds. Those are part of the delivery, and they are
  replaced by the copies from the archive — that is the intent. If you had edited a theme from that
  store, or dropped in your own sound files under the same names, your files are
  replaced.

The release's text files — install notes, build passport, licence — are removed from the
root of the card by the configurator itself the first time it is opened after the update.

> [!NOTE]
> The configurator checks whether it recognises your firmware version, and refuses to work with
> one it does not. That is a safeguard: on another firmware the settings sit in other
> places, so the writes would land in the wrong ones — a reliable way to end up with a
> console that will not boot.
>
> **You will not be locked out.** The settings are hidden, but `Check for updates` and
> `Update` stay on screen and keep working. Press the first one: if a build for your
> firmware exists, the second one installs it and the configurator comes back.

## What survives an update

The archive is unpacked into the **root of the card**, and unpacking lays files over the
ones already there. So before it does, the configurator sets exactly two files aside — into
`/config/ultrahand/downloads/.keep/` — and moves them back afterwards:

| File | What is in it |
|---|---|
| `config/ultrahand/config.ini` | the key combination, language, sound, chosen theme |
| `config/ultrahand/overlays.ini` | the order of overlays in the list |

**Your combination and your overlay order survive an update either way:** setting them
aside does not depend on what is in the archive, and works the same for both kinds.

Everything else under `config/ultrahand/` is **deliberately** not saved — languages,
sounds, themes, images and wallpapers are the delivery itself, and updating them is the
point.

> [!NOTE]
> If an update fails, the configurator puts the previous version of the package back, and those
> same two files with it. If it cannot even do that, it says where to look: the previous
> package in `/switch/.packages/.4IFIR Wizard_old`, the files set aside in
> `/config/ultrahand/downloads/.keep`.

## The order, if you are updating everything

When everything is being updated, the order is:

1. **4IFIR** — the build itself.
2. The console's **system firmware**.
3. **4IFIR Wizard**.

Do not swap the first two: the 4IFIR guide warns that the other way round leaves the
console unable to start. 4IFIR Wizard goes last so that it sees the already updated
firmware.

On 4IFIR 2.7 the [built-in update](#from-4ifir-27-on) takes care of the first two steps,
which leaves `Check for updates` in the configurator.

## If you are updating 4IFIR itself

The current version is **4IFIR 2.7**, and it supports **HOS 23.0.1**.

> [!IMPORTANT]
> **Make a backup before updating 4IFIR** —
> `Service → Backup manager → Create backup`. The update replaces
> the firmware's settings file wholesale, and the whole overclock returns to factory.
>
> The backup itself survives: it sits elsewhere and the update knows nothing about it.
> Restore it from the configurator afterwards.
>
> Do not carry the `loader.kip` file itself over from an earlier version: 4IFIR 2.7 does
> not support kips from older versions. Settings come back through a backup only.

### From 4IFIR 2.7 on

The build and the system firmware update from the console itself, through
`System Settings → System`. Once on the network, the console finds a new 4IFIR version and a
compatible HOS version by itself and offers to install them; after you confirm, it reboots
into the updated system. No separate programs are needed for this — so says the 4IFIR guide;
it has not been tested on a console.

With no network, unpack a fresh `4IFIR.zip` onto the card, replacing the files, and install
the system firmware with `Daybreak`. If you are moving from a build with Uberhand, first
delete what is listed [in step 1 of the installation](01-install.md#step-1-delete-the-old-package).

### On builds older than 2.7

The build is updated not with the configurator but with a separate program — **All-in-One
Switch Updater**, which ships with the build and runs from the Homebrew Menu.

Inside the program it takes two passes, and the first one is the one people skip:

1. `Custom Downloads` → **`Refresh`** → continue;
2. `Custom Downloads` → **`4IFIR`** → continue.

Answer the prompts like this: overwrite `.ini` — **yes**, reinstall hekate — **no**. After
the second pass the console reboots by itself.

Run the program in full memory mode — hold `R` while starting any game. Otherwise the
firmware download refuses to work.

**What survives the update and what does not:**

| | |
|---|---|
| overclock settings (the configurator) | **reset**, restore them from a backup |
| your backups | kept |
| `EMC Magician` timings | kept, they are stored outside the firmware |

This table applies to an update through that program. It has not been checked for the
built-in 2.7 update, so make the backup there as well.

## Before updating

Make a backup, **`Service → Backup manager → Create backup`**. For a configurator update that
is belt and braces;
for a 4IFIR update it is a required step.

## If no update is found

Check your network connection. The configurator talks to GitHub directly; if your access is
restricted, download the update manually and unpack it onto the card as you did for the
first install.

---

<!-- nav:begin -->
[← Profiles, backups and reset](10-profiles.md) · [Contents](README.md) · [If something goes wrong →](12-troubleshooting.md)  
**English** · [Русский](../ru/11-update.md)
<!-- nav:end -->
