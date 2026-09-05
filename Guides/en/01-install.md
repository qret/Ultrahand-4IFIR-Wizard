<!-- i18n: source=Guides/ru/01-install.md sha=9d35faf1ba31 self=fe489dba2c86 -->
# Installation

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->

The tuner installs **on top of an existing 4IFIR**. It does not touch the firmware
itself: the bootloader, `loader.kip`, the 4IFIR overlay and the system modules all
stay as they are.

Only one thing changes: the tuning package. The Ultrahand overlay engine the tuner runs
on comes with the 4IFIR build — we neither ship it nor swap it out.

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

Inside there is one folder of settings — `switch\.packages\4IFIR Wizard\` — plus
`INSTALL.txt`, `BUILD.txt`, `LICENSE` and `NOTICE.txt` beside it.

> [!IMPORTANT]
> **The engine is not in the archive, and that is on purpose.** Ultrahand and its
> `config\ultrahand\` — key combination, theme, language, overlay order, sounds — come
> with the 4IFIR build. Our archive carries none of that and overwrites none of it: your
> overlay setup stays yours, however many times you update the tuner.

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
with our archive.

If the overlay does not open at all, on any combination, the problem is the engine rather
than the tuner. It arrives with the 4IFIR build:
[update that](11-update.md#if-you-are-updating-4ifir-itself).

> [!WARNING]
> The combination in `config\tesla\config.ini` must **match** the one in
> `config\ultrahand\config.ini`. If they differ, overlays start competing for the same
> press.

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
