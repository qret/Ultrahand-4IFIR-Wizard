<!-- i18n: source=Guides/ru/11-troubleshooting.md sha=49893fe5f982 self=b384eae87c5e -->
# If something goes wrong

<!-- nav:begin -->
[← Updating](10-update.md) · [Contents](README.md) · [Settings reference →](12-reference.md)  
**English** · [Русский](../ru/11-troubleshooting.md)
<!-- nav:end -->

Every setting in **this tuner** lives in one file: `atmosphere\kips\loader.kip`.
So anything it caused can be undone, without reinstalling anything.

> [!NOTE]
> **Per-game clocks are not set by this tuner.** They belong to the 4IFIR overlay, which
> keeps them separately, in `/config/4IFIR/`. If your trouble started after you changed a
> clock there, putting back `loader.kip` will not help. Look in the overlay instead.

## The console will not boot

Work down the list, from the top. The first option is the quickest.

### 1. Roll back from the tuner itself

If the console still boots, you can settle this on the spot:

- **`Service → Restore Factory Defaults`**: back to factory. Nothing needs to be prepared
  in advance.
- **`Service → Restore backup`**: back to your own saved setup, if you have a copy.

Both open a preview page. To apply, **hold A** on the entry at the bottom.

> [!NOTE]
> A reset returns the settings themselves to factory values, but it **does not rewrite the
> GPU voltage curve**: there is no factory copy of that curve to put back. The curve stops
> taking effect in a different way. The mode becomes `Eco ST1` again, and that mode reads
> another table, which was never touched.
>
> Only `Restore backup` brings the whole state back, curve included.

### 2. Fix it from the bootloader with KipTool

The system does not start at all. Edit the settings file straight from the bootloader:

1. Boot into **hekate**.
2. `Payloads` → **KipTool**.
3. **KIP Wizard**: it opens `loader.kip`.
4. Find the setting you changed last and put the old value back.
5. Apply and reboot.

Cannot remember what you changed? Put the whole category back to factory; KipTool can
reset a category at once.

> [!WARNING]
> **If the GPU stage is the problem, pick only `ECO ST1` in KipTool.**
>
> Not `ECO ST3`: that is the deepest undervolt in the firmware. If the console failed to
> boot because it did not get enough voltage, `ECO ST3` will make it worse. And not
> `MANUAL`: that is the manual table, and it has a known defect.
>
> `ECO ST2` is useless here. Half stages look exactly the same to KipTool, so it will
> change nothing. See [GPU and stages](06-gpu.md).

### 3. Put the settings file back

If you saved a copy of `loader.kip` before you made any changes, put it back in place.
The overclock returns to that state.

Copies made by the tuner itself are on the card, in `/atmosphere/kips/.bak/`. Those are
applied from the menu, not by replacing the file.

## Common cases

**The setting did not apply.** Almost always a missing reboot. The tuner writes the value
into a file; the firmware reads that file at startup.

**The value is not what I set.** Look at `Current Settings`. It shows what is actually in
the file right now. If that differs from what you picked, something else wrote over it:
KipTool, another package, or a restored backup.

**The console shuts down under load, and the charge drops suddenly.** The power
controller is designed for a peak draw of around fifteen watts. Exceed it, and protection
cuts in and shuts the console down. It may also lower its estimate of the remaining
charge. The fix is lower clocks, not a new battery.

**Stripes on the screen in the dock.** The cause is
`Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 8 E-Boost`. Put it back to `0`: that
is the factory value.

## Why the limits differ between consoles

The power controllers differ per revision: Mariko uses `MAX77812`, Erista uses `MAX77621`.

According to the 4IFIR authors, the **older** Erista has the stronger one: 16 A on each
rail, against 6 A for the CPU and 12 A for the GPU on Mariko. We could not find the
original source for these numbers, so we pass them on as someone else's claim, not as
fact.

The practical conclusion does not depend on them: **someone else's working set of settings
may not suit you**, even if the consoles look identical. Numbers from other people's
screenshots are a starting point, not a recipe.

## Where to look to understand the state

**`Current Settings`** in the tuner shows what is written into the file right now,
including the GPU voltage curve and the clock ceiling of the selected stage. The top line
of the curve is not shown: it is the same for every stage.

It is the only way to see the real state: menu entries show what is *selected*, the
summary shows what is *written*.

---

<!-- nav:begin -->
[← Updating](10-update.md) · [Contents](README.md) · [Settings reference →](12-reference.md)  
**English** · [Русский](../ru/11-troubleshooting.md)
<!-- nav:end -->
