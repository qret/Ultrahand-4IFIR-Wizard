<!-- i18n: source=Guides/ru/01-install.md sha=f000492f5570 self=9472cd264782 -->
# Installation

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->

> [!TIP]
> **The latest 4IFIR is always here:**
> - **[Telegram](https://t.me/kf4fr)** — the 4IFIR group: releases, news and help.
> - **[GitHub](https://github.com/rashevskyv/4ifir-checker/releases)** — the build itself: the latest archive.
>
> <a href="https://t.me/kf4fr"><img src="../img/telegram-kf4fr.png" width="160" alt="QR: t.me/kf4fr"></a>

> [!NOTE]
> **The current 4IFIR is 2.7, and it supports HOS 23.0.1.** It already includes Ultrahand
> and 4IFIR Wizard, so on 2.7 there is no need to install the configurator separately:
> it updates [from its own menu](11-update.md#how-to-update). This page is for 4IFIR
> 2.6 and 2.5, which the configurator also runs on, and for installing a build by hand.

The configurator installs **on top of an existing 4IFIR**. It does not touch the firmware
itself: the bootloader, `loader.kip`, the 4IFIR overlay and the system modules all
stay as they are.

Only the tuning package changes. On 4IFIR 2.5 and 2.6 it is installed once from the kit
with the engine — **[4IFIR-Wizard.zip](https://github.com/qret/Ultrahand-4IFIR-Wizard/releases/download/v0.1.0-2026-10-11-2149/4IFIR-Wizard.zip)**
(release [`v0.1.0-2026-10-11-2149`](https://github.com/qret/Ultrahand-4IFIR-Wizard/releases/tag/v0.1.0-2026-10-11-2149)): besides the configurator it brings
the Ultrahand overlay engine the configurator runs on. From then on the configurator updates
[from its own menu](11-update.md#how-to-update); releases after that kit carry the configurator alone.

## Step 1. Delete the old package

Delete these from the SD card:

```
config\uberhand\
switch\.packages\4IFIR Wizard\
switch\.packages\config.ini
```

These are leftovers of the old engine and the old wizard. The new package cannot read
them, and side by side the two will get in each other's way.

> [!IMPORTANT]
> **Do not touch `atmosphere\kips\`.** It holds `loader.kip` with your overclock
> settings, `kip-json\` with your saved profiles — the configurator can read them,
> [importing old profiles](10-profiles.md) — and the backups the configurator makes.

## Step 2. Copy the kit

Unpack the contents of the kit **into the root of the SD card**, overwriting.

The kit with the engine holds the configurator folder `switch\.packages\4IFIR Wizard\`,
the engine itself, `switch\.overlays\ovlmenu.ovl`, and its settings `config\ultrahand\`,
plus `INSTALL.txt`, `BUILD.txt`, `LICENSE` and `NOTICE.txt` beside them. The configurator removes these text files from the root of the
card by itself the first time it is opened.

> [!IMPORTANT]
> **The kit replaces `config\ultrahand\`** — the key combination, language, sound switch
> and overlay order: 4IFIR on top, then Status Monitor, FPSLocker, InfoNX, ReverseNX.
> If you changed the key combination or the overlay order, save your
> `config\ultrahand\config.ini` and `overlays.ini` first and put them back after unpacking.
>
> Updates through `Update` leave them alone: an archive without the engine does not carry
> them, and for an archive with the engine the update moves them aside before unpacking
> and back after.

## Step 3. Check

Open the overlay: **`L` + `R` + `↑`**

It opens on the **list of overlays** — press **right** and you get the list of
**packages**. That is where **4IFIR Wizard** lives.

Go into it: `eBAMATIC Stage` at the top, then `Advanced`, `Service` and the update
entry.

No such package — either the archive went somewhere other than the card root, or the
files from step 1 are still there.

## If the key combination does not work

It is set in `config\ultrahand\config.ini`: on 4IFIR 2.7 this file comes with the build,
on 2.5 and 2.6 with the kit with the engine.

If the overlay does not open at all, on any combination, the problem is the engine rather
than the configurator. On 4IFIR 2.7 it arrives with the build —
[update that](11-update.md#if-you-are-updating-4ifir-itself); on 2.5 and 2.6 with the kit
with the engine: unpack it again (step 2), then update the configurator through `Update`.

> [!WARNING]
> The combination in `config\tesla\config.ini` and the one in
> `config\ultrahand\config.ini` must **match**, or overlays start competing for the same
> press. The engine keeps them in step itself: if `ultrahand` has none it copies the one
> from `tesla`, and if it has one that differs it **rewrites `tesla`**. So changing a
> single file is enough — but it helps to know which of the two wins.

## Getting back to a clean state

Do a clean 4IFIR install: delete **everything from the card except the `Nintendo` and
`emummc` folders**, then unpack the 4IFIR build again.

`Nintendo` holds your games and saves. `emummc` is a virtual copy of the console's own
internal storage — the one it starts from. Leave both alone.

---

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->
