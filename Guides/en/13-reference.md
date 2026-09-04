# Settings reference

<!-- nav:begin -->
[← If something goes wrong](12-troubleshooting.md) · [Contents](README.md)  
**English** · [Русский](../ru/13-reference.md)
<!-- nav:end -->

Every tuner item that offers a list of values, in menu order. Voltage-curve points, timings and the `pMeh`/`sMeh` rows are listed one by one: they are separate items in the menu, so they are separate rows here.

Actions — backup, restore, factory reset, system info — are not in the table: there is nothing to pick in them.

"Values" is the length of the very list that opens on screen. A field's name dictionary is wider: the tuner can name a value some other package wrote, but it does not offer such a value The GPU voltage curve has no dictionary at all: its value is read straight from the settings file, so whatever is written there gets named, by whoever wrote it. for picking, and it is not counted here.

The table is generated from the **built package** — the same files that go onto the SD card, so it cannot drift out of step with the menu.

| Menu item | Firmware field | Revision | Values | Examples |
|---|---|---|---|---|
| eBAMATIC Stage | `pMeh 18 eBAMATIC ST` | both | 4 | 0 — Default, Stage 1 … Stage 3 |
| Advanced → CPU → Boost Clock | `CPU Boost Clock` | both | 20 | eBAMATIC, 1400MHz … 3000MHz — S |
| Advanced → CPU → Min Voltage | `CPU Minimal Voltage` | both | 53 | Auto — Eco ST1 — Default, Auto — Eco ST2 … 750 mV |
| Advanced → CPU → Max Voltage | `CPU Maximum Voltage` | Mariko | 35 | eBamatic — Default (automatic), 1100 mV … 1375mV |
| Advanced → CPU → Voltage Limit | `CPU Voltage Limit` | Erista | 22 | eBamatic (automatic), 1180mV … 1375mV |
| Advanced → CPU → dCPUv | `dCPUv` | Mariko | 24 | eBamatic, 1 — ECO ST 1 … 890mV |
| Advanced → CPU → Low MHz Undervolt | `Low MHz Undervolt` | Mariko | 7 | Default — 0, lvl 1 … lvl 6 |
| Advanced → CPU → High MHz Undervolt | `High MHz Undervolt` | Mariko | 8 | 0 — Base undervolting, lvl 1 … lvl 7 |
| Advanced → CPU → Speed Shift | `Speed Shift` | both | 8 | eBAMATIC, Auto … ECO Stage 4 |
| Advanced → GPU → GPU Voltage Table → 307MHz | `307MHz` | Mariko | 42 | 395 mV — Default, 400 mV … 600 mV |
| Advanced → GPU → GPU Voltage Table → 345MHz | `345MHz` | Mariko | 41 | 400 mV, 405 mV … 600 mV |
| Advanced → GPU → GPU Voltage Table → 384MHz | `384MHz` | Mariko | 41 | 400 mV, 405 mV … 600 mV |
| Advanced → GPU → GPU Voltage Table → 422MHz | `422MHz` | Mariko | 41 | 400 mV, 405 mV … 600 mV |
| Advanced → GPU → GPU Voltage Table → 460MHz | `460MHz` | Mariko | 41 | 400 mV, 405 mV … 600 mV |
| Advanced → GPU → GPU Voltage Table → 499MHz | `499MHz` | Mariko | 42 | 400 mV, 405 mV … 605 mV |
| Advanced → GPU → GPU Voltage Table → 537MHz | `537MHz` | Mariko | 45 | 400 mV, 405 mV … 620 mV |
| Advanced → GPU → GPU Voltage Table → 576MHz | `576MHz` | Mariko | 57 | 420 mV, 425 mV … 700 mV |
| Advanced → GPU → GPU Voltage Table → 614MHz | `614MHz` | Mariko | 54 | 435 mV, 440 mV … 700 mV |
| Advanced → GPU → GPU Voltage Table → 652MHz | `652MHz` | Mariko | 51 | 450 mV, 455 mV … 700 mV |
| Advanced → GPU → GPU Voltage Table → 691MHz | `691MHz` | Mariko | 52 | 465 mV, 470 mV … 720 mV |
| Advanced → GPU → GPU Voltage Table → 729MHz | `729MHz` | Mariko | 54 | 480 mV, 485 mV … 745 mV |
| Advanced → GPU → GPU Voltage Table → 768MHz | `768MHz` | Mariko | 56 | 495 mV, 500 mV … 770 mV |
| Advanced → GPU → GPU Voltage Table → 806MHz | `806MHz` | Mariko | 60 | 500 mV, 505 mV … 795 mV |
| Advanced → GPU → GPU Voltage Table → 844MHz | `844MHz` | Mariko | 66 | 500 mV, 505 mV … 825 mV |
| Advanced → GPU → GPU Voltage Table → 883MHz | `883MHz` | Mariko | 72 | 500 mV, 505 mV … 855 mV |
| Advanced → GPU → GPU Voltage Table → 921MHz | `921MHz` | Mariko | 67 | 540 mV, 545 mV … 885 mV |
| Advanced → GPU → GPU Voltage Table → 960MHz | `960MHz` | Mariko | 71 | 550 mV, 555 mV … 915 mV |
| Advanced → GPU → GPU Voltage Table → 998MHz | `998MHz` | Mariko | 77 | 550 mV, 555 mV … 945 mV |
| Advanced → GPU → GPU Voltage Table → 1036MHz | `1036MHz` | Mariko | 80 | 550 mV, 555 mV … 960 mV |
| Advanced → GPU → GPU Voltage Table → 1075MHz | `1075MHz` | Mariko | 80 | 550 mV, 555 mV … 960 mV |
| Advanced → GPU → GPU Voltage Table → 1113MHz | `1113MHz` | Mariko | 80 | 550 mV, 555 mV … 960 mV — Default |
| Advanced → GPU → GPU Voltage Table → 1152MHz | `1152MHz` | Mariko | 76 | 605 mV, 615 mV … 990 mV — Default |
| Advanced → GPU → GPU Voltage Table → 1190MHz | `1190MHz` | Mariko | 76 | 645 mV, 650 mV … 1020 mV — Default |
| Advanced → GPU → GPU Voltage Table → 1228MHz | `1228MHz` | Mariko | 47 | 670 mV, 675 mV … 900 mV |
| Advanced → GPU → GPU Voltage Table → 1267MHz | `1267MHz` | Mariko | 44 | 685 mV, 690 mV … 900 mV |
| Advanced → GPU → GPU Voltage Table → 1305MHz | `1305MHz` | Mariko | 45 | 700 mV, 705 mV … 920 mV |
| Advanced → GPU → GPU Voltage Table → 1344MHz | `1344MHz` | Mariko | 56 | 725 mV, 730 mV … 1000 mV |
| Advanced → GPU → GPU Voltage Table → 1382MHz | `1382MHz` | Mariko | 51 | 750 mV, 755 mV … 1000 mV |
| Advanced → GPU → GPU Voltage Table → 1420MHz | `1420MHz` | Mariko | 46 | 775 mV, 780 mV … 1000 mV |
| Advanced → GPU → GPU Voltage Table → Max Clock | `Max Clock` | Mariko | 41 | 800 mV, 805 mV … 1000 mV |
| Advanced → GPU → GPU Voltage Table → 192MHz | `192MHz` | Erista | 13 | 600mV, 612.5mV … 750mV |
| Advanced → GPU → GPU Voltage Table → 230.4MHz | `230.4MHz` | Erista | 13 | 612.5mV, 625mV … 762.5mV |
| Advanced → GPU → GPU Voltage Table → 268.8MHz | `268.8MHz` | Erista | 13 | 625mV, 637.5mV … 775mV |
| Advanced → GPU → GPU Voltage Table → 307.2MHz | `307.2MHz` | Erista | 13 | 637.5mV, 650mV … 787.5mV |
| Advanced → GPU → GPU Voltage Table → 345.6MHz | `345.6MHz` | Erista | 13 | 650mV, 662.5mV … 800mV |
| Advanced → GPU → GPU Voltage Table → 384MHz | `384MHz` | Erista | 13 | 662.5mV, 675mV … 812.5mV |
| Advanced → GPU → GPU Voltage Table → 422.4MHz | `422.4MHz` | Erista | 13 | 675mV, 687.5mV … 825mV |
| Advanced → GPU → GPU Voltage Table → 460.8MHz | `460.8MHz` | Erista | 13 | 687.5mV, 700mV … 837.5mV |
| Advanced → GPU → GPU Voltage Table → 500MHz | `500MHz` | Erista | 13 | 700mV, 712.5mV … 850mV |
| Advanced → GPU → GPU Voltage Table → 537.6MHz | `537.6MHz` | Erista | 13 | 712.5mV, 725mV … 862.5mV |
| Advanced → GPU → GPU Voltage Table → 576MHz | `576MHz` | Erista | 13 | 725mV, 737.5mV … 875mV |
| Advanced → GPU → GPU Voltage Table → 613.4MHz | `613.4MHz` | Erista | 13 | 737.5mV, 750mV … 887.5mV |
| Advanced → GPU → GPU Voltage Table → 653MHz | `653MHz` | Erista | 13 | 750mV, 762.5mV … 900mV |
| Advanced → GPU → GPU Voltage Table → 691.2MHz | `691.2MHz` | Erista | 13 | 762.5mV, 775mV … 912.5mV |
| Advanced → GPU → GPU Voltage Table → 729.6MHz | `729.6MHz` | Erista | 13 | 775mV, 787.5mV … 925mV |
| Advanced → GPU → GPU Voltage Table → 768MHz | `768MHz` | Erista | 13 | 787.5mV, 800mV … 937.5mV |
| Advanced → GPU → GPU Voltage Table → 805.4MHz | `805.4MHz` | Erista | 13 | 800mV, 812.5mV … 950mV |
| Advanced → GPU → GPU Voltage Table → 840.8MHz | `840.8MHz` | Erista | 13 | 812.5mV, 825mV … 962.5mV |
| Advanced → GPU → GPU Voltage Table → 883.2MHz | `883.2MHz` | Erista | 13 | 837.5mV, 850mV … 987.5mV |
| Advanced → GPU → GPU Voltage Table → 921.6MHz | `921.6MHz` | Erista | 13 | 850mV, 862.5mV … 1000mV |
| Advanced → GPU → GPU Voltage Table → 960MHz | `960MHz` | Erista | 13 | 875mV, 887.5mV … 1025mV |
| Advanced → GPU → GPU Voltage Table → 998.4MHz | `998.4MHz` | Erista | 13 | 887.5mV, 900mV … 1037.5mV |
| Advanced → GPU → GPU Voltage Table → 1036.8MHz | `1036.8MHz` | Erista | 13 | 900mV, 912.5mV … 1050mV |
| Advanced → GPU → GPU Voltage Table → 1074.2MHz | `1074.2MHz` | Erista | 13 | 925mV, 937.5mV … 1075mV |
| Advanced → GPU → GPU Voltage Table → 1113.6MHz | `1113.6MHz` | Erista | 13 | 962.5mV, 975mV … 1112.5mV |
| Advanced → GPU → GPU Voltage Table → 1152MHz | `1152MHz` | Erista | 13 | 987.5mV, 1000mV … 1137.5mV |
| Advanced → GPU → GPU Voltage Table → 1190.4MHz | `1190.4MHz` | Erista | 13 | 1025mV, 1037.5mV … 1175mV |
| Advanced → GPU → GPU Voltage Table → 1228.8MHz | `1228.8MHz` | Erista | 13 | 1050mV, 1062.5mV … 1200mV |
| Advanced → GPU → GPU Voltage Table → 1266.2MHz | `1266.2MHz` | Erista | 13 | 1075mV, 1087.5mV … 1225mV |
| Advanced → GPU → Undervolt Mode | `GPU Undervolt Mode` | Mariko | 6 | Eco ST1 — Default, Eco ST1.5 … Custom Table |
| Advanced → GPU → Undervolt Mode | `GPU Undervolt Mode` | Erista | 4 | Default, Eco ST1 … Eco ST3 |
| Advanced → GPU → Min Voltage | `GPU Minimal Voltage` | both | 3 | Eco ST1 — Default, Eco ST2, Eco ST3 — lowest voltage |
| Advanced → GPU → Max Voltage | `GPU Max Voltage` | Mariko | 92 | eBamatic — Default (automatic), 750 mV … 1200 mV |
| Advanced → GPU → Max Voltage | `GPU Max Voltage` | Erista | 92 | eBamatic — Default (automatic), 850 mV … 1300 mV |
| Advanced → GPU → vMin Offset | `pMeh 19 vMINetune ST` | both | 31 | +75 mV, +70 mV … -75 mV |
| Advanced → GPU → vMin Offset (max RAM) | `pMeh 21 gVMINDick` | both | 31 | +75 mV, +70 mV … -75 mV |
| Advanced → RAM → Optimized Mode (1600 MHz) → Optimized Target | `sMeh 16 SYK-LOH` | both | 2 | 0, 1 — Default |
| Advanced → RAM → Optimized Mode (1600 MHz) → VDDQ-VDD2 Voltage | `pMeh 20 rVDDick` | both | 7 | 0, 1 … 6 |
| Advanced → RAM → Optimized Mode (1600 MHz) → Efficiency Stages | `sMeh 8 E-Boost` | both | 3 | 0 — Default, 1, 2 |
| Advanced → RAM → Core Timings → Core Timings 1 | `Core Timings 1` | both | 10 | 1, 2 … 0 — DEBUG |
| Advanced → RAM → Core Timings → Core Timings 2 | `Core Timings 2` | both | 10 | 1, 2 … 9 — ALT Logic |
| Advanced → RAM → Core Timings → Core Timings 3 | `Core Timings 3` | both | 11 | eBamatic, 1 … 10 — ALT Logic |
| Advanced → RAM → Core Timings → Core Timings 4 | `Core Timings 4` | both | 10 | 1, 2 … 0 — DEBUG |
| Advanced → RAM → Core Timings → Core Timings 5 | `Core Timings 5` | both | 10 | 1, 2 … 0 — DEBUG |
| Advanced → RAM → Core Timings → Core Timings 6 | `Core Timings 6` | both | 15 | 1, 2 … 0 — DEBUG |
| Advanced → RAM → Core Timings → Core Timings 7 | `Core Timings 7` | both | 11 | 1, 2 … 0 — DEBUG |
| Advanced → RAM → Core Timings → Core Timings 8 | `Core Timings 8` | both | 13 | 1 — Safe, 2 … 0 — DEBUG |
| Advanced → RAM → Frequency | `RAM MHz` | Mariko | 51 | eBamatic (automatic), 1600MHz — 1600 — SYK-LOH eb1 … 3309MHz — 3309 |
| Advanced → RAM → Frequency | `RAM MHz` | Erista | 46 | eBamatic (automatic), 1600MHz — 1600 — SYK-LOH … 2649MHz |
| Advanced → RAM → EMC Balance | `EMC Balance` | both | 6 | Default, 1 — SYK-LOH … 5 — SRT ST2 |
| Advanced → RAM → EBA-Shift | `EBA-Shift` | both | 6 | 0, 1 — Default (ECO ST1) … 5 — LOH-C4C |
| Advanced → RAM → Vddq | `RAM Vddq` | Mariko | 101 | 300 mV, 305 mV … 800 mV |
| Advanced → RAM → Vdd2 | `RAM Vdd2` | both | 37 | 950 mV, 962.5 mV … 1400 mV |
| Advanced → RAM → EMC DVB Mode | `EMC DVB Mode` | Mariko | 41 | eBamatic, Eco ST1 … 1150mV |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 0 eBAS Sub-Zero | `pMeh 0 eBAS Sub-Zero` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 1 divMB Supressor | `pMeh 1 divMB Supressor` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 2 1333-1065-800 | `pMeh 2 1333>1065>800` | both | 4 | 0 — Default, 1 … 3 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 3 eBAW Shift | `pMeh 3 eBAW Shift` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 4 eBAR Shift | `pMeh 4 eBAR Shift` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 5 eBAW Crement | `pMeh 5 eBAW Crement` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 6 eBAR Crement | `pMeh 6 eBAR Crement` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 7 eBAS Crement | `pMeh 7 eBAS Crement` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 8 RCD Decret | `pMeh 8 RCD Decret` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 9 RP Decret | `pMeh 9 RP Decret` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 10 RAS Decret | `pMeh 10 RAS Decret` | both | 9 | 0 — Default, 1 … 8 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 11 SRPD | `pMeh 11 SRPD` | both | 16 | 0 — Default, 1 … 15 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 12 E-Enhance | `pMeh 12 E-Enhance` | both | 2 | 0, 1 — Default |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 13 DR Debug | `pMeh 13 DR Debug` | both | 9 | 0 — Default, 1 … 8 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 14 GameChanger | `pMeh 14 GameChanger` | both | 25 | 0 — Default, 1 … 24 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 15 eFOS MK | `pMeh 15 eFOS MK` | both | 2 | 0 — Default, eBal3, 1 — eBal4 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 16 lovec | `pMeh 16 lovec` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 17 WL-Set | `pMeh 17 WL-Set` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 18 eBAMATIC ST | `pMeh 18 eBAMATIC ST` | both | 4 | 0 — Default, Stage 1 … Stage 3 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 19 vMINetune ST | `pMeh 19 vMINetune ST` | both | 31 | +75 mV, +70 mV … -75 mV |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 20 rVDDick | `pMeh 20 rVDDick` | both | 7 | 0, 1 … 6 |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 21 gVMINDick | `pMeh 21 gVMINDick` | both | 31 | +75 mV, +70 mV … -75 mV |
| Advanced → Micro-Enhance Logic → pMeh 0-22 → pMeh 22 isKefir | `pMeh 22 isKefir` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 0 ARB-Boost | `sMeh 0 ARB-Boost` | both | 9 | 1, 2 … 9 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 1 ARB-BCD | `sMeh 1 ARB-BCD` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 2 ARB-BRP | `sMeh 2 ARB-BRP` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 3 ARB-RTR | `sMeh 3 ARB-RTR` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 4 ARB-RTW | `sMeh 4 ARB-RTW` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 5 ARB-WTR | `sMeh 5 ARB-WTR` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 6 eZQ Override | `sMeh 6 eZQ Override` | both | 8 | 0, 1 — Default … 7 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 7 trDVFS | `sMeh 7 trDVFS` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 8 E-Boost | `sMeh 8 E-Boost` | both | 3 | 0 — Default, 1, 2 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 9 SSC Logic | `sMeh 9 SSC Logic` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 10 Latent | `sMeh 10 Latent` | both | 9 | 0 — Default, 1 … 8 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 11 REF-NEH | `sMeh 11 REF-NEH` | both | 5 | 0, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 12 Clatok | `sMeh 12 Clatok` | both | 2 | 0 — Default, 1 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 13 CPriora | `sMeh 13 CPriora` | both | 5 | 0 — Default, 1 … 4 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 14 GetLow | `sMeh 14 GetLow` | both | 4 | 0 — Default, 1 … 3 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 15 GetHigh | `sMeh 15 GetHigh` | both | 4 | 0 — Default, 1 … 3 |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 16 SYK-LOH | `sMeh 16 SYK-LOH` | both | 2 | 0, 1 — Default |
| Advanced → Micro-Enhance Logic → sMeh 0-17 → sMeh 17 DBI | `sMeh 17 DBI` | both | 4 | 0 — Default, 1 … 3 |

---

<!-- nav:begin -->
[← If something goes wrong](12-troubleshooting.md) · [Contents](README.md)  
**English** · [Русский](../ru/13-reference.md)
<!-- nav:end -->
