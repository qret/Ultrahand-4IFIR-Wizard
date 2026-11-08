# 4IFIR Wizard

**English** · [Русский](#4ifir-wizard--по-русски)

An overclock configurator for **4IFIR** 2.5, 2.6 and 2.7, built on the
[Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay) engine.
Since 4IFIR 2.7 it is part of the build, and its updates come from here;
on 2.5 and 2.6 it is installed from here.

The firmware itself is left alone: bootloader, `loader.kip`, `4IFIR.ovl` and sysmodules
stay exactly as their authors made them. The configurator **writes into** the kip — it never
replaces it.

> [!TIP]
> **The latest 4IFIR is always here:**
> - **[Telegram](https://t.me/kf4fr)** — the 4IFIR group: releases, news and help.
> - **[GitHub](https://github.com/rashevskyv/4ifir-checker/releases)** — the build itself: the latest archive.
>
> <a href="https://t.me/kf4fr"><img src="Guides/img/telegram-kf4fr.png" width="160" alt="QR: t.me/kf4fr"></a>

## Installing

- **4IFIR 2.7** — nothing to install: the configurator is already in the build.
  Update it from its own menu: `Check for updates` → `Update`.
- **4IFIR 2.5 and 2.6** — install once from the kit with the engine,
  **[4IFIR-Wizard.zip](https://github.com/qret/Ultrahand-4IFIR-Wizard/releases/download/v0.1.0-2026-10-11-2149/4IFIR-Wizard.zip)**
  (release [`v0.1.0-2026-10-11-2149`](../../releases/tag/v0.1.0-2026-10-11-2149)):
  1. Delete from the SD card, if present: `config/uberhand/`, `switch/.packages/4IFIR Wizard/`,
     `switch/.packages/config.ini`. Leave `atmosphere/kips/` alone — your settings and backups are there.
  2. Unpack the archive into the root of the SD card, replacing files. It brings the Ultrahand
     engine and `config/ultrahand/`: if you changed the key combination or the overlay order,
     keep a copy of `config/ultrahand/config.ini` and `overlays.ini` first.
  3. From then on, update from the configurator: `Check for updates` → `Update`.

Releases after that one carry the configurator alone, without the engine, so take them
through `Update` rather than as a first install. `Update` replaces the whole package folder;
your key combination and overlay order stay as they are.

### 📖 [User guide — how to set it up](Guides/en/README.md)

Installation, what to tune first, the CPU, the GPU and its stages, memory, timings,
cooling, backups, a settings reference, and what to do when the console will not boot.
[На русском](Guides/ru/README.md).

---

## Using it

Open the overlay with **`L` + `R` + `▲`** (D-pad Up) — on 4IFIR 2.5 and 2.6 the same
combination that opened Uberhand. It is set by `key_combo` in `config/ultrahand/config.ini`
and can be changed there or from the overlay's own settings. If it does not work —
[the guide](Guides/en/01-install.md#if-the-key-combination-does-not-work).

**Before changing anything:** `Service` → `Backup manager` → `Create backup`. Backups land
in `atmosphere/kips/.bak/<revision>/` as plain ini files you can read on a PC.

### The menu

| | |
|---|---|
| **eBAMATIC Stage** | the easy path. One setting for everything — the kip works out CPU, GPU and memory voltages itself, you only choose how far it goes. If unsure, change only this. |
| **Advanced** | every parameter individually: CPU, GPU, RAM, Micro-Enhance Logic, Fan Control. Sections that hold settings have a second page with help — press L or R. |
| **Service** | backups, restore, import from the old Wizard, reset to defaults, system info. |
| **Current Settings** | what is in the kip right now, read-only. Press L or R for the second page with timings and fine tuning, and for the third with the memory timings saved in EMC Magician. |
| **Check for updates** | asks GitHub whether a newer build exists and says so on the spot. |
| **Update** | downloads and installs it; hold A on it. The old package is kept aside and put back if anything goes wrong. |
| **Reboot the console** | reboots into the entry 4IFIR boots by itself. |

Nothing takes effect until you restart the console. More in the guide:
[reading the values](Guides/en/02-first-run.md#reading-the-values) ·
[a firmware the configurator does not know](Guides/en/11-update.md#what-gets-updated) ·
[if the console stops booting](Guides/en/12-troubleshooting.md#the-console-will-not-boot).

---

## Why this exists

The configurator appeared for 4IFIR 2.5 and 2.6, whose settings package runs on **Uberhand**.
Every setting has been moved onto current Ultrahand, and the bugs found along the way are fixed.
The configurator is developed further for 4IFIR 2.7, which already ships it as part of the build.

## What makes it different

- **Shows what is really set.** `Current Settings` reads every value straight from the kip — even after a change in hekate's KIP tool.
- **Explains what the original kept silent.** Which settings need a mode switched on, which fields add up inside the kip.
- **The whole GPU curve, the full voltage range.** The Mariko curve goes up to 1459.2 MHz; voltage lists offer everything the firmware accepts, its own default included.
- **Shows before it writes.** Reset to defaults and restoring a backup first show what will be written; applying is a separate hold-A item.
- **Backups named by content, kept per revision.** For example `2707-eBal2-140826-175334`; one taken on the other console model will not apply.
- **Carries over the old 4IFIR Wizard.** `Service → Import old 4IFIR backup` turns its copies in `atmosphere/kips/kip-json` into a backup to review and apply.
- **Refuses a firmware it was not built for.** On an unknown kip layout it hides the settings instead of writing to the wrong bytes; updating still works.
- **Each revision sees only its own settings.** Mariko does not see Erista-only fields, and vice versa.

---

## Building

Building the package and the engine, and how the package is generated from the field map: [BUILDING.md](BUILDING.md).

---

## Credits

Almost everything here was figured out by someone else first, tested on their own console
and shared for free. Named individually in [THANKS.md](THANKS.md).

Special thanks to **Cooler3D** for 4IFIR and for `customize.cpp`, which turned out to be
the best documentation on the subject; **Vladislav (EbalNX)** for the fork where the move
to Ultrahand already worked, and for several techniques taken wholesale; **ppkantorski**
for the engine.

## Licensing

**GPL v2**, chosen deliberately — see [LICENSE](LICENSE). What is whose — the generator and
field map, value dictionaries from [rashevskyv/4IFIR](https://github.com/rashevskyv/4IFIR),
the Ultrahand engine and the fork <https://github.com/qret/Ultrahand-Overlay> (branch `4ifir`),
and the firmware itself, which is neither included nor modified — is in [NOTICE.md](NOTICE.md).

## Disclaimer

Overclocking a Nintendo Switch beyond stock tables, with voltage adjustments, can damage
your console. Use at your own risk.

---
---

# 4IFIR Wizard — по-русски

[English](#4ifir-wizard) · **Русский**

Конфигуратор разгона для **4IFIR** 2.5, 2.6 и 2.7 на движке
[Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay).
С 4IFIR 2.7 он входит в состав сборки, а обновления приходят отсюда;
на 2.5 и 2.6 он ставится отсюда.

Саму прошивку не трогает: загрузчик, `loader.kip`, `4IFIR.ovl` и sys-модули остаются
такими, какими их сделали авторы. Конфигуратор **пишет в** kip, а не подменяет его.

> [!TIP]
> **Свежая 4IFIR — всегда здесь:**
> - **[Telegram](https://t.me/kf4fr)** — группа 4IFIR: релизы, новости и помощь.
> - **[GitHub](https://github.com/rashevskyv/4ifir-checker/releases)** — сама сборка: архив последней версии.
>
> <a href="https://t.me/kf4fr"><img src="Guides/img/telegram-kf4fr.png" width="160" alt="QR: t.me/kf4fr"></a>

## Установка

- **4IFIR 2.7** — ставить ничего не нужно: конфигуратор уже в сборке.
  Обновляется из своего меню: `Check for updates` → `Update`.
- **4IFIR 2.5 и 2.6** — один раз поставить набор с движком,
  **[4IFIR-Wizard.zip](https://github.com/qret/Ultrahand-4IFIR-Wizard/releases/download/v0.1.0-2026-10-11-2149/4IFIR-Wizard.zip)**
  (релиз [`v0.1.0-2026-10-11-2149`](../../releases/tag/v0.1.0-2026-10-11-2149)):
  1. Удалите с карты памяти, если есть: `config/uberhand/`, `switch/.packages/4IFIR Wizard/`,
     `switch/.packages/config.ini`. Не трогайте `atmosphere/kips/` — там ваши настройки и копии.
  2. Распакуйте архив в корень карты с заменой. Он везёт движок Ultrahand
     и `config/ultrahand/`: если меняли комбинацию вызова или порядок оверлеев,
     сначала сохраните `config/ultrahand/config.ini` и `overlays.ini`.
  3. Дальше обновляйте из конфигуратора: `Check for updates` → `Update`.

Релизы после него несут только конфигуратор, без движка, — их берут через `Update`,
а не как первую установку. `Update` заменяет каталог пакета целиком; комбинация вызова
и порядок оверлеев остаются вашими.

### 📖 [Руководство — как всё настроить](Guides/ru/README.md)

Установка, с чего начать, процессор, видеоядро и ступени, память, тайминги, охлаждение,
копии настроек, справочник настроек и что делать, если консоль перестала грузиться.
[In English](Guides/en/README.md).

---

## Как пользоваться

Оверлей открывается комбинацией **`L` + `R` + `▲`** (крестовина вверх) — на 4IFIR 2.5
и 2.6 той же, что открывала Uberhand. Задаётся ключом `key_combo` в `config/ultrahand/config.ini`,
меняется там же или из настроек самого оверлея. Не работает —
[руководство](Guides/ru/01-install.md#если-комбинация-не-работает).

**Прежде чем что-то менять:** `Service` → `Backup manager` → `Create backup`. Копии кладутся
в `atmosphere/kips/.bak/<ревизия>/` обычными ini-файлами, которые читаются на компьютере.

### Меню

| | |
|---|---|
| **eBAMATIC Stage** | лёгкий путь. Одна настройка на всё — kip сам считает напряжения CPU, GPU и памяти, вы выбираете только насколько далеко зайти. Если не уверены — меняйте только это. |
| **Advanced** | каждый параметр отдельно: CPU, GPU, RAM, Micro-Enhance Logic, Fan Control. У разделов с настройками есть вторая страница со справкой — L или R. |
| **Service** | копии настроек, восстановление, импорт из старого визарда, сброс к заводским, информация о консоли. |
| **Current Settings** | что сейчас в kip, только чтение. L или R — вторая страница с таймингами и тонкой настройкой и третья — тайминги памяти, сохранённые в EMC Magician. |
| **Check for updates** | спрашивает у GitHub, вышла ли сборка новее, и сразу отвечает. |
| **Update** | скачивает и ставит её; A надо удержать. Старый пакет откладывается в сторону и возвращается, если что-то пошло не так. |
| **Reboot the console** | перезагружает в ту запись, которой 4IFIR грузится сам. |

Ничего не вступает в силу до перезагрузки консоли. Подробнее в руководстве:
[как читать значения](Guides/ru/02-first-run.md#как-читать-значения) ·
[незнакомая конфигуратору прошивка](Guides/ru/11-update.md#что-обновляется) ·
[если консоль перестала грузиться](Guides/ru/12-troubleshooting.md#консоль-не-грузится).

---

## Зачем это

Конфигуратор появился для 4IFIR 2.5 и 2.6, где пакет настройки работает на **Uberhand**.
Все настройки перенесены на актуальный Ultrahand, найденные по пути ошибки исправлены.
Дальше конфигуратор развивается для 4IFIR 2.7, где уже входит в состав сборки.

## Чем отличается

- **Показывает, что выставлено на самом деле.** `Current Settings` читает все значения прямо из kip — даже после правки через KIP tool в hekate.
- **Объясняет связи, о которых оригинал молчал.** Какие настройки не работают без включённого режима, какие поля складываются внутри kip.
- **Вся кривая GPU, весь диапазон напряжений.** Кривая Mariko — до 1459,2 МГц; в списках напряжений всё, что принимает прошивка, включая её собственное значение.
- **Сначала показывает, потом пишет.** Сброс к заводским и восстановление копии сначала показывают, что запишут; применение — отдельный пункт с удержанием A.
- **Копии названы по содержимому и разделены по ревизии.** Например, `2707-eBal2-140826-175334`; копия с консоли другой модели не применится.
- **Переносит настройки старого 4IFIR Wizard.** `Service → Import old 4IFIR backup` превращает его копии из `atmosphere/kips/kip-json` в копию, которую можно посмотреть и применить.
- **Не работает на прошивке, под которую не собран.** При незнакомой раскладке kip настройки скрыты, чтобы запись не ушла не в те байты; обновление при этом работает.
- **Каждая ревизия видит только свои настройки.** Mariko не видит полей, которые есть только у Erista, и наоборот.

---

## Сборка

Сборка пакета и движка и то, как пакет порождается из карты полей, — в [BUILDING.ru.md](BUILDING.ru.md).

---

## Благодарности

Почти всё здесь раньше выяснил кто-то другой, проверил на своей консоли и выложил
бесплатно. Поимённо — в [THANKS.md](THANKS.md).

Отдельно: **Cooler3D** — за 4IFIR и за `customize.cpp`, оказавшийся лучшей документацией
по теме; **Владислав (EbalNX)** — за форк, где перенос на Ultrahand уже работал, и за
несколько приёмов, взятых целиком; **ppkantorski** — за движок.

## Лицензии

**GPL v2**, выбрана осознанно — см. [LICENSE](LICENSE). Что чьё — генератор и карта полей,
словари значений из [rashevskyv/4IFIR](https://github.com/rashevskyv/4IFIR), движок Ultrahand
и форк <https://github.com/qret/Ultrahand-Overlay> (ветка `4ifir`), сама прошивка, которая
здесь не содержится и не изменяется, — в [NOTICE.md](NOTICE.md) (по-английски).

## Предупреждение

Разгон Nintendo Switch за пределы штатных таблиц, с изменением напряжений, может повредить
консоль. Всё на ваш риск.
