# 4IFIR Wizard

**English** · [Русский](#4ifir-wizard--по-русски)

An overclock tuner package for **4IFIR** firmware, built on the
[Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay) engine.
It replaces the legacy Uberhand + 4IFIR Wizard combination.

The firmware itself is left alone: bootloader, `loader.kip`, `4IFIR.ovl` and sysmodules
stay exactly as their authors made them. This package **writes into** the kip — it never
replaces it.

> **Just want to use it?** One archive from [Releases](../../releases), unpacked into
> the root of your SD card. It holds the tuner and nothing else:
> `switch/.packages/4IFIR Wizard/`.
>
> **The engine is not in it.** Ultrahand is maintained by the author of the firmware and
> comes with the 4IFIR build, along with its `config/ultrahand/`. Our archive neither
> carries nor replaces it, so your key combination, theme, overlay order and sounds
> stay as they are.
>
> This repository is for building it yourself or understanding how it works.

### 📖 [User guide — how to set it up](Guides/en/README.md)

Installation, what to tune first, the CPU, the GPU and its stages, memory, timings,
cooling, backups, a settings reference, and what to do when the console will not boot.
[На русском](Guides/ru/README.md).

---

## Using it

Open the overlay with the same key combination that opened Uberhand: **`L` + `R` + `▲`**
(D-pad Up). It is set by `key_combo` in `config/ultrahand/config.ini` and can be changed
there or from the overlay's own settings.

If that key is missing from the config, the engine falls back to its own default,
`ZL` + `ZR` + `▼` — which is *not* what 4IFIR ships, so do not go looking for it there.

**Before changing anything:** go to `Service` → `Create backup`. It takes a second and
saves an evening. Backups land in `atmosphere/kips/.bak/<revision>/` as plain ini files
you can read on a PC.

### The menu

| | |
|---|---|
| **eBAMATIC Stage** | the easy path. One setting for everything — the kip works out CPU, GPU and memory voltages itself, you only choose how far it goes. If unsure, change only this. |
| **Current Settings** | what is in the kip right now, read-only. Press L or R for the second page with timings and fine tuning. |
| **Advanced** | every parameter individually: CPU, GPU, RAM, Micro-Enhance Logic, Fan Control. Sections that hold settings have a second page with help — press L or R. |
| **Service** | backups, restore, import from the old Wizard, reset to defaults, system info. |
| **Check for updates** | asks GitHub whether a newer build exists and says so on the spot. |
| **Install update** | downloads and installs it. The old package is kept aside and put back if anything goes wrong. |
| **Reboot the console** | reboots into the entry 4IFIR boots by itself. |

Nothing takes effect until you restart the console.

If the tuner opens on a single screen saying the kip layout does not match, the menu is
hidden on purpose: that `loader.kip` is from another firmware, and writing into it by
this field map would hit the wrong bytes.

Updating still works there, and that is deliberate too. `Check for updates` and `Update`
stay on that same screen: press the first, and if a build for your firmware exists, the
second installs it. You are not locked out.

### Reading the values

Each item shows its current value on the right. Those labels are read from the kip when
you enter a section, so they reflect the file, not something remembered from last time.

Values are shown as `stage` or as an absolute figure, and the difference matters: a stage
lets the kip calculate per RAM speed, while a fixed voltage applies to every RAM speed
alike. What suits overclocked memory is usually excessive at 1600 MHz.

### If it stops booting

Hold the volume keys to enter hekate, open `Tools` → `KIP tool` → `loader.kip`, and set
the value back. The `pMeh` and `sMeh` numbers in this package are deliberately the same
numbers hekate shows — that numbering is a contract, not decoration.

Alternatively, copy a backup over the kip from a PC.

### Updating over a previous version

Delete every `config.ini` inside `switch/.packages/4IFIR Wizard/` — in the package root
and in all subdirectories. The engine keeps item labels there, those files are not part
of the bundle, so copying over them leaves stale labels behind. Nothing important is lost:
labels are re-read from the kip on the next visit.

---

## Why this exists

4IFIR is configured through an overlay package that runs on **Uberhand** — a fork of
Ultrahand that stopped following upstream years ago. Uberhand's sources were never
published: only a compiled binary ships with 4IFIR. That means the engine cannot be
updated, fixed or extended.

This project moves the tuner onto current Ultrahand, keeping every setting the original
exposed — and fixing a number of bugs found along the way.

## What makes it different

**It shows what is actually set.** A dedicated page reads all values straight from the kip,
not from the menu's cached state. Change the kip elsewhere — through hekate's KIP tool,
for instance — and the summary still tells the truth.

**It explains relationships the original kept silent about.** Which settings do nothing
unless a mode is enabled, which fields are summed inside the kip, where sources disagree
about a safe limit.

**The GPU curve goes all the way up.** Seven offsets that look like another table are the
top seven points of the Mariko curve — 1228.8 to 1459.2 MHz. Both previous tuners wrote
them; we called that a mistake and stopped, then read the firmware and found they were
right. On Erista the same bytes are row 0 of the CPU table, so there they stay untouched.

**Reset to defaults shows you what it will write** before writing it, and applying is
a separate hold-A item. The values come from the file the firmware itself ships, and that
file travels inside the package, so you can read it on a PC. In the original it was
a single item: 62 writes and a reboot, no questions asked.

**Backups are separated by console revision.** Pick one taken on the other model and a
red line names both sides outright; applying it simply does nothing, because the two
setting lists don't overlap.

**A saved configuration is named after what is inside it** — RAM frequency, EMC balance
mode and the time it was taken, for example `2707-eBal2-140826-175334`. Copies group
by frequency in the list, and a configuration left on automatic says so in its name. The
overlay has no on-screen keyboard, so a generated name is the only thing that can describe
a copy at all. It is kept short on purpose: a longer name runs into the selection mark
on the right of the row.

**Choosing a backup shows what is in it before anything is written.** The summary is read
from the file, grouped by CPU, GPU and RAM, and applying is a separate hold-A item.

**It refuses to run on a firmware it was not built for.** Offsets are positions inside a
structure; if a firmware update rearranges that structure, the same numbers would point at
different settings and writing them would corrupt the loader. The package reads the layout
version out of the kip and shows an explanation instead of a menu when it does not match.
A saved configuration records the layout it was taken on, and will not be applied to another.

**Voltage settings offer the range the firmware actually accepts.** Both donor packages
shipped narrower lists — and on parts of the GPU curve the value the firmware itself ships
was not in the list at all, so a changed point could not be put back.

**Settings saved by the old 4IFIR Wizard can be carried over.** `Service -> Import old
4IFIR backup` reads the copies it left in `atmosphere/kips/kip-json` and turns them into
a copy in this package's own format. The import writes nothing to the kip: you review the
result like any other copy and apply it from `Restore backup`.

**Settings are filtered by revision.** Mariko consoles don't see Erista-only fields and
vice versa. The original showed everything at once.

---

## Building the package

Requires [Node.js](https://nodejs.org/) 18 or newer. No other dependencies.

```sh
git clone https://github.com/qret/Ultrahand-4IFIR-Wizard.git
cd Ultrahand-4IFIR-Wizard
node scripts/generate.mjs --clean
```

The result lands in `package/dist/` — copy it to your SD card as
`switch/.packages/4IFIR Wizard/`.

### Validating what you built

Four checks run from a clone, all of which must pass:

```sh
node scripts/uhlint package/dist       # DSL syntax
node scripts/check-menu.mjs            # every offset is reachable from exactly one item
node scripts/check-generated.mjs       # generated output matches intent
node scripts/make-guide.mjs --check    # the guide still matches the package
```

A full build runs two more that are not in this repository, because they read the live
`loader.kip` from the console this was developed against: one compares the field map
against the firmware actually installed, the other replays the old-profile importer.
`BUILD.txt` inside every release archive lists all six by name.

`uhlint` matters more than it sounds. **Both overlay engines swallow errors silently:**
an unknown command is simply ignored, and a failed kip write reports success. For an
overlay that changes CPU voltages, a partially applied profile is more dangerous than
one that never applied at all. The linter is the only thing standing between a typo
and a console that won't boot.

---

## Building the engine

The overlay binary (`ovlmenu.ovl`) is **not** part of this repository, and it is not part
of our releases either: the engine is maintained by the author of the firmware and comes
with the 4IFIR build. Nothing here replaces the one you already run.

So build it yourself only if you want to modify the engine, or to see for yourself what
you are running. The rest of this section covers that. It is written for Windows with
WSL, but the steps are the same on any Linux.

### What you need

| | |
|---|---|
| WSL 2 with Ubuntu | `wsl --install -d Ubuntu` from an elevated PowerShell |
| devkitPro / devkitA64 | the ARM64 toolchain for Switch homebrew |
| libnx **from master** | not the released version — see below |
| ~4 GB free space | toolchain and sources |

### Why libnx from master, and not a release

Ultrahand 2.5.3 reads `nacp.lang_data`. In libnx 4.12.0 — the current release —
`NacpStruct` still has the older `NacpLanguageEntry lang[16]` form, so the build fails with:

```
error: 'struct NacpStruct' has no member named 'lang_data'
```

This is the single most common reason people fail to build Ultrahand. Install the released
libnx first through the package manager, then replace it with a build from master.

### Steps

Install devkitPro's package manager, then the toolchain:

```sh
sudo apt-get update && sudo apt-get install -y wget gnupg xz-utils build-essential git
wget https://apt.devkitpro.org/install-devkitpro-pacman
chmod +x install-devkitpro-pacman && sudo ./install-devkitpro-pacman
sudo dkp-pacman -Sy --noconfirm switch-dev devkitA64
```

Build and install libnx from master, replacing the packaged one:

```sh
export DEVKITPRO=/opt/devkitpro
export DEVKITA64=$DEVKITPRO/devkitA64
export PATH=$DEVKITPRO/tools/bin:$DEVKITA64/bin:$PATH

git clone https://github.com/switchbrew/libnx.git
cd libnx && make -j$(nproc)
sudo -E make install
```

Clone the engine **with submodules** and build:

```sh
git clone --recurse-submodules https://github.com/ppkantorski/Ultrahand-Overlay.git
cd Ultrahand-Overlay
make -j$(nproc)
```

That is upstream, the engine itself. Our own engine changes live in a fork,
<https://github.com/qret/Ultrahand-Overlay>, branch `4ifir` — clone that one instead if
you want them. Nothing built from either ships in our releases.

### Two things that will bite you

**The submodule is not optional.** `lib/libultrahand` must be populated. Cloning without
`--recurse-submodules` leaves it empty and the build fails immediately. Fix with
`git submodule update --init --recursive`.

**No spaces in the path.** `ultrahand.mk` uses `$(subst …)`, and make splits the value on
spaces. A path like `~/My Projects/Ultrahand` breaks the build in a way that is hard
to read from the error message.

### Verifying the result

You get `ovlmenu.ovl`, roughly 1.0–2.2 MB. Two markers confirm it is a valid Ultrahand
overlay rather than something else:

```sh
xxd -s 16 -l 4 ovlmenu.ovl     # NRO0  — valid NRO header
tail -c 4 ovlmenu.ovl          # ULTR  — Ultrahand signature, added by the Makefile
```

The `ULTR` tail is what distinguishes Ultrahand from Uberhand builds.

**Byte-for-byte reproducibility is not guaranteed.** The Makefile passes `-flto=$(NPROC)`,
so the output depends on how many cores your machine has. Compare versions and behaviour,
not hashes.

### Putting it together

```
SD card root
├── switch/.overlays/ovlmenu.ovl        the engine — from the 4IFIR build, or built above
├── config/ultrahand/                   its config, themes, languages, sounds
│   └── config.ini                      the key combination — see below
└── switch/.packages/4IFIR Wizard/      package/dist from this repo  ─── our release archive
```

**If the combination is missing, take `config/ultrahand/config.ini` from this
repository.** A 4IFIR build already has one; a card you assembled yourself may not, and
then the engine falls back to its own default, `ZL + ZR + ▼`, rather than the `L + R + ▲`
this README promises. The file is short and every line in it is commented — it pins the
key combination and keeps other overlays able to have their own.

Do **not** copy `fuse.ini` from someone else's card — it holds calibration constants
specific to one console and is generated for yours on first run.

---

## How it works

The package is not written by hand. It is **generated from a field map**, and that is
the central idea of this project: the label a menu item displays and the value it writes
come from the same map entry, so they cannot drift apart.

Both original packages drifted. In one of them an item writes to offset `12448` while
displaying the value read from `12444` — a mismatch nobody noticed for years.

```
package/
  fields.json          field map: 129 offsets of the CUST block inside loader.kip —
                       address, length, units, console revision, value dictionary,
                       and what each entry is corroborated by
  menu.json            menu structure: where each parameter lives, help texts
  semantics-src/       subsystem semantics and cross-parameter dependencies
  backup-import.json   mapping of legacy 4IFIR Wizard backups onto our offsets

scripts/
  generate.mjs         builds the package from the map
  uhlint/              Ultrahand DSL linter
  check-menu.mjs       coverage check
  check-generated.mjs  intent check
```

### Console revisions

Fields in the `CUST` block are either common, Mariko-only or Erista-only. That split comes
from the primary source — `customize.cpp` by the 4IFIR authors, where the revision is
encoded in the field name itself: `common*`, `mariko*`, `erista*`. This is more reliable
than the markup inside the shipped packages, which contradicts itself in several places.

### Units

Three of them share one block: kilohertz for clocks, millivolts for CPU/GPU voltages and
the Mariko curve, microvolts for Vdd2, Vddq and the Erista curve. Getting them wrong means
being off by a factor of a thousand, so units live in the map rather than being guessed
from a field's name.

---

## Credits

Almost everything here was figured out by someone else first, tested on their own console
and shared for free. Named individually in [THANKS.md](THANKS.md).

Special thanks to **Cooler3D** for 4IFIR and for `customize.cpp`, which turned out to be
the best documentation on the subject; **Vladislav (EbalNX)** for the fork where the move
to Ultrahand already worked, and for several techniques taken wholesale; **ppkantorski**
for the engine.

## Licensing

**This project is under GPL v2** — see `LICENSE` in the repository root, and `NOTICE.md`
for where each part came from. That is a deliberate choice, not something inherited: the
engine this package runs on is GPL v2, and so is the ecosystem around it — Atmosphère,
hekate, Switch-OC-Suite.

The generator and the field map are our own work. Value dictionaries and part of the help
texts come from the 4IFIR Wizard package ([rashevskyv/4IFIR](https://github.com/rashevskyv/4IFIR)) —
years of accumulated knowledge that cannot be reconstructed by hand.

**Ultrahand-Overlay** is distributed under GPL v2 by ppkantorski. It is in neither this
repository nor our release archives — it comes with the 4IFIR build.

Overclocking itself, `loader.kip` and the 4IFIR firmware are the work of Cooler3D and the
Switch-OC-Suite authors. Not included here, not modified.

## Disclaimer

Overclocking a Nintendo Switch beyond stock tables, with voltage adjustments, can damage
your console. Use at your own risk.

---
---

# 4IFIR Wizard — по-русски

[English](#4ifir-wizard) · **Русский**

Пакет настройки разгона для прошивки **4IFIR** на движке
[Ultrahand Overlay](https://github.com/ppkantorski/Ultrahand-Overlay).
Заменяет связку Uberhand + старый 4IFIR Wizard.

Саму прошивку не трогает: загрузчик, `loader.kip`, `4IFIR.ovl` и sys-модули остаются
такими, какими их сделали авторы. Пакет **пишет в** kip, а не подменяет его.

> **Просто хотите пользоваться?** Один архив из [Releases](../../releases),
> распаковать в корень SD-карты. Внутри только тюнер:
> `switch/.packages/4IFIR Wizard/`.
>
> **Движка в нём нет.** Ultrahand ведёт автор прошивки, и он приходит вместе со сборкой
> 4IFIR — вместе со своим `config/ultrahand/`. Наш архив его не несёт и не заменяет:
> ваша комбинация вызова, тема, порядок оверлеев и звук остаются как были.
>
> Этот репозиторий — для тех, кто хочет собрать всё сам или понять, как оно устроено.

### 📖 [Руководство — как всё настроить](Guides/ru/README.md)

Установка, с чего начать, процессор, видеоядро и ступени, память, тайминги, охлаждение,
копии настроек, справочник настроек и что делать, если консоль перестала грузиться.
[In English](Guides/en/README.md).

---

## Как пользоваться

Оверлей открывается той же комбинацией, что открывала Uberhand: **`L` + `R` + `▲`**
(крестовина вверх). Задаётся ключом `key_combo` в `config/ultrahand/config.ini`,
меняется там же или из настроек самого оверлея.

Если этого ключа в конфиге нет, движок берёт своё умолчание — `ZL` + `ZR` + `▼`.
В поставке 4IFIR так не бывает, так что искать эту комбинацию там не стоит.

**Прежде чем что-то менять:** зайдите в `Service` → `Create backup`. Занимает секунду,
экономит вечер. Бэкапы кладутся в `atmosphere/kips/.bak/<ревизия>/` обычными ini-файлами,
которые читаются на компьютере.

### Меню

| | |
|---|---|
| **eBAMATIC Stage** | лёгкий путь. Одна настройка на всё — kip сам считает напряжения CPU, GPU и памяти, вы выбираете только насколько далеко зайти. Если не уверены — меняйте только это. |
| **Current Settings** | что сейчас в kip, только чтение. L или R — вторая страница с таймингами и тонкой настройкой. |
| **Advanced** | каждый параметр отдельно: CPU, GPU, RAM, Micro-Enhance Logic, Fan Control. У разделов с настройками есть вторая страница со справкой — L или R. |
| **Service** | копии настроек, восстановление, импорт из старого визарда, сброс к заводским, информация о консоли. |
| **Check for updates** | спрашивает у GitHub, вышла ли сборка новее, и сразу отвечает. |
| **Install update** | скачивает и ставит её. Старый пакет откладывается в сторону и возвращается, если что-то пошло не так. |
| **Reboot the console** | перезагружает в ту запись, которой 4IFIR грузится сам. |

Ничего не вступает в силу до перезагрузки консоли.

Если конфигуратор открылся сообщением о несовпадении раскладки kip, настройки спрятаны
намеренно: этот `loader.kip` от другой прошивки, и запись по нашей карте полей попала бы
не в те байты.

Обновление при этом работает — и это тоже сделано намеренно. На том же экране остаются
`Check for updates` и `Update`: нажмите первое, и если вышла сборка под вашу прошивку,
второе её поставит. Заперты вы не будете.

### Как читать значения

Справа у каждого пункта показано текущее значение. Эти подписи читаются из kip при входе
в раздел — то есть отражают файл, а не запомненное с прошлого раза.

Значение показывается либо ступенью, либо абсолютной величиной, и разница существенна:
ступень позволяет kip считать под каждую частоту памяти, а фиксированное напряжение
применяется ко всем частотам одинаково. То, что подходит разогнанной памяти, обычно
избыточно на 1600 МГц.

### Если консоль перестала грузиться

Зажмите клавиши громкости, войдите в hekate, откройте `Tools` → `KIP tool` → `loader.kip`
и верните значение обратно. Номера `pMeh` и `sMeh` в этом пакете намеренно те же, что
показывает hekate — эта нумерация контракт, а не украшение.

Либо скопируйте бэкап поверх kip с компьютера.

### Обновление поверх предыдущей версии

Удалите все `config.ini` внутри `switch/.packages/4IFIR Wizard/` — и в корне пакета,
и во всех подкаталогах. Движок хранит там подписи пунктов, в комплект эти файлы не входят,
поэтому копирование поверх оставляет старые подписи. Ничего важного не теряется: подписи
перечитаются из kip при следующем заходе.

---

## Зачем это

4IFIR настраивается пакетом-оверлеем, который работает на **Uberhand** — форке Ultrahand,
переставшем следовать за апстримом несколько лет назад. Исходники Uberhand так и не были
опубликованы: с 4IFIR поставляется только скомпилированный бинарник. Значит, движок
нельзя ни обновить, ни починить, ни расширить.

Этот проект переносит тюнер на актуальный Ultrahand, сохраняя все настройки, которые
были в оригинале, — и попутно исправляя найденные ошибки.

## Чем отличается

**Показывает, что выставлено на самом деле.** Отдельная страница читает все значения прямо
из kip, а не из запомненного состояния меню. Поменяли kip другим способом — например,
через KIP tool в hekate — сводка всё равно говорит правду.

**Объясняет связи, о которых оригинал молчал.** Какие настройки ничего не делают без
включённого режима, какие поля складываются внутри kip, где источники расходятся
в оценке безопасного предела.

**Кривая GPU доходит до самого верха.** Семь смещений, похожих на чужую таблицу, — это
верхние семь точек кривой Mariko, 1228,8…1459,2 МГц. Оба прошлых тюнера туда писали,
мы сочли это ошибкой и перестали, а потом разобрали код прошивки и увидели, что правы
были они. На Erista те же байты — строка 0 таблицы CPU, и там мы их не трогаем.

**Сброс к умолчаниям сначала показывает, что запишет**, а применение — отдельный пункт
с удержанием A. Значения берутся из файла, который кладёт сама прошивка, и этот файл едет
внутри пакета — его можно прочитать на компьютере. В оригинале это был один
пункт: 62 записи и перезагрузка, без вопросов.

**Копии разделены по ревизии консоли.** Выбрав копию с другой модели, вы увидите красную
строку, которая прямо назовёт обе стороны, а применение просто не сработает: наборы
настроек у Erista и Mariko не пересекаются.

**Копия настроек названа по своему содержимому** — частота памяти, режим EMC Balance
и время снятия, например `2707-eBal2-140826-175334`. В списке копии группируются
по частоте, а оставленный автомат так и написан словом. Экранной клавиатуры в оверлее нет
вовсе, поэтому сгенерированное имя — единственное, что вообще может рассказать о копии.
Оно намеренно короткое: имя подлиннее наезжает на отметку выбора справа.

**При выборе копии сначала видно, что в ней лежит.** Сводка читается из самого файла,
разбита по CPU, GPU и RAM, а применение — отдельный пункт с удержанием A.

**Не запускается на прошивке, под которую не собран.** Смещение — это позиция в структуре;
если обновление прошивки её перестроит, те же числа станут указывать на другие настройки,
и запись испортит загрузчик. Пакет читает версию раскладки из самого kip и при несовпадении
показывает объяснение вместо меню. Копия настроек помнит, на какой раскладке снята,
и на чужую не применится.

**Настройки напряжения предлагают тот диапазон, который принимает прошивка.** Оба
пакета-донора отгружали более узкие списки — а на части кривой GPU в списке отсутствовало
даже то значение, которое ставит сама прошивка, и сдвинутую точку нельзя было вернуть.

**Настройки, сохранённые старым 4IFIR Wizard, можно перенести.** `Service -> Import old
4IFIR backup` читает копии, оставленные им в `atmosphere/kips/kip-json`, и превращает их
в копию нашего формата. Импорт в kip ничего не пишет: результат вы смотрите как любую
другую копию и применяете из `Restore backup`.

**Настройки фильтруются по ревизии.** Mariko не видит полей, которые есть только у Erista,
и наоборот. Оригинал показывал всё сразу.

---

## Сборка пакета

Нужен [Node.js](https://nodejs.org/) 18 или новее. Больше ничего.

```sh
git clone https://github.com/qret/Ultrahand-4IFIR-Wizard.git
cd Ultrahand-4IFIR-Wizard
node scripts/generate.mjs --clean
```

Результат появится в `package/dist/` — скопируйте его на SD-карту как
`switch/.packages/4IFIR Wizard/`.

### Проверка того, что собралось

Четыре проверки запускаются из клона, все должны пройти:

```sh
node scripts/uhlint package/dist       # синтаксис DSL
node scripts/check-menu.mjs            # каждое смещение достижимо ровно из одного пункта
node scripts/check-generated.mjs       # сгенерированное соответствует намерению
node scripts/make-guide.mjs --check    # руководство не разошлось с пакетом
```

Полная сборка гоняет ещё две, которых в этом репозитории нет: они читают **живой**
`loader.kip` с консоли, на которой всё это писалось. Одна сверяет карту полей с реально
установленной прошивкой, вторая прогоняет импорт старых профилей. `BUILD.txt` внутри
каждого архива релиза перечисляет все шесть поимённо.

`uhlint` важнее, чем кажется. **Оба движка оверлеев глотают ошибки молча:** неизвестная
команда просто игнорируется, а неудавшаяся запись в kip рапортует об успехе. Для оверлея,
который меняет напряжения CPU, наполовину применённый профиль опаснее, чем не применённый
вовсе. Линтер — единственное, что стоит между опечаткой и консолью, которая не грузится.

---

## Сборка движка

Бинарник оверлея (`ovlmenu.ovl`) **не входит** ни в этот репозиторий, ни в наши релизы:
движок ведёт автор прошивки, и он приходит со сборкой 4IFIR. Тот, что у вас стоит, мы
ничем не заменяем.

Значит, собирать самому есть смысл, только если вы хотите править движок или своими
глазами увидеть, что именно запускаете. Дальше — про это. Написано под Windows с WSL,
но на любом Linux шаги те же.

### Что понадобится

| | |
|---|---|
| WSL 2 с Ubuntu | `wsl --install -d Ubuntu` из PowerShell с правами администратора |
| devkitPro / devkitA64 | тулчейн ARM64 для homebrew под Switch |
| libnx **из master** | не релизная версия — почему, ниже |
| ~4 ГБ места | тулчейн и исходники |

### Почему libnx из master, а не релиз

Ultrahand 2.5.3 читает `nacp.lang_data`. В libnx 4.12.0 — текущем релизе — у `NacpStruct`
всё ещё старая форма `NacpLanguageEntry lang[16]`, поэтому сборка падает с:

```
error: 'struct NacpStruct' has no member named 'lang_data'
```

Это самая частая причина, по которой у людей не собирается Ultrahand. Сначала поставьте
релизный libnx через пакетный менеджер, затем замените его сборкой из master.

### Шаги

Ставим пакетный менеджер devkitPro, затем тулчейн:

```sh
sudo apt-get update && sudo apt-get install -y wget gnupg xz-utils build-essential git
wget https://apt.devkitpro.org/install-devkitpro-pacman
chmod +x install-devkitpro-pacman && sudo ./install-devkitpro-pacman
sudo dkp-pacman -Sy --noconfirm switch-dev devkitA64
```

Собираем и ставим libnx из master поверх пакетного:

```sh
export DEVKITPRO=/opt/devkitpro
export DEVKITA64=$DEVKITPRO/devkitA64
export PATH=$DEVKITPRO/tools/bin:$DEVKITA64/bin:$PATH

git clone https://github.com/switchbrew/libnx.git
cd libnx && make -j$(nproc)
sudo -E make install
```

Клонируем движок **с сабмодулями** и собираем:

```sh
git clone --recurse-submodules https://github.com/ppkantorski/Ultrahand-Overlay.git
cd Ultrahand-Overlay
make -j$(nproc)
```

Это апстрим, сам движок. Наши правки движка живут в форке,
<https://github.com/qret/Ultrahand-Overlay>, ветка `4ifir` — клонируйте его, если нужны
они. В наших релизах не едет ни то, ни другое.

### Две вещи, на которых вы споткнётесь

**Сабмодуль обязателен.** Каталог `lib/libultrahand` должен быть заполнен. Клонирование
без `--recurse-submodules` оставляет его пустым, и сборка падает сразу. Лечится
`git submodule update --init --recursive`.

**Никаких пробелов в пути.** В `ultrahand.mk` используется `$(subst …)`, а make режет
значение по пробелам. Путь вида `~/My Projects/Ultrahand` ломает сборку так,
что по тексту ошибки это не прочитать.

### Как убедиться, что собралось правильно

Получается `ovlmenu.ovl` размером примерно 1.0–2.2 МБ. Два признака подтверждают, что это
настоящий оверлей Ultrahand, а не что-то другое:

```sh
xxd -s 16 -l 4 ovlmenu.ovl     # NRO0  — корректный заголовок NRO
tail -c 4 ovlmenu.ovl          # ULTR  — подпись Ultrahand, дописывается Makefile
```

Хвост `ULTR` — то, чем сборка Ultrahand отличается от сборки Uberhand.

**Побайтовая воспроизводимость не гарантируется.** Makefile передаёт `-flto=$(NPROC)`,
поэтому результат зависит от числа ядер машины. Сравнивайте версии и поведение, а не хеши.

### Как всё сложить вместе

```
корень SD-карты
├── switch/.overlays/ovlmenu.ovl        движок — из сборки 4IFIR или собранный выше
├── config/ultrahand/                   его конфиг, темы, языки, звуки
│   └── config.ini                      комбинация вызова — см. ниже
└── switch/.packages/4IFIR Wizard/      package/dist из этого репо  ─── наш архив релиза
```

**Если комбинации нет, возьмите `config/ultrahand/config.ini` из этого репозитория.**
В сборке 4IFIR он уже есть; на карте, собранной руками, его может не быть — и тогда
движок возьмёт своё умолчание `ZL + ZR + ▼`, а не обещанную этим же README комбинацию
`L + R + ▲`. Файл короткий, каждая строка прокомментирована: он закрепляет комбинацию,
оставляет другим оверлеям возможность иметь свои.

**Не копируйте** `fuse.ini` с чужой карты — там калибровочные константы конкретной
консоли, для вашей он создаётся при первом запуске.

---

## Как это устроено

Пакет не пишется руками. Он **генерируется из карты полей**, и это центральная идея
проекта: подпись, которую показывает пункт меню, и значение, которое он записывает,
берутся из одной и той же записи карты — разойтись они не могут.

Оба оригинальных пакета разошлись. В одном из них пункт пишет в смещение `12448`,
а показывает значение, прочитанное из `12444`, — расхождение, которого годами никто
не заметил.

```
package/
  fields.json          карта полей: 129 смещений блока CUST внутри loader.kip —
                       адрес, длина, единицы, ревизия консоли, словарь значений
                       и чем каждая запись подтверждена
  menu.json            структура меню: где живёт каждый параметр, тексты справки
  semantics-src/       семантика подсистем и связи между параметрами
  backup-import.json   соответствие бэкапов старого 4IFIR Wizard нашим смещениям

scripts/
  generate.mjs         собирает пакет из карты
  uhlint/              линтер DSL Ultrahand
  check-menu.mjs       проверка покрытия
  check-generated.mjs  проверка соответствия намерению
```

### Ревизии консоли

Поля блока `CUST` бывают общие, только для Mariko или только для Erista. Это разделение
взято из первоисточника — `customize.cpp` авторов 4IFIR, где ревизия закодирована в самом
имени поля: `common*`, `mariko*`, `erista*`. Так надёжнее, чем разметка внутри готовых
пакетов, которая в нескольких местах противоречит сама себе.

### Единицы измерения

В одном блоке их три: килогерцы для частот, милливольты для напряжений CPU/GPU и кривой
Mariko, микровольты для Vdd2, Vddq и кривой Erista. Ошибиться здесь — промахнуться
в тысячу раз, поэтому единицы лежат в карте, а не угадываются по имени поля.

---

## Благодарности

Почти всё здесь до нас выяснил кто-то другой, проверил на своей консоли и выложил
бесплатно. Поимённо — в [THANKS.md](THANKS.md).

Отдельно: **Cooler3D** — за 4IFIR и за `customize.cpp`, оказавшийся лучшей документацией
по теме; **Владислав (EbalNX)** — за форк, где перенос на Ultrahand уже работал, и за
несколько приёмов, взятых целиком; **ppkantorski** — за движок.

## Лицензии

**Проект под GPL v2** — файл `LICENSE` в корне репозитория, происхождение каждой части
расписано в `NOTICE.md`. Это осознанный выбор, а не наследование: под GPL v2 и движок,
на котором работает пакет, и вся окружающая экосистема — Atmosphère, hekate,
Switch-OC-Suite.

Генератор и карта полей — наша работа. Словари значений и часть текстов справки взяты
из пакета 4IFIR Wizard ([rashevskyv/4IFIR](https://github.com/rashevskyv/4IFIR)) — это
годами накопленное знание, которое руками не восстановить.

**Ultrahand-Overlay** распространяется под GPL v2, автор ppkantorski. Ни в этот
репозиторий, ни в наши архивы релиза он не входит — приходит со сборкой 4IFIR.

Сам разгон, `loader.kip` и прошивка 4IFIR — работа Cooler3D и авторов Switch-OC-Suite.
Здесь не содержится и не изменяется.

## Предупреждение

Разгон Nintendo Switch за пределы штатных таблиц, с изменением напряжений, может повредить
консоль. Всё на ваш риск.
