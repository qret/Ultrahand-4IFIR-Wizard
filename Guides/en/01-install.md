<!-- i18n: source=Guides/ru/01-install.md sha=4ac3a735880f self=ef1512b3a9ae -->
# Installation

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->

The tuner installs **on top of an existing 4IFIR**. It does not touch the firmware
itself: the bootloader, `loader.kip`, the 4IFIR overlay and the system modules all
stay as they are.

Only two things change: the overlay engine and the tuning package.

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

The old `ovlmenu.ovl` is replaced by the new one automatically — no need to delete it
separately.

> [!IMPORTANT]
> **If you already have Ultrahand, skip two files:**
>
> - `config\ultrahand\config.ini` — it holds your key combination, theme and language;
> - `config\ultrahand\overlays.ini` — it holds the order of your overlays, your
>   favourites and the hidden ones.
>
> Copy them over and you lose your own setup. Everything else copies without worry.
>
> Installing Ultrahand for the first time — copy everything, both files are needed.

## Step 3. Check

Open the overlay: **`L` + `R` + `↑`**

It opens on the **list of overlays** — press **right** and you get the list of
**packages**. That is where **4IFIR Wizard** lives.

Go into it: `eBAMATIC Stage` at the top, then `Advanced`, `Service` and the update
entry.

No such package — either the archive went somewhere other than the card root, or the
files from step 1 are still there.

## If the key combination does not work

It is set in `config\ultrahand\config.ini`.

> [!WARNING]
> The combination in `config\tesla\config.ini` must **match** the one in
> `config\ultrahand\config.ini`. If they differ, overlays start competing for the same
> press.

## Getting back to a clean state

Do a clean 4IFIR install: delete **everything from the card except the `Nintendo` and
`emummc` folders**, then unpack the 4IFIR build again.

`Nintendo` holds your games and saves, `emummc` is the console's virtual storage.
Leave both alone.

---

<!-- nav:begin -->
[Contents](README.md) · [First run →](02-first-run.md)  
**English** · [Русский](../ru/01-install.md)
<!-- nav:end -->
