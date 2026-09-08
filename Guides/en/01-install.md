<!-- i18n: source=Guides/ru/01-install.md sha=9d35faf1ba31 self=852fb4b52bbc -->
# Installation

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->

The tuner installs **on top of an existing 4IFIR**. It does not touch the firmware
itself: the bootloader, `loader.kip`, the 4IFIR overlay and the system modules all
stay as they are.

Only one thing changes: the tuning package. The Ultrahand overlay engine the tuner runs
on comes with the 4IFIR build — as a rule we neither ship it nor swap it out. The rare
exception is in step 2.

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
> **Do not delete `atmosphere\kips\kip-json\`.** Those are your saved setting profiles,
> not scratch files. The tuner can read them — [importing old profiles](10-profiles.md).

## Step 2. Copy the archive

Unpack the contents of the archive **into the root of the SD card**, overwriting.

Inside the ordinary archive there is one folder of settings —
`switch\.packages\4IFIR Wizard\` — plus `INSTALL.txt`, `BUILD.txt`, `LICENSE` and
`NOTICE.txt` beside it.

> [!IMPORTANT]
> **The engine is not in the ordinary archive, and that is on purpose.** Ultrahand and
> its `config\ultrahand\` — key combination, theme, language, overlay order, sounds —
> come with the 4IFIR build. The ordinary archive carries none of that and overwrites
> none of it: your overlay setup stays yours, however many times you update the tuner.
>
> **Once in a while a build with the engine goes out instead** — the release page says
> so. That one brings the engine itself and `config\ultrahand\` with it: otherwise someone
> installing from scratch would get neither our key combination, nor the language, nor
> the sound switch. Your own settings still stay yours: the update moves `config.ini`
> and `overlays.ini` aside before unpacking and moves them back after, and `overlays.ini`
> is not in that archive at all. What is replaced is our own material — languages,
> themes, wallpapers, images and the sound set that is playing; the sound set goes back
> from the engine's settings.
>
> That moving-aside lives inside the package, so it covers you from the **next** update
> after the one that brought it. If you unpack an archive with the engine by hand rather
> than through the update button, save your `config\ultrahand\config.ini` first.

## Step 3. Check

Open the overlay: **`L` + `R` + `↑`**

It opens on the **list of overlays** — press **right** and you get the list of
**packages**. That is where **4IFIR Wizard** lives.

Go into it: `eBAMATIC Stage` at the top, then `Advanced`, `Service` and the update
entry.

No such package — either the archive went somewhere other than the card root, or the
files from step 1 are still there.

## If the key combination does not work

It is set in `config\ultrahand\config.ini` — a file that came with the 4IFIR build, not
with the ordinary archive.

If the overlay does not open at all, on any combination, the problem is the engine rather
than the tuner. It arrives with the 4IFIR build:
[update that](11-update.md#if-you-are-updating-4ifir-itself).

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
