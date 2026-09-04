#!/usr/bin/env node
// generate — builds the Ultrahand package from the field map and the menu structure.
//
// In:  package/fields.json  — which fields exist, where they live, what values they take
//      package/menu.json    — where each setting sits in the menu
// Out: package/dist/        — the package, ready for switch/.packages/
//
// The key property: the footer and the write come from THE SAME map entry, so they cannot
// drift apart. That is exactly where both original packages broke (in Ebal an item writes
// to 12448 while its footer reads from 12444).
//
// Run: node scripts/generate.mjs [--clean]

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'package', 'dist')
const KIP = '/atmosphere/kips/loader.kip'

const fieldsDoc = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8'))
const menu = JSON.parse(readFileSync(join(ROOT, 'package', 'menu.json'), 'utf8'))

// Отображение «запись старого бэкапа -> смещения», выведенное из шаблонов 4IFIR Wizard.
// Нет файла — нет пункта импорта: молча собрать пакет без него лучше, чем упасть.
let IMPORT_MAP = null
try { IMPORT_MAP = JSON.parse(readFileSync(join(ROOT, 'package', 'backup-import.json'), 'utf8')).import_map } catch {}

// Версия раскладки блока CUST, под которую построена вся карта смещений. Пишется
// в паспорт каждой копии настроек и сверяется при восстановлении: смещение — это
// позиция в структуре, а не адрес поля по смыслу, поэтому копия с чужой версией
// применилась бы «успешно» и записала бы чужие значения в чужие места.
const KIPVER = fieldsDoc._meta?.kipVer
if (KIPVER === undefined) throw new Error('в fields.json нет _meta.kipVer — паспорт копии собрать не из чего')

// Тот же номер, но как его видно в самом kip: u32 little-endian по смещению CUST+4.
// Смещение именно 4, а не 0: первые четыре байта блока — это ASCII-метка `CUST`,
// по которой движок его и находит (`verify-fields.mjs:42` читает base+4). В нашей
// документации годами стояло `CUST 0 1B` — предлагавшийся щит проверял бы букву «C».
// Сравнение в движке численное и по первому байту, поэтому одного байта достаточно.
const KIPVER_HEX = KIPVER.toString(16).toUpperCase().padStart(2, '0')
const KIP_OK = `matching_hex_val_custom ${KIP} CUST 4 ${KIPVER_HEX}`

/**
 * ЗНАЧОК «УДЕРЖИВАТЬ A» — два глифа приватной области шрифта Nintendo Extended:
 * дуга-удержание и кнопка A. Пишутся сырыми символами, не escape-последовательностью:
 * разбор ini их не понимает, а файлы мы пишем в UTF-8 без метки порядка байтов.
 *
 * СТАВИТСЯ В ИМЯ ПУНКТА, А НЕ В ПОДПИСЬ. Правая колонка не годится: `;footer=` —
 * лишь начальное значение, движок переносит его в `config.ini` при первой отрисовке
 * и дальше читает оттуда. Первый же `set-footer` замораживает подпись навсегда,
 * а он есть у всех наших пунктов с удержанием.
 *
 * Приём не выдуман: так сделан штатный «Shutdown» самого движка — он не код,
 * а сгенерированный ini-файл с этими же байтами в имени секции. И так же
 * в чужом пакете Ebal (`Memory Kit/memory_hack.ini:80`).
 *
 * ВАЖНО ПРО ПОРЯДОК: у пунктов с суффиксом ревизии глиф обязан стоять ДО `?`.
 * Тег режется при отрисовке имени, а из подписи не режется никогда — `[Имя?rev - ГЛИФ]`
 * показал бы «ГЛИФ?rev».
 */
const HOLD_A = ''

/**
 * УСЛОВИЕ ВИДИМОСТИ ИЗ КАРТЫ МЕНЮ. Один ключ `visible_when`, две формы записи:
 *
 *   { offset, value }  — проверка байта в kip, как было всегда;
 *   'строка'           — произвольное условие движка, как есть.
 *
 * Вторая форма понадобилась обновлению: кнопку установки надо прятать, пока свежей
 * версии нет, а это проверка существования файла-признака, а не значения в kip.
 *
 * Почему признак ФАЙЛОМ, а не сравнением прямо в условии: движок раскрывает внутри
 * `;visibility_condition=` только общие подстановки вроде `{package_version}`,
 * а `{ini_file(...)}` — нет (`utils.hpp:5832`). Сравнить две версии в самом условии
 * невозможно, поэтому сравнивает команда, а условие лишь смотрит на её результат.
 */
const visCond = v =>
  v == null ? null
  : typeof v === 'string' ? v
  : v.offset != null ? `matching_hex_val_custom ${KIP} CUST ${v.offset} ${v.value}`
  : null

/**
 * Поля, которые несёт копия настроек. ОДИН источник для сохранения и для восстановления.
 *
 * Раньше эти два списка строились по-разному: копия — по карте, восстановление — по
 * `kipRows`, куда `read_only` не попадает. В итоге `8 Memory Timing Mode` сохранялся
 * и НИКОГДА не восстанавливался: из 90 полей возвращалось 89, и «restored» было
 * неправдой ровно на одно поле. Пункт меню и восстановление — разные вопросы: в меню
 * поля нет намеренно, но потерять его при откате хуже, чем не показать.
 */
const backupSet = (rev = null) => fieldsDoc.fields
  .filter(f => !BLACKLIST.has(f.offset) && !f.exclude_from_menu)
  .filter(f => !rev || (f.platform ?? 'both') === 'both' || f.platform === rev)

/**
 * ЯЧЕЙКИ, КОТОРЫЕ ПУНКТ ПИШЕТ ПОПУТНО СО СВОИМ ПОЛЕМ.
 *
 * Ступень андервольта GPU — это целая таблица напряжений, а не число: выбор ступени
 * переписывает 32 ячейки внутри блока CUST. Эти ячейки не поля карты — у них нет ни
 * словаря, ни имени, ни пункта меню, и в списке настроек им делать нечего.
 *
 * Но В КОПИЮ ОНИ ОБЯЗАНЫ ПОПАСТЬ. Иначе выходит так: человек выбрал ST1.5, снял копию,
 * потом переключился на ST3, потом восстановил копию — и получил не ST1.5, а то, что
 * лежало в таблице на момент восстановления. Поле 44 вернулось бы, а таблица нет.
 * Копия обязана возвращать состояние целиком, иначе она обещает больше, чем делает.
 *
 * Набор собирается ИЗ САМОЙ КАРТЫ МЕНЮ, а не задаётся списком: любой будущий пункт,
 * который начнёт писать попутные ячейки, попадёт в копию сам, без правки этого места.
 */
const SIDE_WRITES = (() => {
  const out = new Map()
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    for (const v of n.values ?? []) {
      for (const [off, hex] of Object.entries(v.writes ?? {})) {
        out.set(Number(off), { offset: Number(off), length: String(hex).length / 2, platform: n.platform ?? 'both' })
      }
    }
    Object.values(n).forEach(walk)
  }
  walk(menu.sections ?? [])
  return [...out.values()].sort((a, b) => a.offset - b.offset)
})()
const sideSet = rev => SIDE_WRITES.filter(f => !rev || f.platform === 'both' || f.platform === rev)

/**
 * Menu nodes by id, so one node can borrow data from another instead of copying it.
 * Used by `seed_from`: the ST1 seeding lists live on the curve node alone, and the
 * mode item points at them. Two copies of the same 31 values would drift apart.
 */
const MENU_BY_ID = (() => {
  const out = new Map()
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    if (typeof n.id === 'string' && !out.has(n.id)) out.set(n.id, n)
    Object.values(n).forEach(walk)
  }
  walk(menu.sections ?? [])
  return out
})()

/**
 * Number of `Fields` rows a backup of this revision carries — the same count that
 * goes into the passport as `Meta fields`. Restore compares against it to tell an
 * older copy from a current one, so both sides must come from here.
 */
const backupFieldCount = rev => backupSet(rev).length + sideSet(rev).length

/**
 * The same count for an imported copy: it carries only what the old Wizard's profile
 * had, so the number is different. Filled in by `emitImport` while the menu is walked,
 * read later by the backup manager - both from one place, so they cannot disagree.
 */
const IMPORT_FIELD_COUNT = {}

/**
 * Factory values for "Reset to defaults", built by scripts/make-factory-defaults.mjs
 * from the snapshot 4IFIR ships. Deliberately separate from the menu dictionaries —
 * see the long note at the reset section below for why.
 */
const FACTORY = JSON.parse(readFileSync(join(ROOT, 'package', 'factory-defaults.json'), 'utf8')).defaults

/**
 * HARD BLACKLIST — the generator's own guard rail.
 *
 * Offsets that both original packages present as settings while they are nothing of the
 * kind: 184…208 is eristaCpuDvfsTable (the Erista CPU frequency table), and 170 is an
 * unaligned write that clips two neighbouring points of the voltage curve.
 *
 * Why a separate check instead of relying on "no series": these offsets still carry their
 * menu/preset/backup roles inherited from the original packages in fields.json. If the
 * generator ever starts deriving roles automatically, the bug comes back. The list is the
 * last line of defence.
 */
const BLACKLIST = new Map()
try {
  const deps = JSON.parse(readFileSync(join(ROOT, 'package', 'semantics-src', 'dependencies.json'), 'utf8'))
  for (const it of deps.invalid_offsets?.items ?? []) {
    BLACKLIST.set(it.offset, `${it.actually ?? 'not a settings field'} (${it.danger ?? '?'})`)
  }
} catch { /* no dependency map yet — carry on without it */ }
const byOffset = new Map(fieldsDoc.fields.map(f => [f.offset, f]))
const bySeries = new Map()
for (const f of fieldsDoc.fields) {
  if (typeof f.series === 'string' && f.series) {
    if (!bySeries.has(f.series)) bySeries.set(f.series, [])
    bySeries.get(f.series).push(f)
  }
}

if (process.argv.includes('--clean') && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'json'), { recursive: true })

const enc = 'utf8'
const write = (rel, text) => {
  const p = join(OUT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text.replace(/\r\n/g, '\n'), enc)
}

/**
 * A file name FAT32 will accept. In the original, one help file was called
 * `pMeh 2 13331065800.txt` with a `>` in it — and never opened once.
 */
const safeName = s => s
  .replace(/[<>:"/\\|?*]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * Directory and file names: latin letters, digits and dashes only.
 *
 * Menu item titles may be anything — they live INSIDE the ini and the engine treats them
 * as plain text. File names, on the other hand, go through the console's file system and
 * the engine's path handling, where non-latin characters and typographic marks like "…"
 * are needless risk. Every directory in the working reference build is latin.
 *
 * The Cyrillic side of the table is spelled with \u escapes so this file stays pure ASCII;
 * the two rows below are the 33 lowercase Cyrillic letters and their latin counterparts,
 * in the same order.
 */
const TRANSLIT_CYR = '\u0430\u0431\u0432\u0433\u0434\u0435\u0451\u0436\u0437\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f'
const TRANSLIT_LAT = ['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya']
const TRANSLIT = Object.fromEntries([...TRANSLIT_CYR].map((c, i) => [c, TRANSLIT_LAT[i]]))
const slug = s => String(s)
  .toLowerCase()
  .split('').map(c => TRANSLIT[c] ?? c).join('')
  .replace(/[…–—]/g, '-')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  || 'section'

/** Dictionaries already written: key is directory + contents, value is the paths to them. */
const dictCache = new Map()

/**
 * Append the actual magnitude to a value name when it is missing.
 *
 * In the source packages the same field has both labelled values ("Default - 1275mv") and
 * bare ones ("Default"). On screen the bare ones read as no information at all: you see
 * "Vdd2 — Default" and have no idea how many millivolts that is. Vdd2 alone has three
 * different "Default" entries for three different voltages.
 *
 * The number comes from the hex itself: it is little-endian, and the unit comes from the
 * field map. The rule is simple — if the name already carries a magnitude, leave it alone.
 */
function withMagnitude(name, hex, field) {
  // Look for a MAGNITUDE (a number with a unit), not merely for a digit. The first version
  // checked for any digit and so skipped "Stage3 - Max": that one is 1325 mV, and in the
  // row 1300 / 1325 / 1350 / 1375 the screen had a hole in it, because two values out of
  // four were hiding behind the names "Stage3 - Max" and "Default".
  if (/\d\s*(mv|mhz|khz|v\b)/i.test(name)) return name
  const units = field.units
  if (units !== 'uV' && units !== 'mV' && units !== 'kHz') return name

  // little-endian: least significant byte first
  const bytes = hex.match(/../g) ?? []
  let n = 0
  for (let i = bytes.length - 1; i >= 0; i--) n = n * 256 + parseInt(bytes[i], 16)
  if (!n) return name

  /**
   * Is this a magnitude at all?
   *
   * Half the fields declare their unit as mV, yet values 1/2/3 mean an automatic stage
   * rather than a voltage. Without this check the screen showed "ECO ST1 — Default — 3mV",
   * where the 3 is a mode number.
   *
   * Same mistake as the one already made while reverse-engineering the source packages:
   * the unit was inferred from the field name instead of from the values. The order has to
   * be the other way round — first check whether the number looks like a physical quantity,
   * only then label it.
   */
  /**
   * The magnitude comes FIRST: "1350mV — Default", not "Default — 1350mV".
   *
   * The reason is practical. The item footer is a narrow strip on the right, and its tail
   * gets lost: the screen showed just "Default" while the dictionary held "Default — 1350mV".
   * Whether the tail was eaten by width clipping or by string parsing is more expensive to
   * find out than to simply put the number in front. This way it is always visible and
   * visible first, which is exactly what the reader needs: "Default" without a number says
   * nothing, a number without the word "Default" still says something.
   *
   * The order matches how values are labelled in the map itself ("1212.5mV - Default").
   */
  const mv = units === 'uV' ? n / 1000 : units === 'mV' ? n : null
  if (mv !== null) {
    if (mv < 300 || mv > 1600) return name        // voltages here live in the 300…1600 mV band
    return `${Math.round(mv * 10) / 10}mV — ${name}`
  }
  const mhz = Math.round(n / 1000)
  if (mhz < 100 || mhz > 4000) return name         // clocks are hundreds and thousands of MHz
  return `${mhz}MHz — ${name}`
}

/**
 * КОРОТКАЯ ПОДПИСЬ — то, что человек ВЫБРАЛ, без пояснений рядом.
 *
 * Подписи доноров составные: `650 mV — DEFAULT`, `2 — ECO ST1`, `2707MHz — 2707`,
 * `Auto — Eco ST3`, `eBamatic — Default (automatic)`. В СПИСКЕ ВЫБОРА это ценно — там
 * человек сравнивает варианты и пояснение помогает. Там, где показано УЖЕ ВЫБРАННОЕ
 * (сводка, предпросмотр копии, футер пункта), пояснение только мешает: строка длинная,
 * полоса узкая, а второе слово ничего не добавляет к первому.
 *
 * Правило: берём первую часть, а если она — слово-заполнитель, следующую за ним.
 * `Auto` и `Default` сами по себе выбором не являются: за ними всегда стоит настоящее имя
 * (`Auto — Eco ST3` → `Eco ST3`), а вот `eBamatic — Default (automatic)` начинается
 * с настоящего имени, и брать надо его (`eBamatic`).
 *
 * Решение оператора 02.09.2026. Сознательная цена: вместе с дописками уходят и полезные
 * пометки — профиль у `EMC Balance` и `EBA-Shift`, метка ступени у частоты памяти,
 * `DEBUG` у двух частот процессора. Всё это остаётся в СПИСКЕ, где и нужно.
 */
function shortLabel(name) {
  const parts = String(name).split(' — ').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return name
  for (const p of parts) if (!/^(auto|default|automatic)$/i.test(p)) return p
  return parts[0]
}

/**
 * ТОЧКИ КРИВОЙ GPU ПОКАЗЫВАЮТСЯ ВЫЧИСЛЕНИЕМ, А НЕ СЛОВАРЁМ.
 *
 * ПОЧЕМУ. У каждой точки был свой словарь подписи — полоса ±75 мВ вокруг ЗАВОДСКОГО
 * содержимого ячейки. Но заводской массив это грубая линейка (395 мВ на 307 МГц,
 * 1020 мВ на 1190 МГц), а настоящая кривая идёт куда положе, и к верхним точкам
 * расходится с ней на 270 мВ. Всё, что вне полосы, показывалось как «Not available».
 * У живого пользователя так пропали ПЯТНАДЦАТЬ строк из тогдашних двадцати четырёх
 * (кривая с 04.09.2026 — 31 точка, NOTES №232) — при том,
 * что значения в kip лежали правильные и читались.
 *
 * Словарь отвечает на вопрос «что мы предлагаем ВЫСТАВИТЬ», и полоса там уместна.
 * Подпись отвечает на «что лежит в ячейке», а туда могли записать что угодно — чужим
 * конфигуратором, KIP tool, импортом. Заранее перечислить это нельзя в принципе,
 * поэтому подпись обязана СЧИТАТЬСЯ.
 *
 * ЧТО ЧИТАЕМ. Обе ревизии читают ТРИ БАЙТА — этого хватает и на милливольты Mariko
 * (485 = 0x0001E5), и на микровольты Erista (675000 = 0x0A4CB8). У Erista ячейка
 * в карте длиной 24 байта: это весь хвост записи DVFS, и такой она обязана остаться,
 * потому что ею же ВОССТАНАВЛИВАЮТ копию. Для показа берём из неё первые три байта.
 *
 * ГЛУБИНА. Движок раскрывает вложенные подстановки без ограничения и всегда изнутри
 * наружу (`replacePlaceholdersRecursivelyImpl`, форк `utils.hpp`). Цепочка глубиной
 * четыре внутри `;mode=table` работает у донора Ebal годами (`backup.ini:74`, `:180`),
 * а чтение `hex_file` внутри таблицы работает у нас. СТЫКА этих двух приёмов до сих
 * пор не было ни в одном живом пакете — здесь он появляется впервые.
 */
const CURVE_SERIES = new Set(['gpu_curve_mariko', 'gpu_curve_erista'])
const isCurve = r => CURVE_SERIES.has(r.series)

/** Три байта значения: из kip напрямую, из копии — первые три байта ячейки. */
const curveCell = (r, fromIni) => fromIni
  ? (r.len > 3 ? `{slice({ini_file(Fields,${r.offset})},0,6)}` : `{ini_file(Fields,${r.offset})}`)
  : `{hex_file(CUST,${r.offset},3)}`

/**
 * ПРОЧЕРК СТАВИТСЯ ТОЛЬКО ТАМ, ГДЕ ОТСУТСТВИЕ — НОРМА.
 *
 * Живой kip несёт значение всегда: страница видна только когда файл на месте
 * и затвор совпал. А импортированная из старого визарда копия части полей не несёт —
 * их не было в его формате. Там `ini_file` отдаёт `null`, и это не сбой, а «нет данных»
 * (решение оператора 31.08.2026, NOTES №211).
 *
 * Без обёртки такая строка показала бы `0 mV`: цепочка съедает слово `null` молча —
 * переворот даёт `llnu`, превращение в число даёт ноль. Ноль в ячейке кривой значением
 * не бывает, но отличить его от «не прочиталось» человек не смог бы.
 */
const curveValue = (r, fromIni) => {
  const n = `{hex_to_decimal({hex_to_rhex(${curveCell(r, fromIni)})})}`
  // Mariko хранит милливольты как есть, Erista — микровольты. `,true` отбрасывает
  // дробную часть: решение оператора 03.09.2026, четверть милливольта на экране не нужна.
  const mv = r.series === 'gpu_curve_erista' ? `{math(${n}/1000,true)}` : n
  return fromIni
    ? `{if_==({ini_file(Fields,${r.offset})},null,—,${mv} mV)}`
    : `${mv} mV`
}

/**
 * КОРОТКАЯ ПОДПИСЬ ТОЧКИ КРИВОЙ СЧИТАЕТСЯ ТАК ЖЕ, КАК ЕЁ ПОКАЗ.
 *
 * Подпись под пунктом приходит из ДВУХ мест: при открытии раздела её пишет родитель
 * вычислением, а сразу после выбора значения — сам пункт, из ключа `short` своего списка.
 * Разойдись эти два текста — пункт менял бы подпись при первом же касании и возвращал
 * прежнюю при следующем открытии оверлея. Ровно этот дефект мы ловили 02.09.2026
 * на другом поле, и тогда ключ `short` для того и заводился.
 *
 * У Mariko тексты и так совпадали («320 mV» с обеих сторон), а у Erista расходились
 * дважды: список хранит «612.5mV» — без пробела и с половинкой, — тогда как вычисление
 * даёт «612 mV». Половинка теряется намеренно (решение оператора 03.09.2026): `{math}`
 * умеет либо целое, либо две цифры после точки, и «612.50» хуже, чем «612».
 */
function curveShort(hex, field) {
  // Три байта с начала ячейки — столько же читает показ. У Erista дальше лежит хвост
  // записи DVFS, и брать его в число нельзя.
  const bytes = String(hex).slice(0, 6).match(/../g) ?? []
  let n = 0
  for (let i = bytes.length - 1; i >= 0; i--) n = n * 256 + parseInt(bytes[i], 16)
  return `${field.units === 'uV' ? Math.trunc(n / 1000) : n} mV`
}

/** Normalise hex to the field length: dictionaries store both `01` and `010000`. */
function padHex(hex, lenBytes) {
  const h = (hex ?? '').toUpperCase().replace(/[^0-9A-F]/g, '')
  if (!h) return null
  const need = lenBytes * 2
  if (h.length === need) return h
  if (h.length < need) return h + '0'.repeat(need - h.length)   // pad with zeros on the right (LE)
  return h.slice(0, need)
}

/**
 * ОТСТУП НАД ЗАГОЛОВКОМ ГРУППЫ — ОДНО ЧИСЛО НА ВЕСЬ ГЕНЕРАТОР.
 *
 * Заголовок группы («CPU», «GPU», «RAM») отбивается сверху пустой таблицей-распоркой:
 * ключ `;gap=` отводит место ПОД своей секцией, а рамка рисуется вокруг секции целиком,
 * поэтому отступ приходится делать отдельной секцией, а не ключом внутри заголовка.
 *
 * Было 14 и смотрелось перекошенно: снизу от черты до таблицы место заметно больше,
 * чем сверху до предыдущей рамки, и черта казалась приклеенной к ней. Оператор увидел
 * это на снимке экрана 29.08.2026. Значение подобрано на глаз по фотографии консоли —
 * измерить его иначе нечем, поэтому оно и вынесено сюда: подкручивается в одном месте,
 * а не в десяти.
 */
const HEAD_GAP = 22

const stats = { items: 0, dicts: 0, bootLines: 0, guards: 0, infoBlocks: 0, actions: 0, resetFields: 0, packages: 0, skipped: [], blocked: [] }

/** The dependency map — the source of warnings that neither original package ever gave. */
let DEPS = null
try { DEPS = JSON.parse(readFileSync(join(ROOT, 'package', 'semantics-src', 'dependencies.json'), 'utf8')) } catch {}

/**
 * Collect everything the reader needs to know about this field but was never told in the
 * original. Returns short lines for the help table.
 */
function warningsFor(offset, plat) {
  if (!DEPS) return []
  const out = []
  const n = Number(offset)

  /**
   * РЕВИЗИЯ ОТСЕИВАЕТСЯ ЗДЕСЬ, А НЕ ТОЛЬКО У САМИХ ПУНКТОВ.
   *
   * Одно смещение обслуживают ДВА пункта, по одному на ревизию, и в карте связей у него
   * тоже две записи с пометкой `platform`. Раньше отбор шёл по одному номеру смещения,
   * и мариковская подсказка «Set to Custom Table to enable the voltage curve» печаталась
   * на ЭРИСТОВСКОМ экране — где ни `Custom Table`, ни ворот не существует вовсе: там
   * поле работает множителем, а кривая правится всегда.
   *
   * Запись без пометки платформы годится обеим — таких большинство.
   */
  const forThis = sw => !sw.platform || !plat || plat === 'both' || sw.platform === plat

  // The tuner's interface is English only — a deliberate choice for an international audience.
  //
  // TEXT RULE, derived from the Ebal reference and from what the operator saw on the console:
  // the hint speaks to a person, not to a debugger. No offsets, no internal identifiers
  // (`gpu_curve_mariko`), no lists like "Linked with offsets 44, 5424, 5480, …" — such a line
  // filled half the screen and said nothing. The phrase is built from roles, not addresses,
  // and fits in one or two screen lines.
  // The interface is English while the dependency map was written in Russian. Value names are
  // taken from it, and one of them leaked onto the screen half-translated:
  // "Set to <russian word> Optimized E = 1331". Any phrase containing Cyrillic is dropped
  // instead — better to say nothing than to show half a sentence in the wrong language.
  const push = s => {
    const t = String(s ?? '').trim()
    if (t && !/[\u0400-\u04FF]/.test(t)) out.push(t)
  }

  // The field is gated by a switch — without it, editing the field does nothing.
  for (const sw of (DEPS.switches ?? []).filter(forThis)) {
    for (const en of sw.enables ?? []) {
      if ((en.offsets ?? []).includes(n)) {
        const label = (sw.values ?? {})[en.when] ?? en.when
        push(`Needs ${sw.name} = ${label}`)
      }
    }
    if (sw.offset === n && sw.kind === 'gate') {
      // WHAT the gate unlocks comes from the map, it is not hardcoded here. It used to be
      // the literal phrase "to enable the voltage curve", which is true for offset 44
      // (GPU Undervolt Mode really does gate the 24-point curve) and false for sMeh 16,
      // which gates pMeh 2 — a frequency, not a curve. Nobody noticed for months because
      // the sMeh 16 line carried a Cyrillic label and the guard below dropped the whole
      // phrase before it reached the screen. Translating the map made the wrong text visible.
      const enabled = (sw.enables ?? [])[0]
      if (enabled && sw.unlocks) push(`Set to ${(sw.values ?? {})[enabled.when] ?? enabled.when} to enable ${sw.unlocks}`)
    }
    if (sw.value_constraint && (sw.enables ?? []).some(e => (e.offsets ?? []).includes(n))) {
      push('Stay within 75 mV of the Eco ST2 curve, step 5 mV')
    }
  }

  // Paired switch: both fields have to be zero.
  for (const p of [DEPS.paired_switches].flat().filter(Boolean)) {
    if ((p.offsets ?? []).includes(n)) {
      push(`${p.name} turns on only when both undervolt fields are zero`)
      if (p.scale_note) push('Scale is not linear: 1 / 3 / 5 = Eco ST1 / ST2 / ST3')
    }
  }

  // Arithmetic: what matters is THAT values are summed, not the addresses of the operands.
  for (const a of DEPS.arithmetic_links ?? []) {
    if ((a.inputs ?? []).includes(n) || a.target === n) {
      const src = a.source_text ? String(a.source_text).trim() : ''
      push(/^[\x20-\x7E]{1,40}$/.test(src)
        ? `Combined inside the kip: ${src}`
        : 'This value is combined with a related field inside the kip')
    }
  }

  // Conflicts and corruption. The second offset is not always known (b = null in 12 of the
  // 20 entries), so the phrase must not lean on it — otherwise you get "conflicts with offset"
  // trailing off into nothing.
  // Не всякий `kind` — про нашего пользователя. Часть записей описывает дефекты
  // ДОНОРСКИХ пакетов: `missing_file` — пресеты Ebal ссылаются на файлы, которых
  // в поставке нет; `wrong_platform` — «таблица Erista» у Ebal пишет в массив Mariko;
  // `mislabeled_write` и `double_write` — их же промахи в микроP.ini. У нас этих
  // дефектов нет по построению, а на экране они превращались в угрозу без причины:
  // на «Undervolt Mode» висело «WARNING: conflicts with 307MHz» ровно из такой записи.
  // Правило проекта: чужое предостережение не переносится, переносится факт.
  const DONOR_ONLY = new Set(['missing_file', 'wrong_platform', 'mislabeled_write',
                              'double_write', 'version_drift', 'undocumented_danger'])
  for (const c of DEPS.conflicts ?? []) {
    if (c.a !== n && c.b !== n) continue
    if (c.severity !== 'critical' && c.severity !== 'high') continue
    if (DONOR_ONLY.has(c.kind)) continue
    const other = c.a === n ? c.b : c.a
    // Порча несимметрична: `a` — тот, кто портит, `b` — пострадавший. Предупреждение
    // висело на обоих, и пользователь читал «запись сюда портит соседние данные»
    // на совершенно безопасной точке кривой 1075MHz (168), тогда как факт — про
    // невыровненную запись по адресу 170, которую пакет не делает никогда:
    // 170 в чёрном списке. Пугали за то, чего не происходит.
    if (c.kind === 'corruption') { if (c.a === n) push('WARNING: writing here damages neighbouring data') }
    else if (c.kind === 'range_disagreement') push('WARNING: sources disagree on the safe limit — raise slowly')
    // Что именно случится и с чем именно — по названию, а не намёком. Раньше все эти
    // случаи схлопывались в одну фразу «conflicts with another setting in this menu»:
    // она стояла на двенадцати пунктах, ни разу не называла вторую настройку и не
    // различала «полосы на экране» и «повредит emuNAND». Это ровно та «чужая
    // страшилка вместо факта», которую проект запретил тащить от доноров.
    else {
      const withWhom = other != null && byOffset.get(other)?.name ? ` — with ${byOffset.get(other).name}` : ''
      if (c.kind === 'hardware_damage') push(`DANGER: too low a value can damage the emuNAND${withWhom}`)
      else if (c.kind === 'data_corruption') push(`DANGER: excessive values corrupt data and give artifacts${withWhom}`)
      else if (c.kind === 'no_boot') push(`WARNING: some memory chips will not boot at this pair${withWhom}`)
      else if (c.kind === 'visual_artifact') push('WARNING: can make the docked screen stripe')
      else if (withWhom) push(`WARNING: conflicts${withWhom}`)
      else push('WARNING: known to cause problems at non-default values')
    }
  }

  return [...new Set(out)]
}

/** Break a long line into chunks that fit the narrow overlay screen. */
function wrap(s, width = 40) {
  const words = String(s).split(/\s+/)
  const rows = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) rows.push(cur); cur = w }
    else cur = (cur ? cur + ' ' : '') + w
  }
  if (cur) rows.push(cur)
  return rows
}
/** Section names already taken — [boot] addresses footers by name, so duplicates overwrite. */
const usedTitles = new Set()

/** Directory of the current sub-package: its dictionaries go there, so paths stay local. */
let currentDir = ''

// ---------------------------------------------------------------- dictionaries

/**
 * Two dictionaries per field, because the engine reads them in two different ways:
 *   list — for the selector: [{name, hex}]           → json_file_source
 *   map  — for the footer:   {"<hex>": "<name>"}     → json_file + {json_file(0,<hex>)}
 */
function emitDicts(field, base, valuesOverride = null, probeLen = null) {
  const len = field.length ?? 3
  const list = []
  const map = {}
  const seen = new Set()
  /**
   * ДОПОЛНИТЕЛЬНЫЕ ЗАПИСИ У ЗНАЧЕНИЯ.
   *
   * Обычный пункт пишет одно число в одно смещение. Ступени андервольта GPU так не умеют:
   * ступень — это не число, а ЦЕЛАЯ ТАБЛИЦА напряжений внутри блока CUST, и промежуточной
   * ступени в прошивке нет. Значит пункт должен записывать за один выбор и номер режима,
   * и всю таблицу — 32 значения.
   *
   * Движок это позволяет: `json_file_source(*,КЛЮЧ)` резолвит ПРОИЗВОЛЬНЫЙ ключ выбранного
   * элемента (обобщённый обходчик пути в utils.hpp), а не только `name` и `hex`. Поэтому
   * значение может нести `writes: { "<смещение>": "<hex>" }`, и генератор разворачивает их
   * в отдельные команды записи, по одной на смещение.
   */
  const seenInMap = new Set()
  const extra = new Set()
  for (const v of valuesOverride ?? field.values ?? []) for (const off of Object.keys(v.writes ?? {})) extra.add(Number(off))
  const extraOffsets = [...extra].sort((a, b) => a - b)
  for (const v of valuesOverride ?? field.values ?? []) {
    const hex = padHex(v.hex, len)
    if (!hex) continue
    // Deduplicate AFTER padding to the field length: source dictionaries store the same
    // value both as `01` and as `010000`, often under different names ("Stage 1" and
    // "Stage1 - Min"). Without this the menu grows duplicates — which is what the operator
    // saw on the console.
    // Ключ дедупликации — не только hex. Три ступени GPU пишут в поле режима один и тот же
    // код `01` и различаются ТОЛЬКО содержимым таблицы: по одному hex они схлопнулись бы,
    // и из пяти ступеней в списке осталось бы три.
    const dedup = v.writes ? `${hex}|${JSON.stringify(v.writes)}` : hex
    if (seen.has(dedup)) continue
    seen.add(dedup)
    // the engine splits the name at " - ": the left part becomes the item, the right the footer
    const name = withMagnitude((v.name ?? hex).replace(/\s+-\s+/g, ' — ').replace(/(\d),(\d)/g, '$1.$2'), hex, field)
    // СЛОВАРЬ ВЫБОРА И СЛОВАРЬ ПОДПИСИ — РАЗНЫЕ ВОПРОСЫ, И ЭТО НЕ ПЕДАНТИЗМ.
    //
    // `not_in_menu` убирает значение из СПИСКА, но оставляет в ПОДПИСИ. Список отвечает
    // «что мы предлагаем выбрать», подпись — «что мы умеем прочитать». Значение может
    // стоять в kip, поставленное чужим пакетом или прежней версией нашего, и тюнер
    // обязан назвать его, а не печатать «недоступно»: показ — это правда о железе,
    // а не рекомендация.
    // КЛЮЧ ПОДПИСИ. Обычно это само значение поля. Но когда ступени различаются не полем,
    // а таблицей, одного поля мало: `probeLen` включает составной ключ — значение поля
    // плюс контрольная ячейка таблицы, склеенные подряд. Ровно так же его собирает и
    // движок, читая две ячейки в одной подстановке.
    map[probeLen ? hex + padHex(v.writes[String(probeLen.offset)], probeLen.len) : hex] = shortLabel(name)
    seenInMap.add(hex)
    if (v.not_in_menu) continue
    const short = CURVE_SERIES.has(field.series) ? curveShort(hex, field) : shortLabel(name)
    if (!extraOffsets.length) { list.push({ name, short, hex }); continue }
    // Пропущенный ключ движок молча превращает в `null`, а запись с `null` так же молча
    // не выполняется — пункт при этом покажет галочку. Поэтому недостающее смещение это
    // ошибка сборки, а не повод подставить ноль: половина таблицы осталась бы от прошлой
    // ступени, и получилась бы кривая, которой никто не выбирал.
    // `short` — та же подпись без дописок, для футера. Полное имя остаётся в `name`
    // и показывается в списке выбора.
    //
    // Ключ обязан быть у КАЖДОЙ записи, даже когда он равен `name`: движок, не найдя
    // ключа, печатает `null`. Лишние ~60 КБ на пакет — цена того, чтобы футер не менял
    // текст при первом касании пункта.
    const row = { name, short, hex }
    for (const o of extraOffsets) {
      const val = v.writes?.[String(o)]
      if (!val) throw new Error(`значение «${name}» поля ${field.offset} не задаёт запись в смещение ${o}`)
      row[`w${o}`] = val
    }
    list.push(row)
  }
  // ПОРЯДОК В СПИСКЕ = ПОРЯДОК НА ЭКРАНЕ. Словари собраны слиянием двух доноров, и у
  // четырнадцати полей ряды идут вразнобой: у точек кривой Mariko блок 550…595 вклинен
  // ПОСЛЕ 800, у `12344 GPU Max Voltage` «1050 mV — Default» стоит выше всех значений,
  // подписанных «Caution». Человек листает и не понимает, кончился ряд или нет.
  //
  // Сортируем только там, где шкала числовая и однонаправленная: mV, uV, kHz. Служебные
  // пункты без числа в подписи (`eBamatic`, ступени) остаются сверху в исходном порядке —
  // они не часть ряда.
  //
  // `mV_offset` ИСКЛЮЧЁН НАМЕРЕННО: там подписи это смещения со знаком (+20…−35), и ряд
  // уже упорядочен по смыслу, а сырое значение идёт FD, FE, FF, 00, 01 — по возрастанию
  // подписи он бы перевернулся.
  const SORTABLE = new Set(['mV', 'uV', 'kHz'])
  if (SORTABLE.has(field.units)) {
    const num = n => {
      const m = String(n).match(/(-?\d+(?:\.\d+)?)\s*(mV|MHz|kHz|uV)/i)
      return m ? parseFloat(m[1]) : null
    }
    const plain = list.filter(v => num(v.name) === null)
    const scale = list.filter(v => num(v.name) !== null).sort((a, b) => num(a.name) - num(b.name))
    list.length = 0
    list.push(...plain, ...scale)
  }

  /**
   * СЛОВАРЬ ПОДПИСИ ОБЯЗАН ОСТАВАТЬСЯ ПОЛНЫМ, ДАЖЕ КОГДА ВЫБОР СУЖЕН.
   *
   * Постоянное решение оператора: значение, уже стоящее в kip, тюнер обязан НАЗВАТЬ.
   * Список отвечает на «что предлагаем выбрать», подпись — на «что умеем прочитать»,
   * и это разные вопросы (ANCHORS факт 12, NOTES №164).
   *
   * Когда карта меню задаёт пункту свой ряд — например у `Max Voltage`, расщеплённого
   * по ревизиям, — этот ряд ОГРАНИЧИВАЕТ выбор, но не должен ограничивать чтение:
   * иначе владелец Erista, поставивший 800 мВ нашей же прежней сборкой, увидит от неё
   * «недоступно» вместо своего числа. Поэтому в карту подписи доливается полный ряд
   * из карты полей.
   *
   * Исключение — составной ключ (`label_probe`): там подпись адресуется парой ячеек,
   * и плоские ключи из карты полей ей всё равно не встретятся. Доливать их значило бы
   * набивать словарь строками, которые не совпадут никогда.
   */
  if (valuesOverride && !probeLen) {
    for (const v of field.values ?? []) {
      const hex = padHex(v.hex, len)
      if (!hex || seenInMap.has(hex)) continue
      seenInMap.add(hex)
      map[hex] = shortLabel(withMagnitude((v.name ?? hex).replace(/\s+-\s+/g, ' — ').replace(/(\d),(\d)/g, '$1.$2'), hex, field))
    }
  }

  if (!list.length) return null
  const dir = currentDir ? `${currentDir}/json` : 'json'

  /**
   * СОСТАВНОЙ КЛЮЧ: ПОКРЫВАЕМ ВСЕ ДОСТИЖИМЫЕ ПАРЫ, А НЕ ТОЛЬКО ПРЕДЛАГАЕМЫЕ.
   *
   * Ступени различаются парой «режим + первая ячейка таблицы», и пар из меню шесть.
   * Но достижимых состояний двенадцать: сброс к заводским пишет режим и НЕ трогает
   * таблицу, значит после сброса из половинчатой ступени получается пара, которой
   * в меню нет никогда. То же даёт правка через KIP tool в hekate.
   *
   * Непокрытая пара — это «null» на экране, то есть прямое нарушение постоянного решения
   * «словарь названий не сужается никогда». Достраиваем все сочетания.
   *
   * Имя берётся ПО СМЫСЛУ: содержимое таблицы важно только в режиме, который её читает.
   * В остальных режимах прошивка читает другую таблицу, и ступень называется по режиму,
   * что бы ни лежало в рабочей.
   */
  let flatMap = null
  if (probeLen) {
    const byMode = new Map()          // режим -> имя ступени, которая читает СВОЮ таблицу
    const probes = new Set()
    for (const v of valuesOverride ?? field.values ?? []) {
      const hex = padHex(v.hex, len)
      const pr = padHex(v.writes?.[String(probeLen.offset)], probeLen.len)
      if (!hex || !pr) continue
      probes.add(pr)
      // «Своя» — та, что не половинчатая: половинчатые живут в чужом слоте.
      // Тире как у всех остальных подписей: иначе одна и та же ступень называется
      // на разных экранах через дефис и через тире, и это читается как две разные.
      const nm = shortLabel(String(v.name).replace(/\s+-\s+/g, ' — '))
      if (!byMode.has(hex) || !/\d\.\d/.test(v.name)) byMode.set(hex, nm)
    }
    for (const [hex, name] of byMode) {
      for (const pr of probes) if (map[hex + pr] === undefined) map[hex + pr] = name
    }
    // Плоский словарь для источников, где второй ячейки нет вовсе (заводской набор).
    const flat = {}
    for (const [hex, name] of byMode) flat[hex] = name
    write(`${dir}/${base}.flat.json`, JSON.stringify([flat], null, 2))
    stats.dicts++
    flatMap = `./${dir}/${base}.flat.json`
  }


  /**
   * One dictionary for every point of a series, instead of a copy per point.
   *
   * ⚠ ПРИМЕР НИЖЕ УСТАРЕЛ ДВАЖДЫ, и это стоит знать, прежде чем на него опираться.
   * Во-первых, у точек кривой словари давно РАЗНЫЕ: каждый список — своя полоса вокруг
   * своего заводского значения, так что кэш на них не срабатывает ни разу. Во-вторых,
   * с 03.09.2026 у кривой нет словаря показа вовсе — подпись считается. Механизм ниже
   * работает и нужен, но его единственный пример в комментарии исчез.
   *
   * The voltage curve has 31 points, and their value dictionary is THE SAME one — a set of
   * voltages. That used to mean one identical file and one `json_file` declaration per point.
   * Every declaration is a file open on the SD card, and opening the package waits for all
   * of them. Deduplication is by content: identical dictionaries are written once and reused.
   */
  const key = `${dir}|${JSON.stringify(list)}`
  const hit = dictCache.get(key)
  if (hit) return hit
  write(`${dir}/${base}.json`, JSON.stringify(list, null, 2))
  // The footer dictionary is an ARRAY holding one object: `json_file(0, key)` takes the
  // element at index 0, not a field of an object. A plain object is not read here at all —
  // which is why every footer in the menu used to be empty ("...").
  // ПРОЧЕРК ВМЕСТО «NOT AVAILABLE». Если значения для строки нет, движок сперва ищет
  // в словаре запасной ключ `null` и подставляет его текст; не найдя — печатает `null`,
  // а таблица превращает это в `Not available` (`utils.hpp:2511-2517`, `:1372`).
  //
  // Строка без значения — не поломка, а норма в одном месте: копия, импортированная из
  // старого визарда, части полей не несёт, потому что их не было в его формате. На экране
  // это выглядело как отказ, хотя отказывать нечему. Решение оператора — ставить прочерк:
  // строка перестаёт кричать, а почему пусто, сказано в примечании под сводкой.
  //
  // Оговорка на будущее: подмена гасит `Not available` ВЕЗДЕ, в том числе там, где оно
  // означало бы настоящий сбой чтения. Различить эти два случая средствами пакета нельзя —
  // движок в обоих отдаёт один и тот же `null`.
  // СЛОВАРЬ ПОКАЗА ТОЧКЕ КРИВОЙ БОЛЬШЕ НЕ ПИШЕТСЯ — её подпись считается (`curveValue`).
  //
  // Файл, который никто не читает, — не безобидный лишний байт. Он выглядит источником
  // правды, его находит поиск, на него ссылаются сторожа, и однажды кто-то поверит,
  // что подпись берётся оттуда. Пятьдесят три таких файла весили 44 КБ и открывались
  // при каждом входе в раздел GPU, пока объявления не убрали.
  //
  // Список выбора (`${base}.json`) остаётся: он отвечает на другой вопрос — что можно
  // ВЫСТАВИТЬ, — и полоса ±75 мВ живёт именно там.
  const curveDict = CURVE_SERIES.has(field.series)
  if (!curveDict) write(`${dir}/${base}.map.json`, JSON.stringify([{ null: '—', ...map }], null, 2))
  stats.dicts += curveDict ? 1 : 2
  // Two paths to the same footer dictionary:
  //   map     — relative to the sub-package directory (the item reads it itself)
  //   mapRoot — relative to the package root: [boot] runs ONLY at the root (see emitPackage)
  const out = {
    extraOffsets,
    flatMap,
    list: `./json/${base}.json`,
    map: `./json/${base}.map.json`,
    mapRoot: `./${dir}/${base}.map.json`,
    dir: currentDir,
    len,
  }
  dictCache.set(key, out)
  return out
}

// ---------------------------------------------------------------- items

const bootLines = []
/** Last dictionary declared in [boot] — so we do not declare it twice in a row. */
let lastBootMap = null
/**
 * [boot] lines of every sub-package, in menu traversal order.
 *
 * The idea of "a boot file per section" does not work: the engine runs boot_package.ini only
 * for the top-level package, and entering a section through package_source does not count as
 * opening a package. So there is a single file, but every line addresses the config.ini of
 * its own section.
 */
const allBoot = []
/**
 * Rows of the "Current Settings" summary page — what is in loader.kip right now.
 *
 * Neither source package had such a page: you could only see a value by opening the item that
 * owned it. The format is modelled on `Ebal Tuner/info_4IFIR.ini`: `;mode=table`, where the
 * value is substituted straight from the kip into the cell as the page is drawn.
 */
const kipRows = []

/**
 * АДРЕСА ТРЁХ ТАБЛИЦ СТУПЕНЕЙ — для сводки, которая показывает действующую кривую.
 *
 * Не вписываются числами: берутся из того же `scan_guard`, что кладёт в карту скрипт
 * ступеней, а он читает их из живого kip. Базы стоят через равные промежутки, и промежуток
 * равен ёмкости таблицы — поэтому соседние выводятся из той, куда пишут ступени.
 * Нет ступеней в карте — нет и блока: сводка тогда показывает только редактируемый массив,
 * как было раньше.
 */
const curveTables = (() => {
  let g = null
  let rows = null
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    if (n.scan_guard && (n.values ?? []).length) { g = n.scan_guard; rows = n.curve_rows ?? null }
    Object.values(n).forEach(walk)
  }
  walk(menu.sections ?? [])
  if (!g) return null
  const slot = g.base - 32, span = g.step * 31

  /**
   * СЛОВАРЬ ПОДПИСЕЙ ДЛЯ НАПРЯЖЕНИЙ ТАБЛИЦ — микровольты в милливольты.
   *
   * Не вычислением, а словарём, и это осознанный выбор. Вычислением вышла бы цепочка
   * из четырёх подстановок: прочитать байты, перевернуть их, превратить в число, поделить
   * на тысячу. Трёхуровневая цепочка в пакете живёт и работает, четырёхуровневой нет нигде,
   * и проверять её на живой консоли дорого.
   *
   * Словарь же — это ровно тот механизм, которым пакет показывает ВСЕ свои значения:
   * прочитали четыре байта, нашли строку. Один файл на все 72 строки трёх таблиц.
   *
   * Диапазон с запасом: напряжения таблиц лежат в 445000…960000, берём 400000…1000000
   * с шагом 5 мВ. Значение вне сетки покажется как «недоступно» — и это правда о железе,
   * а не поломка: таких значений прошивка в таблицах не держит.
   */
  const map = {}
  for (let uv = 400000; uv <= 1000000; uv += 5000) {
    const b = Buffer.alloc(4); b.writeUInt32LE(uv)
    map[b.toString('hex').toUpperCase()] = `${uv / 1000} mV`
  }
  /**
   * ПОТОЛОК ЖИВЁТ В ТОМ ЖЕ СЛОВАРЕ, ЧТО И НАПРЯЖЕНИЯ. Двух словарей в одной таблице
   * не бывает: объявление `json_file` — это КУРСОР, следующее перебивает предыдущее,
   * а первый аргумент `json_file(0,…)` — индекс внутри файла, не номер объявления.
   * Значит подпись потолка обязана лежать там же, где милливольты.
   *
   * Столкнуться они не могут: напряжения таблиц не выходят за 1 000 000 (микровольты),
   * потолки начинаются от 1 459 200 (килогерцы). Диапазоны не пересекаются.
   */
  /**
   * ПОТОЛОК ЛЕЖИТ В СЛОВАРЕ ДВАЖДЫ — четырьмя байтами и восемью, и это не дубль.
   *
   * Ячейка потолка ВОСЬМИБАЙТОВАЯ (`SIDE_WRITES` берёт длину из самой карты: `10544`
   * там записан шестнадцатью знаками). Сводка читает её живьём и берёт только младшие
   * четыре — `{hex_file(CUST,10544,4)}`. А копия хранит ячейку целиком, как записана,
   * и `{ini_file(Fields,10544)}` возвращает все восемь байт.
   *
   * Один и тот же потолок приходит в словарь двумя разными строками, смотря откуда
   * читали. Обрезать вторую подстановкой можно (`{slice(...)}` в пакете уже есть), но
   * это лишний уровень вложенности на каждой странице; ключ в словаре стоит ничего.
   */
  for (const khz of rows?.ceilings ?? []) {
    const b = Buffer.alloc(4); b.writeUInt32LE(khz)
    const hex = b.toString('hex').toUpperCase()
    map[hex] = `${khz / 1000} MHz`
    map[hex + '00000000'] = `${khz / 1000} MHz`
  }
  // ПРОЧЕРК ВМЕСТО «NOT AVAILABLE» — как и во всех остальных словарях подписей.
  //
  // Этот словарь единственный собирается отдельным кодом, и ключ `null` в него не попадал:
  // решение оператора от 31.08.2026 исполнялось в общем сборщике словарей, а сюда просто
  // не дошло. Найдено аудитом 01.09.2026.
  //
  // Именно здесь пропуск и был заметнее всего: этим словарём подписана таблица ступеней
  // на второй странице копии, а импортированная копия части строк не несёт — старый
  // формат их не хранил. То есть до трёх десятков строк показывали «Not available» там,
  // где отсутствие значения является нормой.
  write('json/dvfs_uv.map.json', JSON.stringify([{ null: '—', ...map }], null, 2))
  stats.dicts++

  return {
    step: g.step,
    map: './json/dvfs_uv.map.json',
    // Подписи берутся у САМОЙ ТАБЛИЦЫ — все 31 строка, — а не у группы меню: сводка
    // не должна зависеть от того, сколько точек группа выдала на экран. Пока их было
    // 24, разгонный конец кривой (1228…1420 МГц плюс потолок) не показывался вовсе.
    labels: (rows?.khz ?? []).map(k => `${Math.floor(k / 1000)}MHz`),
    modes: [
      { hex: '00', base: slot - span, name: 'Eco ST1' },
      { hex: '01', base: slot,        name: 'Eco ST2 group' },
      { hex: '02', base: slot + span, name: 'Eco ST3' },
    ],
  }
})()
/**
 * ЗАВОДСКОЕ СОДЕРЖИМОЕ РАБОЧЕЙ ТАБЛИЦЫ — ВЫВОДИТСЯ, А НЕ ПЕРЕЧИСЛЯЕТСЯ.
 *
 * Четыре ступени из шести (ST1, ST2, ST3, Custom Table) пишут в @8864 побайтово одно
 * и то же — заводскую таблицу. Им своя кривая не нужна: режим 0 читает @7128, режим 2 —
 * @10600, режим 3 — массив @88, и рабочий слот они просто ВОЗВРАЩАЮТ в исходное
 * состояние. Половинчатые ступени — единственные, кто его переписывает.
 *
 * Значит «заводская таблица» — не функция режима, а одна константа, и её можно вывести
 * из самой карты: сгруппировать наборы `writes` по содержимому и взять большинство.
 * Списком её задавать нельзя — список разойдётся с картой молча.
 */
const stockTable = (() => {
  const groups = new Map()
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    for (const v of n.values ?? []) {
      if (!v.writes) continue
      const k = JSON.stringify(v.writes)
      groups.set(k, (groups.get(k) ?? 0) + 1)
    }
    Object.values(n).forEach(walk)
  }
  walk(menu.sections ?? [])
  if (!groups.size) return null
  const ranked = [...groups].sort((a, b) => b[1] - a[1])
  // Большинство обязано быть строгим: если две группы равны, «заводского» набора нет,
  // и молча выбрать любой значило бы записать в чужую кривую невесть что.
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    throw new Error('в карте нет большинства среди наборов writes — заводскую таблицу вывести не из чего')
  }
  return JSON.parse(ranked[0][0])
})()

/** The section the summary rows currently being collected belong to. */
let kipGroup = 'General'
/** Group subtitle in the summary: the reference puts "Speedo {cpu_speedo}" next to "CPU". */
let kipGroupCtx = ''
/** Accumulator for the help blocks of the current section. */
const infoRows = []

function emitItem(item, lines) {
  const offsets = item.offsets ?? []
  const field = offsets.length === 1 ? byOffset.get(offsets[0]) : null
  if (!field) { stats.skipped.push({ id: item.id, why: 'not a single offset' }); return }
  // the blacklist outranks everything else: these offsets must never be written to
  if (BLACKLIST.has(field.offset)) {
    stats.blocked.push({ id: item.id, offset: field.offset, why: BLACKLIST.get(field.offset) })
    return
  }
  // fields the struct source marks as belonging to something else stay out of the menu
  // `exclude_from_menu` — мусор, писать туда нельзя вовсе.
  // `read_only` — настоящее поле, но коды режимов не установлены: показываем и сохраняем,
  //   а в меню не выводим, чтобы нельзя было записать наугад.
  if (field.exclude_from_menu || field.read_only) { stats.skipped.push({ id: item.id, why: `excluded: ${field.danger ?? 'flagged in the map'}` }); return }
  // Ряд значений обычно берётся из карты полей — он там один на смещение. Но у поля 44
  // смысл РАЗНЫЙ на двух ревизиях: на Mariko это выбор одной из готовых таблиц, на Erista
  // множитель −12,5 мВ. Один ряд на оба случая врал бы на одной из ревизий, поэтому карта
  // меню вправе задать свой — тогда пункт разделяется на два, по `platform`.
  const values = item.values ?? field.values ?? []
  if (!values.length) { stats.skipped.push({ id: item.id, why: 'no value dictionary' }); return }

  const base = safeName(item.id)
  const d = emitDicts(field, base, item.values ?? null, item.label_probe ?? null)
  if (!d) { stats.skipped.push({ id: item.id, why: 'empty dictionary' }); return }

  /**
   * An item name has to be unique within the package: [boot] addresses footers BY NAME
   * (`set-ini-val './config.ini' '*Name' footer …`). Two identical names and the footers
   * overwrite each other. The audit found 24 such collisions: "307MHz" exists in both the
   * Mariko and the Erista curve, "Max Voltage" in both CPU and GPU.
   * We make them unique with a ?tag suffix — Ultrahand hides it when drawing (removeTag).
   */
  const rawTitle = safeName(item.title ?? item.id)
  let title = rawTitle
  if (usedTitles.has(rawTitle)) {
    // Метка берётся сперва у ПУНКТА, и только потом у поля: одно смещение может значить
    // на двух ревизиях разное, и тогда пункта два — у каждого своя ревизия, а у поля в карте
    // по-прежнему `both`. Без этого второй пункт получал метку `?both`, то есть врал.
    const tag = safeName(item.tag ?? item.platform ?? field.platform ?? String(field.offset))
    title = `${rawTitle}?${tag}`
    let n = 2
    while (usedTitles.has(title)) title = `${rawTitle}?${tag}${n++}`
  }
  usedTitles.add(title)

  const cmd = field.write_kind === 'rdecimal' ? 'hex-by-custom-rdecimal-offset' : 'hex-by-custom-offset'

  lines.push(`[*${title}]`)
  lines.push(';mode=option')
  // Console revision. The engine hides items belonging to the other platform by itself
  // (main.cpp:5480), so Erista fields are invisible on Mariko and vice versa. The platform
  // comes from the field map, where it was filled in from the field NAME in customize.cpp:
  // mariko*, erista*, common*. Ebal's own tagging is no good here — it contradicts itself:
  // 12 is tagged mariko there even though it is commonCpuBoostClock, shared by both revisions.
  const plat = item.platform ?? field.platform
  if (plat === 'mariko' || plat === 'erista') lines.push(`;system=${plat}`)
  // conditional visibility: show the item only while its controlling field is in the right state
  if (item.visible_when?.offset != null) {
    const v = item.visible_when
    lines.push(`;visibility_condition=matching_hex_val_custom ${KIP} CUST ${v.offset} ${v.value}`)
    stats.guards++
  }
  if (item.help) lines.push(`;footer_highlight=true`)
  lines.push(`json_file_source '${d.list}' name`)
  // Кэш найденного смещения якоря движок не сбрасывает сам. Пока команда одна, это неважно;
  // когда их три десятка — один скан файла вместо тридцати, и заодно страховка на случай,
  // если в этой же сессии оверлея kip подменили восстановлением копии.
  if (d.extraOffsets.length) lines.push('clear hex_sum_cache')
  lines.push(`${cmd} ${KIP} CUST ${field.offset} {json_file_source(*,hex)}`)
  for (const o of d.extraOffsets) lines.push(`${cmd} ${KIP} CUST ${o} {json_file_source(*,w${o})}`)
  /**
   * ONE-TIME SEEDING ON THE MODE SWITCH, not only on the way into the curve screen.
   *
   * The curve screen is gated: with the mode off it shows "set Undervolt Mode to Custom
   * Table" and does not ask the reader to come back. Whoever followed that hint switched
   * the mode and left, the seeding never ran, and the firmware applied the seven top
   * points as they lie in a stock kip - bytes of another structure read as voltages.
   *
   * The first guard reads CUST 44 back after the line above wrote it: hexSumCache keeps
   * the file offset of the CUST anchor, not the bytes (hex_funcs.cpp:501-540), so the
   * read sees the fresh value. `try:` drops the rest of the section once a block succeeds,
   * so the footer has to stand in both branches.
   */
  if (item.seed_from) {
    const donor = MENU_BY_ID.get(item.seed_from)
    if (!donor) throw new Error(`${item.id}: seed_from ссылается на "${item.seed_from}", а такого узла в карте нет`)
    if (!(donor.seed_when?.length && donor.seed_write?.length)) {
      throw new Error(`${item.id}: у узла "${item.seed_from}" нет seed_when/seed_write — сеять нечем`)
    }
    lines.push('try:', ...donor.seed_when, ...donor.seed_write, `set-footer '{json_file_source(*,short)}'`, 'try:')
    stats.seedBlocks = (stats.seedBlocks ?? 0) + 1
  }
  // ФУТЕР БЕРЁТ `short`, А НЕ `name`, И ЭТО НЕ ПРИДИРКА.
  //
  // Подпись под пунктом приходит из ДВУХ разных файлов: при открытии пакета — из словаря
  // (`[boot]`, `set-ini-val … footer`), а сразу после выбора значения — отсюда, из списка.
  // Оставь здесь `name` — и пункт показывал бы короткую подпись до касания и длинную
  // после, до следующего открытия оверлея. Найдено разбором 02.09.2026 ДО правки.
  lines.push(`set-footer '{json_file_source(*,short)}'`)
  lines.push('')

  // The footer shown when the package opens — from THE SAME offset and THE SAME dictionary.
  //
  // Paths here are relative to the PACKAGE ROOT, not to the section directory: the engine
  // runs `boot_package.ini` only for the top-level package (main.cpp:7381, 8144) and does
  // not run the boot file of a sub-package entered through `package_source`. Item state,
  // however, is read from the `config.ini` sitting NEXT TO its package.ini (main.cpp:6258),
  // so the target file is the config.ini of that very subdirectory.
  // declaring the same dictionary twice in a row is one more file open at startup
  //
  // ТОЧКЕ КРИВОЙ ОБЪЯВЛЕНИЕ НЕ НУЖНО ВОВСЕ: её подпись считается, словарь не открывается.
  // Оставь объявление — и получишь полсотни открытий файла при входе в раздел ради
  // словаря, к которому никто не обратится. `lastBootMap` при этом НЕ двигаем: объявление
  // это курсор, и раз мы его не сдвинули, следующая словарная строка вправе не объявлять
  // свой словарь заново. Пропускаются объявление И подстановка разом, иначе строка осталась
  // бы с чужим словарём.
  if (!isCurve({ series: field.series }) && d.mapRoot !== lastBootMap) { bootLines.push(`json_file '${d.mapRoot}'`); lastBootMap = d.mapRoot }
  // Ключ чтения. Обычно одна ячейка. Если ступени различаются таблицей, а не полем, то
  // по одной ячейке три из пяти неотличимы — читаем две подряд и склеиваем. Движок это
  // умеет: подстановки резолвятся все, а не первая (replacePlaceholdersRecursivelyImpl).
  const probe = item.label_probe
    ? `{hex_file(CUST,${field.offset},${d.len})}{hex_file(CUST,${item.label_probe.offset},${item.label_probe.len})}`
    : `{hex_file(CUST,${field.offset},${d.len})}`
  // ТРЕТИЙ ПОТРЕБИТЕЛЬ ТОГО ЖЕ ЗНАЧЕНИЯ — подпись под пунктом. Точка кривой и здесь
  // считается, а не ищется в словаре: иначе на экране вышло бы разное — сводка назвала бы
  // напряжение, а пункт под ней промолчал бы «Not available».
  //
  // Значение ОБЯЗАНО быть в кавычках: в нём есть пробел перед «mV», а `set-ini-val` берёт
  // значением ровно один разобранный токен. Без кавычек в конфиг легло бы одно число,
  // а слово «mV» потерялось бы по дороге.
  const curveRow = { series: field.series, offset: field.offset }
  bootLines.push(isCurve(curveRow)
    ? `set-ini-val '${d.dir ? `./${d.dir}/config.ini` : './config.ini'}' '*${title}' footer '${curveValue(curveRow, false)}'`
    : `set-ini-val '${d.dir ? `./${d.dir}/config.ini` : './config.ini'}' '*${title}' footer {json_file(0,${probe})}`)
  stats.bootLines++
  stats.items++

  // summary row "what is in the kip right now" — same dictionary, same offset
  kipRows.push({
    // timings live inside RAM, but on the summary page they need a heading of their own:
    // "RAM" above the T1…T8 row is confusing
    group: field.series === 'core_timings' ? 'Core Timings' : kipGroup,
    // the section subtitle belongs to the section: above the T1…T8 row the memory model was
    // printed flush against the words "Core Timings" and overlapped them
    groupCtx: field.series === 'core_timings' ? '' : kipGroupCtx,
    // NAME WITHOUT THE TAG. In the menu, same-named items are told apart by a ?tag suffix
    // which the engine hides — but safeName turns ? into a dash, so the summary page ended
    // up showing "Min Voltage-both" and "Frequency-mariko".
    title: rawTitle,
    map: d.mapRoot,
    offset: field.offset,
    len: d.len,
    probe: item.label_probe ?? null,   // сводная страница читает ту же пару ячеек, что и меню
    flatMap: d.flatMap,                // запасной словарь: источник без второй ячейки
    platform: plat,
    series: field.series ?? null,
    // Условие видимости едет вместе со строкой. Сводка обязана его уважать: показывать
    // таблицу, которую прошивка в текущем режиме не читает, — значит врать молча.
    // Именно так вышло со ступенями: человек выбирал ST2.5, открывал сводку, видел
    // прежние напряжения кривой и решал, что ступень не применилась. Значения были верные,
    // но относились к Custom Table, а ступень пишет совсем в другую таблицу.
    visible_when: item.visible_when ?? null,
  })

  // Build up the help: the field description plus the links the original packages kept quiet about.
  //
  // The block used to be added ONLY when there were warnings, and a description without any
  // warning silently vanished: all 39 pMeh/sMeh fields have help text in the map, yet only
  // six blocks out of thirty-nine reached the screen.
  const warns = warningsFor(field.offset, plat)
  const help = item.help ?? field.help_text
  // Ревизия едет вместе со справкой: у расщеплённого по платформам пункта справок ДВЕ,
  // и без пометки эристовец читал бы подряд мариковские границы и свои. Приём тот же,
  // что и у самих пунктов, — движок покажет ровно одну.
  if (warns.length || help) infoRows.push({ title: rawTitle, warns, help, platform: plat })
}

/**
 * СЕКЦИИ СОЗДАНИЯ КОПИИ, ОТЛОЖЕННЫЕ ДО СТРАНИЦЫ `Backup manager`.
 *
 * Пункт «Create backup» больше НЕ стоит в разделе Service. Решение оператора: всё про
 * копии — создать, выбрать, посмотреть, применить, удалить — живёт на одной странице,
 * а Service остаётся списком обслуживания, а не половиной менеджера копий.
 *
 * Почему через промежуточный склад, а не прямой вызов. Секции собираются при обходе
 * меню (`emitBackup`, его зовёт `emitPackage`), а страница восстановления пишется позже,
 * из общего блока сводки (`emitPreviewPage`). Между ними нет ни общего вызова, ни порядка,
 * который можно было бы переставить: обход обязан идти первым, потому что из него же
 * берутся строки сводки. Поэтому `emitBackup` кладёт готовые строки сюда, а страница
 * забирает их по ревизии.
 *
 * Ключ — ревизия, значение — массив строк готовой секции. Пусто быть не может: обе
 * ревизии заполняются в одном цикле.
 */
const backupCreate = {}

/**
 * BACKUP AND RESTORE.
 *
 * Taken from Ebal (`boot_package.ini`, sections `[backup]` and `[restore]`): a backup is saved
 * NOT as a kip image but as an ini listing values. That matters more than it looks. A kip image
 * is about a megabyte and contains bootloader code — restore yesterday's image after a 4IFIR
 * update and you silently roll the bootloader back too. A list of values is applied on top of
 * the current kip and survives a firmware update.
 *
 * What we do differently:
 *
 * 1. THE KEY IS THE OFFSET, not an invented name. Ebal uses keys like `CPUVoltLm` and `CPUVoltL`
 *    (28 and 20 — the Mariko maximum and the Erista limit), and they are easy to mix up by eye.
 *    An offset cannot be renamed or confused.
 *
 * 2. BACKUPS ARE SPLIT BY REVISION. Mariko and Erista backups live in different directories and
 *    the restore item is tagged `;system=`. Applying a backup from the other revision is
 *    physically impossible — the file list never reaches it. Ebal has a single directory while
 *    half the fields are platform-specific: restoring a backup from the other revision writes
 *    garbage into a live kip.
 *
 * 3. EVERYTHING IN THE MAP IS SAVED, not a selection. Ebal saves 99 fields out of 122.
 *
 * The file path is stored in `config.ini` BEFORE the values are written: `{timestamp(...)}` is
 * evaluated on every substitution, so on a minute boundary the 122 lines would end up split
 * across two files. That trick comes from Ebal too, and it is no accident there.
 */
function emitBackup(item, lines) {
  const BAK = '/atmosphere/kips/.bak'
  const title = safeName(item.title ?? item.id)

  // Fields worth saving: not junk, not blacklisted.
  // read_only здесь НЕ исключается: в меню его нет, но это настоящая настройка,
  // и потерять её при восстановлении было бы хуже, чем не показать.
  const saved = backupSet()

  for (const rev of ['mariko', 'erista']) {
    // A backup holds the shared fields plus the ones for its own revision. The others are
    // skipped: this console cannot read them anyway, and in the file they would only create
    // an illusion of completeness.
    const mine = saved.filter(f => (f.platform ?? 'both') === 'both' || f.platform === rev)
    const dir = `${BAK}/${rev}`
    const path = `{ini_file(Backup,Path)}`

    // Имя копии складывается из того, ЧТО в ней лежит: частота памяти, режим EMC Balance
    // и метка времени. Раньше имя было только временем — по списку нельзя было понять,
    // какая копия к чему относится, не открыв каждую.
    //
    // Частота стоит первой намеренно: движок сортирует список бэкапов лексикографически
    // по имени файла (`main.cpp:3862-3864`), значит копии группируются по частоте. Это
    // работает только потому, что все частоты в словарях четырёхзначные (1600…3309):
    // будь среди них трёхзначная, «928» встала бы после «2707». Метка времени идёт
    // в конец в виде `дд-мм-гг-ччммсс` — внутри одной группы порядок хронологический,
    // а секунды снимают вопрос о совпадении имён: две копии в одну секунду одним
    // нажатием физически не сделать.
    //
    // «Авто» показывается словом: у обоих полей автоматический режим это ноль,
    // и `2707` против `auto` читается сразу.
    //
    // ДЛИНА ИМЕНИ — НЕ КОСМЕТИКА, А ГРАНИЦА. В списке выбора строка файла несёт справа
    // кружок радиоселектора, и подсвеченная строка при прокрутке заходит на него
    // (замерено: 15 пикселей из 36). Лечится тем же способом, что и версия в шапке
    // пакета, — текст укорачивается, а не подгоняется рамка: `docs/RELEASE.md`,
    // «Версия на экране короче тега».
    //
    // Что убрано и почему именно это:
    //   `mhz` после частоты   — частота всегда четырёхзначная, единица очевидна;
    //   дефисы внутри даты    — `280826` читается не хуже `28-08-26`;
    //   `imported` → `imp`    — метка нужна, чтобы отличить копию в списке,
    //                           полное слово для этого избыточно.
    //
    // ОДНОЙ БУКВЫ ОКАЗАЛОСЬ МАЛО, И НЕ ПО ДЛИНЕ. Сперва метка была `-i-`, и на экране
    // консоли она читается не как буква между дефисами, а как крестик: узкая `i`
    // сливается с обеими чёрточками в один значок. Оператор увидел это первым.
    // Три буквы разделяются глазом однозначно и стоят два лишних знака.
    // СЕКУНДЫ ТРОГАТЬ НЕЛЬЗЯ: на них держится невозможность совпадения имён,
    // а без неё вернулась бы цепочка `try:` с суффиксом, обрывающая секцию
    // из девяноста записей (`docs/NOTES.md` №72).
    //
    // Худший случай длины стережёт проверка в `check-generated.mjs`.
    const freqField = fieldsDoc.fields.find(f => f.name === 'RAM MHz' && f.platform === rev)
    const balField = fieldsDoc.fields.find(f => f.name === 'EMC Balance')
    // Молча откатываться на имя-время нельзя: получится, что переименование поля тихо
    // ухудшило продукт. Пусть лучше упадёт сборка.
    if (!freqField) throw new Error(`нет поля "RAM MHz" для ${rev} — имя бэкапа собрать не из чего`)
    if (!balField) throw new Error('нет поля "EMC Balance" — имя бэкапа собрать не из чего')

    // СЕКЦИЯ СОБИРАЕТСЯ В ОТДЕЛЬНЫЙ МАССИВ, а не в `lines`: её место не здесь.
    // `lines` — это `service/package.ini`, а пункт создания уехал на страницу
    // `Backup manager` (`service/restore-<ревизия>.ini`). Оттуда его и заберут.
    const mk = []

    // Суффикс ревизии в имени ОСТАЁТСЯ, хотя страница уже своя у каждой ревизии.
    // Он не фильтр, а различитель имён: движок его при отрисовке срезает, зато
    // две секции `Create backup` в двух файлах остаются различимы — и по нему же
    // ищут секцию проверки (`check-generated.mjs` №14, `verify-import.mjs`).
    mk.push(`[${title}?${rev}]`)
    // `;mini=true` УБРАН 01.09.2026: строка была вдвое ниже соседней.
    //
    // Директива задаёт компактную строку — сорок пикселей вместо семидесяти.
    // Подсветка рисуется от габарита строки, поэтому у выделенного `Create backup`
    // рамка выходила на тридцать пикселей ниже, чем у стоящего под ним
    // `Choose backup`. На экране это читалось как съехавшая вёрстка, что оператор
    // и заметил.
    //
    // Это было ЕДИНСТВЕННОЕ `;mini=` во всём пакете — то есть отклонение от нормы
    // движка на одной строке из сотни экранов. Появилось вместе с первой версией
    // копий, когда пункт жил в общем списке `Service` и его ужимали, чтобы не
    // растягивать длинный список. После переезда на свою страницу основание
    // исчезло, а строка осталась — ни комментария, ни следа в сообщении коммита.
    //
    // Не путать с другим явлением: подсветка ЛЮБОГО пункта выходит за строку
    // на пять пикселей вверх (`NOTES` №112). Это системная черта движка, она
    // одинакова у обоих пунктов и к разнице высот отношения не имеет.
    // `;system=` ЗДЕСЬ БОЛЬШЕ НЕ НУЖЕН, И ЭТО НЕ ОСЛАБЛЕНИЕ ЗАЩИТЫ.
    //
    // Фильтр отсекал пункт по ревизии, когда оба лежали в одном файле — в общем
    // списке Service. Теперь файл СВОЙ у каждой ревизии, а единственный вход в него —
    // форвардер `[*Backup manager?<ревизия>]` ниже, и вот на нём `;system=` стоит.
    // На чужой консоли форвардер не показывается вовсе, значит и страница недостижима.
    //
    // Это ровно то, на чём уже держатся `Apply this backup` и `Delete this backup`:
    // они пишут в kip и тоже обходятся без собственного фильтра. Оставить его одному
    // созданию значило бы завести на странице два разных правила вместо одного.
    mk.push(`mkdir ${dir}`)
    mk.push('clear hex_sum_cache')
    mk.push(`hex_file '${KIP}'`)
    mk.push(`ini_file './config.ini'`)
    // Разложено по шагам, а не собрано в одно выражение, СПЕЦИАЛЬНО. Вложенное
    // `{if_==(…,{math(…,true)}…)}` зависело бы от того, что внутренние подстановки
    // раскрываются раньше внешней: парсер `if_` режет аргументы по запятым
    // (`utils.hpp:3209-3241`), и запятая внутри `{math(…,true)}` его бы развалила,
    // раскройся она позже. Промежуточные значения в `config.ini` эту зависимость
    // убирают совсем и вдобавок видны глазами, если что-то пойдёт не так.
    const raw = f => `{hex_to_decimal({hex_to_rhex({hex_file(CUST,${f.offset},${f.length ?? 3})})})}`
    mk.push(`set-ini-val './config.ini' Backup Khz '${raw(freqField)}'`)
    mk.push(`set-ini-val './config.ini' Backup Bal '${raw(balField)}'`)
    mk.push(`set-ini-val './config.ini' Backup Mhz '{math({ini_file(Backup,Khz)}/1000,true)}'`)
    mk.push(`set-ini-val './config.ini' Backup Freq '{if_==({ini_file(Backup,Khz)},0,auto,{ini_file(Backup,Mhz)})}'`)
    mk.push(`set-ini-val './config.ini' Backup Bals '{if_==({ini_file(Backup,Bal)},0,auto,eBal{ini_file(Backup,Bal)})}'`)
    // name first, values second — otherwise a second boundary splits the file in two
    mk.push(`set-ini-val './config.ini' Backup Path '${dir}/{ini_file(Backup,Freq)}-{ini_file(Backup,Bals)}-{timestamp(%d%m%y-%H%M%S)}.ini'`)
    // the backup's passport: where it came from and whether it fits this console
    mk.push(`set-ini-val '${path}' Meta revision '${rev}'`)
    // Версия раскладки блока CUST. Без неё копия, снятая на одной прошивке, молча
    // применилась бы на другой: смещения — это позиции в структуре, и если автор её
    // изменит, те же числа станут указывать не туда, а запись пойдёт прямо в загрузчик.
    // Восстановление сверяет это поле и отказывается работать при несовпадении.
    mk.push(`set-ini-val '${path}' Meta kipver '${KIPVER}'`)
    mk.push(`set-ini-val '${path}' Meta created '{timestamp("%Y-%m-%d %H:%M")}'`)
    mk.push(`set-ini-val '${path}' Meta ram '{ram_vendor} {ram_model}'`)
    // Паспорт копии обязан считать ВСЁ, что в неё легло, включая попутные ячейки таблицы:
    // иначе число в файле разойдётся с числом строк, и первый же, кто станет по нему сверять
    // полноту копии, получит ложную тревогу.
    mk.push(`set-ini-val '${path}' Meta fields '${backupFieldCount(rev)}'`)
    for (const f of mine) {
      mk.push(`set-ini-val '${path}' Fields ${f.offset} '{hex_file(CUST,${f.offset},${f.length ?? 3})}'`)
    }
    // Попутные ячейки — после полей и тем же ключом-смещением: восстановление читает файл
    // одним списком и не отличает их от прочего, а копия остаётся полной.
    for (const f of sideSet(rev)) {
      mk.push(`set-ini-val '${path}' Fields ${f.offset} '{hex_file(CUST,${f.offset},${f.length})}'`)
    }
    // ПОДПИСЬ ОБ УСПЕХЕ ОСТАЁТСЯ ПОДПИСЬЮ, а не превращается в `notify`.
    //
    // `set-footer` у обычного пункта садится на сам пункт, а не на родительский:
    // разбор про `notify` (`emitImport` ниже, `NOTES` №114) касается секций-селекторов
    // `;mode=option`, где итог уезжает на пункт-родитель. Здесь пункт обычный, и на
    // новой странице он остаётся таким же — поведение переезда не меняет.
    mk.push(`set-footer 'saved {timestamp("%d.%m %H:%M")}'`)
    mk.push('')
    backupCreate[rev] = mk
    stats.backupFields = (stats.backupFields ?? 0) + mine.length

    // ОДИН ПУНКТ НА ОБА ДЕЙСТВИЯ — «BACKUP MANAGER».
    //
    // Было два: `Restore backup` и `Delete backup`, каждый со своей страницей и своим
    // выбором копии. Чтобы удалить, человек выбирал копию второй раз — на другом экране,
    // по имени, которое видел на первом.
    //
    // Оператор поймал лишний шаг с другой стороны: до удаления вели ДВА входа подряд —
    // пункт открывал страницу, страница открывала список. Убрать промежуточный пункт
    // нельзя: список файлов движок показывает только отдельным экраном (`;mode=option`
    // → `SelectionOverlay`), прямо на странице его не нарисовать.
    //
    // Поэтому страницы слиты. Копия выбирается ОДИН раз, под ней паспорт, ниже две
    // кнопки — применить и удалить. Обе с удержанием, поэтому соседство безопасно:
    // короткое нажатие не делает ничего ни на той, ни на другой.
    //
    // Страница по-прежнему показывает содержимое копии теми же таблицами, что и сводка
    // текущих настроек: выбор в списке пишет одну строку в `config.ini`, а не девяносто
    // значений в kip, и передумать можно до самого удержания.
    lines.push(`[*Backup manager?${rev}]`)
    lines.push(';mode=forwarder')
    lines.push(`;system=${rev}`)
    lines.push(`package_source './restore-${rev}.ini'`)
    lines.push('')

    emitImport(lines, rev, dir)
  }
  stats.actions++
}

/**
 * ИМПОРТ КОПИИ ИЗ СТАРОГО ВИЗАРДА.
 *
 * Что делает: читает файл из `atmosphere/kips/kip-json/`, где старый 4IFIR Wizard хранил
 * свои копии, и превращает его в НАШ формат — обычный ini рядом с остальными копиями.
 *
 * **В kip при этом не пишется ничего.** Это главное решение: импорт создаёт файл, а
 * применяет его человек уже через обычное «Restore backup», где перед записью показывается
 * содержимое. Ошибка в отображении даёт неверный ini, который видно глазами, а не тихую
 * запись в загрузчик.
 *
 * Откуда отображение: `package/backup-import.json`, раздел `import_map`, выведенный
 * скриптом из шаблонов старого визарда. Правило вывода проверено на Mariko — совпало
 * 54 имени из 54 с реальным файлом.
 *
 * Три вещи, которые здесь делаются намеренно:
 *
 * 1. `kipver=imported`. Старый формат версию раскладки не хранил, и выдумывать её нельзя.
 *    Обычное применение такую копию отвергнет; для неё есть отдельный пункт с предупреждением.
 * 2. Имя строится из значений САМОГО файла, а не из живого kip: копия описывает то, что
 *    в ней лежит, а не то, что сейчас на консоли.
 * 3. Точки кривой переносятся только при `GPU Eco Mode = 3`. В остальных режимах старый
 *    инструмент писал их из совсем других таблиц и в микровольтах — проверено численно,
 *    у `Default.json` (режим 0) совпадение с нашей кривой 1 из 31.
 */
function emitImport(lines, rev, dir) {
  const imp = IMPORT_MAP?.[rev]
  if (!imp?.length) return

  const SRC = '/atmosphere/kips/kip-json'
  // Ширина значения приводится к ширине поля одним выражением: дописываем нули справа
  // и берём нужное число знаков. Так решаются оба случая сразу — и слишком длинное
  // значение (в старом формате многие поля по 4 байта), и слишком короткое.
  // ЗАЩИТА ОТ ОТСУТСТВУЮЩЕЙ ЗАПИСИ. Если ключа в файле нет, `json_file` возвращает
  // литерал `null`. Без обёртки он дополнился бы нулями до «NULL00» — а это уже не
  // сентинел, и восстановление записало бы его в kip как hex. Поэтому: нет значения —
  // остаётся ровно `null`, и запись пропускается (`handleHexByCustom`, utils.hpp:4560).
  //
  // СРАВНИВАЕТСЯ КУСОК СЕНТИНЕЛА, А НЕ ЦЕЛОЕ СЛОВО. Для элемента ряда `expr` — это уже
  // вырезка, и на пропавшем ключе она даёт не `null`, а его начало: `slice('null',0,2)`
  // = `nu`. Сравнение с `null` не срабатывало, и в поле уезжало `nu0000` — чётной длины
  // и не-hex. `hexEditByOffset` длину проверяет, а символы нет: такое ушло бы прямо
  // в тайминги памяти.
  //
  // Подставить в сравнение саму запись донора **нельзя**: у ряда она вида `01,01,00,…`,
  // а `if_==` режет аргументы по запятым, и вложенное значение с запятыми ломает разбор
  // (тот же дефект движка, ради которого первая ячейка кривой откладывается в config.ini).
  // Поэтому сравниваем с куском слова `null` той же ширины: два знака — `nu`, четыре —
  // `null`. Настоящее значение таким быть не может, оно hex.
  //
  // И СМОТРИМ ВСЕГДА НА ЭЛЕМЕНТ НОЛЬ, А НЕ НА СВОЙ. Первая редакция сравнивала срез
  // своего элемента, и защита работала только у первого: срез берётся С ПОЗИЦИИ элемента,
  // а слово `null` длиной четыре знака. Элемент 1 шириной 2 вырезал из него `l`, элемент 2
  // и дальше — пустоту. То есть в поле уезжало `l00000` (не-hex, прямо в тайминг памяти
  // по смещению 64) либо тихие нули поверх настроек, которых в профиле не было.
  // Элемент ноль лежит в начале строки всегда — на пропавшем ключе он и даёт начало
  // сентинела, на живом профиле там hex.
  //
  // ДОБИВКА ПО ШИРИНЕ ПОЛЯ, А НЕ ТРЕМЯ БАЙТАМИ. Стояло фиксированное `000000`, и для
  // поля шире четырёх байт результат выходил короче нужного: у точек кривой Erista
  // (24 байта) донор даёт 4, добивка ещё 3, итого 7 — `slice` упирается в конец строки
  // и отдаёт 14 знаков вместо 48. Записалось бы напряжение и три младших байта
  // коэффициента, остальные 17 байт остались бы от прежней строки.
  const fit = (expr, len, sentinel = 'null', guard = expr) =>
    `{if_==(${guard},${sentinel},null,{slice(${expr}${'0'.repeat(len * 2)},0,${len * 2})})}`
  const val = (row, k = 0) => `{json_file(${row.index},${row.key})}`

  // поле «GPU Eco Mode» нужно как условие для точек кривой
  const eco = imp.find(r => r.name === 'GPU Eco Mode')

  /**
   * ПОТОЛОК ЧАСТОТЫ В ПРОФИЛЕ НЕ ХРАНИТСЯ, И ВЫДУМЫВАТЬ ЕГО НЕЛЬЗЯ.
   *
   * Профиль KipTool несёт напряжения строк, но не частоту последней строки. А по
   * постоянному решению оператора потолок наследуется от нижней соседки, и у ST1.5
   * он свой — 1459,2 МГц против 1536 у ST2 и ST2.5.
   *
   * Определяем по первой ячейке кривой: она у ступеней различна (на этом же держится
   * подпись). Оба числа берём ИЗ КАРТЫ, а не пишем своими руками, — правило обязано
   * жить в одном месте.
   *
   * Если определить не удалось, ячейка не пишется вовсе: `null` движок пропускает,
   * и потолок остаётся прежним. Это единственный вариант, не выдумывающий число.
   */
  const capRule = (() => {
    if (!stockTable) return null
    const CAP = '10544', CELL0 = '8896'
    const stock = stockTable[CAP]
    if (!stock) return null
    const odd = []
    const walk = n => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      for (const v of n.values ?? []) {
        const w = v.writes
        if (!w?.[CAP] || !w[CELL0]) continue
        if (w[CAP] !== stock) odd.push({ cell0: w[CELL0], cap: w[CAP] })
      }
      Object.values(n).forEach(walk)
    }
    walk(menu.sections ?? [])
    return { stock, odd }
  })()

  const rows = []
  const seenOff = new Set()
  for (const r of imp) {
    /**
     * ЯЧЕЙКИ РАБОЧЕЙ ТАБЛИЦЫ ПИШУТСЯ ОТДЕЛЬНО ОТ МАССИВА И ДО ПРОВЕРКИ `skip`.
     *
     * `skip` у строки кривой означает «для МАССИВА эта строка непригодна»: у массива
     * слотов 24, и индексы 24…30 залезли бы в таблицу CPU Erista. К таблице это
     * отношения не имеет — там все 31 строка законны.
     *
     * ЗАЧЕМ ЭТО ВООБЩЕ. Профиль KipTool несёт режим, но раньше не нёс кривую, и
     * импортированная копия применялась НАПОЛОВИНУ: режим ставился, таблица оставалась
     * прежней. Выбрал ST2.5, импортировал старый профиль «ST2» — получил режим ST2
     * поверх кривой ST2.5, то есть состояние, которого нет ни в одном меню.
     *
     * Кривая в профиле ЕСТЬ — снимок той таблицы, которую выбирал режим. При режиме `01`
     * переносим её ДОСЛОВНО: подстроенную вручную кривую (такие в природе есть) запись
     * константы молча стёрла бы. При остальных режимах профиль несёт снимок ЧУЖОЙ
     * таблицы, и в рабочий слот кладём заводское содержимое — ровно то, что туда пишут
     * все четыре целые ступени.
     */
    if (r.table_offsets?.length && eco && stockTable) {
      const off = r.table_offsets[0]
      const stock = stockTable[String(off)]
      if (stock) {
        const verbatim = fit(val(r), 4)
        rows.push({ off, expr: `{if_==({json_file(${eco.index},${eco.key})},${r.table_when.equals},${verbatim},${stock})}` })
        seenOff.add(off)
      }
    }
    if (r.skip || !r.offsets?.length) continue
    r.offsets.forEach((off, i) => {
      const f = fieldsDoc.fields.find(x => x.offset === off)
      if (!f) return                                  // чего нет в карте, того не пишем
      if (BLACKLIST.has(off)) return
      const len = f.length ?? 3
      // элемент упакованного ряда вырезается по позиции: ширина внутри ряда постоянна
      // ШИРИНА В ЗНАКАХ, А НЕ В БАЙТАХ. В шаблоне `length` — длина поля в байтах,
      // а в строке элемент занимает вдвое больше знаков плюс запятую-разделитель.
      // Первая версия брала байты за знаки, и срез попадал НА ЗАПЯТУЮ: у ряда
      // `0000,0200,…` элементом 1 выходило «0,». Такое уезжало в kip как hex,
      // и консоль переставала грузиться. Поймано на живой консоли оператором.
      const w = r.length * 2                 // знаков на элемент
      const stride = w + 1                   // плюс разделитель
      const isRow = r.offsets.length > 1
      const src = isRow
        ? `{slice(${val(r)},${i * stride},${i * stride + w})}`
        : val(r)
      // У ряда сторожем служит ПЕРВЫЙ элемент, а не свой: только он гарантированно
      // вырезает начало слова `null`, когда записи в профиле нет.
      const guard = isRow ? `{slice(${val(r)},0,${w})}` : src
      let expr = fit(src, len, isRow ? 'null'.slice(0, w) : 'null', guard)
      // условие по режиму — только для точек кривой Mariko
      if (r.only_when && eco) {
        expr = `{if_==({json_file(${eco.index},${eco.key})},${r.only_when.equals},${expr},null)}`
      }
      /**
       * ОДНО СМЕЩЕНИЕ — ОДНА ЗАПИСЬ. Импорт писал `12436` дважды: отдельной записью
       * и элементом упакованного ряда, и побеждала вторая просто потому, что стояла
       * ниже. Это `eBAMATIC Stage`, первая строка сводки по расстановке оператора, —
       * то есть выбор делал порядок строк, а не решение.
       */
      if (seenOff.has(off)) { stats.skipped.push({ id: `import ${off}`, why: 'смещение уже записано выше' }); return }
      seenOff.add(off)
      rows.push({ off, expr })
    })
  }
  /**
   * Строка потолка эмитится ПОСЛЕ кривой: она опирается на первую её ячейку, которую
   * к этому моменту уже прочитали в `Import Cell0`.
   */
  if (capRule && eco && rows.some(r => r.off === 8896)) {
    const inner = capRule.odd.reduce(
      (acc, o) => `{if_==({ini_file(Import,Cell0)},${o.cell0},${o.cap},${acc})}`,
      capRule.stock)
    rows.push({ off: 10544, expr: `{if_==({json_file(${eco.index},${eco.key})},01,${inner},${capRule.stock})}` })
  }
  if (!rows.length) return

  // частота памяти и eBal — для имени файла, читаются из самого json
  const freqRow = imp.find(r => r.name === 'RAM MHz')
  const balRow = imp.find(r => r.name === 'EMC Balance')

  // УДЕРЖАНИЯ ЗДЕСЬ НЕТ — И ЭТО НЕ УПУЩЕНИЕ.
  //
  // Удержание — плата за необратимость, а импорт ничего не ломает: он читает чужой json
  // и создаёт РЯДОМ копию в нашем формате. Kip он не трогает вовсе — применение остаётся
  // отдельным шагом в «Restore backup». Случайное нажатие здесь стоит одного лишнего файла.
  //
  // Была и вторая причина, практическая. С удержанием правая колонка строки оставалась
  // пустой: ни галочки, ни крестика, ни песочных часов, — то есть человек не понимал,
  // сработало ли. Разбор в NOTES №113: у движка две копии логики завершения, и для
  // пунктов `;mode=option` общая из них показывает не отметку, а сохранённую подпись.
  // Поэтому подпись мы и ставим сами, последней командой.
  lines.push(`[*Import old 4IFIR backup?${rev}]`)
  lines.push(';mode=option')
  lines.push(`;system=${rev}`)
  lines.push(`file_source ${SRC}/*.json`)
  lines.push(`json_file '{file_source}'`)
  lines.push(`mkdir ${dir}`)
  lines.push(`ini_file './config.ini'`)
  /**
   * Первая ячейка кривой откладывается в сторону: по ней ниже опознаётся ступень
   * и выбирается потолок. Читать её дважды в одном выражении нельзя — `if_==` режет
   * аргументы по запятым, и вложенная подстановка в поле сравнения ломает разбор.
   */
  const cell0Row = imp.find(r => r.table_index === 0)
  if (capRule && cell0Row) {
    lines.push(`set-ini-val './config.ini' Import Cell0 '${fit(val(cell0Row), 4)}'`)
  }
  if (freqRow && balRow) {
    lines.push(`set-ini-val './config.ini' Import Khz '{hex_to_decimal({hex_to_rhex(${fit(val(freqRow), 3)})})}'`)
    lines.push(`set-ini-val './config.ini' Import Bal '{hex_to_decimal({hex_to_rhex(${fit(val(balRow), 3)})})}'`)
    lines.push(`set-ini-val './config.ini' Import Mhz '{math({ini_file(Import,Khz)}/1000,true)}'`)
    lines.push(`set-ini-val './config.ini' Import Freq '{if_==({ini_file(Import,Khz)},0,auto,{ini_file(Import,Mhz)})}'`)
    lines.push(`set-ini-val './config.ini' Import Bals '{if_==({ini_file(Import,Bal)},0,auto,eBal{ini_file(Import,Bal)})}'`)
    lines.push(`set-ini-val './config.ini' Import Path '${dir}/{ini_file(Import,Freq)}-{ini_file(Import,Bals)}-imp-{timestamp(%d%m%y-%H%M%S)}.ini'`)
  } else {
    lines.push(`set-ini-val './config.ini' Import Path '${dir}/imp-{timestamp(%d%m%y-%H%M%S)}.ini'`)
  }
  const path = `{ini_file(Import,Path)}`
  lines.push(`set-ini-val '${path}' Meta revision '${rev}'`)
  lines.push(`set-ini-val '${path}' Meta kipver 'imported'`)
  lines.push(`set-ini-val '${path}' Meta created '{timestamp("%Y-%m-%d %H:%M")}'`)
  lines.push(`set-ini-val '${path}' Meta ram '{ram_vendor} {ram_model}'`)
  lines.push(`set-ini-val '${path}' Meta source '{file_name}'`)
  /**
   * Откуда кривая — это факт о копии, а не украшение: при режиме `01` она перенесена
   * из профиля дословно, при остальных подставлено заводское содержимое рабочей
   * таблицы. Человек, открывший копию через полгода, обязан это видеть.
   */
  if (capRule && eco) {
    lines.push(`set-ini-val '${path}' Meta curve '{if_==({json_file(${eco.index},${eco.key})},01,from-profile,assumed-stock)}'`)
  }
  // Число полей — паспорт полноты копии. Читает его менеджер копий, поэтому запоминаем.
  IMPORT_FIELD_COUNT[rev] = rows.length
  lines.push(`set-ini-val '${path}' Meta fields '${rows.length}'`)
  for (const r of rows) lines.push(`set-ini-val '${path}' Fields ${r.off} '${r.expr}'`)
  // ОТВЕТ ЧЕЛОВЕКУ — ЭКРАННЫМ СООБЩЕНИЕМ, А НЕ ПОДПИСЬЮ ПУНКТА.
  //
  // Подпись через `set-footer` садится НЕ туда, где человек её ждёт: движок пишет её
  // на РОДИТЕЛЬСКИЙ пункт меню (`main.cpp:565-590`), а не на строку файла, где шла
  // работа. На экране это выглядело как «done» рядом с названием раздела.
  //
  // `notify` рисует сообщение поверх открытого списка — в тот момент и на том экране,
  // где человек находится. Оно не зависит ни от режима пункта, ни от правой колонки,
  // ни от того, какая из двух копий логики завершения отработает.
  //
  // Приём не наш: так сделано в чужом пакете `Ebal/…/Memory Kit/memory_hack.ini:53-66`,
  // в такой же секции-селекторе. И он снимает старое ограничение — узкая правая колонка
  // длинный текст обрезала, а сообщение переносит по словам, поэтому подсказка про
  // следующий шаг вернулась целиком.
  lines.push(`notify 'Imported - apply it from Backup manager' 22 4000`)
  lines.push('')
  stats.imported = (stats.imported ?? 0) + rows.length
}

/**
 * An item with explicit commands: maintenance, actions, information tables.
 * Such items are not tied to an offset — they do file operations or display data.
 */
function emitAction(item, lines) {
  if (item.backup_restore) { emitBackup(item, lines); return }
  const title = safeName(item.title ?? item.id)
  if (usedTitles.has(title)) return
  usedTitles.add(title)

  // Пункт-переход: ничего не делает сам, открывает отдельную страницу. Так устроены
  // и восстановление, и сброс — сначала показать, что будет записано, и только потом писать.
  if (item.forwarder_to) {
    lines.push(`[*${title}]`)
    lines.push(';mode=forwarder')
    lines.push(`package_source '${item.forwarder_to}'`)
    lines.push('')
    stats.actions++
    return
  }

  // information table — live hardware context
  if (item.info_table?.length) {
    // Отступ ОТДЕЛЬНОЙ пустой секцией перед таблицей, а не ключом `;gap=` внутри неё.
    // `;gap=` отводит место ПОД таблицей, а рамка рисуется вокруг всей секции вместе
    // с заголовком — и верхним краем наезжала на кнопку, стоящую выше. Тот же приём
    // уже применён в сводке (`emitPage`), там его вызвала та же беда.
    lines.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
    lines.push(`[${title}]`)
    lines.push(';mode=table')
    lines.push(';alignment=left')
    lines.push(';spacing=3')
    lines.push(';gap=20')
    for (const row of item.info_table) lines.push(row)
    lines.push('')
    stats.actions++
    return
  }

  // Reset to factory values.
  //
  // The values come from package/factory-defaults.json, which is built from the snapshot
  // 4IFIR itself ships (atmosphere/kips/kip-json/Default.json). They do NOT come from the
  // menu dictionaries any more.
  //
  // The previous approach picked whichever dictionary entry had the word "Default" in its
  // name. That tied two unrelated questions together — what to offer the user, and what
  // counts as factory — and it went wrong in three separate ways:
  //
  //   1. the label sat on values inherited from the donor packages, not on factory ones:
  //      28 of 81 writes disagreed with the console's own snapshot;
  //   2. fields whose dictionary had no entry named "Default" were not reset AT ALL, so
  //      RAM clock and CPU boost survived a "reset to defaults" untouched;
  //   3. where the factory value is absent from the dictionary it could not be fixed at
  //      all — the Erista GPU curve is on a 15 mV grid here and 12.5 mV in the firmware.
  //
  // The GPU voltage curves are deliberately not in the snapshot, so reset leaves them
  // alone: there is nowhere to take a factory value from, and inventing one is exactly
  // what caused this in the first place.
  // Reset reads Default.ini, exactly the way Restore reads a backup file.
  //
  // The values used to be baked into the commands, one hex literal per offset. Reading them
  // from a file instead buys three things:
  //
  //   1. reset and restore become the same operation, differing only in which file is read —
  //      so whatever gets built for one (a preview screen, say) serves the other unchanged;
  //   2. the factory set becomes something a person can open and read, on the console or on
  //      a PC, instead of ~60 hex literals buried inside a menu file;
  //   3. Default.ini ships inside the package, so it is always present — it cannot be lost
  //      the way a backup taken by the user can.
  //
  // The file itself is written by emitDefaultIni() below, in our backup format.
  const resetCmds = []
  if (item.reset_from_defaults) {
    const plat = item.platform ?? 'both'
    resetCmds.push(`ini_file './Default.ini'`)
    for (const off of Object.keys(FACTORY).map(Number).sort((a, b) => a - b)) {
      if (BLACKLIST.has(off)) continue
      // A field belonging to the other revision is skipped: this console cannot read it
      // anyway, and writing it would only put noise into the kip.
      const only = byOffset.get(off)?.platform ?? 'both'
      if (only !== 'both' && plat !== 'both' && only !== plat) continue
      resetCmds.push(`hex-by-custom-offset ${KIP} CUST ${off} {ini_file(Fields,${off})}`)
    }
  }

  const cmds = [...(item.commands ?? []), ...resetCmds]
  if (!cmds.length && !item.note) return

  // Значок удержания дописывается к имени сам, для любого пункта с `hold` из карты меню.
  lines.push(`[${title}${item.hold ? ' ' + HOLD_A : ''}]`)
  // Условие видимости у пункта С КОМАНДАМИ раньше не поддерживалось вовсе: `visible_when`
  // читался только у пунктов-настроек. Пункт установки обновления без этого не спрятать.
  const vc = visCond(item.visible_when)
  if (vc) { lines.push(`;visibility_condition=${vc}`); stats.guards++ }
  if (item.mode) lines.push(`;mode=${item.mode}`)
  // Удержание A читается из карты меню. Раньше `;hold=true` умели только те места,
  // где строки собирались руками (копии, восстановление, импорт), а ключ `hold`
  // из menu.json терялся молча: пункт генерировался, но срабатывал от касания.
  // Для необратимых действий это разница между «подтвердил» и «задел».
  if (item.hold) lines.push(';hold=true')
  for (const c of cmds) lines.push(c)
  lines.push('')

  /**
   * Help rows were collected only from settings items with a kip offset, so an action item
   * lost its `help` silently - and with it the page title, which rides along.
   */
  if (item.help) infoRows.push({ title: item.title ?? item.id, warns: [], help: item.help, platform: item.platform })
  stats.actions++
  if (resetCmds.length) stats.resetFields = resetCmds.length
}

/** A series (GPU curve, timings, pMeh/sMeh) — one item per point. */
function emitSeries(item, lines) {
  const list = bySeries.get(item.series) ?? []
  if (!list.length) { stats.skipped.push({ id: item.id, why: `series ${item.series} is empty` }); return }

  for (const field of list.sort((a, b) => a.offset - b.offset)) {
    if (!(field.values ?? []).length) { stats.skipped.push({ id: `${item.id}@${field.offset}`, why: 'no dictionary' }); continue }
    emitItem({
      id: `${item.id}_${field.offset}`,
      title: field.name ?? `${field.offset}`,
      offsets: [field.offset],
      tag: item.tag ?? item.platform ?? item.id,   // tell same-named points of different curves apart
      platform: item.platform ?? field.platform,   // the whole series inherits the revision
      visible_when: item.visible_when,             // the whole series inherits the condition
    }, lines)
  }
}

// ---------------------------------------------------------------- traversal

function emitSection(node, lines, depth = 0) {
  // only groups need a separator heading; items with commands print their own
  const printsOwnHeader = node.offsets || node.series || node.commands || node.info_table || node.reset_from_defaults || node.backup_restore || node.forwarder_to
  if (node.title && depth > 0 && !printsOwnHeader) {
    lines.push(`[${safeName(node.title)}]`)
    lines.push('')
  }
  if (node.offsets?.length === 1) emitItem(node, lines)
  if (node.series) emitSeries(node, lines)
  if (node.commands || node.info_table || node.reset_from_defaults || node.backup_restore || node.forwarder_to) emitAction(node, lines)
  for (const k of node.children ?? []) emitSection(k, lines, depth + 1)
}

/**
 * Help on the second screen page — a trick borrowed from Ebal: `[@Section]` on the left with
 * the settings, `[@Info]` on the right with the explanations. One press of the right button
 * instead of a separate help section holding 89 text files, one of which never opened at all
 * in the original because of a forbidden character in its name.
 */
function emitInfoPage(rows, lines, sectionTitle) {
  if (!rows.length) return

  // Page layout follows the working reference (`Ebal Tuner/GPU.ini`): TWO `[@Name]` sections
  // in one file, with L/R paging between them. The first one has to be named, otherwise the
  // engine labels it with the internal word "Commands" — which is exactly what was on screen.
  lines.unshift('')
  lines.unshift(`[@${safeName(sectionTitle ?? 'Settings')}]`)

  lines.push(`[@Info]`)
  lines.push('')
  for (const r of rows) {
    // In the reference the block is always called `[Info]`, and the setting name is the first
    // row of the table. That keeps the label from turning into a group heading and dragging a
    // separator along with it.
    lines.push('[Info]')
    lines.push(';mode=table')
    if (r.platform === 'mariko' || r.platform === 'erista') lines.push(`;system=${r.platform}`)
    lines.push(';alignment=left')
    lines.push(';offset=10')       // without an indent the left edge of the text hits the frame
    lines.push(';spacing=4')
    lines.push(';gap=30')
    lines.push(`'${safeName(r.title)}:'=''`)
    const body = [...(r.help ? [r.help] : []), ...r.warns]
    for (const s of body) for (const ln of wrap(s)) lines.push(`''='${ln.replace(/'/g, '`')}'`)
    lines.push('')
    stats.infoBlocks++
  }
}

const rootLines = []
rootLines.push(`;title='4IFIR Wizard'`)
rootLines.push(`;version='0.1.0'`)
rootLines.push(`;creator='Ultrahand-4IFIR project'`)
rootLines.push(`;about='Overclock tuner for 4IFIR, built on Ultrahand. Generated from a verified field map.'`)
rootLines.push(`;color=#00AAFF`)
rootLines.push('')

/**
 * Every section is a separate SUB-PACKAGE with its own `boot_package.ini`.
 *
 * Why: `[boot]` runs when a package is opened and reads the values for the footers. If there
 * is a single boot file for everything, opening the root costs a read of EVERY field. In the
 * reference that is 107 file operations and 57 writes to the SD card on every trip into the
 * menu. Splitting into sub-packages makes the cost proportional to what the reader actually
 * opened.
 *
 * Dictionaries go inside the sub-package: the engine resolves relative paths from the package
 * directory, and a shared directory higher up would need `../`, which is fragile.
 */
/**
 * Recursive: a node whose children have content becomes a sub-package.
 * Returns true if anything was written.
 */
function emitPackage(node, dirPath, depth = 0) {
  const dirName = slug(node.id ?? node.title)
  const here = dirPath ? `${dirPath}/${dirName}` : dirName
  const myBoot = []   // this section's footers: they move up into the parent's forwarder section

  // A child becomes a sub-package when it has children of its own OR a long series: a 24-point
  // curve left inside a section drags 24 footers into that section's boot and makes entering
  // it expensive. The threshold of 12 is roughly one screen of the list.
  const seriesLen = k => (typeof k.series === 'string' && bySeries.get(k.series)?.length) || 0
  // own_package — fold a section by hand even when it is under the threshold: eight timings in
  // a row clogged the RAM list just as badly as a long series.
  const heavyKids = (node.children ?? []).filter(k => k.own_package || (k.children ?? []).length > 0 || seriesLen(k) > 12)
  const ownKids = (node.children ?? []).filter(k => !heavyKids.includes(k))

  const lines = []
  infoRows.length = 0
  bootLines.length = 0
  currentDir = here
  kipGroup = node.title ?? node.id
  kipGroupCtx = node.header_context ?? ''

  // the node's own content
  if (node.offsets?.length === 1) emitItem(node, lines)
  if (node.series) emitSeries(node, lines)
  if (node.commands || node.info_table || node.reset_from_defaults || node.backup_restore || node.forwarder_to) emitAction(node, lines)
  for (const k of ownKids) emitSection(k, lines, depth + 1)

  const ownBoot = [...bootLines]
  const ownInfo = [...infoRows]

  // nested sub-packages: their footers are written when you enter them, not at startup
  const links = []
  for (const k of heavyKids) {
    const kidBoot = emitPackage(k, here, depth + 1)
    if (kidBoot) {
      const kn = slug(k.id ?? k.title)
      // the * sigil is mandatory — without it the item does not open a submenu;
      // package_source points at a FILE inside the subdirectory, not at the directory itself.
      // The name has to be unique within the file: both voltage tables are called the same,
      // and without a tag their [boot] footers would overwrite each other. The engine hides
      // the tag when drawing, and `;system=` leaves exactly one of them on screen — the one
      // that fits this console.
      const raw = safeName(k.title ?? k.id)
      let name = raw
      if (usedTitles.has(raw)) name = `${raw}?${slug(k.platform ?? k.id)}`
      usedTitles.add(name)
      links.push(`[*${name}]`)
      if (k.platform === 'mariko' || k.platform === 'erista') links.push(`;system=${k.platform}`)
      links.push(';mode=forwarder')

      /**
       * THE SECTION'S FOOTERS GO HERE, not into a shared [boot].
       *
       * The engine runs the commands of a forwarder section BEFORE moving into the sub-package
       * (`main.cpp:5784`: `interpretAndExecuteCommands(...)` in the key handler). That is how
       * `exec SystemSettings` works in Ebal's Tools item.
       *
       * What this buys us. Every `set-ini-val` re-reads and rewrites the whole file
       * (`ini_funcs.cpp:736,859`), and all 120 footers used to run when the package opened —
       * before the first screen appeared. Now startup only does what the first screen shows,
       * and a section's footers are read the moment you enter it: the cost is proportional to
       * what the reader actually opened.
       *
       * Paths stay relative to the package root: forwarder commands run in the context of the
       * CURRENT package (`packagePath` on the same line), not of the sub-package.
       */
      /**
       * Seed the sub-package config before entering it. Trackbars read their position only
       * from that file, and an empty one makes `{ini_file}` return null. A forwarder runs
       * its commands before the switch, so this lands in time. Idempotent via `{if_null}`.
       */
      if (k.pre_commands?.length) links.push(...k.pre_commands)

      /**
       * One-time seeding, guarded. `try:` ends the section as soon as a block succeeds, so
       * the footers below have to appear in both branches - the alternative is writing 31
       * cells of loader.kip on every visit just to put the same values back. `package_source`
       * is a declaration read while the item is built, not a command, so `try:` cannot lose it.
       */
      if (k.seed_when?.length && k.seed_write?.length) {
        const foot = kidBoot.length ? [`hex_file '${KIP}'`, ...kidBoot.map(l => l.split(here ? `./${here}/` : './').join('./'))] : []
        links.push('try:', ...k.seed_when, ...k.seed_write, ...foot, 'try:')
      }

      /**
       * Paths are relative to THIS PACKAGE'S DIRECTORY, not to the root.
       *
       * Forwarder commands run with the `packagePath` of the file the forwarder lives in
       * (`main.cpp:5784`). For top-level sections that is the package root, and the path
       * `./advanced/ram/json/x.json` resolves correctly. But a forwarder inside
       * `advanced/ram/package.ini` already runs from `advanced/ram/`, and the same path turns
       * into `advanced/ram/advanced/ram/...` — no such file, empty footer. That is exactly
       * what the operator saw on entering Core Timings and Optimized Mode.
       *
       * So we strip the current directory prefix from every path of the nested section.
       */
      if (kidBoot.length) {
        const prefix = here ? `./${here}/` : './'
        links.push(`hex_file '${KIP}'`, ...kidBoot.map(l => l.split(prefix).join('./')))
      }


      links.push(`package_source './${kn}/package.ini'`, '')
      stats.lazySections = (stats.lazySections ?? 0) + 1
      stats.lazyLines = (stats.lazyLines ?? 0) + kidBoot.length
    }
  }

  // restore our own context after the recursion
  currentDir = here
  kipGroup = node.title ?? node.id
  kipGroupCtx = node.header_context ?? ''
  infoRows.length = 0
  infoRows.push(...ownInfo)

  /**
   * A gated section: an explanation instead of an empty screen.
   *
   * All 31 points of the voltage table are hidden until the undervolt mode is set to Custom
   * Table. That works correctly but looks broken: you open the section and see nothing, not
   * even a word. The engine can negate a condition (`!matching_hex_val_custom`,
   * `utils.hpp:5805`) — so we show the hint exactly when the list itself is hidden.
   */
  if (node.visible_when?.offset != null && lines.length) {
    const v = node.visible_when
    lines.push('[Not in use]')
    lines.push(';mode=table')
    lines.push(`;visibility_condition=!matching_hex_val_custom ${KIP} CUST ${v.offset} ${v.value}`)
    lines.push(';alignment=left')
    lines.push(';offset=10')
    lines.push(';spacing=4')
    lines.push(';gap=20')
    for (const ln of wrap('This table is not in use right now. Set GPU - Undervolt Mode to Custom Table to switch it on. Until then the kip picks the voltages itself.')) {
      lines.push(`''='${ln}'`)
    }
    lines.push('')
  }

  const body = [...links, ...lines]
  if (!body.length) return null

  emitInfoPage(infoRows, body, node.title ?? node.id)

  /**
   * A sub-package cannot name its own screen: the engine takes the subtitle from the last
   * header in the PARENT list, and prints "Commands" or the version when there is none.
   * `;subtitle=` is our fork's key for it (patches/0003). Details: NOTES 231.
   */
  body.unshift(`;subtitle='${safeName(node.title ?? node.id)}'`, '')
  write(`${here}/package.ini`, body.join('\n'))

  // Hand our own footers up: the parent's forwarder will run them when you enter this section.
  myBoot.push(...ownBoot)
  stats.packages++
  return myBoot
}

/**
 * A top-level section with no children is just an item, not a section.
 * It must not be wrapped in a sub-package: the forwarder and the item itself would get the
 * same name, and since `[boot]` addresses footers by name, one would overwrite the other.
 */
const rootBoot = []
for (const s of menu.sections) {
  const isPlainItem = !(s.children ?? []).length && (s.offsets?.length || s.commands || s.info_table)

  if (isPlainItem) {
    currentDir = ''
    bootLines.length = 0
    emitSection(s, rootLines, 1)
    rootBoot.push(...bootLines)
    continue
  }

  const secBoot = emitPackage(s, '')
  if (!secBoot) continue
  const dirName = slug(s.id ?? s.title)
  rootLines.push(`[*${safeName(s.title ?? s.id)}]`)
  rootLines.push(`;mode=forwarder`)
  // a section's footers are read when you enter it — see the explanation in emitPackage
  if (secBoot.length) rootLines.push(`hex_file '${KIP}'`, ...secBoot)
  rootLines.push(`package_source './${dirName}/package.ini'`)
  rootLines.push('')
  stats.lazyLines = (stats.lazyLines ?? 0) + secBoot.length
}

/**
 * ПОРЯДОК СТРОК ВНУТРИ ГРУППЫ, заданный человеком, а не структурой кипа.
 *
 * Ключ — имя группы, значение — смещения в том порядке, в каком их читают глазами.
 * Всё, чего здесь нет, идёт как лежит в карте полей.
 *
 * Для RAM порядок задан оператором: сперва то, что человек крутит (частота, режим eBal,
 * сдвиг), потом напряжения, и в конце режим DVB. Смещения 32 и 24 — одно и то же поле
 * «Frequency» на разных ревизиях, поэтому стоят рядом: в готовую таблицу попадёт ровно одно.
 */
const GROUP_ORDER = {
  RAM: [32, 24, 12352, 12360, 36, 16, 56],
}

/**
 * The "Current Settings" page — what is written in loader.kip right now.
 *
 * Nothing like it existed in 4IFIR Wizard or in Ebal: every section summarised on one screen,
 * without opening a single item. Values are substituted as the page is drawn
 * (`;mode=table` + `{json_file(0,{hex_file(...)})}`), so the page is always honest — it reads
 * the kip, not some remembered menu state.
 *
 * It lives in the PACKAGE ROOT: the dictionary paths are the same as in the root boot file and
 * are already proven. From a subdirectory we would have to go through `../`, which we avoid.
 *
 * One caveat the reader should know: fields left on automatic hold zeros, so what you see here
 * is the intent ("the kip works it out") rather than the resulting voltage — the device
 * computes that at boot.
 */
if (kipRows.length) {
  // Long rows move to a second page: eight timings, twenty-two pMeh, seventeen sMeh and fifty
  // points of two curves together made a wall of text in which no single value could be found.
  //
  // We split by SECTION, not by series: six pMeh/sMeh fields are deliberately duplicated into
  // CPU, GPU and RAM under understandable names (eBAMATIC Stage, vMin Offset, …). Split by
  // series they would drift off to their numbers, while people look for them among the
  // ordinary settings.
  //
  // The voltage curves go to the SECOND page: they are long, and the first page has to stay
  // readable. See PAGE2_SERIES below — it is what actually decides, and this caption used to
  // claim the opposite.
  // Which rows belong on the second page — decided by the SERIES, not by the section title.
  //
  // This used to be a set of literal captions: `['pMeh 0-21', 'sMeh 0-16']`. Adding pMeh 22
  // and sMeh 17 renamed those sections to `0-22` and `0-17`, the match stopped firing, and
  // all 43 rows silently moved back to the first page — the exact layout the operator had
  // asked to change. Nothing failed: the file was generated, every check stayed green, and
  // the defect was visible only on the console.
  //
  // A caption is a label for a human and changes whenever the contents change. A series is
  // what the field IS. Keying behaviour off the caption tied the layout to a string that is
  // meant to drift.
  const DEEP_SERIES = new Set(['pMeh', 'sMeh', 'core_timings'])
  const isDeep = r => DEEP_SERIES.has(r.series)

  /**
   * A `mariko:` / `erista:` label stays in force until the next label and never falls back to
   * "both revisions" (utils.hpp:1319). So rows inside a group are ordered by platform: shared
   * first, then Erista, then Mariko — each label is written once.
   */
  /**
   * Where the raw value comes from. Two callers, same rows:
   *   FROM_KIP  — the live kip, for "Current Settings"
   *   FROM_INI  — a backup or Default.ini, for the preview before applying
   *
   * The formats match bit for bit: a backup stores `Fields <off> = {hex_file(CUST,off,len)}`,
   * so the string in the file is exactly what the kip reading would have produced. That is
   * what makes the same dictionaries work for both without a single change.
   */
  // Читаем ровно то же, что и меню: у ступеней GPU одна ячейка неоднозначна, нужна пара.
  // Разойдись эти два места — сводная страница называла бы ступень иначе, чем сам пункт.
  const FROM_KIP = r => `{hex_file(CUST,${r.offset},${r.len})}`
                      + (r.probe ? `{hex_file(CUST,${r.probe.offset},${r.probe.len})}` : '')
  const FROM_INI = r => `{ini_file(Fields,${r.offset})}`

  // Точки кривой показываются вычислением: `curveValue` и `isCurve` объявлены на верхнем
  // уровне, потому что тем же значением подписывается и пункт меню, а он порождается
  // раньше этого места.

  const emitGroupRows = (kl, rows, valueOf = FROM_KIP, scoped = false) => {
    const order = { both: 0, erista: 1, mariko: 2 }
    // `scoped` — таблица уже ограничена одной ревизией через `;system=`, метки внутри
    // не нужны, а значит и сортировка по платформе не нужна: порядок строк свободен.
    const sorted = scoped ? [...rows]
                          : [...rows].sort((a, b) => (order[a.platform] ?? 0) - (order[b.platform] ?? 0))
    let lastPlat = scoped ? 'skip' : null
    let lastMap = null
    for (const r of sorted) {
      const plat = r.platform === 'mariko' || r.platform === 'erista' ? r.platform : 'both'
      if (!scoped && plat !== lastPlat) {
        if (plat !== 'both') kl.push(`${plat}:`)
        lastPlat = plat
        lastMap = null              // dictionary declarations do not survive a branch change
      }
      // ТОЧКА КРИВОЙ СЛОВАРЯ НЕ ОТКРЫВАЕТ ВОВСЕ — ни объявления, ни подстановки.
      // `lastMap` при этом не трогаем: объявление `json_file` это КУРСОР, и раз мы его
      // не двигаем, следующая словарная строка с тем же словарём вправе не объявлять его
      // заново.
      if (isCurve(r)) {
        kl.push(`'${safeName(r.title)}' = '${curveValue(r, valueOf === FROM_INI)}'`)
        continue
      }
      // `json_file` is declared once per run of consecutive rows sharing a dictionary:
      // that is what the reference does, and extra declarations only slow the parse down.
      if (r.map !== lastMap) { kl.push(`json_file '${r.map}'`); lastMap = r.map }
      kl.push(`'${safeName(r.title)}' = '{json_file(0,${valueOf(r)})}'`)
    }
  }

  /**
   * `src` — строки объявления источника, которые ставятся перед каждой таблицей.
   * Для живого kip это `hex_file '<kip>'`; для превью бэкапа — привязка к config.ini
   * и следом к выбранному файлу. Объявлять надо в КАЖДОЙ таблице: привязка не переживает
   * границу секции.
   */
  const emitPage = (kl, rows, src = [`hex_file '${KIP}'`], valueOf = FROM_KIP) => {
    const groups = []
    for (const r of rows) {
      const g = groups.at(-1)
      if (g && g.name === r.group) g.rows.push(r)
      else groups.push({ name: r.group, ctx: r.groupCtx, rows: [r] })
    }
    // Одна таблица группы: отступ, заголовок, строки.
    const emitOne = (g, rows, sys, scoped) => {
      // Если ВСЕ строки группы живут под одним условием — условие переезжает на её таблицы.
      // Частичное совпадение не годится: спрятали бы заодно и то, что видно всегда.
      const conds = new Set(rows.map(r => r.visible_when ? `${r.visible_when.offset}|${r.visible_when.value}` : ''))
      const vc = conds.size === 1 && [...conds][0] ? visCond(rows[0].visible_when) : null
      const gate = vc ? [`;visibility_condition=${vc}`] : []
      // A gap BEFORE the heading, not only between tables: without it the next section's
      // caption was printed flush against the previous frame and overlapped it.
      kl.push('[Gap]', ';mode=table', ';background=false', ...sys, ...gate, `;gap=${HEAD_GAP}`, '')
      kl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false', ...sys, ...gate,
              `'${safeName(g.name)}' = '${g.ctx ?? ''}'`, '')
      kl.push('[Info]', ';mode=table', ';spacing=0', ';gap=0', ...sys, ...gate, ...src)
      emitGroupRows(kl, rows, valueOf, scoped)
      kl.push('')
    }

    const platOf = r => (r.platform === 'mariko' || r.platform === 'erista' ? r.platform : 'both')

    for (const g of groups) {
      // If EVERY row of a group belongs to one revision, the heading is tagged the same way.
      // Without this, Mariko was left with a "Voltage Curve (Erista)" caption over an empty
      // frame: the engine filtered the rows out but not the heading, which it cannot see.
      const plats = new Set(g.rows.map(platOf))
      const only = plats.size === 1 ? [...plats][0] : null
      const wanted = GROUP_ORDER[g.name]
      const inOrder = rows => wanted
        ? [...rows].sort((a, b) => wanted.indexOf(a.offset) - wanted.indexOf(b.offset))
        : rows

      // КРИВАЯ GPU В СВОДКЕ ПОКАЗЫВАЕТ ТУ ТАБЛИЦУ, КОТОРУЮ ПРОШИВКА СЕЙЧАС ЧИТАЕТ.
      //
      // Блок остаётся прежним на вид — «GPU Voltage Table» и те же строки частот, — но
      // источник у него меняется вместе с режимом. Раньше он всегда читал редактируемый
      // массив, а прошивка берёт его ТОЛЬКО в режиме Custom Table: человек выбирал ступень,
      // открывал сводку и видел прежние числа, решая, что ступень не применилась.
      //
      // Печатается по варианту на каждый режим ступени, на экране появляется ровно один:
      // движок вычисляет условие видимости при построении страницы и чужие блоки
      // не создаёт вовсе. Вариант для Custom Table — это сама группа ниже, у неё своё
      // условие уже стоит в карте меню.
      //
      // Значения читаются ИЗ ЖИВОГО KIP. Словарь подписей не нужен: микровольты делятся
      // на тысячу прямо в подстановке, а «mV» и так стоит в каждой строке этой сводки.
      // Группа «GPU Voltage Table» СМЕШАННАЯ: в неё попадают строки обеих ревизий,
      // 31 точка Mariko и 29 Erista. Берём только свои — иначе блок печатает и чужие,
      // и таблица на экране становится вдвое длиннее. Ровно это и случилось.
      const mrows = g.rows.filter(r => r.series === 'gpu_curve_mariko')
      if (mrows.length && curveTables) {
        // Таблицы читаются мариковские, значит и блок мариковский. Метка обязательна:
        // без неё блок показался бы и на Erista, где этих таблиц нет.
        const sys = [';system=mariko']
        for (const m of curveTables.modes) {
          const cond = [`;visibility_condition=matching_hex_val_custom ${KIP} CUST 44 ${m.hex}`]
          kl.push('[Gap]', ';mode=table', ';background=false', ...sys, ...cond, `;gap=${HEAD_GAP}`, '')
          kl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false', ...sys, ...cond,
                  // Подпись справа пустая — как было до правки. Какая ступень выбрана,
                  // говорит строка `Undervolt Mode` выше, дублировать её здесь незачем.
                  `'${safeName(g.name)}' = ''`, '')
          kl.push('[Info]', ';mode=table', ';spacing=0', ';gap=0', ...sys, ...cond,
                  `hex_file '${KIP}'`, `json_file '${curveTables.map}'`)
          /**
           * ПОДПИСИ БЕРЁМ У ТАБЛИЦЫ, А НЕ У ГРУППЫ МЕНЮ.
           *
           * У настоящих таблиц тридцать одна строка. Пока меню выдавало двадцать четыре
           * точки — по объявленному размеру массива, — подписи из группы резали сводку
           * СВЕРХУ: 1228…1420 МГц и потолок не показывались вовсе, а это разгонный конец
           * кривой, ради которого тюнер и открывают. Источник подписей — сама таблица,
           * и от числа выданных точек сводка больше не зависит.
           */
          const labels = curveTables.labels.length ? curveTables.labels : mrows.map(r => r.title)
          labels.forEach((title, i) => {
            const off = m.base + curveTables.step * i + 32
            kl.push(`'${safeName(title)}' = '{json_file(0,{hex_file(CUST,${off},4)})}'`)
          })
          /**
           * ПОСЛЕДНЯЯ СТРОКА — ПОТОЛОК, И ПОДПИСАТЬ ЕГО ЧИСЛОМ НЕЛЬЗЯ.
           *
           * Блок выбирается по РЕЖИМУ, а режим `01` обслуживают три ступени сразу:
           * ST1.5 с потолком 1459,2 МГц, ST2 и ST2.5 с 1536. Постоянная подпись «1536MHz»
           * врала бы на ST1.5 — а потолок по решению оператора и есть главное отличие
           * половинчатой ступени от соседки.
           *
           * Поэтому подпись слева постоянная, а частота читается из живого kip и
           * переводится в текст тем же словарём. Ступень называет себя сама, и любая
           * будущая подхватится без правки.
           *
           * Напряжение верхней строки не показываем: у всех таблиц оно одно и то же,
           * 960 мВ — это предел шины, а не свойство ступени.
           */
          if (curveTables.labels.length) {
            const top = m.base + curveTables.step * curveTables.labels.length
            kl.push(`'Max Clock' = '{json_file(0,{hex_file(CUST,${top},4)})}'`)
          }
          kl.push('')
        }
      }

      if (plats.size > 1) {
        // СМЕШАННАЯ ГРУППА ПЕЧАТАЕТСЯ ДВУМЯ ТАБЛИЦАМИ, ПО ОДНОЙ НА РЕВИЗИЮ.
        //
        // Иначе порядок строк не наш, а движка: метка `mariko:` действует до следующей
        // метки и НИКОГДА не возвращается к «обеим» (utils.hpp:1319), поэтому все общие
        // строки вынуждены идти первыми. Пока таблица была одна, «Frequency» не могла
        // стоять первой — она платформенная, а общие лезли вперёд.
        //
        // Ограничение таблицы через `;system=` снимает это целиком: внутри одной ревизии
        // меток нет, порядок свободен, и он одинаков на обеих консолях. Цена — вторая
        // таблица в файле, из которых читателю всегда видна ровно одна.
        for (const rev of ['mariko', 'erista']) {
          const rows = inOrder(g.rows.filter(r => platOf(r) === 'both' || platOf(r) === rev))
          if (rows.length) emitOne(g, rows, [`;system=${rev}`], true)
        }
      } else {
        const sys = only && only !== 'both' ? [`;system=${only}`] : []
        emitOne(g, inOrder(g.rows), sys, false)
      }
    }
  }

  /**
   * РАССТАНОВКА ПО СТРАНИЦАМ — РЕШЕНИЕ ОПЕРАТОРА, А НЕ СЛЕДСТВИЕ СЕРИИ.
   *
   * По умолчанию страница выводится из серии поля: длинные ряды (pMeh, sMeh, тайминги)
   * уходят на вторую. Но у трёх мест читательская логика спорит с этим правилом,
   * и правило уступает — оно про длину, а страница про то, где читатель это ищет.
   *
   *   `12436 eBAMATIC Stage` — общий выключатель всей автоматики. Смотрят на него первым,
   *   значит и стоять он должен первым, а не среди внутренних рядов.
   *
   *   `12440` и `12448` — смещения GPU vMin. Их читают вместе с самим vMin, поэтому
   *   они переезжают в блок GPU и встают его последними строками: сперва настройка,
   *   потом её подстройка.
   *
   *   Кривая напряжений GPU — наоборот, ряд на два десятка строк, и на первой странице
   *   она заслоняла всё остальное. Уходит на вторую, но не в конец: её место сразу
   *   за «Optimized Mode (1600 MHz)» и перед таймингами.
   */
  const PAGE1_FORCED = new Set([12436, 12440, 12448])
  const PAGE2_SERIES = new Set(['gpu_curve_mariko', 'gpu_curve_erista'])
  // Отбираем по смещению И ПО БЛОКУ: у всех трёх полей есть двойники в аварийных рядах
  // `pMeh`/`sMeh` — та самая вторая дверь для KIP tool в hekate. Их место на второй
  // странице, среди своих номеров, иначе один и тот же байт покажется дважды подряд.
  // Отбираем по смещению И ПО БЛОКУ. У всех трёх полей есть двойники в аварийных рядах
  // pMeh/sMeh — та самая вторая дверь для KIP tool в hekate (ANCHORS, граница работ).
  // Их место на второй странице, среди своих номеров: иначе один и тот же байт покажется
  // дважды подряд. Блоки перечислены явно, а не выведены из имени ряда: имя — подпись
  // для человека, оно меняется, а список блоков это решение и меняться должно осознанно.
  const PAGE1_GROUPS = new Set(['General', 'GPU'])
  const onPage2 = r => (isDeep(r) && !(PAGE1_FORCED.has(r.offset) && PAGE1_GROUPS.has(r.group)))
                    || PAGE2_SERIES.has(r.series)

  const main = (() => {
    const rows = kipRows.filter(r => !onPage2(r))
    // `eBAMATIC Stage` — в самое начало страницы, остальное в прежнем порядке.
    const head = rows.filter(r => r.offset === 12436)
    return [...head, ...rows.filter(r => r.offset !== 12436)]
  })()

  /**
   * ВЫКЛЮЧАТЕЛЬ БЛОКА «НАПРЯЖЕНИЯ ПО РЕЖИМУ». Пока `false` — блок не печатается.
   *
   * Замысел был такой: Vdd2 и Vddq в кипе это ПЕРЕОПРЕДЕЛЕНИЯ, и в заводском состоянии
   * там нули. Какое напряжение уйдёт в память на самом деле, решает связка «частота памяти
   * + уровень eBal», и таблица этого соответствия есть только у нас. Блок показывал именно
   * её: не что записано в кипе, а что кип выберет сам.
   *
   * Почему спрятан — две причины, и обе честные.
   *
   * 1. **Пусто у большинства.** Строка заполняется, только если частота и eBal закреплены
   *    руками. На автомате (а это состояние по умолчанию) движку неоткуда взять реальные
   *    значения: ни `clkrstGetClockRate`, ни `pcvGetClockRate` ему не доступны, и прошивка
   *    свой выбор нигде не записывает. Пустая строка на видном месте хуже отсутствующей.
   * 2. **Заголовок ничего не объяснял.** «What the mode would give» не сообщает читателю
   *    ни что за mode, ни что за give. Название придумано от механики, а не от вопроса,
   *    на который блок отвечает.
   *
   * Что нужно, чтобы вернуть: заполнять строку и на автомате — то есть либо правка движка
   * (доступ к реальным частотам), либо честная подпись «auto — kip decides at boot» вместо
   * пустоты; и заголовок, названный по вопросу читателя, вроде «Memory voltage the kip picks».
   * Данные для этого никуда не делись: `emc_mode_voltage_table` в dependencies.json.
   */
  const SHOW_MODE_VOLTAGES = false

  /**
   * НАПРЯЖЕНИЯ ПАМЯТИ, КОТОРЫЕ ВЫБИРАЕТ САМ KIP.
   *
   * У Vdd2 и Vddq нет «значения по умолчанию»: какое напряжение уйдёт в память, решает
   * скорость памяти вместе с уровнем eBal, а поля 16 и 36 это решение переопределяют.
   * Таблица соответствия есть только у нас — ни один из донорских пакетов её не показывал
   * (`emc_mode_voltage_table` в dependencies.json, источник — исходник прошивки).
   *
   * ЧЕГО ЭТО НЕ УМЕЕТ, и это не лечится пакетом. На стоковой консоли и частота памяти,
   * и eBal стоят на автомате (в кипе оба нуля), а движок не умеет читать реальные частоты:
   * ни `clkrstGetClockRate`, ни `pcvGetClockRate` ему не доступны, и прошивка нигде
   * не записывает, что именно выбрала. Значит строка покажет значение только тому, кто
   * закрепил режим руками, и промолчит у того, кто оставил автомат.
   *
   * Vddq зависит ТОЛЬКО от частоты, поэтому его видно всегда, когда частота закреплена.
   * Vdd2 требует и частоту, и eBal, и в таблице часть сочетаний помечена как недоступные.
   */
  function emitModeVoltages(kl) {
    if (!SHOW_MODE_VOLTAGES) return
    const table = DEPS?.emc_mode_voltage_table
    if (!table?.rows?.length) return

    const hex = v => v.toString(16).toUpperCase().padStart(6, '0').match(/../g).reverse().join('')
    const vddq = {}
    const vdd2 = {}
    for (const [, , khz, vq, ...byEbal] of table.rows) {
      const speed = hex(khz)
      if (vq != null) vddq[speed] = `${vq} mV`
      byEbal.forEach((mv, i) => {
        if (mv != null) vdd2[`${speed}|${hex(i + 1)}`] = `${mv} mV`
      })
    }

    // Пути от корня пакета: current.ini лежит в корне и видит их как ./json/...
    const vqFile = './json/mode_vddq.map.json'
    const v2File = './json/mode_vdd2.map.json'
    write('json/mode_vddq.map.json', JSON.stringify([vddq], null, 2))
    write('json/mode_vdd2.map.json', JSON.stringify([vdd2], null, 2))

    kl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
    kl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
            `'What the mode would give' = ''`, '')
    kl.push('[Info]', ';mode=table', ';spacing=0', ';gap=0', `hex_file '${KIP}'`)
    // Ключ второй таблицы склеивается из двух прочитанных значений: подстановки
    // раскрываются раньше, чем json_file разбирает аргумент, поэтому на вход приходит
    // готовая строка вида `006A18|010000`.
    for (const [rev, speedOff] of [['mariko', 32], ['erista', 24]]) {
      kl.push(`${rev}:`)
      kl.push(`json_file '${vqFile}'`)
      kl.push(`'Vddq by mode' = '{json_file(0,{hex_file(CUST,${speedOff},3)})}'`)
      kl.push(`json_file '${v2File}'`)
      kl.push(`'Vdd2 by mode' = '{json_file(0,{hex_file(CUST,${speedOff},3)}|{hex_file(CUST,12352,3)})}'`)
    }
    kl.push('')
    kl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
    kl.push('[Note]', ';mode=table', ';background=false', ';alignment=left', ';offset=10', ';spacing=4', ';gap=0')
    for (const ln of wrap('Shown only when the RAM speed and eBal mode are pinned by hand. '
                        + 'On automatic the kip decides at boot and records the result nowhere readable.')) {
      kl.push(`''='${ln}'`)
    }
    kl.push('')
  }

  const deep = (() => {
    const rows = kipRows.filter(onPage2)
    const curve = rows.filter(r => PAGE2_SERIES.has(r.series))
    const rest = rows.filter(r => !PAGE2_SERIES.has(r.series))
    // Вставляем кривую сразу за последней строкой блока «Optimized Mode»: группы на странице
    // склеиваются из ПОДРЯД идущих строк с одинаковым `group`, поэтому место определяется
    // положением в массиве, а не отдельным ключом сортировки.
    const after = rest.map(r => r.group).lastIndexOf('Optimized Mode (1600 MHz)')
    if (!curve.length || after < 0) return [...rest, ...curve]
    return [...rest.slice(0, after + 1), ...curve, ...rest.slice(after + 1)]
  })()

  // Подпись экрана — см. пояснение у `;subtitle=` в конце `emitPackage`.
  const kl = [`;subtitle='Current Settings'`, '', `[@Current]`, '']
  emitPage(kl, main)
  emitModeVoltages(kl)
  // The note goes right at the bottom and without a frame: its own frame overlapped the last table.
  kl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
  kl.push('[Note]', ';mode=table', ';background=false', ';alignment=left', ';offset=10', ';spacing=4', ';gap=0')
  for (const ln of wrap('Fields left on automatic hold a zero: the kip works the real value out at boot.')) {
    kl.push(`''='${ln}'`)
  }
  kl.push('')

  if (deep.length) {
    kl.push('[@Page 2]', '')
    emitPage(kl, deep)
  }
  write('current.ini', kl.join('\n'))

  /**
   * ПРЕДПРОСМОТР ПЕРЕД ПРИМЕНЕНИЕМ — для бэкапов и для заводского набора.
   *
   * Раньше выбор файла из списка СРАЗУ писал ~90 значений в kip: ни увидеть, что внутри,
   * ни передумать. Теперь выбор только запоминает путь, экран показывает содержимое теми же
   * таблицами, что и «Current Settings», и только отдельный пункт применяет.
   *
   * Как это держится:
   *   1. `set-ini-val './config.ini' Restore Path '{file_source}'` — выбор запоминается;
   *   2. `refresh-return` заставляет движок пересобрать родительскую страницу при возврате
   *      (`main.cpp:4374`, действует ТОЛЬКО в списке выбора) — иначе таблица осталась бы
   *      старой, движок вернул бы прежний объект экрана;
   *   3. `ini_file './config.ini'` затем `ini_file '{ini_file(Restore,Path)}'` — плейсхолдер
   *      в аргументе разрешается ДО того, как аргумент станет новым путём (`utils.hpp:1322`
   *      против `:1354`), поэтому вторая строка перепривязывает чтение к выбранному файлу;
   *   4. значения совпадают с форматом бэкапа бит в бит, поэтому идут те же словари.
   *
   * ЭТОТ БЛОК ОПИСЫВАЕТ ОТМЕНЁННОЕ УСТРОЙСТВО. Оставлен как история решения, но по нему
   * НЕЛЬЗЯ судить о том, что делает код: `refresh-return` из пункта 2 на консоли не
   * сработал и в пакете его нет, а `;polling=true`, который здесь объявлен неприемлемым,
   * ниже включается для страницы выбора — и работает. Действующее объяснение стоит
   * в следующем блоке.
   *
   * Расхождение найдено аудитом 01.09.2026. Это второй случай в этом же файле, когда два
   * комментария подряд утверждали противоположное; первый разобран у таблицы имени копии.
   * Опасность у них разная: там расходились описания, здесь — рекомендации. Тот, кто
   * поверил бы верхнему блоку и «починил» полинг, сломал бы работающий экран.
   */
  /**
   * Пути к словарям считаются ОТ КОРНЯ ПАКЕТА, потому что так их видит `current.ini`.
   * Страницы предпросмотра лежат на уровень глубже, в `service/`, и то же `./advanced/...`
   * развернулось бы у них в `service/advanced/...`.
   *
   * Четвёртый случай в проекте, когда относительный путь оказался бессмыслен без ответа
   * «относительно чего» (до этого: `package_source`, словари в подпакетах, форвардеры).
   * Поэтому не «поправить руками», а пересчитать при выводе — глубиной, а не заменой строк.
   */
  const rebase = (p, depth) => p && depth ? p.replace(/^\.\//, './' + '../'.repeat(depth)) : p
  /**
   * ПРЕДПРОСМОТР ПЕРЕД ПРИМЕНЕНИЕМ.
   *
   * Выбрал копию — увидел, что в ней и что будет записано; применяет отдельный пункт.
   *
   * ПОЧЕМУ НЕ `refresh-return`. Первая версия строилась на нём: он заставляет движок
   * пересобрать страницу при возврате из списка выбора. На консоли это не сработало —
   * `main.cpp:4374` вместе с пересборкой делает `swapTo<PackageMenu>(SwapDepth(2))`
   * и ставит `inSubPackageMenu = false`, то есть возвращает на два уровня вверх и как
   * в обычный пакет. У Ebal список лежит в пакете верхнего уровня и попадает куда надо,
   * а наша страница — подпакет внутри Service, и человека выбрасывало мимо неё.
   *
   * Взят приём, которым Ebal пользуется годами: `;polling=true` — таблица пересобирается
   * сама, раз в секунду, пока видна. Возврат из списка при этом обычный.
   *
   * ПОЧЕМУ СВОДКА, А НЕ ВСЕ 95 СТРОК. Опрос стоит чтения файла на каждую подстановку.
   * Сотня строк раз в секунду — это сотня открытий файла в секунду; у Ebal таблицы по
   * шесть строк, он может себе позволить. Но дело не только в скорости: экран на 95 строк
   * нечитаем, а решение принимается по десятку значений. Показываем паспорт копии и
   * ключевые настройки; полный состав всегда виден в самом файле с ПК.
   */
  const emitPreviewPage = (file, opts) => {
    // `only` — множество смещений, которые в файле-источнике ДЕЙСТВИТЕЛЬНО есть.
    // Без него страница сброса показывала строку `Frequency` для смещения 24, которого
    // в заводском снимке нет вовсе: движок возвращал null, таблица печатала «недоступно»,
    // и рядом стояли две одинаково подписанные строки — одна с числом, вторая пустая.
    //
    // `polling` нужен только там, где источник меняется по ходу дела (выбор копии).
    // У заводского снимка файл неизменный, и опрос раз в секунду просто жёг бы батарею.
    const { title, rev, source, chooser, apply, del, note, note2, create = null, depth = 0, only = null } = opts
    const poll = chooser ? [';polling=true'] : []
    // Подпись экрана — тем же ключом, что и у подпакетов; см. пояснение у `;subtitle=`
    // в конце `emitPackage`. Без него движок подписывал эти два экрана словом `Commands`.
    const pl = [`;subtitle='${safeName(title)}'`, '', `[@${safeName(title)}]`, '']

    /**
     * Choose first, create second.
     *
     * Create used to sit on top and was mis-clicked: reaching for a backup you already
     * have, you make another one instead. Choosing is what people come here for; making
     * a new copy is the rare case, and it is the only irreversible-looking one on this
     * page. Operator's call, 04.09.2026.
     *
     * No gap between the two. Gaps on this page separate an item from a TABLE, where the
     * highlight of a selected row overlaps the table frame. Two plain items in a row need
     * nothing between them.
     */
    if (chooser) pl.push(...chooser)

    if (create) pl.push(...create, '')

    // Паспорт копии — ДВЕ СТРОКИ, и это результат разбора, а не экономии места.
    //
    // Было пять. Три убраны, потому что не отвечали ни на один вопрос человека:
    //
    //   `File`   — НЕ РАБОТАЛА НИКОГДА. Строкой выше `ini_file` перепривязан на файл
    //              копии, а `[Restore] Name` есть только в `config.ini` пакета. Движок
    //              возвращал литерал `null`, таблица печатала «Not available» — с первого
    //              дня и всегда. Имя выбранной копии теперь стоит подписью на самом
    //              пункте выбора, где его и ищут (`docs/NOTES.md` №152);
    //   `Taken`  — дубль: дата и время уже стоят в имени файла, которое видно в списке;
    //   `Fields` — не счёт, а КОНСТАНТА: число вписывает сюда генератор. Обрезанный файл
    //              она поймать не может, зато обманывает — 88 значит «своя» на Erista
    //              и «импортированная» на Mariko.
    //
    // Остались две, и каждая отвечает на свой вопрос перед записью в kip:
    //   `Memory` — на какой памяти снята копия. Единственная строка, несущая то, чего
    //              человек не знает и не может посмотреть рядом;
    //   `Kip layout` — видно ВСЕГДА, иначе отказ применить копию выглядел бы поломкой.
    //              На неё же ссылается заметка под сводкой, объясняя слово `imported`.
    pl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')

    // ВЫБРАННАЯ КОПИЯ — ЗАГОЛОВОК И ИМЯ ДВУМЯ СТРОКАМИ, а не подписью на пункте.
    //
    // Было: имя стояло справа на самом пункте выбора (`set-footer`), а `;grouping=split`
    // кладёт подпись и значение в ОДНУ строку. Ширину делит движок: футер резервирует
    // своё место, имени пункта достаётся остаток (`tesla.hpp:9491-9493`). Имя копии
    // длинное всегда — частота, режим и метка времени, — поэтому подпись обречена: на
    // снимке оператора от слова `Backup` осталось `Bac`.
    //
    // Стало: заголовок своей строкой, имя своей, прижатое влево. Целиком помещается:
    // строке таблицы отведено 346 пикселей (`utils.hpp:1637-1644`), а имя копии занимает
    // около 260 даже с пометкой `imp`.
    //
    // БЕГУЩЕЙ СТРОКИ ЗДЕСЬ НЕТ, И ЭТО НАДО ЗНАТЬ. Прокрутка текста живёт только у
    // пунктов-строк и только пока пункт выделен (`tesla.hpp:9548`); таблицы рисуют
    // текст одним вызовом без смещения (`utils.hpp:1701-1712`), а при переполнении
    // молча обрезают — `wrappingMode` по умолчанию `none`. Флаг `isScrollableTable`
    // (`main.cpp:4790`) к тексту отношения не имеет: он говорит списку, что элемент
    // нефокусируемый. Я на него сослался и ошибся, проверка поймала.
    //
    // Значит имя, переехав с пункта в таблицу, потеряло способность прокручиваться.
    // Разменяно сознательно: на пункте оно эту способность имело, но там же и съедало
    // подпись. Если имена когда-нибудь станут длиннее трёхсот пикселей, выбор будет
    // между обрезкой здесь и обрезкой подписи там — либо правкой движка.
    //
    // Слово тоже сменилось. `Backup` над именем читалось как название раздела, а не как
    // «вот что вы выбрали»; на пункте выше теперь стоит `Choose backup`, здесь —
    // `Selected backup`, и вместе они читаются как приглашение и ответ.
    if (chooser) {
      pl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
              `'Selected backup' = ''`, '')
      pl.push('[Info]', ';mode=table', ';background=false', ';alignment=left',
              ';offset=10', ';spacing=0', ';gap=0', ';polling=true',
              `ini_file './config.ini'`,
              `''='{ini_file(Restore,Name)}'`, '')
      pl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
    }

    pl.push('[Info]', ';mode=table', ...poll, ';spacing=0', ';gap=0', ...source)
    if (chooser) pl.push(`'Memory' = '{ini_file(Meta,ram)}'`)
    pl.push(`'Kip layout' = '{ini_file(Meta,kipver)}'`, '')

    /**
     * Warning when the chosen backup comes from the other console model. The passport
     * itself is frozen at two rows and never shows the revision - this appears only on a
     * mismatch. A separate table section because colour is per-section; literal FF0000
     * because a bundled theme redefines the name "warning" to cyan; `{if_==}` with an
     * empty branch because `;visibility_condition=` expands no `{ini_file}` and the page
     * is never rebuilt after the choice. Compare against the OTHER revision, not "not
     * ours" - an unselected backup reads empty and would light it up for everyone.
     * No commas or brackets in the text: `{if_==}` splits on the last comma.
     */
    if (chooser) {
      const other = rev === 'mariko' ? 'erista' : 'mariko'
      const said  = rev === 'mariko' ? 'Erista backup on a Mariko console'
                                     : 'Mariko backup on an Erista console'
      pl.push('[Warning]', ';mode=table', ';background=false', ';alignment=left',
              ';offset=10', ';spacing=0', ';gap=0', ';polling=true', ';info_text_color=FF0000',
              ...source,
              `''='{if_==({ini_file(Meta,revision)},${other},${said},)}'`,
              `''='{if_==({ini_file(Meta,revision)},${other},It will not be applied.,)}'`, '')

      /**
       * Second warning, and NOT in the red block above: that one is frozen by the operator
       * at exactly one section and one shape, checked line by line (check 39). This is a
       * different message anyway - the copy fits this console and will be applied, it just
       * carries less than it looks like it does.
       *
       * The flag is computed when the file is chosen; here we only print it. Plain text
       * with no cell numbers: what the reader needs is that the top of the curve stays as
       * it is and has to be set by hand. Wrapped by the same helper as the note below, so
       * the rows fit the overlay instead of being clipped mid-word.
       */
      pl.push('[Info]', ';mode=table', ';background=false', ';alignment=left',
              ';offset=10', ';spacing=0', ';gap=0', ';polling=true',
              `ini_file './config.ini'`,
              ...wrap(rev === 'mariko'
                // На Mariko потеря названа прямо: копия старее расширения кривой с 24 точек
                // до 31, и не хватает именно верха. На Erista этих точек не было никогда,
                // поэтому там текст общий — он ждёт следующего расширения карты.
                ? 'Older backup - the top GPU voltage points are missing. Set them by hand after restoring.'
                : 'Older backup - some settings are missing. They will keep their current values.')
                .map(ln => `''='{if_==({ini_file(Restore,Old)},yes,${ln},)}'`), '')
    }

    // Ключевые настройки — то, по чему человек и опознаёт свою копию.
    //
    // РАЗБИТЫ ПО ПОДСИСТЕМАМ, а не свалены списком. Первая версия шла в порядке смещений,
    // и на экране получалась каша: частота памяти между двумя настройками процессора,
    // напряжения вперемешку. Смещение — это то, как поля лежат в kip, а не то, как человек
    // о них думает; порядок в сводке должен повторять порядок в меню.
    //
    // Заголовок группы снимает и вторую беду: без него в списке шли два «Min Voltage»
    // подряд, и было не понять, где процессор, а где видеоядро.
    /**
     * СОСТАВ И ПОРЯДОК ПРЕДПРОСМОТРА БЕРУТСЯ ИЗ САМОЙ СВОДКИ, а не задаются вторым списком.
     *
     * Раньше здесь лежал свой перечень смещений, и он уже разошёлся со сводкой: та
     * показывала у GPU режим андервольта и оба смещения vMin, а предпросмотр — только два
     * напряжения. Человек сравнивает копию с текущим состоянием глазами, переводя взгляд
     * с экрана на экран, и разный порядок строк делает это сравнение работой.
     *
     * Теперь источник один: строки первой страницы сводки, в том же порядке, сгруппированные
     * так же. Перестановка в сводке автоматически доезжает сюда, и разойтись они больше
     * не могут. `only` по-прежнему отсекает то, чего в файле-источнике нет.
     */
    /**
     * ОДИН ЦИКЛ НА ОБЕ СТРАНИЦЫ ПРЕДПРОСМОТРА.
     *
     * Сводка давно живёт двумя страницами: на первой паспорт и настройки (`main`),
     * на второй кривая напряжений GPU и аварийные ряды (`deep`). Предпросмотр брал
     * только первую — и человек применял копию, не зная, что вместе с двумя десятками
     * строк приедут тридцать две ячейки рабочей таблицы и оба ряда pMeh/sMeh.
     *
     * Поэтому цикл вынесен: он собирает блоки из ЛЮБОГО набора строк сводки и возвращает
     * готовые строки файла. Пусто — возвращает пустой массив, и страницы не будет вовсе.
     *
     * `src` служит и пулом для поиска строки по смещению. Раньше искали по всем `kipRows`,
     * но у `12436`, `12440` и `12448` есть двойники в рядах pMeh/sMeh: поиск по общему
     * списку вернул бы под заголовком `pMeh 0-22` подпись `eBAMATIC Stage`. Пул страницы
     * возвращает ту строку, которая на этой странице и стоит.
     *
     * `seen` тоже своё на страницу: те же три поля показываются на ОБЕИХ страницах сводки —
     * один раз по смыслу, второй раз под своим номером в аварийном ряду, — и предпросмотр
     * повторяет это, а не прячет вторую половину.
     */
    const previewGroups = (src, heading, before = null) => {
      const out = []
      const PREVIEW_GROUPS = []
      for (const r of src) {
        // Группы сливаем ПО ИМЕНИ, а не по соседству: в сводке один и тот же блок бывает
        // разорван строками другой ревизии, и при слиянии только соседних половина RAM
        // осталась бы за бортом.
        let g = PREVIEW_GROUPS.find(x => x.name === r.group)
        if (!g) PREVIEW_GROUPS.push(g = { name: r.group, offsets: [] })
        if (!g.offsets.includes(r.offset)) g.offsets.push(r.offset)
      }
      // Внутри блока порядок тот же, что в сводке: там он задаётся GROUP_ORDER при выводе,
      // а не порядком строк в карте меню.
      for (const g of PREVIEW_GROUPS) {
        const wanted = GROUP_ORDER[g.name]
        if (wanted) g.offsets.sort((a, b) => wanted.indexOf(a) - wanted.indexOf(b))
      }

      for (const g of PREVIEW_GROUPS) {
        // `seen` — СВОЙ НА БЛОК, а не на страницу, и это не мелочь.
        //
        // Шесть смещений намеренно живут в двух блоках сразу: под человеческим именем
        // и под своим номером в аварийном ряду pMeh/sMeh — вторая дверь для KIP tool
        // в hekate (`check-menu.mjs`, «Deliberate aliases»). Сводка печатает оба, и
        // предпросмотр обязан печатать оба: ряд, названный `pMeh 0-22`, читают ПО НОМЕРАМ,
        // и дырка на месте `pMeh 20` в нём — не экономия, а обрыв нумерации.
        //
        // Дубликаты внутри одного блока это по-прежнему ловит: список смещений блока уже
        // уникален, а ключ со ревизией разводит две строки одного смещения на странице
        // сброса, где показываются обе.
        const seen = new Set()
        const rows = g.offsets
          // ВЫБОР СТРОКИ ПО СМЕЩЕНИЮ, А НЕ ПЕРВОЙ ПОПАВШЕЙСЯ. Одно смещение может обслуживаться
          // ДВУМЯ пунктами — по одному на ревизию, когда у поля разный смысл или разные границы
          // (`44 Undervolt Mode`, `12344 Max Voltage`). Слепой `find` брал пункт другой ревизии,
          // и следующий же фильтр по платформе выбрасывал строку совсем.
          //
          // Оговорка о происхождении: это не давняя беда, а дыра, пробитая расщеплением
          // `12344` по ревизиям в тот же день. До него пункт был один и общий, `find`
          // возвращал его, фильтр пропускал. Первое расщепление (`44`) прошло незамеченным
          // только потому, что его второй пункт принадлежал той же ревизии, что и превью.
          .flatMap(o => {
            const all = src.filter(r => r.offset === o)
            if (all.length < 2) return all
            // Ревизия задана — берём её строку, а если своей нет, общую.
            if (rev) return all.filter(r => r.platform === rev).concat(all.filter(r => (r.platform ?? 'both') === 'both')).slice(0, 1)
            // Ревизия НЕ задана (страница сброса) — нужны ОБЕ строки. Взять одну значило бы
            // показать эристовцу мариковский предел или не показать ему ничего: именно так
            // со страницы сброса пропал `Max Voltage` для Erista. Метки `mariko:` / `erista:`
            // расставит общий код ниже, по одной на каждую.
            return all
          })
          .filter(Boolean)
          .filter(r => !rev || (r.platform ?? 'both') === 'both' || r.platform === rev)
          .filter(r => !only || only.has(r.offset))
          // Ключ — смещение ВМЕСТЕ с ревизией: одно смещение может обслуживаться двумя
          // строками, по одной на ревизию, и они не дубликаты друг друга.
          .filter(r => { const k = `${r.offset}|${r.platform ?? 'both'}`; return !seen.has(k) && seen.add(k) })
          .map(r => ({ ...r, map: rebase(r.map, depth), flatMap: rebase(r.flatMap, depth) }))
          // Сортировка по платформе нужна ТОЛЬКО когда ревизия не задана: метка `mariko:`
          // действует до следующей и не возвращается к «обеим». Превью копии всегда знает
          // свою ревизию (`rev`), поэтому там метки не появляются вовсе и порядок остаётся
          // тем, что задан в PREVIEW_GROUPS.
          .sort((a, b) => rev ? 0
            : ({ both: 0, erista: 1, mariko: 2 }[a.platform] ?? 0)
            - ({ both: 0, erista: 1, mariko: 2 }[b.platform] ?? 0))
        if (!rows.length) continue

        // A group whose rows are all one revision must carry `;system=` on its heading too,
        // or the other console shows a caption over an empty frame: the engine filters rows,
        // it cannot see headings. Same guard as in emitPage; it did not travel here when the
        // grouping was rebuilt. Mixed groups keep `sys` empty and are byte-for-byte as before.
        const rowPlats = new Set(rows.map(r => (r.platform === 'mariko' || r.platform === 'erista') ? r.platform : 'both'))
        const onePlat = rowPlats.size === 1 ? [...rowPlats][0] : null
        const sys = (!rev && onePlat && onePlat !== 'both') ? [`;system=${onePlat}`] : []

        // Врезка ПЕРЕД блоком — тем же приёмом, что в сводке: там таблицы ступеней
        // печатаются внутри цикла групп, до собственных строк «GPU Voltage Table»
        // (`emitPage`, блок `mrows`). Порядок на экране задаётся положением в массиве,
        // отдельного ключа сортировки у таблиц нет.
        if (before) out.push(...before(g.name))

        // Отступ ПЕРЕД заголовком, а не только между таблицами. Без него подпись группы
        // печатается вплотную к рамке предыдущей таблицы и наезжает на неё. Ровно это
        // уже чинили в emitPage — и я повторил ошибку, собирая группировку заново.
        out.push('[Gap]', ';mode=table', ';background=false', ...sys, `;gap=${HEAD_GAP}`, '')
        out.push('[Header]', ';mode=table', ';header_indent=true', ';background=false', ...sys,
                `'${g.name}' = ''`, '')
        out.push('[Info]', ';mode=table', ...poll, ';spacing=0', ';gap=0', ...sys, ...source)
        // ОБЪЯВЛЕНИЕ СЛОВАРЯ — ОДНО НА ТАБЛИЦУ, А НЕ НА СТРОКУ, и это не косметика.
        // В нашем форке движка разобранный json кэшируется на время сборки ОДНОЙ таблицы
        // (`JsonScope`, `utils.hpp`, коммит 215270d5). Повторное `json_file` внутри той же
        // таблицы кэш не рушит, но лишние объявления сводят выигрыш на нет, а на второй
        // странице строк вчетверо больше, чем на первой.
        let lastMap = null
        let lastPlat = null
        for (const r of rows) {
          // Страница, не привязанная к ревизии (заводской набор), обязана разводить
          // платформенные строки метками — иначе на экране две строки «Frequency» подряд.
          if (!rev) {
            const plat = r.platform === 'mariko' || r.platform === 'erista' ? r.platform : 'both'
            if (plat !== lastPlat) {
              if (plat !== 'both') out.push(`${plat}:`)
              lastPlat = plat
              lastMap = null          // объявление словаря не переживает смену ветки
            }
          }
          // Имя группы уже в заголовке — в строке оставляем только само поле.
          const label = r.group && r.title.startsWith(r.group)
            ? r.title.slice(r.group.length).trim() || r.title
            : r.title
          // СОСТАВНОЙ КЛЮЧ И ЗДЕСЬ. У ступеней GPU подпись адресуется парой ячеек, и если
          // предпросмотр подставит только первую, ключ не найдётся НИКОГДА — на экране
          // встанет «null». Так и было: обе страницы «что будет применено» врали про GPU
          // при любом значении поля, а это ровно те экраны, по которым человек решается
          // нажать удержание.
          //
          // Вторая ячейка есть не во всяком источнике: в копии настроек она лежит, а в
          // заводском наборе её нет и по замыслу быть не должно — сброс таблицу не трогает.
          // Поэтому ключ достраивается ТОЛЬКО когда источник её содержит; иначе строка
          // читается плоским словарём, где тот же режим назван без оглядки на таблицу.
          const probeInSrc = r.probe && (!only || only.has(r.probe.offset))
          const key = probeInSrc
            ? `{ini_file(Fields,${r.offset})}{ini_file(Fields,${r.probe.offset})}`
            : `{ini_file(Fields,${r.offset})}`
          //
          // Объявление идёт ПОСЛЕ выбора, а не до него. Иначе страница открывает два файла
          // подряд и пользуется вторым: лишнее открытие на карте памяти и путаница в чтении.
          // Точка кривой считается, а не ищется в словаре — см. `curveValue`.
          if (isCurve(r)) {
            out.push(`'${safeName(label)}' = '${curveValue(r, true)}'`)
            continue
          }
          const mapPath = probeInSrc || !r.flatMap ? r.map : r.flatMap
          if (mapPath !== lastMap) { out.push(`json_file '${mapPath}'`); lastMap = mapPath }
          out.push(`'${safeName(label)}' = '{json_file(0,${key})}'`)
        }
        out.push('')
      }

      // Ни одной строки не пережило фильтров — значит и заголовка быть не должно.
      // На заводском сбросе так и случается со всем, чего нет в `Default.ini`.
      if (!out.length) return []
      const head = []
      if (heading) {
        head.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
        head.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
                  `'${safeName(heading)}' = ''`, '')
      }
      return [...head, ...out]
    }

    pl.push(...previewGroups(main, 'What it will apply'))
    pl.push('')

    if (note) {
      pl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
      pl.push('[Note]', ';mode=table', ';background=false', ';alignment=left', ';offset=10', ';spacing=4', ';gap=0')
      for (const ln of wrap(note)) pl.push(`''='${ln}'`)
      pl.push('')
    }

    // Отступ ПЕРЕД кнопкой, а не только перед заметкой.
    //
    // Подсветка выделенного пункта рисуется выше его строки и накрывала последнюю строку
    // заметки, стоявшей вплотную. Та же беда, что с рамкой таблицы над кнопкой (NOTES №110),
    // только с другой стороны: там секция лезет вниз, здесь пункт лезет вверх.
    //
    // Пустая секция без фона — единственный способ отвести место: `;gap=` заметки отводит
    // его ПОД её собственной рамкой, а подсветке нужен зазор снаружи.
    pl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
    pl.push(...apply, '')
    // ВТОРАЯ КНОПКА — УДАЛЕНИЕ, И ОНА НИЖЕ ПРИМЕНЕНИЯ НАМЕРЕННО: действие опаснее, а
    // лишний шаг крестовиной до него ничего не стоит. Свой зазор ей нужен по той же
    // причине, что и первой: рамка выделения выходит за строку вверх и съедает то,
    // что стоит над ней.
    if (del) {
      pl.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
      pl.push(...del, '')
    }

    /**
     * ВТОРАЯ СТРАНИЦА — КРИВАЯ И АВАРИЙНЫЕ РЯДЫ, ровно как на второй странице сводки.
     *
     * Идёт ПОСЛЕ кнопок, и это не порядок чтения, а устройство файла: `[@Имя]` начинает
     * новую страницу, и всё, что ниже, на неё и попадает. Кнопки `Apply` и `Delete`
     * обязаны остаться на первой — решение оператора о едином `Backup manager`, — значит
     * заголовок второй страницы может стоять только за ними.
     *
     * Имя то же, что в сводке: человек листает крестовиной и там и тут, и вторая страница
     * должна называться одинаково. Проверке уникальности (`check-generated.mjs`, №5) оно
     * не мешает — та считает пункты меню `[*Имя]`, а не страницы `[@Имя]`.
     *
     * Страницы не будет вовсе, если после фильтров (платформа, `only`) не осталось строк:
     * так на заводском сбросе не появится пустая страница из-под того, чего в `Default.ini`
     * нет. Решает это сам `previewGroups`, возвращая пустой массив.
     */
    /**
     * РАБОЧАЯ ТАБЛИЦА СТУПЕНЕЙ — ТРИДЦАТЬ ОДНА ЯЧЕЙКА, КОТОРЫЕ КОПИЯ НЕСЁТ МОЛЧА.
     *
     * ПРАВИЛО, ПО КОТОРОМУ ЭТОТ БЛОК ЕСТЬ (решение оператора): есть в копии — показываем
     * из копии; нет — показываем заводское, оно у всех одно. Условий по режиму не ставим
     * вовсе, потому что условие тут и не выражается: `;visibility_condition` разбирает
     * только общие подстановки (`utils.hpp`, `evaluateMenuCondition` → `generalPlaceholders`),
     * а `{ini_file(...)}` раскрывает другой, рекурсивный проход. Прочитать режим ИЗ КОПИИ
     * условие не может: путь копии сам является подстановкой.
     *
     * Что показываем:
     *   рабочая таблица `@8896` (её переписывают половинчатые ступени) — В КОПИИ ЕСТЬ,
     *   она лежит в `SIDE_WRITES` и уезжает в файл вместе с настройками. Читаем оттуда.
     *   Ручной массив `Custom Table` — тоже в копии, его печатает группа ниже.
     *
     * Чего НЕ показываем и почему: заводские таблицы `@7160` (ST1) и `@10632` (ST3).
     *
     * РЕШЕНИЕ ОПЕРАТОРА 01.09.2026, ОКОНЧАТЕЛЬНОЕ: «забудь про это и никогда не надо
     * делать». Экран показывает ВЫБРАННУЮ ступень — остальные человеку не нужны, и двух
     * лишних блоков на странице копии быть не должно.
     *
     * Прежняя редакция этого комментария звала доделать: «в карте их сейчас нет, нужен
     * отдельный скрипт-вычитыватель — тогда сюда добавятся ещё два блока». К 01.09 это
     * стало неправдой дважды: скрипт написан (`make-stock-curves.mjs`), данные лежат
     * в карте ключом `stock_tables` — а показывать их всё равно не надо.
     *
     * Поэтому `stock_tables` генератор не читает СОЗНАТЕЛЬНО. Если однажды заметите, что
     * данные в карте есть, а на экране их нет, — так и задумано, это не забытое звено.
     *
     * Смещения выводятся из `curveTables`, а не перечисляются: сводка считает их той же
     * формулой, и разойтись эти два места не должны.
     */
    const stageTable = groupName => {
      if (groupName !== 'GPU Voltage Table' || rev !== 'mariko' || !curveTables) return []
      const m = curveTables.modes.find(x => x.hex === '01')
      if (!m || !curveTables.labels.length) return []
      const cells = curveTables.labels.map((title, i) => [title, m.base + curveTables.step * i + 32])
      // Потолок стоит не на сетке строк, а на своём месте — как и в сводке.
      cells.push(['Max Clock', m.base + curveTables.step * curveTables.labels.length])
      // Источник обязан нести ВСЕ ячейки: половина таблицы хуже, чем её отсутствие.
      if (only && cells.some(([, o]) => !only.has(o))) return []
      const t = []
      t.push('[Gap]', ';mode=table', ';background=false', `;gap=${HEAD_GAP}`, '')
      t.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
             `'GPU Voltage Table - stages' = ''`, '')
      // Объявления — ОДИН РАЗ НА ТАБЛИЦУ: словарь у всех строк один, и кэш разбора json
      // на время сборки таблицы (`JsonScope`) работает только при таком порядке.
      t.push('[Info]', ';mode=table', ...poll, ';spacing=0', ';gap=0', ...source,
             `json_file '${rebase(curveTables.map, depth)}'`)
      for (const [title, off] of cells) {
        t.push(`'${safeName(title)}' = '{json_file(0,{ini_file(Fields,${off})})}'`)
      }
      t.push('')
      return t
    }

    const deepLines = previewGroups(deep, 'Also applied', stageTable)
    if (deepLines.length) {
      pl.push('[@Page 2]', '')
      pl.push(...deepLines, '')
    }

    write(file, pl.join('\n'))
    stats.previewPages = (stats.previewPages ?? 0) + 1
  }

  for (const rev of ['mariko', 'erista']) {
    const dir = `/atmosphere/kips/.bak/${rev}`
    // Привязка объявляется в каждой таблице: она не переживает границу секции.
    const src = [`ini_file './config.ini'`, `ini_file '{ini_file(Restore,Path)}'`]
    const mine = kipRows.filter(r => (r.platform ?? 'both') === 'both' || r.platform === rev)

    emitPreviewPage(`service/restore-${rev}.ini`, {
      title: 'Backup manager', rev, source: src, depth: 1,
      // Готовые строки пункта создания копии — их собрал `emitBackup` при обходе меню.
      // Пути внутри переезд переживают: `./config.ini` разворачивается в каталог
      // подпакета, а `restore-<ревизия>.ini` лежит в том же `service/`, что и прежний
      // хозяин секции — `package.ini`. Путь до kip абсолютный и от места не зависит.
      create: backupCreate[rev],
      chooser: [
        `[*Choose backup?${rev}]`, ';mode=option',
        `file_source ${dir}/*.ini`,
        // имя запоминается отдельным ключом: иначе пришлось бы резать путь по числу символов,
        // как делает Ebal, и любое переименование каталога поехало бы на экране
        `set-ini-val './config.ini' Restore Path '{file_source}'`,
        // ИМЯ КОПИИ УШЛО С ПУНКТА В ТАБЛИЦУ ПОД НИМ. Раньше оно стояло подписью справа
        // (`set-footer`), а `;grouping=split` кладёт подпись и значение в ОДНУ строку —
        // и при нехватке места жертвует подписью, а не значением. На снимке оператора
        // от `Backup` осталось `Bac`, дальше сразу имя файла.
        //
        // Ширину делит сам движок: футер резервирует своё место, а имени пункта
        // достаётся остаток (`tesla.hpp:9491-9493`). Имя копии длинное всегда — оно
        // собрано из частоты, режима и метки времени, — так что подпись обречена.
        //
        // Теперь пункт зовёт выбрать, а выбранное показано отдельной таблицей ниже:
        // подпись своей строкой, имя своей.
        //
        // ПРЕЖНЯЯ РЕДАКЦИЯ ЭТОГО КОММЕНТАРИЯ ВРАЛА и обещала, что длинное имя там
        // прокручивается само. Не прокручивается: бегущая строка живёт только
        // у пунктов и только пока пункт выделен, а таблицы рисуют текст одним
        // вызовом и при переполнении обрезают. Разбор — в комментарии к таблице
        // выше по файлу; здесь оставалось неисправленное следствие той же ошибки,
        // и два комментария в одном файле утверждали противоположное.
        //
        // Имя помещается целиком, это посчитано, — но если имена когда-нибудь
        // станут длиннее, выбор будет между обрезкой здесь и обрезкой подписи там.
        `set-ini-val './config.ini' Restore Name '{file_name}'`,
        /**
         * IS THIS COPY OLDER THAN THE PACKAGE THAT IS ABOUT TO APPLY IT?
         *
         * `Meta fields` has been written into every copy since day one and read by no one.
         * It is the only thing that tells a copy made before the curve grew from 24 points
         * to 31 from a current one: `Meta kipver` did not change, so the gate lets the old
         * file through and the seven missing cells are simply never written - the engine
         * skips an empty substitution without a word (`handleHexByCustom`, utils.hpp:4724).
         *
         * Worked out here in steps rather than in the row that shows it. The engine can
         * only compare for equality, and an unselected backup reads as `null`, which would
         * light the warning up for everyone. A flag written when a file is actually chosen
         * has neither problem: no choice - no key - no text.
         *
         * The expected numbers come from the generator, not from the text: they change
         * whenever the map grows. An imported copy is counted differently - it holds only
         * what the old profile had - and if this revision has no import path at all, the
         * native count stands in: such a copy cannot be produced here.
         */
        `ini_file '{file_source}'`,
        `set-ini-val './config.ini' Restore Have '{ini_file(Meta,fields)}'`,
        `set-ini-val './config.ini' Restore Want '{if_==({ini_file(Meta,kipver)},imported,${IMPORT_FIELD_COUNT[rev] ?? backupFieldCount(rev)},${backupFieldCount(rev)})}'`,
        `ini_file './config.ini'`,
        `set-ini-val './config.ini' Restore Old '{if_==({ini_file(Restore,Have)},{ini_file(Restore,Want)},no,yes)}'`,
        // `back` последней строкой: в Ultrahand она не прерывает секцию, остаток
        // выполнится (`docs/MIGRATION.md` §3, конфликт 3).
        'back',
      ],
      apply: [
        `[Apply this backup ${HOLD_A}]`,
        // ПУНКТ ВИДЕН ВСЕГДА, И ЭТО НАМЕРЕННО.
        //
        // Раньше он прятался условием `!matching_ini_val ./config.ini Restore Path`.
        // Условие видимости вычисляется ОДИН РАЗ, когда страница строится
        // (`main.cpp:5341-5352`), а выбор копии происходит позже: `back` из списка
        // снимает оверлей со стека, но нижележащую страницу заново не строит
        // (`tesla.hpp:14336`). То есть на первом заходе человек выбирал файл, видел
        // его содержимое — и кнопки применения не было. Она появлялась, только если
        // выйти со страницы и зайти снова. Выглядело как «предпросмотр есть, применить нечем».
        //
        // Перерисовку можно было бы попросить командой `refresh`, но её поведение
        // на этой глубине вложенности проверяется только на консоли, а `refresh-return`
        // мы уже так теряли (журнал №68). Поэтому опираемся на то, что доказуемо
        // по коду: без выбранного файла предикат `matching_ini_val` не пройдёт, а
        // `handleHexByCustom` пропускает запись при `NULL_STR` (`utils.hpp:4560`).
        // Нажатие без выбора не делает ничего и говорит об этом.
        ';hold=true',
        // ЩИТ ПО ВЕРСИИ РАСКЛАДКИ. Копия хранит смещения — то есть позиции в структуре
        // блока CUST. Изменится структура в новой прошивке, и те же числа станут указывать
        // на другие поля: применение прошло бы «успешно», записав чужие значения прямо
        // в загрузчик. Поэтому сверяем паспорт.
        //
        // Механика — блоки `try:`. Первый ПОЛНОСТЬЮ успешный блок обрывает секцию
        // (`utils.hpp:3866-3880`), поэтому запасной блок с сообщением идёт вторым и
        // отработает только если предикат не прошёл. Запись в kip своим итогом
        // `commandSuccess` не трогает (`handleHexByCustom` возвращает void), так что
        // девяносто команд внутри блока цепочку не порвут.
        src[0],
        'try:',
        /**
         * Must come BEFORE `ini_file '{ini_file(Restore,Path)}'`: that rebinds reads to
         * the backup file, where section `Restore` does not exist, and the predicate would
         * fail always. Negative form on purpose - backups made before 2026-09-01 carry no
         * revision key, and a positive test would reject them. Details: NOTES 232.
         */
        `!matching_ini_val {ini_file(Restore,Path)} Meta revision ${rev === 'mariko' ? 'erista' : 'mariko'}`,
        `matching_ini_val {ini_file(Restore,Path)} Meta kipver ${KIPVER}`,
        src[1],
        // Список пишущих команд строится из ТОГО ЖЕ набора, что и копия, а не из kipRows:
        // иначе read_only-поля сохраняются и не возвращаются.
        ...backupSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        ...sideSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        `set-footer 'restored'`,
        // ВТОРОЙ БЛОК — ДЛЯ ИМПОРТИРОВАННЫХ КОПИЙ, НО КНОПКА ОДНА.
        //
        // У копии из старого визарда версии раскладки нет: старый формат её не хранил,
        // и в паспорте стоит `imported`. Сперва это сделали отдельным пунктом, и оператор
        // сразу указал на беду: две кнопки рядом, одна из которых на твоей копии молча
        // ничего не делает. Человек не обязан знать, какая ему нужна, — это должен знать
        // пакет. Теперь пункт один, а какой блок сработает, решает паспорт файла.
        //
        // ФУТЕРЫ КОРОТКИЕ, и это не вкусовщина: футер занимает слот значения и
        // выдавливает имя пункта. Строка «restored from an imported copy» съедала
        // кнопку целиком — на экране оставалась одна скобка. Причина живёт в примечании,
        // футер отвечает только «что стало».
        //
        // Предупреждение про неизвестную версию осталось, но в примечании под сводкой:
        // его читают до нажатия, а не выбирают между кнопками вслепую.
        'try:',
        `!matching_ini_val {ini_file(Restore,Path)} Meta revision ${rev === 'mariko' ? 'erista' : 'mariko'}`,
        `matching_ini_val {ini_file(Restore,Path)} Meta kipver imported`,
        src[1],
        ...backupSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        ...sideSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        `set-footer 'restored (import)'`,
        'try:',
        `set-footer 'not applied'`,
      ],
      // УДАЛЕНИЕ ЧИСТИТ ОБА КЛЮЧА, а не одно имя: `config.ini` переживает выход из
      // оверлея и перезагрузку, так что выбор прошлого раза встречал бы человека уже
      // сделанным — вошёл, ничего не трогал, удержал, и стёрлась копия, выбранная вчера.
      //
      // `try:` с `path_exists` закрывает второе удержание на уже стёртой копии: кнопка
      // видна всегда (условие видимости движок считает один раз при построении страницы),
      // и без проверки она сделала бы вид, что стёрла ещё раз.
      del: [
        `[Delete this backup ${HOLD_A}]`,
        ';hold=true',
        `ini_file './config.ini'`,
        'try:',
        `path_exists {ini_file(Restore,Path)}`,
        `delete {ini_file(Restore,Path)}`,
        `set-ini-val './config.ini' Restore Path ''`,
        `set-ini-val './config.ini' Restore Name ''`,
        // Флаг «копия старая» стирается вместе с выбором: иначе предупреждение осталось бы
        // висеть после удаления файла, которого оно касалось.
        `set-ini-val './config.ini' Restore Old ''`,
        `notify 'Done - Deleted' 22 4000`,
        'try:',
        `notify 'Pick a backup first' 22 4000`,
      ],
      // ПРИМЕЧАНИЕ РАЗНОЕ ПО РЕВИЗИЯМ, и не ради красоты. Копия старого визарда на Erista
      // снималась двумя шаблонами, в которых шести полей нет вовсе (`NOTES` №193), — их
      // строки покажут `Not available` и останутся как есть.
      //
      // Одно из них молчать не имеет права. Кривая GPU переносится вся, 29 ячеек, а поле 44
      // — нет; на Erista оно не выбирает таблицу, а СДВИГАЕТ эту самую кривую на 12,5 мВ
      // за единицу. То есть человек получает чужую кривую под своим текущим сдвигом,
      // и узнать об этом ему неоткуда: обе части выглядят применёнными.
      note: 'Values above are read from the selected file, not from the kip. Hold A on Apply to write them. '
          + 'A copy imported from the old Wizard shows "imported" as its kip layout: that format never '
          + 'stored one. It was taken on this console, so the values are yours - but if the firmware has '
          + 'been updated since, check the summary above before applying.'
          + (rev === 'erista'
              ? ' On Erista that old format did not store the GPU undervolt mode, the voltage floors, '
                + 'the boost clock or Speed Shift: those rows read "Not available" and keep their current '
                + 'values. The GPU curve is restored in full, and on Erista the undervolt mode shifts that '
                + 'curve - so set the mode yourself afterwards, or the restored curve sits under whatever '
                + 'shift is in the kip now.'
              : ''),
    })
  }

  // Заводской набор — та же страница, только файл известен заранее и выбирать нечего.
  {
    const src = [`ini_file './Default.ini'`]
    const factoryOffsets = Object.keys(FACTORY).map(Number).sort((a, b) => a - b)
      .filter(o => !BLACKLIST.has(o))
    const platOf = o => fieldsDoc.fields.find(f => f.offset === o)?.platform ?? 'both'

    // ДВА ПУНКТА ПРИМЕНЕНИЯ, ПО ОДНОМУ НА РЕВИЗИЮ.
    //
    // Заводской снимок снят с Mariko: часть смещений в нём общие, часть принадлежит только
    // Mariko, а полей, принадлежащих только Erista, не было ни одного. Один общий пункт
    // писал на Erista чужие значения впустую, а два её собственных поля — `20 CPU Voltage
    // Limit` и `24 RAM MHz` — не сбрасывал вовсе, обещая при этом «вот что ставит прошивка».
    // Теперь каждая ревизия пишет только своё.
    //
    // 29.08.2026 вторая половина беды закрыта с другой стороны: недостающие эристовские
    // значения дописаны в эталон из живого kip (NOTES №173), и поля, принадлежащие только
    // Erista, в нём наконец есть. Числа здесь намеренно не называются — они живут
    // в `docs/FACTS.md` и в `_meta` самого эталона, а комментарий, повторяющий число,
    // устаревает молча.
    const bothOnReset = new Set(fieldsDoc.fields.filter(f => f.factory_reset_both).map(f => f.offset))
    const applyFor = rev => [
      `[Apply factory defaults ${HOLD_A}?${rev}]`, ';hold=true', `;system=${rev}`,
      ...src,
      /**
       * СБРОС ФИЛЬТРУЕТСЯ ПО РЕВИЗИИ — И У ЭТОГО ЕСТЬ ОДНО ИСКЛЮЧЕНИЕ.
       *
       * Семь смещений 184…208 помечены `mariko`, потому что ВЫДАЮТСЯ только там:
       * на Mariko это верхние точки кривой GPU. Но физически те же байты на Erista —
       * первая строка её таблицы CPU, и испортить её может кто угодно: донорский
       * конфигуратор пишет туда без фильтра ревизии вовсе.
       *
       * Значит сброс обязан возвращать их заводское значение НА ОБЕИХ ревизиях —
       * это единственный путь вылечить порчу. Поле объявляет это ключом
       * `factory_reset_both`, и без ключа исключения нет: молчаливых тут быть не может.
       *
       * Найдено проверкой готового кода 04.09.2026: правка была написана ради починки
       * Erista и именно на Erista не работала — фильтр по платформе выбрасывал эти
       * строки из эристовского блока.
       */
      ...factoryOffsets.filter(o => platOf(o) === 'both' || platOf(o) === rev || bothOnReset.has(o))
        .map(o => `hex-by-custom-offset ${KIP} CUST ${o} {ini_file(Fields,${o})}`),
      `set-footer 'restored'`,
    ]

    const notCovered = fieldsDoc.fields
      .filter(f => f.platform === 'erista' && !(f.series ?? '').startsWith('gpu_curve'))
      .filter(f => !factoryOffsets.includes(f.offset))
      .map(f => f.name)

    emitPreviewPage('service/reset.ini', {
      title: 'Factory Defaults', rev: null, source: src, depth: 1,
      chooser: null,
      only: new Set(factoryOffsets),
      apply: [...applyFor('mariko'), '', ...applyFor('erista')],
      // Вторая фраза собиралась из литерала и списка непокрытых полей — и сломалась ровно
      // тогда, когда список опустел: на экране осталось «has no value for , so those keep».
      // Дыру закрыли, дописав недостающие значения в эталон из живого kip, а фраза об этом
      // не знала. Теперь предложение появляется, только если ему есть что сказать.
      note: 'This is what the firmware ships with. The GPU voltage curves are not touched — the '
          + 'factory snapshot does not carry them.'
          + (notCovered.length
              ? ` On Erista the snapshot also has no value for ${notCovered.join(' or ')}, so those keep their current setting.`
              : ''),
    })
  }

  // СВОДКА СТОИТ ПОД `Service`, по расстановке оператора.
  //
  // Раньше она была вторым пунктом, сразу за eBAMATIC: «открывают чаще, чем крутят».
  // Порядок сверху вниз теперь другой и честнее: сперва то, чем меняют (eBAMATIC,
  // Advanced), потом обслуживание, и только потом то, чем смотрят.
  //
  // Ищем конец блока `[*Service]`, а не начало следующего пункта: следующий пункт
  // может исчезнуть или переехать, а свой блок кончается пустой строкой всегда.
  const svc = rootLines.findIndex(l => l.startsWith('[*Service]'))
  const at = svc >= 0 ? rootLines.indexOf('', svc) + 1 : -1
  const entry = ['[*Current Settings]', ';mode=forwarder', `package_source './current.ini'`, '']
  if (at > 0) rootLines.splice(at, 0, ...entry)
  else rootLines.push(...entry)
  stats.kipRows = kipRows.length
}

/**
 * Default.ini — the factory set, written in the same format as a backup.
 *
 * Why a file and not literals in the menu: see the note at the reset section. The short of
 * it is that reset and restore then differ only in which file they read, and the factory
 * values stop being something only the generator knows.
 *
 * The format matches our backups deliberately, key for key. A person can diff their backup
 * against this file on a PC and see, line by line, what they have changed since the
 * firmware's own defaults. That comparison was impossible before.
 */
function emitDefaultIni() {
  const lines = [
    '; Factory values, as shipped by the firmware itself.',
    ';',
    '; Same format as the backups this package writes, so the two can be compared directly:',
    '; each key under [Fields] is an offset inside the CUST block of loader.kip, and the',
    '; value is what goes there, little-endian.',
    ';',
    '; Source: atmosphere/kips/kip-json/Default.json from the 4IFIR distribution, verified',
    '; against a live kip. The GPU voltage curves are deliberately absent — the snapshot',
    '; does not carry them, and inventing a factory value is worse than leaving one alone.',
    '',
    '[Meta]',
    `revision=mariko-derived`,
    `fields=${Object.keys(FACTORY).length}`,
    `kipver=${KIPVER}`,
    `source=Default.json`,
    '',
    '[Fields]',
  ]
  // ИМЯ ПОЛЯ — ОТДЕЛЬНОЙ СТРОКОЙ, НЕ ХВОСТОМ ЗНАЧЕНИЯ.
  //
  // Движок при чтении ini обрезает у значения только пробелы и табуляции, а дальше берёт
  // всё до конца строки (`libultra/source/ini_funcs.cpp:601-605`). Точку с запятой он
  // комментарием НЕ считает. Строка `12=000000   ; CPU Boost Clock` вернулась бы целиком,
  // а `hexEditByOffset` проверяет только чётность длины и пишет len/2 байт — то есть
  // тринадцать байт вместо трёх, прямо в loader.kip.
  //
  // Читаемость сохраняется, цена — лишняя строка на поле.
  for (const off of Object.keys(FACTORY).map(Number).sort((a, b) => a - b)) {
    const f = byOffset.get(off)
    if (f?.name) lines.push(`; ${f.name}`)
    lines.push(`${off}=${FACTORY[off]}`)
  }
  // Кладётся РЯДОМ С ТЕМ, КТО ЕГО ЧИТАЕТ. `./` в команде разворачивается в каталог того
  // подпакета, где команда написана (`libultra/source/string_funcs.cpp`), а сброс живёт
  // в service/. Файл в корне dist/ движок бы не нашёл и молча пропустил бы все записи:
  // `{ini_file(...)}` вернул бы null, а `handleHexByCustom` на null не пишет и не ругается.
  write('service/Default.ini', lines.join('\n') + '\n')
  stats.defaultIni = Object.keys(FACTORY).length
}

/**
 * Help on the second page of the ROOT menu.
 *
 * It differs from section help in who it addresses: here it is someone who opened the overlay
 * for the first time and sees four words, none of which means anything to them. So the text is
 * taken from `menu.json` as it stands, already written out, rather than assembled from the
 * dependency map — machine assembly is fine for "which field depends on which", not for "what
 * is this thing".
 *
 * The lines are already broken up by hand, but they still go through wrap: if a phrase ever
 * gets longer it will fold instead of running off the frame.
 */
if (menu.root_help?.blocks?.length) {
  // The first page has to be named: without [@Name] the engine labels it with the internal
  // word "Commands" (see NOTES #34).
  const firstSection = rootLines.findIndex(l => l.startsWith('['))
  if (firstSection >= 0) rootLines.splice(firstSection, 0, `[@${safeName(menu._meta?.package_title ?? '4IFIR Wizard')}]`, '')
  rootLines.push(`[@Help]`, '')
  for (const b of menu.root_help.blocks) {
    rootLines.push('[Info]', ';mode=table', ';alignment=left', ';offset=10', ';spacing=4', ';gap=26')
    rootLines.push(`'${safeName(b.title)}'=''`)
    for (const s of b.lines ?? []) for (const ln of wrap(s)) rootLines.push(`''='${ln.replace(/'/g, '`')}'`)
    rootLines.push('')
    stats.infoBlocks++
  }
}

/**
 * ЗАТВОР ПО ВЕРСИИ РАСКЛАДКИ — на весь пакет, а не на отдельное действие.
 *
 * Приём взят у оригинала. В Uberhand это возможность движка: пакет объявляет `;kipVer=27`
 * в заголовке, движок читает `CUST+4` из живого kip и при несовпадении подменяет всё меню
 * одной надписью «Kip version mismatch» (`Uberhand-src/source/main.cpp:954-968`). Коммит
 * `9567886` в репозитории 4IFIR — ровно такое обновление: `;kipVer=26` -> `27` в двух файлах.
 *
 * Ultrahand директиву `;kipVer` не знает и молча проигнорирует её как неизвестную. Поэтому
 * то же самое собирается средствами пакета: каждый пункт корня получает условие видимости
 * по живому kip, а рядом появляется пункт-предупреждение с обратным условием. Снаружи
 * поведение неотличимо — при чужой раскладке человек видит объяснение вместо меню.
 *
 * Почему запрещается ВСЁ, включая чтение: при другой раскладке наши смещения указывают
 * не на те поля, поэтому и показанные значения будут ложью. Полупрозрачный тюнер хуже
 * закрытого.
 */
{
  const gate = []
  for (const line of rootLines) {
    gate.push(line)
    if (/^\[\*/.test(line)) gate.push(`;visibility_condition=${KIP_OK}`)
  }
  const firstItem = gate.findIndex(l => /^\[\*/.test(l))
  const warn = [
    '[Kip version mismatch]', ';mode=table', ';background=false',
    ';alignment=left', ';offset=10', ';spacing=4', ';gap=26',
    `;visibility_condition=!${KIP_OK}`,
    // ЭКРАН ОБЯЗАН ПОКАЗАТЬ ВЫХОД, А НЕ ТОЛЬКО ДИАГНОЗ.
    //
    // Прежний текст говорил «обновите пакет до подходящей сборки» — и человек шёл
    // качать архив на компьютер, потому что из слов «the tuner is disabled» следует,
    // что мёртв весь пакет. А средство стоит прямо здесь же: пункты обновления
    // затвор не закрывает, они видны и работают именно тогда, когда всё остальное
    // отключено. Об этом и надо сказать, назвав пункты по именам.
    //
    // Ставки на это выросли 01.09.2026: из движка убран его собственный экран
    // обновления, и пакетный апдейтер стал ЕДИНСТВЕННЫМ способом обновиться
    // с консоли. Человек, не заметивший кнопку, останется без выхода вовсе.
    `''='This package is built for kip layout ${KIPVER}, and the'`,
    `''='installed loader.kip reports a different one.'`,
    `''=''`,
    `''='Every offset would point at the wrong field, so the'`,
    `''='tuner is disabled rather than shown wrong.'`,
    `''=''`,
    `''='THE FIX IS ON THIS SCREEN, just below.'`,
    `''=''`,
    `''='1. Press Check for updates.'`,
    `''='2. If a newer build is found, press Update.'`,
    `''=''`,
    `''='Both work while the tuner is off - that is on'`,
    `''='purpose, so you are never locked out.'`,
    `''=''`,
    // Последняя строка — путь наружу, когда обновления ещё нет. «Подождите релиза»
    // ничего не советует; группа 4IFIR — живые люди, которые знают про смену
    // раскладки раньше нас. Ссылку набирают руками: в таблице движок кликабельных
    // ссылок не рисует, поэтому короткая форма без номера сообщения.
    `''='No newer build yet? Put back the loader.kip this'`,
    `''='package was made for, or ask in the 4IFIR group:'`,
    `''='t.me/kf4fr'`,
    '',
  ]
  if (firstItem >= 0) gate.splice(firstItem, 0, ...warn)
  else gate.push(...warn)
  rootLines.length = 0
  rootLines.push(...gate)
}

emitDefaultIni()

/**
 * RELEASE.INI В ПАКЕТЕ — СОБСТВЕННАЯ ВЕРСИЯ, С КОТОРОЙ СРАВНИВАЮТ УДАЛЁННУЮ.
 *
 * Здесь пишется заглушка `0.0.0`; настоящий номер проставляет `release.ps1` в собранный
 * комплект — тем же способом, что и `;version=` в шапке пакета, и тем же значением.
 *
 * Зачем заглушка нужна. Без файла подстановка вернёт `null`, проверка обновлений уйдёт
 * в ветку «ошибка» и скажет «check failed» — на сборке из репозитория, где релиза ещё
 * не было, это выглядело бы поломкой. С заглушкой поведение честное: `0.0.0` заведомо
 * старше любого выпуска, значит такая сборка сообщит, что обновление есть.
 *
 * ФОРМА ФАЙЛА ТА ЖЕ, что у скачиваемого с GitHub, — секция в секцию, ключ в ключ.
 * Это не совпадение, а условие: сравниваются две строки, и подгонка форматов была бы
 * ровно тем местом, где такие вещи ломаются (NOTES №126).
 */
write('RELEASE.ini', '[Release Info]\nlatest_version=0.0.0\n')

write('package.ini', rootLines.join('\n'))

// A single boot file for the whole package: root items first, then every section.
const boot = [...rootBoot, '', ...allBoot]
if (boot.some(l => l.startsWith('set-ini-val'))) {
  write('boot_package.ini', [
    '[boot]',
    'clear hex_sum_cache',
    `hex_file '${KIP}'`,
    '',
    ...boot,
    '',
  ].join('\n'))
  stats.bootFiles = 1
}

// ---------------------------------------------------------------- report

console.log(`items generated : ${stats.items}`)
console.log(`dictionaries    : ${stats.dicts}`)
console.log(`lines in [boot] : ${stats.bootLines}`)
console.log(`skipped         : ${stats.skipped.length}`)
if (stats.skipped.length) {
  const byWhy = new Map()
  for (const s of stats.skipped) byWhy.set(s.why, (byWhy.get(s.why) ?? 0) + 1)
  for (const [why, n] of byWhy) console.log(`   ${n}× ${why}`)
}
console.log(`\nout: package/dist/`)
