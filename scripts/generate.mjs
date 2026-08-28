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

/** Normalise hex to the field length: dictionaries store both `01` and `010000`. */
function padHex(hex, lenBytes) {
  const h = (hex ?? '').toUpperCase().replace(/[^0-9A-F]/g, '')
  if (!h) return null
  const need = lenBytes * 2
  if (h.length === need) return h
  if (h.length < need) return h + '0'.repeat(need - h.length)   // pad with zeros on the right (LE)
  return h.slice(0, need)
}

const stats = { items: 0, dicts: 0, bootLines: 0, guards: 0, infoBlocks: 0, actions: 0, resetFields: 0, packages: 0, skipped: [], blocked: [] }

/** The dependency map — the source of warnings that neither original package ever gave. */
let DEPS = null
try { DEPS = JSON.parse(readFileSync(join(ROOT, 'package', 'semantics-src', 'dependencies.json'), 'utf8')) } catch {}

/**
 * Collect everything the reader needs to know about this field but was never told in the
 * original. Returns short lines for the help table.
 */
function warningsFor(offset) {
  if (!DEPS) return []
  const out = []
  const n = Number(offset)

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
  for (const sw of DEPS.switches ?? []) {
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
function emitDicts(field, base) {
  const len = field.length ?? 3
  const list = []
  const map = {}
  const seen = new Set()
  for (const v of field.values ?? []) {
    const hex = padHex(v.hex, len)
    if (!hex) continue
    // Deduplicate AFTER padding to the field length: source dictionaries store the same
    // value both as `01` and as `010000`, often under different names ("Stage 1" and
    // "Stage1 - Min"). Without this the menu grows duplicates — which is what the operator
    // saw on the console.
    if (seen.has(hex)) continue
    seen.add(hex)
    // the engine splits the name at " - ": the left part becomes the item, the right the footer
    const name = withMagnitude((v.name ?? hex).replace(/\s+-\s+/g, ' — ').replace(/(\d),(\d)/g, '$1.$2'), hex, field)
    list.push({ name, hex })
    map[hex] = name
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

  if (!list.length) return null
  const dir = currentDir ? `${currentDir}/json` : 'json'

  /**
   * One dictionary for every point of a series, instead of a copy per point.
   *
   * The voltage curve has 24 points, and their value dictionary is THE SAME one — a set of
   * voltages. That used to mean 24 identical files and 24 `json_file` declarations in [boot].
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
  write(`${dir}/${base}.map.json`, JSON.stringify([map], null, 2))
  stats.dicts += 2
  // Two paths to the same footer dictionary:
  //   map     — relative to the sub-package directory (the item reads it itself)
  //   mapRoot — relative to the package root: [boot] runs ONLY at the root (see emitPackage)
  const out = {
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
  if (!(field.values ?? []).length) { stats.skipped.push({ id: item.id, why: 'no value dictionary' }); return }

  const base = safeName(item.id)
  const d = emitDicts(field, base)
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
    const tag = safeName(item.tag ?? field.platform ?? String(field.offset))
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
  lines.push(`${cmd} ${KIP} CUST ${field.offset} {json_file_source(*,hex)}`)
  lines.push(`set-footer '{json_file_source(*,name)}'`)
  lines.push('')

  // The footer shown when the package opens — from THE SAME offset and THE SAME dictionary.
  //
  // Paths here are relative to the PACKAGE ROOT, not to the section directory: the engine
  // runs `boot_package.ini` only for the top-level package (main.cpp:7381, 8144) and does
  // not run the boot file of a sub-package entered through `package_source`. Item state,
  // however, is read from the `config.ini` sitting NEXT TO its package.ini (main.cpp:6258),
  // so the target file is the config.ini of that very subdirectory.
  // declaring the same dictionary twice in a row is one more file open at startup
  if (d.mapRoot !== lastBootMap) { bootLines.push(`json_file '${d.mapRoot}'`); lastBootMap = d.mapRoot }
  bootLines.push(`set-ini-val '${d.dir ? `./${d.dir}/config.ini` : './config.ini'}' '*${title}' footer {json_file(0,{hex_file(CUST,${field.offset},${d.len})})}`)
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
    platform: plat,
    series: field.series ?? null,
  })

  // Build up the help: the field description plus the links the original packages kept quiet about.
  //
  // The block used to be added ONLY when there were warnings, and a description without any
  // warning silently vanished: all 39 pMeh/sMeh fields have help text in the map, yet only
  // six blocks out of thirty-nine reached the screen.
  const warns = warningsFor(field.offset)
  const help = item.help ?? field.help_text
  if (warns.length || help) infoRows.push({ title: rawTitle, warns, help })
}

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

    lines.push(`[${title}?${rev}]`)
    lines.push(';mini=true')
    lines.push(`;system=${rev}`)
    lines.push(`mkdir ${dir}`)
    lines.push('clear hex_sum_cache')
    lines.push(`hex_file '${KIP}'`)
    lines.push(`ini_file './config.ini'`)
    // Разложено по шагам, а не собрано в одно выражение, СПЕЦИАЛЬНО. Вложенное
    // `{if_==(…,{math(…,true)}…)}` зависело бы от того, что внутренние подстановки
    // раскрываются раньше внешней: парсер `if_` режет аргументы по запятым
    // (`utils.hpp:3209-3241`), и запятая внутри `{math(…,true)}` его бы развалила,
    // раскройся она позже. Промежуточные значения в `config.ini` эту зависимость
    // убирают совсем и вдобавок видны глазами, если что-то пойдёт не так.
    const raw = f => `{hex_to_decimal({hex_to_rhex({hex_file(CUST,${f.offset},${f.length ?? 3})})})}`
    lines.push(`set-ini-val './config.ini' Backup Khz '${raw(freqField)}'`)
    lines.push(`set-ini-val './config.ini' Backup Bal '${raw(balField)}'`)
    lines.push(`set-ini-val './config.ini' Backup Mhz '{math({ini_file(Backup,Khz)}/1000,true)}'`)
    lines.push(`set-ini-val './config.ini' Backup Freq '{if_==({ini_file(Backup,Khz)},0,auto,{ini_file(Backup,Mhz)})}'`)
    lines.push(`set-ini-val './config.ini' Backup Bals '{if_==({ini_file(Backup,Bal)},0,auto,eBal{ini_file(Backup,Bal)})}'`)
    // name first, values second — otherwise a second boundary splits the file in two
    lines.push(`set-ini-val './config.ini' Backup Path '${dir}/{ini_file(Backup,Freq)}-{ini_file(Backup,Bals)}-{timestamp(%d%m%y-%H%M%S)}.ini'`)
    // the backup's passport: where it came from and whether it fits this console
    lines.push(`set-ini-val '${path}' Meta revision '${rev}'`)
    // Версия раскладки блока CUST. Без неё копия, снятая на одной прошивке, молча
    // применилась бы на другой: смещения — это позиции в структуре, и если автор её
    // изменит, те же числа станут указывать не туда, а запись пойдёт прямо в загрузчик.
    // Восстановление сверяет это поле и отказывается работать при несовпадении.
    lines.push(`set-ini-val '${path}' Meta kipver '${KIPVER}'`)
    lines.push(`set-ini-val '${path}' Meta created '{timestamp("%Y-%m-%d %H:%M")}'`)
    lines.push(`set-ini-val '${path}' Meta ram '{ram_vendor} {ram_model}'`)
    lines.push(`set-ini-val '${path}' Meta fields '${mine.length}'`)
    for (const f of mine) {
      lines.push(`set-ini-val '${path}' Fields ${f.offset} '{hex_file(CUST,${f.offset},${f.length ?? 3})}'`)
    }
    lines.push(`set-footer 'saved {timestamp("%d.%m %H:%M")}'`)
    lines.push('')
    stats.backupFields = (stats.backupFields ?? 0) + mine.length

    // RESTORE — переход на страницу предпросмотра, а не немедленная запись.
    //
    // Было: выбрал файл из списка — и 90 значений ушли в kip тем же нажатием. Ни увидеть,
    // что внутри, ни передумать. Стало: страница показывает содержимое файла теми же
    // таблицами, что и «Current Settings», и применяет отдельным пунктом с удержанием A.
    //
    // Побочно это ещё и быстрее: нажатие в списке теперь пишет одну строку в config.ini
    // вместо девяноста записей в kip.
    lines.push(`[*Restore backup?${rev}]`)
    lines.push(';mode=forwarder')
    lines.push(`;system=${rev}`)
    lines.push(`package_source './restore-${rev}.ini'`)
    lines.push('')

    // УДАЛЕНИЕ — ОДИН ПУНКТ-СЕЛЕКТОР, И ЗНАЧОК В ЕГО ИМЕНИ РАБОТАЕТ ДВАЖДЫ.
    //
    // Имя секции движок показывает В ДВУХ МЕСТАХ: строкой в меню Service и
    // ЗАГОЛОВКОМ НАД СПИСКОМ КОПИЙ — `SelectionOverlay` берёт имя секции, снимает `*`,
    // режет по `?` и кладёт заголовком (`main.cpp:3868-3872`). Одна строка, два места,
    // и развести их средствами пакета нельзя.
    //
    // Значок нужен над списком: там человек стоит на копии и держит A, и подсказка
    // «удерживать» — единственное, что предупреждает ДО действия (`notify` отвечает
    // уже ПОСЛЕ). Ценой того, что тот же значок виден и на входе, где только нажимают.
    //
    // На саму строку копии его поставить невозможно: подпись строки файлового списка —
    // это имя файла дословно (`main.cpp:3937-3944`), `;footer=` в списках движок молча
    // игнорирует, а `set-footer` адресован родительскому пункту, не строке.
    //
    // Промежуточную страницу-обёртку пробовали — получилось два одинаковых меню подряд,
    // «Delete backup» внутри «Delete backup». Откачено: меню из одного пункта — не меню.
    lines.push(`[*Delete backup ${HOLD_A}?${rev}]`)
    lines.push(';mode=option')
    // Удержание остаётся: удаление необратимо и подтверждения не спрашивает,
    // а список копий соседствует со списком выбора — промахнуться на пункт легко.
    lines.push(';hold=true')
    lines.push(`;system=${rev}`)
    lines.push(`file_source ${dir}/*.ini`)
    lines.push(`delete {file_source}`)
    // ОТВЕТ НА ЭКРАНЕ — В ДОПОЛНЕНИЕ К УДЕРЖАНИЮ, А НЕ ВЗАМЕН.
    //
    // Строка списка у `;mode=option` текст не показывает вовсе (NOTES №115),
    // и без этого сообщения человек не знал бы, стёрлось ли. Удержание защищает
    // ДО действия, сообщение подтверждает ПОСЛЕ — разные роли.
    lines.push(`notify 'Done - Deleted' 22 4000`)
    lines.push('')

    // ПОДСКАЗКА СЛОВАМИ, ПОТОМУ ЧТО ЗНАЧКА МАЛО.
    //
    // Значок в имени пункта виден и в меню, и заголовком над списком копий — развести
    // эти два места средствами пакета нельзя, у экрана выбора всего два источника
    // заголовка: имя секции и имя каталога. Но значок отвечает только на вопрос «как»,
    // и то намёком. Строка отвечает на «что» и «когда»: выбрать копию, потом удержать.
    //
    // Стоит ноль лишних нажатий и ноль расхождений с движком. Пустая секция-отступ
    // перед таблицей обязательна: подсветка выделенного пункта рисуется ВЫШЕ его
    // строки и накрыла бы верхнюю строку заметки (`docs/NOTES.md` №112).
    lines.push(`[Gap?${rev}]`)
    lines.push(';mode=table')
    lines.push(';background=false')
    lines.push(`;system=${rev}`)
    lines.push(';gap=6')
    lines.push('')
    lines.push(`[Delete hint?${rev}]`)
    lines.push(';mode=table')
    lines.push(';background=false')
    lines.push(';alignment=left')
    lines.push(';offset=10')
    lines.push(';spacing=4')
    lines.push(';gap=0')
    lines.push(`;system=${rev}`)
    lines.push(`''='Pick a copy, then hold A to delete it.'`)
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
  const fit = (expr, len) => `{if_==(${expr},null,null,{slice(${expr}000000,0,${len * 2})})}`
  const val = (row, k = 0) => `{json_file(${row.index},${row.key})}`

  // поле «GPU Eco Mode» нужно как условие для точек кривой
  const eco = imp.find(r => r.name === 'GPU Eco Mode')

  const rows = []
  for (const r of imp) {
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
      const src = r.offsets.length > 1
        ? `{slice(${val(r)},${i * stride},${i * stride + w})}`
        : val(r)
      let expr = fit(src, len)
      // условие по режиму — только для точек кривой Mariko
      if (r.only_when && eco) {
        expr = `{if_==({json_file(${eco.index},${eco.key})},${r.only_when.equals},${expr},null)}`
      }
      rows.push({ off, expr })
    })
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
  lines.push(`notify 'Imported - apply it from Restore backup' 22 4000`)
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
    lines.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
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
   * All 24 points of the voltage table are hidden until the undervolt mode is set to Custom
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
  // The voltage curves stay on the FIRST page even though they are long: they are a setting
  // you look at alongside the undervolt mode, not an internal row.
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
  const FROM_KIP = r => `{hex_file(CUST,${r.offset},${r.len})}`
  const FROM_INI = r => `{ini_file(Fields,${r.offset})}`

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
      // A gap BEFORE the heading, not only between tables: without it the next section's
      // caption was printed flush against the previous frame and overlapped it.
      kl.push('[Gap]', ';mode=table', ';background=false', ...sys, ';gap=14', '')
      kl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false', ...sys,
              `'${safeName(g.name)}' = '${g.ctx ?? ''}'`, '')
      kl.push('[Info]', ';mode=table', ';spacing=0', ';gap=0', ...sys, ...src)
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

  const main = kipRows.filter(r => !isDeep(r))

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

    kl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
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
    kl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
    kl.push('[Note]', ';mode=table', ';background=false', ';alignment=left', ';offset=10', ';spacing=4', ';gap=0')
    for (const ln of wrap('Shown only when the RAM speed and eBal mode are pinned by hand. '
                        + 'On automatic the kip decides at boot and records the result nowhere readable.')) {
      kl.push(`''='${ln}'`)
    }
    kl.push('')
  }

  const deep = kipRows.filter(isDeep)

  const kl = [`[@Current]`, '']
  emitPage(kl, main)
  emitModeVoltages(kl)
  // The note goes right at the bottom and without a frame: its own frame overlapped the last table.
  kl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
  kl.push('[Note]', ';mode=table', ';background=false', ';alignment=left', ';offset=10', ';spacing=4', ';gap=0')
  for (const ln of wrap('Fields left on automatic hold a zero: the kip works the real value out at boot.')) {
    kl.push(`''='${ln}'`)
  }
  kl.push('')

  if (deep.length) {
    kl.push('[@Timings & Micro]', '')
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
   * `;polling=true` намеренно НЕ используется: он пересобирает таблицу раз в секунду, а тут
   * больше сотни чтений ini — у Ebal таблицы по шесть строк, он может себе позволить, мы нет.
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
  const rebase = (p, depth) => depth ? p.replace(/^\.\//, './' + '../'.repeat(depth)) : p
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
    const { title, rev, source, chooser, apply, note, note2, depth = 0, only = null } = opts
    const poll = chooser ? [';polling=true'] : []
    const pl = [`[@${safeName(title)}]`, '']

    if (chooser) pl.push(...chooser, '')

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
    pl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
    pl.push('[Info]', ';mode=table', ...poll, ';spacing=0', ';gap=0', ...source)
    if (chooser) pl.push(`'Memory' = '{ini_file(Meta,ram)}'`)
    pl.push(`'Kip layout' = '{ini_file(Meta,kipver)}'`, '')

    // Ключевые настройки — то, по чему человек и опознаёт свою копию.
    //
    // РАЗБИТЫ ПО ПОДСИСТЕМАМ, а не свалены списком. Первая версия шла в порядке смещений,
    // и на экране получалась каша: частота памяти между двумя настройками процессора,
    // напряжения вперемешку. Смещение — это то, как поля лежат в kip, а не то, как человек
    // о них думает; порядок в сводке должен повторять порядок в меню.
    //
    // Заголовок группы снимает и вторую беду: без него в списке шли два «Min Voltage»
    // подряд, и было не понять, где процессор, а где видеоядро.
    const PREVIEW_GROUPS = [
      { name: 'General', offsets: [12436] },
      { name: 'CPU', offsets: [12, 48, 12340] },
      { name: 'GPU', offsets: [52, 12344] },
      // Порядок RAM берётся из одного места на весь генератор — см. GROUP_ORDER.
      { name: 'RAM', offsets: GROUP_ORDER.RAM },
    ]

    pl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
    pl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
            `'What it will apply' = ''`, '')

    const seen = new Set()
    for (const g of PREVIEW_GROUPS) {
      const rows = g.offsets
        .map(o => kipRows.find(r => r.offset === o))
        .filter(Boolean)
        .filter(r => !rev || (r.platform ?? 'both') === 'both' || r.platform === rev)
        .filter(r => !only || only.has(r.offset))
        .filter(r => !seen.has(r.offset) && seen.add(r.offset))
        .map(r => ({ ...r, map: rebase(r.map, depth) }))
        // Сортировка по платформе нужна ТОЛЬКО когда ревизия не задана: метка `mariko:`
        // действует до следующей и не возвращается к «обеим». Превью копии всегда знает
        // свою ревизию (`rev`), поэтому там метки не появляются вовсе и порядок остаётся
        // тем, что задан в PREVIEW_GROUPS.
        .sort((a, b) => rev ? 0
          : ({ both: 0, erista: 1, mariko: 2 }[a.platform] ?? 0)
          - ({ both: 0, erista: 1, mariko: 2 }[b.platform] ?? 0))
      if (!rows.length) continue

      // Отступ ПЕРЕД заголовком, а не только между таблицами. Без него подпись группы
      // печатается вплотную к рамке предыдущей таблицы и наезжает на неё. Ровно это
      // уже чинили в emitPage — и я повторил ошибку, собирая группировку заново.
      pl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
      pl.push('[Header]', ';mode=table', ';header_indent=true', ';background=false',
              `'${g.name}' = ''`, '')
      pl.push('[Info]', ';mode=table', ...poll, ';spacing=0', ';gap=0', ...source)
      let lastMap = null
      let lastPlat = null
      for (const r of rows) {
        // Страница, не привязанная к ревизии (заводской набор), обязана разводить
        // платформенные строки метками — иначе на экране две строки «Frequency» подряд.
        if (!rev) {
          const plat = r.platform === 'mariko' || r.platform === 'erista' ? r.platform : 'both'
          if (plat !== lastPlat) {
            if (plat !== 'both') pl.push(`${plat}:`)
            lastPlat = plat
            lastMap = null            // объявление словаря не переживает смену ветки
          }
        }
        if (r.map !== lastMap) { pl.push(`json_file '${r.map}'`); lastMap = r.map }
        // Имя группы уже в заголовке — в строке оставляем только само поле.
        const label = r.group && r.title.startsWith(r.group)
          ? r.title.slice(r.group.length).trim() || r.title
          : r.title
        pl.push(`'${safeName(label)}' = '{json_file(0,{ini_file(Fields,${r.offset})})}'`)
      }
      pl.push('')
    }
    pl.push('')

    if (note) {
      pl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
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
    pl.push('[Gap]', ';mode=table', ';background=false', ';gap=14', '')
    pl.push(...apply, '')
    write(file, pl.join('\n'))
    stats.previewPages = (stats.previewPages ?? 0) + 1
  }

  for (const rev of ['mariko', 'erista']) {
    const dir = `/atmosphere/kips/.bak/${rev}`
    // Привязка объявляется в каждой таблице: она не переживает границу секции.
    const src = [`ini_file './config.ini'`, `ini_file '{ini_file(Restore,Path)}'`]
    const mine = kipRows.filter(r => (r.platform ?? 'both') === 'both' || r.platform === rev)

    emitPreviewPage(`service/restore-${rev}.ini`, {
      title: 'Restore', rev, source: src, depth: 1,
      chooser: [
        `[*Choose a backup?${rev}]`, ';mode=option', ';grouping=split',
        `file_source ${dir}/*.ini`,
        // имя запоминается отдельным ключом: иначе пришлось бы резать путь по числу символов,
        // как делает Ebal, и любое переименование каталога поехало бы на экране
        `set-ini-val './config.ini' Restore Path '{file_source}'`,
        // Имя выбранной копии — подписью на самом пункте выбора. До этого его не было
        // на экране НИГДЕ: строка `File` в паспорте не работала, а пункт-селектор
        // показывает справа служебный значок, а не имя файла.
        //
        // `set-footer` внутри списка кладёт текст РОДИТЕЛЬСКОМУ пункту — то самое
        // поведение, которое дважды мешало нам раньше (`docs/NOTES.md` №113, №115).
        // Здесь родитель и есть пункт выбора, поэтому оно ровно то, что нужно.
        `set-footer '{file_name}'`,
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
        `matching_ini_val {ini_file(Restore,Path)} Meta kipver ${KIPVER}`,
        src[1],
        // Список пишущих команд строится из ТОГО ЖЕ набора, что и копия, а не из kipRows:
        // иначе read_only-поля сохраняются и не возвращаются.
        ...backupSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        `set-footer 'restored'`,
        // ВТОРОЙ БЛОК — ДЛЯ ИМПОРТИРОВАННЫХ КОПИЙ, НО КНОПКА ОДНА.
        //
        // У копии из старого визарда версии раскладки нет: старый формат её не хранил,
        // и в паспорте стоит `imported`. Сперва это сделали отдельным пунктом, и оператор
        // сразу указал на беду: две кнопки рядом, одна из которых на твоей копии молча
        // ничего не делает. Человек не обязан знать, какая ему нужна, — это должен знать
        // пакет. Теперь пункт один, а какой блок сработает, решает паспорт файла.
        //
        // Предупреждение про неизвестную версию осталось, но в примечании под сводкой:
        // его читают до нажатия, а не выбирают между кнопками вслепую.
        'try:',
        `matching_ini_val {ini_file(Restore,Path)} Meta kipver imported`,
        src[1],
        ...backupSet(rev).map(f => `hex-by-custom-offset ${KIP} CUST ${f.offset} {ini_file(Fields,${f.offset})}`),
        `set-footer 'restored from an imported copy'`,
        'try:',
        `set-footer 'not applied - no backup chosen, or it is for another kip layout'`,
      ],
      note: 'Values above are read from the selected file, not from the kip. Hold A on Apply to write them. '
          + 'A copy imported from the old Wizard shows "imported" as its kip layout: that format never '
          + 'stored one. It was taken on this console, so the values are yours - but if the firmware has '
          + 'been updated since, check the summary above before applying.',
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
    // Заводской снимок снят с Mariko: из 63 смещений 54 общие, 9 принадлежат только Mariko,
    // а полей, принадлежащих только Erista, в нём нет ни одного. Один общий пункт писал
    // на Erista все девять чужих значений впустую, а два её собственных поля —
    // `20 CPU Voltage Limit` и `24 RAM MHz` — не сбрасывал вовсе, обещая при этом
    // «вот что ставит прошивка». Теперь каждая ревизия пишет только своё, а чего снимок
    // не покрывает, сказано прямо в примечании.
    const applyFor = rev => [
      `[Apply factory defaults ${HOLD_A}?${rev}]`, ';hold=true', `;system=${rev}`,
      ...src,
      ...factoryOffsets.filter(o => platOf(o) === 'both' || platOf(o) === rev)
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
      note: 'This is what the firmware ships with. The GPU voltage curves are not touched — the '
          + 'factory snapshot does not carry them. On Erista the snapshot also has no value for '
          + notCovered.join(' or ') + ', so those keep their current setting.',
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
    `''='This package is built for kip layout ${KIPVER}, and'`,
    `''='the installed loader.kip reports a different one.'`,
    `''=''`,
    `''='Every offset would point at the wrong field, so'`,
    `''='the tuner is disabled rather than shown wrong.'`,
    `''=''`,
    `''='Update the package to a build that matches your'`,
    `''='firmware, or restore the matching loader.kip.'`,
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
