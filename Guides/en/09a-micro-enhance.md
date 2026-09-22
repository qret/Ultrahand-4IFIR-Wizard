<!-- i18n: source=Guides/ru/09a-micro-enhance.md sha=ed1fae8db66f self=488b0ac0dffc -->
# Micro-Enhance Logic: pMeh and sMeh

<!-- nav:begin -->
[← Timings and fine tuning](09-timings.md) · [Contents](README.md) · [Profiles, backups and reset →](10-profiles.md)  
**English** · [Русский](../ru/09a-micro-enhance.md)
<!-- nav:end -->

Two rows of fine controls for the memory controller. Most people never need them:
everything worth adjusting regularly is duplicated under readable names in other sections.
This page is for anyone who wants to know what sits behind each number, and for the case
when the console will not boot and the setting has to be found in KipTool by its number.

## What it is

The firmware file `loader.kip` holds two rows of fields with code names:

- **`pMeh`** — Primary Micro-Enhance, the primary row, numbers `0`–`22`;
- **`sMeh`** — Secondary Micro-Enhance, the secondary row, numbers `0`–`17`.

The difference between the rows is risk. `pMeh` reaches into how the timings, voltages
and clocks of the memory steps are calculated: a bad value here can keep the console from
booting. `sMeh` mostly adjusts controller arbitration and step-switching algorithms, and
the firmware author explicitly marks this row as safe. `pMeh` carries no such mark.

The firmware reads both rows at start-up, so **every change takes effect after a
reboot**.

> [!NOTE]
> The firmware gives each field only a name, an allowed range and a factory value; it
> carries no explanations. The descriptions below come from the 4IFIR Wizard help and
> from the community description; some fields have no description anywhere, and that is
> said plainly.

## Where to find it in the configurator

`Advanced → Micro-Enhance Logic`. It holds two sub-menus:

- `pMeh 0-22` — items from `pMeh 0 eBAS Sub-Zero` to `pMeh 22 isKefir`;
- `sMeh 0-17` — items from `sMeh 0 ARB-Boost` to `sMeh 17 DBI`.

Each item shows the value currently written on its right. Each item has a help page.
In the value list the factory value is marked with the word `Default`.

All values of both rows are visible without entering the section too: on the **second
page** of `Current Settings`, on the second page of a backup's view in `Backup manager`,
and in the `Restore Factory Defaults` preview.

**The numbers do not change and will not.** This is an agreement with KipTool: if the
console will not boot, the setting is looked up there by number, and the number has to
match.

Some fields are duplicated under readable names. It is the same field: change it in one
place and it changes in the other.

| Field | Also at | More |
|---|---|---|
| `pMeh 18 eBAMATIC ST` | `eBAMATIC Stage` in the main menu | [eBAMATIC](05-ebamatic.md) |
| `pMeh 19 vMINetune ST` | `Advanced → GPU → vMin Offset` | [GPU](07-gpu.md#vmin-offsets) |
| `pMeh 21 gVMINDick` | `Advanced → GPU → vMin Offset (max RAM)` | [GPU](07-gpu.md#vmin-offsets) |
| `sMeh 16 SYK-LOH` | `Advanced → RAM → Optimized Mode (1600 MHz) → Optimized Target` | [RAM](08-ram.md#optimized-mode-1600-mhz) |
| `pMeh 20 rVDDick` | `… → Optimized Mode (1600 MHz) → VDDQ-VDD2 Voltage` | [RAM](08-ram.md#optimized-mode-1600-mhz) |
| `sMeh 8 E-Boost` | `… → Optimized Mode (1600 MHz) → Efficiency Stages` | [RAM](08-ram.md#optimized-mode-1600-mhz) |

## Two memory steps

Some fields act not on the memory as a whole but on one of the two steps the configurator
works with. Step **S** (`Optimized S` in the 4IFIR overlay) is the full clock, the one set
in `Advanced → RAM → Frequency`. Step **E** (`Optimized E`) is the economical one; its base
clock, 1600 or 1331 MHz, is chosen by `Optimized Target` (`sMeh 16`), and the
`Optimized Mode (1600 MHz)` sub-section belongs to it
([see the RAM chapter](08-ram.md#optimized-mode-1600-mhz)). For memory, the names
`Optimized` and `Optimized E+` in the overlay and in older descriptions mean the same step
E — leftovers of earlier plans, not separate steps.

## pMeh — the primary row

"Touch": **worth it** — a clear benefit and a clear way back; **careful** — it works, but
a mistake costs more or the meaning is thinly described; **leave alone** — no description,
or it is a debug tool.

| No. | Item | What it does | Factory | Touch |
|---|---|---|---|---|
| 0 | `eBAS Sub-Zero` | The only way to lower the eBAS correction, and only by one. Affects the eighth timing | `0` | careful |
| 1 | `divMB Supressor` | Stability of the memory clock step. Helps when a clock will not hold for no visible reason. On Erista the firmware understands only `3` and treats anything else as zero; on Mariko the control is ignored at memory clocks above 3.0 GHz | `2` | worth it, for an unstable clock |
| 2 | `1333-1065-800` | Lowers the effective clock of the `Optimized E` step on Mariko; timings are still calculated from 1331. Works only when `Optimized Target` (`sMeh 16`) is `0` — so says the help of a donor package; the firmware does not confirm it | `0` | careful |
| 3 | `eBAW Shift` | Shifts the eBAW correction; part of the sixth timing's calculation | `2` | careful |
| 4 | `eBAR Shift` | Shifts the eBAR correction; part of the seventh timing's calculation | `2` | careful |
| 5 | `eBAW Crement` | Added to the seventh timing | `0` | careful |
| 6 | `eBAR Crement` | Added to the sixth timing | `0` | careful |
| 7 | `eBAS Crement` | Added to the eighth timing | `0` | careful |
| 8 | `RCD Decret` | Subtracted from the first timing: a higher value means a tighter timing, faster but less stable | `0` | careful |
| 9 | `RP Decret` | The same for the second timing | `0` | careful |
| 10 | `RAS Decret` | The same for the third timing | `0` | careful |
| 11 | `SRPD` | Memory power-saving mechanisms. On Mariko they are off by default for `Optimized S` and on for `Optimized E`. With them on it is a little slower but more economical | `0` | careful |
| 12 | `E-Enhance` | No description | `1` | leave alone |
| 13 | `DR Debug` | Debugging: switches 4IFIR optimisations off step by step to find the culprit of a failure and report it to the firmware author | `0` | leave alone |
| 14 | `GameChanger` | Lowers the effective memory clock relative to the set one | `0` | careful |
| 15 | `eFOS MK` | Support for high-frequency memory modes, in a test state. Switching between steps takes two or three seconds longer, but is more reliable when the steps' voltages differ a lot | `0` | careful |
| 16 | `lovec` | Lowers the performance of the system timings | `0` | leave alone |
| 17 | `WL-Set` | No description beyond the name. **This is not DBI** — [see below](#names-in-kiptool-and-older-descriptions) | `0` | leave alone |
| 18 | `eBAMATIC ST` | The eBAMATIC auto-selection stage, the same as `eBAMATIC Stage` | `0` | worth it, via [`eBAMATIC Stage`](05-ebamatic.md) |
| 19 | `vMINetune ST` | Offset of the automatic GPU voltage floor (vMin) for step E, from +75 to −75 mV in 5 mV steps: plus raises the floor, minus lowers it. The same as `vMin Offset` | `0 - Default`; KipTool shows the raw `1`, and `0` there is +5 mV | worth it |
| 20 | `rVDDick` | Level of the `VDDQ`/`VDD2` memory voltages of step E, `0` to `6`: a higher value means a higher voltage. The same as `VDDQ-VDD2 Voltage`; not to be confused with the `VDDQ` and `VDD2` items, which set millivolts in the EMC Magician file | `4` | careful |
| 21 | `gVMINDick` | Offset of the same floor for step S (maximum memory clock), same scale; `pMeh 19` is for step E. The same as `vMin Offset (max RAM)` | `0 - Default`; KipTool shows the raw `2`, and `0` there is +10 mV | worth it |
| 22 | `isKefir` | No description | `0` | leave alone |

## sMeh — the secondary row

| No. | Item | What it does | Factory | Touch |
|---|---|---|---|---|
| 0 | `ARB-Boost` | Refresh period of the controller's cyclic timings. There is no zero, the range is `1` to `9`. Overdoing it lowers game performance instead of raising it | `4` | careful |
| 1–5 | `ARB-BCD`, `ARB-BRP`, `ARB-RTR`, `ARB-RTW`, `ARB-WTR` | Manual correction of the arbitration timings where the firmware's calculation missed. Described as not affecting stability; they can win back some speed or remove a dip at a particular clock | `2` | worth it, for a speed dip |
| 6 | `eZQ Override` | Controlled by the firmware by default. Affects memory speed; no noticeable effect on the clock ceiling | `1` | careful |
| 7 | `trDVFS` | Tied to the arbiter voltages; at high clocks it sometimes affects stability | `0` | careful |
| 8 | `E-Boost` | Memory efficiency levels on step E: a higher value means faster. At `2`, with `Core Timings` set, step E takes its timings from the high-frequency profile — per the configurator author, 21.09.2026; the firmware documentation does not describe the mechanism. Can cause stripes on the screen in the dock | `0` | worth it |
| 9 | `SSC Logic` | Noise-suppression mode of the memory clock generator. Helps if wireless connections misbehave at particular memory clocks | `0` | worth it, for that fault |
| 10 | `Latent` | Shifts the tertiary timings upwards; behaves differently on different chips | `0` | careful |
| 11 | `REF-NEH` | Memory refresh mode: less bandwidth, sometimes more stability at high clocks | `2` | careful |
| 12 | `Clatok` | A second algorithm for calculating parameters and timings; `1` usually gives a couple of frames per second. At low clocks it is not compatible with every memory chip | `0` | worth it, with the caveat below |
| 13 | `CPriora` | Priority for the CPU at the GPU's expense. For emulators | `0` | worth it, for emulators |
| 14 | `GetLow` | How quickly memory switches to the lower step. Faster means a higher risk the switch fails | `0` | careful |
| 15 | `GetHigh` | The same for switching to the higher step | `0` | careful |
| 16 | `SYK-LOH` | Base of step E: `1` — 1600 MHz, `0` — 1331 MHz. At `0`, `pMeh 2` starts to apply | `1` | worth it, via `Optimized Target` |
| 17 | `DBI` | Data Bus Inversion. Per the community description (still under its old place `pMeh 17`), error correction on the memory bus for high frequencies, in debugging | `0` | leave alone |

## What to try, and in what order

The main sections come first: clock, `EMC Balance`, voltages, timings. This section comes
after them. The rule is the same as everywhere: **one field at a time, reboot, memory test,
a game**. Worse or unstable — back.

1. **`sMeh 8 E-Boost` = `2`** (also `Efficiency Stages`). The old 4IFIR guide advises
   setting it right away — the gain on step E is noticeable. Stripes on the screen in the
   dock — put it back to `0`. Step E timings on the third page of `Current Settings` are
   shown only at `2` and a non-zero `EMC Balance` ([details](02-first-run.md#third-page-emc-magician-timings)).
2. **`pMeh 19` and `pMeh 21`** (`vMin Offset` and `vMin Offset (max RAM)`) — fitting the
   GPU voltage floor, once the [GPU stage](07-gpu.md) has been chosen. One 5 mV step at
   a time; after each, a reboot and a GPU-heavy game for five to ten minutes with the GPU
   clock pinned in the 4IFIR overlay. The voltage is visible in `InfoNX`. Artefacts or a
   hang — one step back.
3. **`sMeh 1`–`5`**, if memory speed in `MicroMemBench` dips at some clock for no reason.
   Move one of them a step either way and watch the number.
4. **`sMeh 13 CPriora`** — if you play in emulators.
5. **`sMeh 12 Clatok` = `1`** — for a couple of frames. On some chips the console may
   fail to boot with it at low clocks; a known case is Micron with `EMC Balance` = `1` at
   1600 MHz.
6. **`pMeh 1 divMB Supressor` = `3`** — if the memory clock will not hold for no visible
   reason. The [RAM chapter](08-ram.md#emc-balance) points to this control too.

> [!WARNING]
> **Where the risk is higher.**
>
> - **`pMeh 20` below factory.** The old wizard's help warns that too low a voltage may
>   damage emuNAND. The flip side: if the console hangs almost right after power-on, put
>   `pMeh 20` back to `4` first.
> - **`pMeh 8`–`10`** and the other timing corrections (`pMeh 3`–`7`) are a direct road to
>   hangs: they tighten the timings on top of the firmware's calculation.
> - **`pMeh 13 DR Debug`** is only for tracking down a failure. It switches optimisations
>   off; there is no point playing with it.
> - **`sMeh 14`/`15`** — the more aggressive the switch, the higher the risk memory does
>   not make it to the new step.
> - **`sMeh 0`** should not be overdone: speed falls from it rather than rises.
> - Keep the fields without a description (`pMeh 12`, `17`, `22`) and those described in one
>   sentence (`pMeh 16`, `sMeh 17`) at factory.

## How to roll back

In order, from simple to last resort:

1. **Put the item back to its factory value** — it is marked `Default` in the list.
2. **`Service → Restore Factory Defaults`** — returns both rows to factory in full, along
   with everything else ([details](10-profiles.md#reset-to-defaults)).
3. **Restore your own backup** from `Backup manager`: a backup carries every field of both
   rows.
4. **The console will not boot** — KipTool in hekate: `Payloads → KipTool → KIP Wizard`,
   the `pMeh Table` and `sMeh Table` tables. Look the field up **by number**
   ([step by step](12-troubleshooting.md#3-fix-it-from-the-bootloader-with-kiptool)).
5. **KipTool did not help either** — replace `loader.kip` on the card with a file saved
   in advance ([details](12-troubleshooting.md#4-put-the-settings-file-back)).

## Names in KipTool and older descriptions

> [!WARNING]
> **Number 17 is named wrongly in KipTool and in older descriptions.**
>
> In the current firmware `pMeh 17` is `WL-Set`, two values `0`–`1`. The `DBI` field
> with four values `0`–`3` has moved to `sMeh 17`. KipTool and older descriptions (the old
> wizard's help, the community description) do not reflect this: there `pMeh 17` is still
> called `DBI`.
>
> What this means in practice:
>
> - **In KipTool, look fields up by number, not by name.** The `pMeh 17 DBI` line in
>   KipTool is the same field as `pMeh 17 WL-Set` in the configurator. Do not set values
>   above `1` there, even if KipTool offers them: `WL-Set` has none.
> - **`sMeh 17` is not in KipTool at all** — its table ends at `sMeh 16`. It can be put
>   back only from the configurator (including after booting into `Stock (semi-stock)`)
>   or by replacing `loader.kip`.
> - **Importing old wizard backups** does not carry `pMeh 17` or `sMeh 17` over: the old
>   wizard wrote DBI into `pMeh 17`, and the file does not tell which layout the backup was
>   taken on. After restoring such a backup, both fields stay as they are on the console.
>   The `pMeh 22` field does not exist in old backups at all.
>
> The other names in KipTool match the configurator up to spelling: `1333>1065>800`
> instead of `1333-1065-800`, `E-Enhance P` instead of `E-Enhance`, and the like.

## Open questions

Plainly, what has not been established.

- **In what units `pMeh 14 GameChanger` subtracts.** According to the community
  description (which may lag behind the firmware), from the `DIVN` value of the `PLLMB`
  divider, that is, in divider steps rather than megahertz. The old help of another
  package says "from the frequency", with no units. How many megahertz one step is has not
  been established.
- **What `pMeh 12`, `17` and `22` do** beyond their names — not described anywhere.
  `pMeh 16` and `sMeh 17` have one sentence of description each, nothing more.
- **The formula of the fifth timing** — its line is empty in the known sources.
- **Which `pMeh` corrections affect the fourth timing** — the formula is not given in the
  known sources.

---

<!-- nav:begin -->
[← Timings and fine tuning](09-timings.md) · [Contents](README.md) · [Profiles, backups and reset →](10-profiles.md)  
**English** · [Русский](../ru/09a-micro-enhance.md)
<!-- nav:end -->
