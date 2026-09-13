<!-- i18n: source=Guides/ru/11-update.md sha=4dbe520c3b5c self=f17238a06e3e -->
# Updating

<!-- nav:begin -->
[← Profiles, backups and reset](10-profiles.md) · [Contents](README.md) · [If something goes wrong →](12-troubleshooting.md)  
**English** · [Русский](../ru/11-update.md)
<!-- nav:end -->

The tuner can update itself without taking the card out.

## How to update

1. **`Check for updates`** in the root of the menu: the tuner asks GitHub whether a
   newer version exists.
2. If there is one, an **`Update`** entry appears. You have to **hold** it.
3. Restart the overlay. Overclock settings are applied when the console reboots, and
   `Reboot the console` is there for that.

Updating **the tuner** leaves your overclock settings alone: they live in the firmware
settings file, and our archive does not touch it.

> [!WARNING]
> Updating **4IFIR itself** is the opposite case: there that file is replaced wholesale
> and the overclock goes back to factory. [See below](#if-you-are-updating-4ifir-itself).

## What gets updated

The firmware, the bootloader and the 4IFIR overlay stay as they were. We do not touch
them, at install or at update.

**We do not maintain the overlay engine** — the author of the firmware does, and it is
updated together with the 4IFIR build. Whether the engine rides in our archive depends on
which archive came out: there are two kinds, and the release page says which one this is.

- **Configurator only.** The archive holds one directory, `switch/.packages/4IFIR Wizard/`,
  and nothing else. Neither the engine nor `config/ultrahand/` is in it, so an update
  like that changes nothing about your key combination, theme, overlay order or sounds.
- **With the engine.** Besides the tuner it brings the overlay engine itself — the file
  in `switch/.overlays/` — and the whole `config/ultrahand/` directory: languages,
  themes, wallpapers, images and sounds. Those are ours to deliver, and they are
  replaced by our copies — that is the intent. If you had edited a theme from that
  store, or dropped in your own sound files under the same names, your files are
  replaced.

> [!NOTE]
> The tuner checks whether it recognises your firmware version, and refuses to work with
> one it does not. That is a safeguard: on another firmware the settings sit in other
> places, so the writes would land in the wrong ones — a reliable way to end up with a
> console that will not boot.
>
> **You will not be locked out.** The settings are hidden, but `Check for updates` and
> `Update` stay on screen and keep working. Press the first one: if a build for your
> firmware exists, the second one installs it and the tuner comes back.

## What survives an update

The archive is unpacked into the **root of the card**, and unpacking lays files over the
ones already there. So before it does, the tuner sets exactly two files aside — into
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
> If an update fails, the tuner puts the previous version of the package back, and those
> same two files with it. If it cannot even do that, it says where to look: the previous
> package in `/switch/.packages/.4IFIR Wizard_old`, the files set aside in
> `/config/ultrahand/downloads/.keep`.

## The order, if you are updating everything

When everything is being updated, the order is:

1. **4IFIR** — the build itself.
2. The console's **system firmware**.
3. **Our package**.

Do not swap the first two: the 4IFIR guide warns that the other way round leaves the
console unable to start. Our package goes last so that it sees the already updated
firmware.

## If you are updating 4IFIR itself

That is not done with our tuner but with a separate program — **All-in-One Switch
Updater**, which ships with the build and runs from the Homebrew Menu.

> [!IMPORTANT]
> **Make a backup before updating 4IFIR** —
> `Service → Backup manager → Create backup`. The update replaces
> the firmware's settings file wholesale, and the whole overclock returns to factory.
>
> The backup itself survives: it sits elsewhere and the update knows nothing about it.
> Restore it from the tuner afterwards.

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
| overclock settings (our tuner) | **reset**, restore them from a backup |
| your backups | kept |
| `EMC Magician` timings | kept, they are stored outside the firmware |

## Before updating

Make a backup, **`Service → Backup manager → Create backup`**. For a tuner update that
is belt and braces;
for a 4IFIR update it is a required step.

## If no update is found

Check your network connection. The tuner talks to GitHub directly; if your access is
restricted, download the update manually and unpack it onto the card as you did for the
first install.

---

<!-- nav:begin -->
[← Profiles, backups and reset](10-profiles.md) · [Contents](README.md) · [If something goes wrong →](12-troubleshooting.md)  
**English** · [Русский](../ru/11-update.md)
<!-- nav:end -->
