#!/usr/bin/env node
// check-generated — checks WHAT WAS GENERATED against WHAT WAS INTENDED.
//
// Why this particular check exists. The audit found that a package with a dead GPU curve passed
// both of the checks we already had: menu.json declared the gate `44=03`, check-menu counted it
// as covered (it looked at the declaration), and uhlint could not know the command was missing
// altogether (it inspects what is written, not what is absent). "Zero errors" meant "nothing is
// wrong with what is written", not "what is written is what was intended".
//
// This runs the other direction: for every declaration in menu.json and every link in
// dependencies.json, look for the corresponding line in dist/.
//
// Run: node scripts/check-generated.mjs
// Exit code: 0 — everything is in place, 1 — there are discrepancies.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'package', 'dist')

if (!existsSync(DIST)) { console.error('no package/dist — run generate.mjs first'); process.exit(2) }

const menu = JSON.parse(readFileSync(join(ROOT, 'package', 'menu.json'), 'utf8'))
const fields = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8')).fields
const byOffset = new Map(fields.map(f => [f.offset, f]))
let deps = null
try { deps = JSON.parse(readFileSync(join(ROOT, 'package', 'semantics-src', 'dependencies.json'), 'utf8')) } catch {}

// gather the whole text of the package
function walkFiles(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walkFiles(p, acc)
    else if (/\.ini$/i.test(n)) acc.push(p)
  }
  return acc
}
const iniFiles = walkFiles(DIST)
const text = iniFiles.map(f => readFileSync(f, 'utf8')).join('\n')
const lines = text.split(/\r?\n/)

function padHexLocal(hex, lenBytes) {
  const h = String(hex ?? '').toUpperCase().replace(/[^0-9A-F]/g, '')
  if (!h) return null
  const need = lenBytes * 2
  return h.length === need ? h : (h.length < need ? h + '0'.repeat(need - h.length) : h.slice(0, need))
}

const problems = []
const ok = []

// ---------------------------------------------------------------- 1. declared offsets

function collectItems(node, acc = []) {
  acc.push(node)
  for (const k of node.children ?? []) collectItems(k, acc)
  return acc
}
const items = menu.sections.flatMap(s => collectItems(s))

const writtenOffsets = new Set()
for (const m of text.matchAll(/hex-by-custom(?:-r?decimal)?-offset\s+\S+\s+CUST\s+(\d+)/g)) {
  writtenOffsets.add(Number(m[1]))
}

// ONE CHECK, ONE ASSERTION. This used to push an `ok` per item, so the tally at the
// bottom grew with the size of the map instead of with the number of guards - twenty-six
// green lines for a single check. The count is what a reader trusts when deciding whether
// a guard was lost, so it has to mean guards. The subject count moves into the message.
{
  let bad = 0, checked = 0
  for (const it of items) {
    for (const off of it.offsets ?? []) {
      const f = byOffset.get(off)
      if (!f || f.exclude_from_menu) continue
      if (!(f.values ?? []).length) continue        // no dictionary means no item — that is legitimate
      checked++
      if (!writtenOffsets.has(off)) {
        bad++
        problems.push({ sev: 'CRITICAL', what: `item "${it.title ?? it.id}" is declared on offset ${off}, but dist has no write to it` })
      }
    }
  }
  if (!checked) problems.push({ sev: 'CRITICAL', what: 'ни один пункт меню не объявляет смещения — проверка записей смотрит в пустоту' })
  else if (!bad) ok.push(`every offset a menu item declares is written in dist (${checked} declarations)`)
}

// ---------------------------------------------------------------- 2. conditional visibility

// One assertion for the whole check - see the note on check 1.
{
  let bad = 0, checked = 0
  for (const it of items) {
  const v = it.visible_when
  if (!v?.offset) continue
  // СРАВНИВАЕМ И ЗНАЧЕНИЕ, А НЕ ТОЛЬКО СМЕЩЕНИЕ.
  //
  // Здесь проверялось лишь то, что где-то в пакете есть условие на нужную ячейку —
  // а на какое значение оно смотрит, не спрашивалось вовсе. Значит карта могла обещать
  // «показывать при 03», пакет — проверять `99`, и сторож был доволен. Найдено аудитом
  // 01.09.2026 и доказано опытом: подмена ожидаемого значения в карте проходила молча.
  //
  // Проверять есть что: движок сравнивает содержимое ячейки с последним словом строки,
  // и написано оно ровно так, как лежит в карте.
  const needle = `matching_hex_val_custom`
  const onOffset = lines.filter(l => l.includes(needle) && l.includes(` CUST ${v.offset} `))
  const withValue = v.value == null ? onOffset : onOffset.filter(l => l.trimEnd().endsWith(` ${v.value}`))
  checked++
  if (withValue.length) continue
  bad++
  if (onOffset.length) problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" is declared visible when ${v.offset}=${v.value}, but dist checks that cell against a different value` })
  else problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" is declared visible when ${v.offset}=${v.value}, but dist has no visibility_condition` })
  }
  if (!checked) problems.push({ sev: 'CRITICAL', what: 'ни один пункт не объявляет условия видимости по смещению — проверка условий смотрит в пустоту' })
  else if (!bad) ok.push(`every declared visibility condition is in dist with its value (${checked} conditions)`)
}

// ---------------------------------------------------------------- 3. complete series

const bySeries = new Map()
for (const f of fields) {
  if (typeof f.series === 'string' && f.series) {
    if (!bySeries.has(f.series)) bySeries.set(f.series, [])
    bySeries.get(f.series).push(f)
  }
}
// One assertion for the whole check - see the note on check 1.
{
  let bad = 0, series = 0, points = 0
  for (const it of items) {
    if (!it.series) continue
    const list = (bySeries.get(it.series) ?? []).filter(f => !f.exclude_from_menu && (f.values ?? []).length)
    const missing = list.filter(f => !writtenOffsets.has(f.offset))
    series++; points += list.length
    if (!missing.length) continue
    bad++
    problems.push({ sev: 'CRITICAL', what: `series "${it.series}": ${missing.length} of ${list.length} not written (${missing.slice(0, 6).map(f => f.offset).join(', ')}…)` })
  }
  if (!series) problems.push({ sev: 'CRITICAL', what: 'ни один пункт меню не ссылается на серию — проверка полноты серий смотрит в пустоту' })
  else if (!bad) ok.push(`every series a menu item names is written in full (${series} series, ${points} points)`)
}

// ---------------------------------------------------------------- 4. blacklist

const blacklist = new Set((deps?.invalid_offsets?.items ?? []).map(i => i.offset))
for (const off of blacklist) {
  if (writtenOffsets.has(off)) problems.push({ sev: 'CRITICAL', what: `write to FORBIDDEN offset ${off} — it is not a settings field` })
}
if (blacklist.size) ok.push(`blacklist (${blacklist.size} offsets) — no violations`)

// ---------------------------------------------------------------- 5. name uniqueness

const titles = []
for (const l of lines) {
  const m = l.match(/^\[\*(.+)\]\s*$/)
  if (m) titles.push(m[1])
}
const dupTitles = [...new Map(titles.map(t => [t, titles.filter(x => x === t).length])).entries()].filter(([, n]) => n > 1)
if (dupTitles.length) {
  for (const [t, n] of dupTitles) problems.push({ sev: 'CRITICAL', what: `section name "${t}" occurs ${n} times — the [boot] footers will overwrite each other` })
} else ok.push(`section names are unique (${titles.length})`)

/**
 * ПЕРЕЗАГРУЗКА — ПОСЛЕДНИЙ ПУНКТ КОРНЯ, И ЭТО ПРОВЕРЯЕТСЯ.
 *
 * Решение оператора: перезапуск — завершение работы с тюнером, а не одно из действий
 * наравне с остальными. Порядок задан в menu.json, но порядком в файле его не удержать:
 * любой новый пункт, дописанный в конец карты, молча оттеснит перезагрузку вверх,
 * и заметить это можно будет только на консоли.
 */
{
  const rootIni = join(DIST, 'package.ini')
  const rootSections = readFileSync(rootIni, 'utf8').split(/\r?\n/)
  // Только ПЕРВАЯ страница: за `[@Help]` идут блоки справки, они не пункты меню.
  // Первая `[@…]` — заголовок самой страницы, вторая — начало справки. Режем по второй.
  const pages = rootSections.map((l, i) => (/^\[@/.test(l) ? i : -1)).filter(i => i >= 0)
  // Считаем ПУНКТЫ, а не секции. Таблица — это подпись, а не пункт меню: на неё нельзя
  // встать курсором и её нельзя нажать. Под перезагрузкой стоит строка «какая прошивка
  // стоит», и решение «перезагрузка последняя» она не нарушает — оно про то, чем работа
  // с тюнером заканчивается, а не про последнюю строку на экране.
  const body = rootSections.slice(0, pages[1] ?? rootSections.length)
  const menuItems = body.filter((l, i) => {
    if (!/^\[[^@]/.test(l)) return false
    // Директивы секции идут сразу за её заголовком, до следующей пустой строки.
    for (let k = i + 1; k < body.length && body[k].trim() !== ''; k++)
      if (/^;mode=table/.test(body[k])) return false
    return true
  })
  const last = menuItems.at(-1)
  if (last === '[Reboot the console]') ok.push('«Reboot the console» — последний пункт корня')
  else problems.push({ sev: 'IMPORTANT', what: `«Reboot the console» должен быть последним пунктом корня, а последний — ${last}` })
}

/**
 * ВИДЖЕТ СУЖАЕТ ШАПКУ ВТРОЕ — И ЭТО ЗАМЕЧАЕТСЯ ТОЛЬКО НА КОНСОЛИ.
 *
 * Директива `;show_widget=true` включает часы и датчики в шапке, а заодно урезает бокс
 * под название и подпись с 408 пикселей до 214 (`tesla.hpp:6770`, константа приколочена).
 * Что не влезло — уезжает бегущей строкой; обрезки многоточием в шапке нет.
 *
 * Замерено по фотографиям экрана:
 *   «4IFIR Wizard» кеглем 32 ≈ 195 px — влезает в 214 с запасом в один символ;
 *   подпись «<версия> ⋮ Ultrahand Package» кеглем 15 — «Ultrahand Package» сам по себе
 *   ≈ 138 px, значит на версию остаётся около ВОСЬМИ ЗНАКОВ.
 *
 * Сейчас виджета у нас нет, поэтому бокс 408 и всё влезает. Проверка нужна на будущее:
 * тот, кто включит виджет, узнает о бюджете здесь, а не по фотографии с консоли.
 *
 * Рецепт готов и лежит в `NOTES.md` №148 — правки на одну строку каждая.
 */
{
  const rootIni = readFileSync(join(DIST, 'package.ini'), 'utf8')
  if (/^;show_widget\s*=\s*true/mi.test(rootIni)) {
    const ver = rootIni.match(/^;version='([^']*)'/m)?.[1] ?? ''
    const title = rootIni.match(/^;display_title='([^']*)'/m)
               ?? rootIni.match(/^;title='([^']*)'/m)
    const name = title?.[1] ?? ''
    if (ver.length > 8) {
      problems.push({ sev: 'IMPORTANT', what:
        `виджет включён, а версия в шапке ${ver.length} знаков (бюджет ~8) — подпись уедет бегущей строкой. Рецепт: NOTES №148` })
    }
    if (name.length > 13) {
      problems.push({ sev: 'IMPORTANT', what:
        `виджет включён, а имя в шапке «${name}» длиннее 13 знаков — может уехать. Лечится ;display_title=, рецепт: NOTES №148` })
    }
    // Виджет НЕ наследуется через форвардер — директива нужна в каждом ini.
    const withWidget = iniFiles.filter(f => /^;show_widget\s*=\s*true/mi.test(readFileSync(f, 'utf8')))
    if (withWidget.length < iniFiles.filter(f => /package\.ini$/.test(f)).length) {
      problems.push({ sev: 'IMPORTANT', what:
        `;show_widget= стоит не во всех package.ini (${withWidget.length}) — на подстраницах виджет пропадёт: директива через форвардер не наследуется` })
    }
  } else {
    ok.push('виджет выключен — под название и подпись все 408 пикселей')
  }
}

// ---------------------------------------------------------------- 6. boot covers what is written

const bootRead = new Set()
for (const m of text.matchAll(/hex_file\(CUST,(\d+),/g)) bootRead.add(Number(m[1]))
// Ячейки, которые пункт пишет ПОПУТНО со своим полем, подписи не имеют и иметь не должны:
// подпись у них общая, у самого пункта. Так устроены ступени андервольта GPU — выбор одной
// ступени переписывает 32 ячейки таблицы напряжений, и тридцать две подписи на один пункт
// были бы бессмыслицей. Отличаем их по форме команды: значение берётся из ключа `w<смещение>`.
const sideWritten = new Set()
for (const m of text.matchAll(/CUST (\d+) \{json_file_source\(\*,w\d+\)\}/g)) sideWritten.add(Number(m[1]))
const noFooter = [...writtenOffsets].filter(o => !bootRead.has(o) && !sideWritten.has(o))
if (noFooter.length) {
  problems.push({ sev: 'IMPORTANT', what: `${noFooter.length} offsets are written but never read in [boot] — there will be no footer (${noFooter.slice(0, 8).join(', ')}…)` })
} else ok.push(`every written offset is read in [boot]`)

/**
 * Footer paths must resolve FROM THEIR OWN FILE'S DIRECTORY.
 *
 * Forwarder commands run with the `packagePath` of the file the forwarder lives in
 * (`main.cpp:5784`). A forwarder in `advanced/ram/package.ini` runs from `advanced/ram/`, not
 * from the package root — so the path `./advanced/ram/core-timings/config.ini` written in that
 * file turns into `advanced/ram/advanced/ram/…`, there is no such file, and the footer stays
 * empty.
 *
 * The bug is treacherous because it breaks NOTHING visibly: the package builds, uhlint says
 * nothing, and on the console the section simply has no values. Worse, an old `config.ini` left
 * over from a previous install keeps showing the inherited footers, which makes it look like
 * "some sections work".
 */
const badPaths = []
for (const f of iniFiles) {
  const dir = dirname(f)
  const body = readFileSync(f, 'utf8')
  // Файлы, которые пакет создаёт САМ, во время работы: скачивает, пишет, трогает.
  // Проверять их существование на диске бессмысленно — их там нет и не должно быть.
  // Обновление скачивает файл и тут же его читает; прежде это давало CRITICAL,
  // то есть проверка ругалась на верный код. Ложная тревога дороже пропущенной:
  // к ней привыкают и перестают читать вывод целиком.
  const madeAtRuntime = new Set(
    [...body.matchAll(/^(?:download|download-no-retry|touch|set-ini-val|set-ini-value|cp|copy|mv|move|rename)\s+(.*)$/gm)]
      .flatMap(m => [...m[1].matchAll(/'([^']+)'|(\S+)/g)].map(a => (a[1] ?? a[2])))
      .filter(a => a.startsWith('./'))
      .map(a => a.slice(2)))

  for (const m of body.matchAll(/(?:set-ini-val|json_file)\s+'\.\/([^']+)'/g)) {
    if (madeAtRuntime.has(m[1])) continue
    const target = join(dir, m[1])
    // config.ini is created by the engine, so check the directory rather than the file itself
    const probe = /config\.ini$/.test(m[1]) ? dirname(target) : target
    if (!existsSync(probe)) badPaths.push(`${f.replace(DIST, '')} → ./${m[1]}`)
  }
}
if (badPaths.length) {
  problems.push({ sev: 'CRITICAL', what: `${badPaths.length} paths do not resolve from their own file — the footers will be empty:\n     ${badPaths.slice(0, 5).join('\n     ')}` })
} else ok.push(`footer paths resolve from their own file's directory`)

// ------------------------------------------------- 8. reset writes exactly the factory set
//
// "Reset to defaults" must write what the firmware's own snapshot says, no more and no less.
// Both directions matter and both went wrong before:
//   too much — the Erista GPU curve was reset to invented values, shifted a row off;
//   too little — RAM clock and CPU boost were skipped entirely, so an overclock survived
//   a reset that claimed to undo it.
{
  // Сброс читает Default.ini вместо hex-литералов, поэтому проверка разделилась надвое:
  // меню обязано АДРЕСОВАТЬ ровно заводские смещения, а Default.ini — СОДЕРЖАТЬ ровно
  // заводские значения. Раздельно оно ловит класс, который прежняя проверка не видела:
  // файл, тихо разошедшийся с картой, из которой был порождён.
  const factory = JSON.parse(readFileSync(join(ROOT, 'package', 'factory-defaults.json'), 'utf8')).defaults
  // Применение переехало на отдельную страницу: сначала показать, что будет записано,
  // и только потом писать. В service/package.ini остался лишь переход.
  const resetPage = join(DIST, 'service', 'reset.ini')
  const resetIni = existsSync(resetPage) ? readFileSync(resetPage, 'utf8') : ''
  // Пунктов применения ДВА — по одному на ревизию. Заводской снимок снят с Mariko,
  // и один общий пункт писал на Erista девять чужих значений, а два её собственных поля
  // не сбрасывал вовсе. Проверяем каждую ревизию отдельно: она обязана писать ровно свою
  // долю снимка — не меньше (иначе разгон переживёт сброс) и не больше (иначе в kip
  // уедет значение поля, которого на этой консоли нет).
  const sections = [...resetIni.matchAll(/\[Apply factory defaults[^\]?]*\?(\w+)\]([\s\S]*?)(?=\n\[|$)/g)]

  if (!sections.length) {
    problems.push({ sev: 'CRITICAL', what: 'страница сброса service/reset.ini не найдена или в ней нет пунктов [Apply factory defaults?<ревизия>]' })
  } else {
    if (sections.length !== 2) problems.push({ sev: 'CRITICAL', what: `пунктов сброса ${sections.length}, а ревизий две` })
    for (const [, rev, sec] of sections) {
      const written = new Set()
      for (const m of sec.matchAll(/CUST (\d+) \{ini_file\(Fields,(\d+)\)\}/g)) {
        if (m[1] !== m[2]) problems.push({ sev: 'CRITICAL', what: `сброс пишет в ${m[1]}, а значение берёт из ключа ${m[2]}` })
        written.add(Number(m[1]))
      }
      if (!sec.includes("ini_file './Default.ini'")) {
        problems.push({ sev: 'CRITICAL', what: `сброс ${rev} не объявляет источник Default.ini — подстановки дадут пустоту` })
      }
      if (!sec.includes(`;system=${rev}`)) {
        problems.push({ sev: 'CRITICAL', what: `сброс ${rev} без ;system= — он выполнится и на другой ревизии` })
      }
      const mine = Object.keys(factory).map(Number).filter(o => {
        const f = fields.find(x => x.offset === o)
        const p = f?.platform ?? 'both'
        // ИСКЛЮЧЕНИЕ, ОБЪЯВЛЕННОЕ ВСЛУХ: поле может выдаваться на одной ревизии,
        // а сбрасываться на обеих. Так у семи верхних точек кривой GPU (184…208):
        // на Mariko это точки, на Erista — первая строка её таблицы CPU, испортить
        // которую может чужой конфигуратор. Вернуть её к заводскому больше нечем.
        // Ключ `factory_reset_both` обязателен: молчаливого исключения тут нет.
        return p === 'both' || p === rev || Boolean(f?.factory_reset_both)
      })
      const missing = mine.filter(o => !written.has(o))
      const extra = [...written].filter(o => !mine.includes(o))
      if (missing.length) problems.push({ sev: 'CRITICAL', what: `сброс ${rev} пропускает ${missing.length} заводских смещений: ${missing.slice(0, 6).join(', ')}` })
      if (extra.length) problems.push({ sev: 'CRITICAL', what: `сброс ${rev} пишет ${extra.length} смещений не своей ревизии: ${extra.slice(0, 6).join(', ')}` })
    }
    // Ниже — проверки самого файла Default.ini, они от ревизии не зависят.
    const badApply = problems.length

    // Файл обязан лежать РЯДОМ с тем, кто его читает: `./` разворачивается в каталог
    // подпакета. В корне dist/ движок его не найдёт и молча пропустит все записи.
    const defPath = join(DIST, 'service', 'Default.ini')
    if (!existsSync(defPath)) {
      problems.push({ sev: 'CRITICAL', what: 'Default.ini не сгенерирован, а сброс на него ссылается' })
    } else {
      const def = new Map()
      for (const line of readFileSync(defPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^(\d+)=([0-9A-Fa-f]+)/)
        if (m) def.set(Number(m[1]), m[2].toUpperCase())
      }
      // Значение обязано быть ЧИСТЫМ hex. Движок обрезает у значения только пробелы
      // и табуляции (ini_funcs.cpp:601-605), точку с запятой комментарием не считает —
      // хвост уехал бы в kip, и hexEditByOffset записал бы len/2 байт вместо длины поля.
      const dirty = readFileSync(defPath, 'utf8').split(/\r?\n/)
        .filter(l => /^\d+=/.test(l) && !/^\d+=[0-9A-Fa-f]+$/.test(l))
      if (dirty.length) problems.push({ sev: 'CRITICAL', what: `в Default.ini ${dirty.length} значений с посторонним содержимым: ${dirty[0]}` })
      const bad = Object.entries(factory).filter(([o, h]) => def.get(Number(o)) !== h)
      if (bad.length) problems.push({ sev: 'CRITICAL', what: `Default.ini расходится с эталоном в ${bad.length} значениях: ${bad.slice(0, 4).map(([o]) => o).join(', ')}` })
      else if (problems.length === badApply) ok.push(`reset applies Default.ini per revision and it matches the factory set (${def.size} offsets)`)
    }
  }
}

// ------------------------------------------- 9. dictionary entries are the field's full width
//
// A value shorter than the field leaves the high bytes of whatever was there before.
// It only bites where the old value is large: writing a 1-byte "auto" (00) over
// 3000000 kHz leaves 2999808 kHz — a silent overclock instead of automatic mode.
// The generator pads, so this never reached a console; the check keeps it that way.
// Only ZERO entries matter. A short non-zero value pads to the same number — `4C04`
// becomes `4C0400`, still 1100. A short zero does not: `00` written over `C0C62D`
// (3000000 kHz) leaves `00C62D` = 2999808, so "automatic" would quietly stay an overclock.
{
  const risky = []
  for (const f of fields) {
    const len = f.length ?? 3
    for (const v of f.values ?? []) {
      const h = (v.hex ?? '').replace(/[^0-9A-Fa-f]/g, '')
      if (h.length / 2 < len && /^0+$/.test(h)) risky.push(`${f.offset}:"${v.name}"`)
    }
  }
  if (risky.length) problems.push({ sev: 'IMPORTANT', what: `${risky.length} zero entries are narrower than their field — padding is the only thing stopping a silent partial write: ${risky.slice(0, 5).join(', ')}` })
  else ok.push('no zero dictionary entry is narrower than its field')
}

// --------------------------------------------- 10. the published set can build itself
//
// Everything the generator and the checks read must be in $PUBLISH, or someone who clones
// the public repository gets a crash on the first `node scripts/generate.mjs`.
//
// This is not hypothetical: package/factory-defaults.json was introduced as a generator
// input and left out of the list. Locally nothing broke — the file was right there — and
// the gap was invisible until someone thought to look. A published repository that cannot
// build is worse than no repository: it reads as neglect.
// Проверка только для рабочего дерева: `publish.ps1` сам не публикуется, и в клоне
// публичного репозитория его нет. Без этой оговорки проверка падала бы ровно там,
// где должна была защищать, — в собранном по списку наборе. Что и произошло при первом
// же честном прогоне: она была написана против этой ошибки и совершила её сама.
if (!existsSync(join(ROOT, 'scripts', 'publish.ps1'))) {
  ok.push('publish list check skipped — not a maintainer working tree')
} else {
  const publishPs1 = readFileSync(join(ROOT, 'scripts', 'publish.ps1'), 'utf8')
  const block = publishPs1.slice(publishPs1.indexOf('$PUBLISH = @('), publishPs1.indexOf(')', publishPs1.indexOf('$PUBLISH = @(')))
  const published = [...block.matchAll(/'([^']+)'/g)].map(m => m[1])

  const scripts = ['generate.mjs', 'check-menu.mjs', 'check-generated.mjs']
  const needed = new Set()
  for (const s of scripts) {
    const src = readFileSync(join(ROOT, 'scripts', s), 'utf8')
    // Именно ЧТЕНИЕ: `join(ROOT, …)` встречается и в определении каталога вывода,
    // и тогда проверка требовала бы публиковать package/dist — порождаемое.
    for (const m of src.matchAll(/readFileSync\(join\(ROOT,\s*((?:'[^']*'\s*,?\s*)+)\)/g)) {
      const parts = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1])
      if (parts[0] === 'package') needed.add(parts.join('/'))
    }
  }
  const uncovered = [...needed].filter(p => !published.some(pub => p === pub || p.startsWith(pub + '/')))
  if (uncovered.length) problems.push({ sev: 'CRITICAL', what: `the published set cannot build itself — these inputs are missing from $PUBLISH: ${uncovered.join(', ')}` })
  else ok.push(`every generator input is published (${needed.size} paths)`)
}

// ------------------------------------------- 11. Current Settings: раскладка по страницам
//
// pMeh, sMeh и тайминги живут на ВТОРОЙ странице сводки — так попросил оператор, посмотрев
// на первую версию: на одном экране они забивали то, ради чего сводку открывают.
//
// Проверка появилась потому, что раскладка уже один раз тихо развалилась. Она была привязана
// к подписям разделов (`pMeh 0-21`), подписи изменились при добавлении новых полей — и все
// 43 строки вернулись на первую страницу. Файл сгенерировался, проверки остались зелёными,
// увидеть это можно было только на консоли.
{
  const cur = join(DIST, 'current.ini')
  if (!existsSync(cur)) {
    problems.push({ sev: 'CRITICAL', what: 'нет current.ini — сводка не сгенерирована' })
  } else {
    const text = readFileSync(cur, 'utf8').split(/\r?\n/)
    const pages = []
    let page = null
    for (const line of text) {
      const m = line.match(/^\[@(.+)\]/)
      if (m) { page = { name: m[1], rows: [] }; pages.push(page); continue }
      const r = line.match(/^'?([^;=[][^=]*?)'?\s*=/)
      if (r && page) page.rows.push(r[1].trim())
    }
    const deepRx = /meh|timing/i
    if (pages.length < 2) {
      problems.push({ sev: 'CRITICAL', what: `в current.ini ${pages.length} страниц(ы) — тонкая настройка должна быть на второй` })
    } else {
      const strays = pages[0].rows.filter(r => deepRx.test(r))
      if (strays.length) problems.push({ sev: 'CRITICAL', what: `на первой странице сводки ${strays.length} строк тонкой настройки: ${strays.slice(0, 3).join(', ')}` })
      else ok.push(`current settings split correctly (${pages[0].rows.length} rows / ${pages[1].rows.length} on the second page)`)
    }
  }
}

// ------------------------------------------- 12. каждому заголовку — отступ перед ним
//
// Без пустой рамки `[Gap]` перед `[Header]` подпись раздела печатается вплотную к рамке
// предыдущей таблицы и наезжает на неё. Видно только на консоли: файл валиден, uhlint
// доволен, движок команду выполняет.
//
// Проверка появилась после второго раза. Первый — в сводке «Current Settings», починили
// в `emitPage`. Второй — в сводке бэкапа, собранной заново: тот же дефект, потому что
// правило жило в одной функции, а не в проверке.
{
  const noGap = []
  for (const f of iniFiles) {
    const L = readFileSync(f, 'utf8').split(/\r?\n/)
    for (let i = 0; i < L.length; i++) {
      if (L[i] !== '[Header]') continue
      let j = i - 1
      while (j >= 0 && L[j].trim() === '') j--
      if (j < 0) continue
      // выше должна быть директива (последняя строка Gap-секции) или начало страницы
      if (!/^;/.test(L[j]) && !/^\[@/.test(L[j])) noGap.push(`${f.replace(DIST, '')}:${i + 1}`)
    }
  }
  if (noGap.length) problems.push({ sev: 'IMPORTANT', what: `${noGap.length} заголовков без отступа перед ними — подпись наедет на предыдущую таблицу: ${noGap.slice(0, 4).join(', ')}` })
  else ok.push('every table heading has a gap in front of it')
}

// ------------------------------------------------- 13. метаданные карты равны содержимому
//
// `_meta` в fields.json хранит итоговые числа. Карту правят несколько скриптов, и однажды
// метаданные разошлись с содержимым на семь полей — а документация цитировала именно их,
// поэтому «122 смещения» разъехались по трём файлам.
{
  const meta = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8'))._meta ?? {}
  const both = fields.filter(f => (f.confirmed_by ?? []).length >= 2).length
  const claims = [
    ['offsets_total', meta.offsets_total, fields.length],
    ['confirmed_by_both', meta.confirmed_by_both, both],
    ['single_source', meta.single_source, fields.length - both],
  ].filter(([, said, real]) => said !== undefined && said !== real)
  if (claims.length) problems.push({ sev: 'IMPORTANT', what: `_meta расходится с картой: ${claims.map(([k, s, r]) => `${k} ${s}≠${r}`).join(', ')}` })
  else ok.push('fields.json _meta matches its own contents')
}

// ------------------------------------------- 14. имя бэкапа собирается из объявленных ключей
//
// Имя копии складывается по шагам через промежуточные ключи в `config.ini`:
// Khz -> Mhz -> Freq, Bal -> Bals, и уже из них Path. Порядок здесь не косметика —
// `{ini_file(Backup,X)}` читает то, что записано ВЫШЕ по секции, и опечатка в имени ключа
// или перестановка двух строк дадут пустое место в имени файла, о котором никто не скажет:
// бэкап просто получит имя вида `-eBal2-14-08-26-175334.ini`.
//
// Заодно стережём, что каждая ревизия читает СВОЁ смещение частоты (mariko 32, erista 24):
// один общий оффсет на обе — ровно та ошибка, которую легко не заметить глазами.
{
  const bad = []
  for (const f of iniFiles) {
    const L = readFileSync(f, 'utf8').split(/\r?\n/)
    let known = null
    for (const line of L) {
      if (/^\[/.test(line)) { known = /^\[Create backup/.test(line) ? new Set() : null; continue }
      if (!known) continue
      for (const [, key] of line.matchAll(/\{ini_file\(Backup,(\w+)\)\}/g)) {
        if (!known.has(key)) bad.push(`${f.replace(DIST, '')}: {ini_file(Backup,${key})} читается раньше, чем записан`)
      }
      const set = line.match(/^set-ini-val '\.\/config\.ini' Backup (\w+) /)
      if (set) known.add(set[1])
    }
  }
  // частота: у каждой ревизии своя
  const wantFreq = {}
  for (const rev of ['mariko', 'erista']) {
    const fld = fields.find(x => x.name === 'RAM MHz' && x.platform === rev)
    if (fld) wantFreq[rev] = fld.offset
  }
  for (const f of iniFiles) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/\[Create backup\?(\w+)\]([\s\S]*?)(?=\n\[|$)/g)) {
      const off = m[2].match(/Backup Khz '\{hex_to_decimal\(\{hex_to_rhex\(\{hex_file\(CUST,(\d+),/)?.[1]
      if (wantFreq[m[1]] !== undefined && Number(off) !== wantFreq[m[1]]) {
        bad.push(`${f.replace(DIST, '')}: бэкап ${m[1]} читает частоту со смещения ${off}, а надо ${wantFreq[m[1]]}`)
      }
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `имя бэкапа собрано неверно:\n     ${bad.slice(0, 4).join('\n     ')}` })
  else ok.push('backup file name is built from keys declared before use')
}

// --------------------------------------- 15. копия и восстановление несут одно и то же
//
// Списки строились по-разному: копия — по карте, восстановление — по набору пунктов меню,
// куда `read_only` не попадает. `8 Memory Timing Mode` сохранялся и не возвращался никогда:
// из 90 полей восстанавливалось 89, и слово «restored» было неправдой ровно на одно поле.
// Обратное направление тоже важно: запись поля, которого нет в копии, взяла бы значение
// из пустоты. И дубликаты: раньше восстановление писало 95 команд на 90 значений.
{
  const bad = []
  // СОЗДАНИЕ И ПРИМЕНЕНИЕ КОПИИ ЛЕЖАТ ТЕПЕРЬ В ОДНОМ ФАЙЛЕ.
  //
  // Секция `Create backup` переехала из списка `Service` на страницу `Backup manager`
  // (решение оператора: всё про копии в одном месте). Проверка искала её в `package.ini`
  // и после переезда говорила «нет секций» — то есть жаловалась не на то, чего нет,
  // а на то, что сама смотрит не туда. Второй раз за день: имя пункта и место секции —
  // хрупкие опоры для сторожа, и оба уже подводили.
  for (const rev of ['mariko', 'erista']) {
    const restorePath = join(DIST, 'service', `restore-${rev}.ini`)
    if (!existsSync(restorePath)) { bad.push(`нет страницы восстановления для ${rev}`); continue }
    {
      const text = readFileSync(restorePath, 'utf8')
      const from = text.indexOf(`[Create backup?${rev}]`)
      if (from < 0) { bad.push(`нет секции создания копии для ${rev}`); continue }
      // Границей служит следующая секция: создание идёт первым пунктом страницы,
      // сразу за ним `Choose backup`.
      const nl = text.indexOf('\n[', from + 1)
      const to = nl < 0 ? text.length : nl
      const saved = new Set([...text.slice(from, to).matchAll(/Fields (\d+) /g)].map(m => Number(m[1])))
      // Секция применения ОДНА, а блоков `try:` внутри неё два: первый для копий
      // нашей раскладки, второй для импортированных. Оба обязаны писать один и тот же
      // набор. Сперва пунктов действительно было два, но оператор указал на беду:
      // две кнопки рядом, одна из которых на твоей копии молча ничего не делает.
      const text2 = readFileSync(restorePath, 'utf8')
      const sections = [...text2.matchAll(/\[Apply [^\]]+\]([\s\S]*?)(?=\n\[|$)/g)].map(m => m[1])
      if (sections.length !== 1) bad.push(`${rev}: секций применения ${sections.length}, ожидается одна`)
      const writesOf = t => [...t.matchAll(/CUST (\d+) \{ini_file/g)].map(m => Number(m[1]))
      const blocks = (sections[0] ?? '').split(/^try:$/m).filter(b => writesOf(b).length)
      if (blocks.length !== 2) bad.push(`${rev}: блоков записи ${blocks.length}, ожидается 2 (своя раскладка и импортированная)`)
      const writes = writesOf(blocks[0] ?? '')
      const wrote = new Set(writes)
      if (blocks[1] && String(writesOf(blocks[1])) !== String(writes)) {
        bad.push(`${rev}: блок для импортированных копий пишет не тот же набор`)
      }
      const lost = [...saved].filter(o => !wrote.has(o))
      const extra = [...wrote].filter(o => !saved.has(o))
      if (lost.length) bad.push(`${rev}: сохраняется, но не восстанавливается — ${lost.join(', ')}`)
      if (extra.length) bad.push(`${rev}: восстанавливается, но не сохраняется — ${extra.join(', ')}`)
      if (writes.length !== wrote.size) bad.push(`${rev}: ${writes.length - wrote.size} дублирующихся команд записи`)
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `копия и восстановление разошлись:\n     ${bad.join('\n     ')}` })
  else ok.push('backup and restore carry exactly the same fields')
}

// ----------------------------------- 16. точки кривых: сетка, штатные ступени, объяснимые дыры
//
// ЧТО ПРОВЕРЯЛОСЬ РАНЬШЕ И ПОЧЕМУ БОЛЬШЕ НЕ ГОДИТСЯ. Прежняя редакция требовала, чтобы пункт
// Default стоял РОВНО В СЕРЕДИНЕ списка. Список строился полосой ±75 мВ вокруг заводского
// значения, и середина была единственным опознавательным знаком, доступным без живого kip.
// 03.09.2026 список Mariko расширен до донорских границ, и обе крайние позиции стали
// законными: на 307MHz заводское 395 мВ лежит НИЖЕ пола 400 и досылается отдельным пунктом,
// на 1190MHz заводское 1020 мВ и есть потолок строки. Симметрия перестала быть признаком
// правильности, и сторож, оставленный как был, запретил бы ровно ту правку, ради которой
// всё делалось.
//
// Проверяем теперь то, ради чего сторож заводился, — что человек не останется без нужного
// пункта. Три инварианта:
//   * ровно один Default, значения строго возрастают и не повторяются;
//   * сетка выдержана: каждый пропуск кратен шагу, и пропущенное объяснимо — это
//     запрещённая константа сканера на видимой строке, а не случайная прореха;
//   * все штатные ступени этой строки есть в списке. Ступени приезжают из самой карты
//     (`writes` у пункта со `scan_guard`), живой kip для этого не нужен.
// Последний инвариант и заменил «середину»: список, собранный мимо реальных кривых
// прошивки, провалит его — а именно этим и болели донорские словари.
{
  const bad = []
  const points = fields.filter(f => String(f.series ?? '').startsWith('gpu_curve'))

  // Ступени и граница видимости сканера — из карты меню, тем же путём, что у проверки №27.
  let sg = null
  const stageRows = new Map()
  {
    const walk = n => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      if (!sg && n.scan_guard && (n.values ?? []).length) {
        sg = n.scan_guard
        for (const v of n.values) {
          for (const [key, hex] of Object.entries(v.writes ?? {})) {
            const off = Number(key)
            if ((off - sg.base) % sg.step !== 0) continue
            const uv = parseInt(String(hex).match(/../g).reverse().join(''), 16)
            if (uv % 1000) continue        // половинчатые ступени на сетку милливольт не ложатся
            const row = (off - sg.base) / sg.step
            if (!stageRows.has(row)) stageRows.set(row, new Set())
            stageRows.get(row).add(uv / 1000)
          }
        }
      }
      Object.values(n).forEach(walk)
    }
    walk(menu.sections ?? [])
  }
  const bannedMv = new Set((sg?.consts ?? []).filter(c => c % 1000 === 0).map(c => c / 1000))

  for (const f of points) {
    const mariko = f.series === 'gpu_curve_mariko'
    const step = mariko ? 5 : 12500          // Mariko хранит милливольты, Erista микровольты
    const vals = (f.values ?? []).map(v => ({
      name: String(v.name),
      n: parseInt(String(v.hex).match(/../g).reverse().join(''), 16),
    }))
    if (vals.length < 2) { bad.push(`${f.offset} ${f.name}: в списке ${vals.length} пунктов`); continue }

    const marks = vals.filter(v => /default/i.test(v.name)).length
    if (marks !== 1) bad.push(`${f.offset} ${f.name}: пунктов Default ${marks}, нужен ровно один`)

    const row = mariko ? (f.offset - 88) / 4 : null
    const visible = mariko && sg != null && row >= sg.from_row
    for (let i = 1; i < vals.length; i++) {
      const gap = vals[i].n - vals[i - 1].n
      if (gap <= 0) { bad.push(`${f.offset} ${f.name}: ${vals[i].n} не больше предыдущего ${vals[i - 1].n}`); break }
      if (gap % step) { bad.push(`${f.offset} ${f.name}: разрыв ${gap} между ${vals[i - 1].n} и ${vals[i].n} не кратен шагу ${step}`); break }
      if (gap === step) continue
      const skipped = []
      for (let x = vals[i - 1].n + step; x < vals[i].n; x += step) skipped.push(x)
      const unexplained = skipped.filter(x => !(visible && bannedMv.has(x)))
      if (unexplained.length) { bad.push(`${f.offset} ${f.name}: необъяснимая дыра, пропущены ${unexplained.join(', ')}`); break }
    }

    if (mariko && stageRows.has(row)) {
      const have = new Set(vals.map(v => v.n))
      const lost = [...stageRows.get(row)].filter(v => !have.has(v)).sort((a, b) => a - b)
      if (lost.length) bad.push(`${f.offset} ${f.name}: штатной ступени нет в списке — ${lost.join(', ')} мВ`)
    }
  }
  if (!points.length) problems.push({ sev: 'IMPORTANT', what: 'в карте не нашлось ни одной точки кривых напряжений' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `списки точек кривой собраны неверно:\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push(`curve lists keep their grid, every gap explained and every stage voltage on offer (${points.length} points)`)
}

// ------------------------------------------------- 17. числа в README равны карте
//
// README — единственный публикуемый документ, и число смещений в нём стояло руками.
// Оно разъехалось с картой на семь (122 против 129) и уехало на GitHub в обоих
// переводах сразу. Проверяем оба, потому что расходятся они независимо: правят одну
// половину и забывают вторую.
{
  const readme = join(ROOT, 'README.md')
  if (!existsSync(readme)) {
    ok.push('README не найден — проверка чисел пропущена')
  } else {
    const text = readFileSync(readme, 'utf8')
    const claims = [
      ...text.matchAll(/(\d+)\s+offsets of the CUST block/g),
      ...text.matchAll(/(\d+)\s+смещени\S*\s+блока CUST/g),
    ].map(m => Number(m[1]))
    const wrong = claims.filter(n => n !== fields.length)
    if (!claims.length) problems.push({ sev: 'IMPORTANT', what: 'в README не нашлось утверждения о числе смещений — проверка ослепла' })
    else if (wrong.length) problems.push({ sev: 'CRITICAL', what: `README обещает ${wrong.join(' и ')} смещений, в карте ${fields.length}` })
    else ok.push(`README agrees with the map on the offset count (${fields.length}, both languages)`)
  }
}

// ------------------- 18. LICENSE и NOTICE обещают состав архива — отказ обязан его держать
//
// The old subject died on 04.09.2026. While the archive carried the engine binary, GPL v2
// made both files name the fork it was built from, and this check enforced that. The engine
// left the archive and the duty went with it, so the check was guarding a dead object: green
// only because the fork link happens to sit in an unrelated sentence, and it would have gone
// RED on the legitimate edit of striking that link out.
//
// What is left is a promise the files still make to every reader: release archives carry the
// configurator alone. Nothing makes that true except a switch someone has to remember, and
// the person who finds out is the one whose engine our archive replaced on his next console
// update. So the promise is paired with the refusal in release.ps1 that enforces it.
{
  // Обе стороны — текст в репозитории, поэтому проверка не зависит от того, собирался ли
  // здесь движок. Прежняя редакция зависела: без `baseline.txt` она «пропускалась» и всё
  // равно засчитывалась пройденной — зелень за то, что смотреть было не на что.
  const PROMISE = /Release archives? contains? the configurator (only|alone)/i
  const promising = [], absent = []
  for (const name of ['LICENSE', 'NOTICE.md']) {
    const f = join(ROOT, name)
    if (!existsSync(f)) { absent.push(name); continue }
    if (PROMISE.test(readFileSync(f, 'utf8'))) promising.push(name)
  }
  const relPs = join(ROOT, 'scripts', 'release.ps1')
  if (absent.length) {
    problems.push({ sev: 'CRITICAL', what: `${absent.join(', ')} не найден — обещание о составе архива проверить не на чем` })
  } else if (!promising.length) {
    // Снять обещание — законная правка: файл просто перестаёт говорить о составе архива.
    ok.push('neither LICENSE nor NOTICE.md promises anything about the archive contents — nothing to back')
  } else if (!existsSync(relPs)) {
    // Выпускающий скрипт в публикацию не входит (список запрещённого в publish.ps1),
    // и у постороннего второй стороны нет вовсе. Пропуск назван вслух, а не выдан за проверку.
    ok.push('archive-contents promise check skipped — no scripts/release.ps1 in this tree')
  } else {
    const ps = readFileSync(relPs, 'utf8')
    const at = ps.indexOf('$ovlInStage')
    const stop = ps.indexOf('=== 2.', at < 0 ? 0 : at)
    const region = at < 0 ? '' : ps.slice(at, stop < 0 ? ps.length : stop)
    const bad = []
    if (!region) bad.push('в release.ps1 нет разбора состава по $ovlInStage — обещание ничем не держится')
    else {
      // Отказ обязан срабатывать именно на ПУБЛИКАЦИИ: комплект на передачу (`-NoUpload`)
      // несёт движок намеренно и уходит из рук в руки, а не в Releases.
      if (!/if \(Test-Path -LiteralPath \$ovlInStage\)[\s\S]{0,400}?if \(-not \$NoUpload\)[\s\S]{0,160}?throw/.test(region))
        bad.push('release.ps1 не отказывает, когда движок в комплекте, а релиз уходит на GitHub')
      // Обратное требование — «движок в комплекте обязан быть» — отменено тем же решением.
      if (/-not \(Test-Path -LiteralPath \$ovlInStage\)/.test(region))
        bad.push('release.ps1 всё ещё требует движок в комплекте — это отменено 04.09.2026')
    }
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `${promising.join(' и ')} обещают архив без движка, а выпуск это не держит:\n     ${bad.join('\n     ')}` })
    else ok.push(`the archive-contents promise in ${promising.join(' and ')} is backed by the release refusal`)
  }
}

// ------------------------------------------- 19. Подпись словаря против того, что она запишет
//
// В словаре `EMC DVB Mode` жили две записи-призрака: подпись «400 mV» писала 145,
// подпись «800 mV» — 35. Обе пришли от донора перестановкой байтов (`9001`→`9100`,
// `2003`→`2300`) и прожили месяцы, потому что рядом стояли ПРАВИЛЬНЫЕ «400mV» и «800mV»,
// отличавшиеся одним пробелом. Дедупликация словарей идёт по hex — и схлопывала
// корректные дубли, а испорченные выживали ИМЕННО ПОТОМУ, что испорчены.
//
// Это единственный найденный класс, где пункт меню записывает не то, что обещает
// подпись, — то самое, что README ставит проекту в заслугу. Ни uhlint, ни check-menu
// его не видели: синтаксис безупречен, поле существует, значение в поле влезает.
//
// Допуск на масштаб единиц: кривая Erista хранит микровольты (600 mV = 600000),
// частоты RAM — килогерцы с округлением подписи вниз (2707200 кГц → «2707MHz»).
{
  const dicts = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.json')) dicts.push(p)
    }
  }
  walk(DIST)

  const liars = []
  for (const file of dicts) {
    let data
    try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    if (!Array.isArray(data)) continue
    for (const e of data) {
      if (!e || typeof e.name !== 'string' || typeof e.hex !== 'string') continue
      const m = e.name.match(/^(\d+)\s*(mV|uV|MHz|kHz)\b/)
      if (!m || e.hex.length % 2) continue
      const want = Number(m[1])
      let got = 0
      for (let i = e.hex.length - 2; i >= 0; i -= 2) got = got * 256 + parseInt(e.hex.slice(i, i + 2), 16)
      // сама величина, она же в тысячных, она же в миллионных — с допуском на округление подписи
      const fits = [1, 1e3, 1e6].some(k => Math.abs(got - want * k) < k)
      if (!fits) liars.push(`${relative(ROOT, file)}: «${e.name}» запишет ${got}`)
    }
  }
  if (liars.length) problems.push({ sev: 'CRITICAL', what: `подпись словаря обещает не то, что запишет: ${liars.join('; ')}` })
  else ok.push(`every numeric dictionary label encodes the value it names (${dicts.length} dictionaries)`)
}

// ------------------------------------------- 20. Длина имени копии настроек
//
// В списке выбора файла строка несёт справа кружок радиоселектора, а место под текст
// движок отмеряет так, будто значения нет: подсвеченная строка при прокрутке заходит
// на кружок (замерено — 15 пикселей из 36; апстрим это не чинил, `tesla.hpp`,
// `drawTruncatedText`). Лечится тем же приёмом, что и версия в шапке пакета:
// укорачиваем ТЕКСТ, а не подгоняем чужую вёрстку.
//
// Проверка сторожит не «влезает» — ширину шрифта отсюда не измерить, — а РЕГРЕССИЮ:
// имя не должно снова вырасти. Порог равен нынешнему худшему случаю, поэтому любое
// удлинение шаблона роняет сборку и заставляет подумать ещё раз.
{
  // 28 — нынешний худший случай (импортированная копия). Бюджет НЕ обещает «влезает»:
  // проверено на консоли, что даже 24 знака заходят на кружок отметки, и укорачивание
  // эту границу не переносит, а только отодвигает. Обещает он другое — что имя
  // не вырастет молча. Настоящее лечение — ширина поля бегущей строки в движке.
  const NAME_BUDGET = 28

  // Раскрываем шаблон худшими значениями: длиннейшая частота, длиннейший режим eBal,
  // и метка времени, где каждое поле формата занимает два знака.
  const digits = n => String(n).length
  const mhzMax = Math.max(...fields
    .filter(f => f.name === 'RAM MHz')
    .flatMap(f => (f.values ?? []).map(v => {
      const le = String(v.hex).match(/../g) ?? []
      const khz = le.reverse().reduce((a, b) => a * 256 + parseInt(b, 16), 0)
      return digits(Math.round(khz / 1000))
    })), 4)
  const balMax = Math.max(...fields
    .filter(f => f.name === 'EMC Balance')
    .flatMap(f => (f.values ?? []).map(v => {
      const le = String(v.hex).match(/../g) ?? []
      return digits(le.reverse().reduce((a, b) => a * 256 + parseInt(b, 16), 0))
    })), 1)

  const freqLen = Math.max(4, mhzMax)          // «auto» либо число мегагерц
  const balsLen = Math.max(4, 4 + balMax)      // «auto» либо «eBal» + номер
  const stampLen = fmt => fmt.replace(/%[a-zA-Z]/g, '..').length

  const paths = []
  for (const f of iniFiles) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/set-ini-val '\.\/config\.ini' \w+ Path '([^']+)'/g)) paths.push([f, m[1]])
  }
  if (!paths.length) problems.push({ sev: 'IMPORTANT', what: 'не нашлось ни одной строки, задающей имя копии — проверка длины ослепла' })

  const tooLong = []
  for (const [file, tpl] of paths) {
    const name = tpl.slice(tpl.lastIndexOf('/') + 1).replace(/\.ini$/, '')
    const len = name
      .replace(/\{ini_file\([^,]+,Freq\)\}/g, 'x'.repeat(freqLen))
      .replace(/\{ini_file\([^,]+,Bals\)\}/g, 'x'.repeat(balsLen))
      .replace(/\{timestamp\(([^)]*)\)\}/g, (_, fmt) => 'x'.repeat(stampLen(fmt)))
      .length
    if (len > NAME_BUDGET) tooLong.push(`${relative(ROOT, file)}: ${len} знаков при бюджете ${NAME_BUDGET}`)
  }
  if (tooLong.length) problems.push({ sev: 'CRITICAL', what: `имя копии настроек выросло и снова полезет на кружок выбора: ${tooLong.join('; ')}` })
  else ok.push(`backup file names stay within the ${NAME_BUDGET}-character budget (${paths.length} templates)`)
}

// ------------------------------------------- 21. Таблица не читает секцию из чужого файла
//
// На странице восстановления строка `File` показывала «Not available» С ПЕРВОГО ДНЯ.
// Причина — привязка: `ini_file './config.ini'`, затем `ini_file '{ini_file(Restore,Path)}'`
// переводит чтение на файл копии, а следующая строка спрашивала `[Restore] Name` —
// секцию, которой в копии нет. Движок возвращает литерал `null`, а таблица подменяет
// любое значение со словом `null` на «Not available» (`utils.hpp:1261`).
//
// Дефект не даёт ни ошибки, ни пустоты — он даёт правдоподобное «недоступно», которое
// читается как свойство копии, а не как поломка экрана. Поймать его можно только так:
// после перепривязки ни одна строка не смеет спрашивать секции, живущие в `config.ini`.
{
  const OWN_SECTIONS = ['Restore', 'Backup', 'Import']   // секции нашего config.ini
  const strays = []
  for (const f of iniFiles) {
    let rebound = false
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim()
      if (line.startsWith('[')) { rebound = false; continue }   // привязка не переживает границу секции
      // Перепривязка — это `ini_file` с аргументом-подстановкой, а не с литеральным путём.
      if (/^ini_file\s+'\{/.test(line)) { rebound = true; continue }
      if (!rebound) continue
      // Только СТРОКИ ТАБЛИЦЫ вида 'подпись' = 'значение'. Команды тоже принимают
      // `{ini_file(Restore,Path)}`, но там это аргумент-путь, а не чтение из привязки:
      // `matching_ini_val {ini_file(Restore,Path)} Meta kipver …` совершенно законно.
      if (!/^'[^']*'\s*=\s*'/.test(line)) continue
      for (const sec of OWN_SECTIONS) {
        if (line.includes(`{ini_file(${sec},`)) {
          strays.push(`${relative(ROOT, f)}: «${line}» читает [${sec}] уже из чужого файла`)
        }
      }
    }
  }
  if (strays.length) problems.push({ sev: 'CRITICAL', what: `строка таблицы спрашивает секцию, которой в привязанном файле нет — на экране будет «Not available»: ${strays.join('; ')}` })
  else ok.push('no table row reads a config.ini section after the binding moved to a data file')
}

// ------------------------------------------- 22. GPU Min Voltage предлагает только ступени
//
// Решение оператора как эксперта по железу: фиксированное число милливольт в этом поле
// применяется СРАЗУ К ОБОИМ режимам частоты памяти, а ступень заставляет kip считать
// порог для каждого режима отдельно. Для этой консоли верно второе, поэтому в меню
// остаются только ступени.
//
// Проверка нужна потому, что история тянет назад: `docs/NOTES.md` №75 записал обратное
// — «наш тюнер был строго беднее обоих предшественников», и милливольты тогда вернули.
// Довод был верен для полноты словаря и неверен по существу поля. Без сторожа следующий
// читатель журнала восстановит их снова, и это будет выглядеть как исправление.
//
// Числа при этом остаются в СЛОВАРЕ ПОДПИСИ: значение может стоять в kip, поставленное
// чужим пакетом, и назвать его мы обязаны. Проверяется только список выбора.
{
  const vmin = join(DIST, 'advanced', 'gpu', 'json', 'gpu_vmin.json')
  if (!existsSync(vmin)) {
    problems.push({ sev: 'IMPORTANT', what: 'словарь GPU Min Voltage не найден — проверка ослепла' })
  } else {
    const list = JSON.parse(readFileSync(vmin, 'utf8'))
    const numeric = list.filter(e => /^\s*\d/.test(String(e.name)))
    if (numeric.length) {
      problems.push({ sev: 'CRITICAL', what: `GPU Min Voltage снова предлагает милливольты (${numeric.length}): фиксированное число бьёт по обоим режимам памяти сразу, ступень — по каждому отдельно. Разбор — docs/NOTES.md` })
    } else if (!list.length) {
      problems.push({ sev: 'CRITICAL', what: 'GPU Min Voltage остался вовсе без вариантов' })
    } else {
      // Подпись обязана уметь прочитать больше, чем меню предлагает выбрать.
      const map = JSON.parse(readFileSync(vmin.replace(/\.json$/, '.map.json'), 'utf8'))[0]
      if (Object.keys(map).length <= list.length) {
        problems.push({ sev: 'CRITICAL', what: 'из словаря подписи GPU Min Voltage пропали числовые значения — тюнер перестанет называть то, что уже стоит в kip' })
      } else {
        ok.push(`GPU Min Voltage offers stages only (${list.length}), still reads ${Object.keys(map).length} values`)
      }
    }
  }
}

// ------------------------------- 23. Ступени андервольта GPU пишут таблицу целиком и в свою
//
// Ступень GPU — это не число, а таблица напряжений в блоке CUST, и выбор ступени переписывает
// её целиком: 31 напряжение плюс частота последней строки. Здесь всё ломается тихо:
//
//   * недописанная таблица — это смесь двух ступеней, которой никто не выбирал. Промах по
//     ключу движок молча превращает в `null`, запись с `null` молча пропускается, а пункт
//     при этом показывает галочку;
//   * промах МИМО таблицы бьёт по соседям: ниже 8864 лежит базовая таблица ST1, с 10600 —
//     HiOPT, то есть ST3. Ошибка в одном смещении испортила бы ступень, которую мы вообще
//     не собирались трогать;
//   * верхнее напряжение таблицы прошивка ставит ещё и как потолок напряжения шины GPU.
//     Разойдись оно у ступеней — потолок шины ездил бы вместе с выбором ступени;
//   * подпись читает пару «режим + первая ячейка». Совпади эта пара у двух ступеней —
//     тюнер называл бы одну именем другой.
{
  const SLOT_LO = 8864, SLOT_HI = 10600      // границы таблицы ST2: строго между ST1 и ST3
  const dir = join(DIST, 'advanced', 'gpu', 'json')
  const listFile = join(dir, 'gpu_uv_mode_mariko.json')
  if (!existsSync(listFile)) {
    problems.push({ sev: 'IMPORTANT', what: 'ступени андервольта GPU не найдены — их убрали намеренно?' })
  } else {
    const list = JSON.parse(readFileSync(listFile, 'utf8'))
    const bad = []
    const keys = new Set(list.flatMap(e => Object.keys(e).filter(k => /^w\d+$/.test(k))))
    const offs = [...keys].map(k => Number(k.slice(1))).sort((a, b) => a - b)

    if (offs.length !== 32) bad.push(`записываемых ячеек ${offs.length}, а таблица это 31 напряжение плюс частота верхней строки`)
    for (const o of offs) {
      if (o <= SLOT_LO || o >= SLOT_HI) bad.push(`смещение ${o} лежит вне таблицы ST2 (${SLOT_LO}…${SLOT_HI}) — это уже чужая ступень`)
    }
    const probes = new Set()
    let top = null
    for (const e of list) {
      for (const k of keys) if (e[k] === undefined) bad.push(`ступень «${e.name}» не задаёт ${k} — таблица останется от предыдущей`)
      const probe = e.hex + (e[`w${SLOT_LO + 32}`] ?? '')
      if (probes.has(probe)) bad.push(`ступень «${e.name}» неотличима от предыдущей по паре «режим + первая ячейка» — подпись соврёт`)
      probes.add(probe)
      // Верхняя ячейка = максимум напряжения шины. Обязана быть одинаковой у всех ступеней.
      const hi = e[`w${SLOT_LO + 32 + 56 * 30}`]
      if (top === null) top = hi
      else if (hi !== top) bad.push(`ступень «${e.name}» задаёт другое верхнее напряжение (${hi} против ${top}) — уедет потолок шины`)
      // Монотонность: кривая обязана расти вместе с частотой.
      const mv = h => parseInt(String(h).match(/../g).reverse().join(''), 16)
      for (let i = 1; i < 31; i++) {
        const a = e[`w${SLOT_LO + 32 + 56 * (i - 1)}`], b = e[`w${SLOT_LO + 32 + 56 * i}`]
        if (a && b && mv(b) < mv(a)) { bad.push(`ступень «${e.name}»: строка ${i} ниже предыдущей`); break }
      }
    }
    // Подпись обязана уметь прочитать пару, а не одно поле — иначе три ступени сольются.
    const bootLine = text.split(/\r?\n/).find(l => l.includes("'*Undervolt Mode' footer"))
    if (!bootLine) bad.push('подпись пункта не строится при открытии пакета')
    else if ((bootLine.match(/hex_file\(CUST,/g) ?? []).length < 2)
      bad.push('подпись читает одну ячейку — три ступени из шести получат одно имя')

    if (bad.length) problems.push({ sev: 'CRITICAL', what: `ступени андервольта GPU собраны неверно:\n     ${bad.slice(0, 6).join('\n     ')}` })
    else ok.push(`GPU stages rewrite their own table in full (${list.length} stages, ${offs.length} cells each)`)
  }
}

// ----------------------------- 24. Подпись «Default» против эталона сброса, и полнота эталона
//
// Два файла говорят о заводском значении, и до сих пор их никто не сверял между собой:
// `factory-defaults.json` решает, ЧТО запишет сброс, а метка «Default» в словаре меню
// говорит человеку, ЧТО считать заводским. Разошлись — и оба раза молча: `sMeh 0 ARB-Boost`
// подписывал заводским значение на три ступени выше настоящего, `pMeh 15 eFOS MK` — на одну.
// Человек, возвращающий заводское руками, уезжал не туда, куда его вернул бы сброс.
//
// Вторая половина проверки — про полноту. У поля есть роль `reset`, но в эталоне его может
// не оказаться вовсе: снимок прошивки, из которого эталон строится, неполон. Тогда сброс
// такое поле молча не трогает. Так из сброса выпали предел напряжения CPU и частота памяти
// на Erista — ровно то, ради чего сброс и нажимают.
{
  const factory = JSON.parse(readFileSync(join(ROOT, 'package', 'factory-defaults.json'), 'utf8')).defaults
  const bad = [], gaps = [], unmarked = []
  let checked = 0, labelled = 0, noted = 0
  for (const f of fields) {
    if (blacklist.has(f.offset)) continue
    const want = factory[String(f.offset)]
    // полнота: поле участвует в сбросе, а эталон о нём не знает
    if ((f.roles ?? []).includes('reset') && want === undefined && !f.exclude_from_menu)
      gaps.push(`${f.offset} ${f.name}`)
    if (want === undefined) continue
    // Поле вправе НЕ иметь заводского значения на экране — но только объяснив это вслух.
    // У Vdd2 напряжение выбирает kip по режиму и частоте, а слова ECO/DEFAULT/SRT в подписях
    // это имена пресетов из легенды прошивки, а не «у вас стоит вот это». Молчаливого
    // исключения здесь быть не может: `default_label_note` обязателен и читается человеком.
    if (f.default_label_note) { noted++; continue }
    checked++
    // Сравниваем по ЗНАЧЕНИЮ, а не по строке: в словарях один и тот же ноль лежит и как
    // `00`, и как `000000`, и это законно — генератор выравнивает их сам.
    const len = f.length ?? 3
    const num = h => parseInt(String(h).padEnd(len * 2, '0').slice(0, len * 2).match(/../g).reverse().join(''), 16)
    // THE VALUE THE RESET WRITES MUST BE IN THE DICTIONARY - the half of this check that
    // was missing. The earlier version `continue`d past any field carrying no "Default" mark,
    // so nine fields - `12 CPU Boost Clock`, both `RAM MHz`, `20 CPU Voltage Limit` and five
    // more - were not checked at all, while the printed 57 read as full coverage. The mark is
    // not the only form of the same claim: ask first whether the dictionary offers the value
    // the reset returns to. If it does not, nobody can return by hand to where the button
    // returns them, and that is a defect no matter what the labels say.
    const offered = (f.values ?? []).filter(v => num(v.hex) === num(want))
    if (!offered.length) {
      bad.push(`${f.offset} ${f.name}: сброс пишет ${want}, а в словаре такой записи нет — руками к заводскому не вернуться`)
      continue
    }
    const marked = (f.values ?? []).filter(v => /(^|[^a-z])default([^a-z]|$)/i.test(String(v.name)))
    if (!marked.length) { unmarked.push(`${f.offset} ${f.name} → ${offered[0].name}`); continue }
    labelled++
    if (!marked.some(v => num(v.hex) === num(want)))
      bad.push(`${f.offset} ${f.name}: «Default» стоит на ${marked.map(v => v.name).join(', ')}, а сброс пишет ${want}`)
  }
  // ZERO FIELDS IS RED: the baseline moved or its keys changed, and there is nothing to compare.
  if (!checked) {
    problems.push({ sev: 'CRITICAL', what: 'ни одно поле не сверено с эталоном сброса — проверка «Default» смотрит в пустоту' })
  } else if (bad.length || gaps.length) {
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `метка «Default» расходится с эталоном сброса:\n     ${bad.slice(0, 6).join('\n     ')}` })
    if (gaps.length) problems.push({ sev: 'CRITICAL', what: `поля участвуют в сбросе, но в эталоне их нет — сброс их не тронет:\n     ${gaps.slice(0, 8).join('\n     ')}` })
  } else {
    // FIELDS WITHOUT THE MARK ARE NAMED, NOT SKIPPED. A missing mark is not itself a defect:
    // their factory value is called `eBamatic`, which is an honest name. But skipping them in
    // silence turned 57 into "all there is", and nothing showed the difference.
    const tail = unmarked.length
      ? `; ${unmarked.length} без метки, заводское зовётся своим именем: ${unmarked.join(', ')}`
      : ''
    ok.push(`the "Default" label agrees with the reset baseline (${checked} fields, ${labelled} carry the label, ${noted} excused by default_label_note${tail}), and the baseline covers every field that resets`)
  }
}

// ---------------------------- 25. Команда, адресующая пункт по имени, обязана в него попадать
//
// Подпись пункта хранится в `config.ini` и адресуется ИМЕНЕМ секции. Значит любая команда
// вида `set-ini-val './config.ini' '<имя>' footer …` — это ссылка одного пункта на другой,
// записанная строкой. Переименовали пункт — ссылка молча повисла: подпись просто не появится,
// и заметить это можно только на консоли.
//
// Так и вышло при укорачивании названия «Install update»: имя поменялось в одном месте,
// а команда проверки обновлений продолжала писать подпись пункту, которого больше нет.
// Имя вдобавок несёт невидимые глифы удержания, так что глазами расхождение не видно вовсе.
{
  const bad = []
  // Пункты живут в `package.ini` СВОЕГО каталога, а подпись пишется в лежащий рядом
  // `config.ini`. Путь в команде указывает на конфиг, значит искать пункт надо в пакете
  // того же каталога — `[boot]` из корня адресует и корневые пункты, и подстраничные.
  const sectionsOf = pkg => existsSync(pkg)
    ? new Set([...readFileSync(pkg, 'utf8').matchAll(/^\[([^\]@][^\]]*)\]/gm)].map(m => m[1]))
    : null
  for (const file of iniFiles) {
    const body = readFileSync(file, 'utf8')
    for (const m of body.matchAll(/set-ini-val\s+'([^']*config\.ini)'\s+'([^']+)'\s+footer/g)) {
      const pkg = join(dirname(file), m[1].replace(/^\.\//, '').replace(/config\.ini$/, 'package.ini'))
      const sections = sectionsOf(pkg)
      if (!sections) { bad.push(`${relative(ROOT, file)}: подпись адресована в ${m[1]}, а пакета рядом нет`); continue }
      // `*` перед именем — форма записи для пунктов-селекторов, сама секция со звёздочкой.
      const name = m[2].replace(/^\*/, '')
      if (!sections.has(name) && !sections.has(`*${name}`))
        bad.push(`${relative(ROOT, file)}: подпись адресована пункту «${name}», а в ${relative(ROOT, pkg)} такого нет`)
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `подпись адресована несуществующему пункту:\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push('every footer command addresses an item that exists in the same file')
}

// ------------------- 26. Словарь НАЗВАНИЙ не сужается никогда, каким бы узким ни был выбор
//
// Постоянное решение оператора: список отвечает на «что предлагаем выбрать», словарь
// названий — на «что умеем прочитать», и второй сужать нельзя. Значение может стоять
// в kip от чужого пакета, от прежней нашей сборки или от правки в hekate, и тюнер обязан
// назвать его, а не печатать «недоступно»: показ — это правда о железе, а не рекомендация.
//
// Проверка №22 сторожила то же правило, но только для одного поля. Этого не хватило:
// расщепление `Max Voltage` по ревизиям сжало его словарь названий со 112 значений
// до 92, и ни одна из проверок не среагировала — потому что стерегли не правило, а поле.
// Здесь правило проверяется для ВСЕХ полей сразу.
{
  const bad = []
  let checked = 0, widened = 0, computed = 0
  for (const f of fields) {
    if (blacklist.has(f.offset) || !(f.values ?? []).length) continue
    const len = f.length ?? 3
    const want = new Set((f.values ?? []).map(v => padHexLocal(v.hex, len)).filter(Boolean))
    // Карта названий может обслуживать несколько пунктов; ищем все, где это поле пишется.
    for (const mapFile of iniFiles.flatMap(file => {
      const body = readFileSync(file, 'utf8')
      const out = []
      for (const sec of body.split(/\r?\n(?=\[)/)) {
        if (!new RegExp(`CUST ${f.offset} \{json_file_source`).test(sec)) continue
        const m = sec.match(/json_file_source\s+'([^']+)'/)
        if (m) out.push(join(dirname(file), m[1].replace(/^\.\//, '').replace(/\.json$/, '.map.json')))
      }
      return out
    })) {
      // ПРОПУСК ОБЯЗАН БЫТЬ ИМЕНОВАННЫМ, А НЕ МОЛЧАЛИВЫМ.
      //
      // У точек кривой GPU словаря показа нет вовсе с 03.09.2026: подпись считается
      // из ячейки, и назвать она умеет ЛЮБОЕ значение — то есть решение «словарь названий
      // не сужается никогда» там выполняется сильнее, чем словарём. Это законный пропуск,
      // и его стережёт проверка №34.
      //
      // А вот пропавший словарь у ЛЮБОГО другого поля — это дефект: раньше строка
      // `if (!existsSync) continue` глотала такое молча, и сторож тихо переставал смотреть.
      if (!existsSync(mapFile)) {
        if (String(f.series).startsWith('gpu_curve')) { computed++; continue }
        bad.push(`${relative(ROOT, mapFile)}: словаря нет, а подпись поля не считается — сторож ослеп бы на этом поле`)
        continue
      }
      checked++
      const map = JSON.parse(readFileSync(mapFile, 'utf8'))[0] ?? {}
      const keys = Object.keys(map)
      // Составной ключ (пара ячеек) — другая длина, полноту так не мерить: там подпись
      // адресуется не значением поля, и плоские ключи ей не встретятся. Пропускаем.
      if (keys.some(k => k.length > len * 2)) continue
      const missing = [...want].filter(h => map[h] === undefined)
      if (missing.length)
        bad.push(`${relative(ROOT, mapFile)}: словарь названий не знает ${missing.length} значений из карты полей (${missing.slice(0, 4).join(', ')})`)
      else if (keys.length > (JSON.parse(readFileSync(mapFile.replace(/\.map\.json$/, '.json'), 'utf8')) ?? []).length) widened++
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `словарь названий сужен — стоящее в kip значение будет названо «недоступно»:\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push(`no naming dictionary is narrower than its field map (${checked} checked, ${computed} computed instead of looked up, ${widened} deliberately wider than their selector)`)
}

// -------- 27. Кривая ступени не совпадает с константами поиска прошивки (гейт сборки)
//
// ПРАВИЛО, СТОИВШЕЕ ЗАГРУЗКИ КОНСОЛИ. Прошивка патчит PCV не по адресам, а СКАНЕРОМ:
// идёт по памяти словами по четыре байта и сравнивает каждое со списком искомых констант.
// У каждой константы свой предел совпадений; недобор законен, а ПЕРЕБОР — аварийный выход
// с именем записи на экране. Таблицу GPU прошивка подменяет ПОСРЕДИ этого же скана,
// копируя её вперёд, в ещё не прочитанную область. Поэтому строки с 16-й и выше сканер
// читает уже как наши данные.
//
// Значение 625000 в строке 16 дало третье совпадение записи «MEM Freq Limit» при двух
// разрешённых — и консоль перестала грузиться. Разбор — docs/NOTES.md №180.
//
// ПОЧЕМУ ПРОВЕРКА ЗДЕСЬ, А НЕ ТОЛЬКО В СКРИПТЕ КАРТЫ. Сторож там есть, но `make-gpu-stages`
// запускается руками и в сборке не участвует. Правило, роняющее консоль, обязано стоять
// в гейте — рядом с правилами про длину имени файла, а не слабее их.
//
// Список констант и границу видимости сюда привозит сама карта меню (`scan_guard`):
// они читаются из живого kip тем скриптом, а проверка сверяется с ними, не открывая kip.
{
  const guards = []
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    if (n.scan_guard && (n.values ?? []).length) guards.push(n)
    Object.values(n).forEach(walk)
  }
  walk(menu.sections ?? [])

  if (!guards.length) ok.push('no stage writes a DVFS table — the PCV scanner rule does not apply')
  else {
    const bad = []
    let rows = 0
    for (const item of guards) {
      const g = item.scan_guard
      const consts = new Set(g.consts)
      for (const v of item.values ?? []) {
        for (const [key, hex] of Object.entries(v.writes ?? {})) {
          const off = Number(key)
          // Только напряжения: у частоты верхней строки своё смещение внутри строки.
          if ((off - g.base) % g.step !== 0) continue
          const row = (off - g.base) / g.step
          if (row < g.from_row) continue          // эти строки сканер уже прошёл
          rows++
          const val = parseInt(String(hex).match(/../g).reverse().join(''), 16)
          if (consts.has(val))
            bad.push(`«${v.name}» строка ${row} = ${val} совпадает с искомой константой прошивки`)
        }
      }
    }
    // ТОЧКИ КРИВОЙ ХОДЯТ ПОД ТЕМ ЖЕ ПРАВИЛОМ, А ПРОВЕРКА ИХ НЕ ВИДЕЛА. Она обходила только
    // узлы со `scan_guard` — то есть сами ступени. Но `Custom Table` берёт за основу ST1
    // и перекрывает её напряжения из массива `marikoGpuVoltArray`, домножая на 1000
    // (`mul w1,w1,w2` в патчере): для сканера это ровно такая же строка таблицы, и точка
    // 921MHz со значением 625 мВ роняет консоль так же, как ступень со значением 625000.
    // Список выбора точки собирается отдельным скриптом, и без этой половины сторож
    // сторожил только ту сторону, которую я в тот день правил.
    if (guards[0]) {
      const g = guards[0].scan_guard
      const consts = new Set(g.consts)
      for (const f of fields.filter(x => x.series === 'gpu_curve_mariko')) {
        const row = (f.offset - 88) / 4
        if (!Number.isInteger(row) || row < g.from_row) continue
        for (const v of f.values ?? []) {
          const mv = parseInt(String(v.hex).match(/../g).reverse().join(''), 16)
          rows++
          if (consts.has(mv * 1000))
            bad.push(`точка ${f.name} (строка ${row}) предлагает ${mv} мВ — это искомая константа прошивки`)
        }
      }
    }
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `значение совпало с константой поиска прошивки — консоль не загрузится:\n     ${bad.slice(0, 6).join('\n     ')}` })
    else ok.push(`no stage voltage and no curve choice collides with a firmware search constant (${rows} values in the scanned range checked)`)
  }
}

// ------------ 28. Одноимённые блоки сводки не могут показаться одновременно
//
// СЕГОДНЯШНЯЯ ОШИБКА, ПРЕВРАЩЁННАЯ В СТОРОЖ — СО ВТОРОГО РАЗА.
//
// Блок «GPU Voltage Table» печатается по варианту на каждый режим ступени, и на экране
// должен появляться ровно один. Я взял в него ВСЕ строки группы, а группа в сводке
// смешанная — тогда 24 точки Mariko и 29 Erista (с 04.09.2026 — 31 и 29). Вышло 53 строки вместо тогдашних 24, вдобавок без метки
// ревизии, то есть на Erista показался бы мариковский блок поверх эристовского.
//
// ПЕРВАЯ РЕДАКЦИЯ ЭТОЙ ПРОВЕРКИ ТУ ПОРЧУ ПРОПУСКАЛА. Она сравнивала длины только внутри
// одной ревизии, а сломанные блоки метки не имели вовсе и сравнивались лишь друг с другом —
// все три по 53, значит «сходится». Два дефекта замаскировали друг друга.
//
// Правило сформулировано заново и от следствия, а не от признака: два одноимённых блока
// НЕ ДОЛЖНЫ МОЧЬ показаться одновременно. Могут — если их ревизии совместимы (равны или
// одна из них «обе») И условия видимости не исключают друг друга. Исключают только условия
// на ОДНО И ТО ЖЕ смещение с РАЗНЫМИ значениями: на разных смещениях оба могут оказаться
// истинными, а отсутствие условия истинно всегда.
//
// Если же блоки взаимоисключающие — это варианты одного и того же, и длина у них обязана
// совпадать. Разная длина здесь означает, что в один из вариантов попало лишнее.
{
  const bad = []
  for (const file of iniFiles) {
    const secs = readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)
    const blocks = []
    for (let i = 0; i < secs.length; i++) {
      if (!/^\[Header\]/.test(secs[i]) || !/^;mode=table/m.test(secs[i])) continue
      const title = secs[i].match(/^'([^']*)'\s*=/m)?.[1]
      if (!title) continue
      const info = secs.slice(i + 1).find(x => /^\[Info\]/.test(x))
      const cond = secs[i].match(/CUST (\d+) ([0-9A-F]+)/)
      blocks.push({
        title,
        rev: secs[i].match(/^;system=(\w+)/m)?.[1] ?? 'both',
        // Условие раскладываем на смещение и значение: только так видно, исключают ли
        // два условия друг друга, или просто отличаются текстом.
        off: cond ? cond[1] : null,
        val: cond ? cond[2] : null,
        rows: info ? (info.match(/^'/gm) ?? []).length : 0,
        // Не только счёт, но и сами подписи: длина ловит не всякую порчу, а вот
        // ЧУЖИЕ подписи среди своих — ловит всегда.
        labels: info ? [...info.matchAll(/^'([^']*)'\s*=/gm)].map(m => m[1]) : [],
      })
    }
    // Короткий вариант обязан быть НАЧАЛОМ длинного: усечение законно, подмена — нет.
    const prefixOf = (x, y) => {
      const [sh, lo] = x.length <= y.length ? [x, y] : [y, x]
      return sh.every((v, k) => lo[k] === v)
    }
    const byTitle = new Map()
    for (const b of blocks) { if (!byTitle.has(b.title)) byTitle.set(b.title, []); byTitle.get(b.title).push(b) }

    for (const [title, list] of byTitle) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const sameConsole = a.rev === b.rev || a.rev === 'both' || b.rev === 'both'
        if (!sameConsole) continue                       // разные ревизии — вместе не встретятся
        const exclusive = a.off && b.off && a.off === b.off && a.val !== b.val
        if (!exclusive) {
          bad.push(`${relative(ROOT, file)}: «${title}» — два блока могут показаться разом `
                 + `(${a.rev}/${a.off ? `${a.off}=${a.val}` : 'без условия'} и ${b.rev}/${b.off ? `${b.off}=${b.val}` : 'без условия'})`)
        } else if (!prefixOf(a.labels, b.labels)) {
          /**
           * ПРАВИЛО — НЕ «ОДИНАКОВАЯ ДЛИНА», А «КОРОТКИЙ ЕСТЬ НАЧАЛО ДЛИННОГО».
           *
           * Равенство длин было слишком грубым и запрещало законное: `Custom Table`
           * читает редактируемый массив, а у того слотов физически 24 против 31 строки
           * настоящих таблиц. Это не порча, это устройство железа.
           *
           * А порча, ради которой сторож заводился, — чужие подписи среди своих: блок
           * набрал строки обеих ревизий и стал вдвое длиннее. Такой набор началом
           * другого не является ни при какой длине, и правило его ловит.
           */
          const [sh, lo] = a.labels.length <= b.labels.length ? [a.labels, b.labels] : [b.labels, a.labels]
          const at = sh.findIndex((x, k) => lo[k] !== x)
          bad.push(`${relative(ROOT, file)}: «${title}» — взаимоисключающие варианты разошлись `
                 + `(${a.rows} и ${b.rows} строк; на месте ${at + 1} «${sh[at]}» против «${lo[at] ?? '—'}»)`)
        }
      }
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `одноимённые блоки сводки разойдутся на экране:\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push('same-named summary blocks cannot appear together and equal-length variants agree')
}

// ------------------------------- 29. подстановка по словарю реально что-то находит
//
// САМАЯ ДЕШЁВАЯ ПОЛОМКА ИЗ ВСЕХ: строка на экране печатает «null», проверки молчат.
//
// `{json_file(0,КЛЮЧ)}` — это поиск в словаре. Промахнулся ключом — движок не ругается,
// он просто печатает «null» там, где человек ждёт название. Так и жили обе страницы
// «что будет применено»: подпись ступени GPU адресуется ПАРОЙ ячеек, а предпросмотр
// подставлял одну, и ключ из 6 знаков искался в словаре с ключами по 14. Промах был
// гарантирован при любом значении поля — и ни одна из 60 проверок этого не видела.
//
// Сторож смотрит две вещи, обе — про промах мимо словаря, а не про его содержимое:
//   1. объявленный файл словаря существует по тому пути, как его прочитает движок,
//      то есть ОТНОСИТЕЛЬНО САМОГО ФАЙЛА (на этом я и споткнулся: путь посчитался
//      от корня пакета, и сброс открывал несуществующий файл);
//   2. длина ключа совпадает с длиной ключей в словаре — сумма ширин подставляемых
//      полей против того, что реально лежит в json.
//
// Ширину поля берём из карты (`length` в байтах), для второй ячейки — из `label_probe`.
// Если ширина неизвестна хоть одному куску ключа, строка пропускается: врать «всё
// хорошо» нельзя, но и падать на том, чего не умеем измерить, тоже.
{
  const hexLen = new Map()
  for (const f of fields) if (f.length) hexLen.set(f.offset, f.length * 2)
  for (const it of items) {
    const pr = it.label_probe
    if (pr && pr.offset != null && pr.len) hexLen.set(pr.offset, pr.len * 2)
  }

  const dictKeyLens = new Map()          // путь на диске -> набор длин ключей
  const keyLensOf = abs => {
    if (dictKeyLens.has(abs)) return dictKeyLens.get(abs)
    let set = null
    try {
      const j = JSON.parse(readFileSync(abs, 'utf8'))
      const obj = Array.isArray(j) ? j[0] : j
      if (obj && typeof obj === 'object') set = new Set(Object.keys(obj).map(k => k.length))
    } catch { set = null }
    dictKeyLens.set(abs, set)
    return set
  }

  const bad = []
  for (const file of iniFiles) {
    const here = dirname(file)
    let dict = null
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const decl = raw.match(/^\s*json_file\s+'([^']+)'/)
      if (decl) {
        // Путь может собираться на ходу (`{file_source}` — выбранный пользователем файл).
        // Такой заранее не проверить: он существует только в момент показа страницы.
        if (decl[1].includes('{')) { dict = null; continue }
        dict = resolve(here, decl[1])
        if (!existsSync(dict)) {
          bad.push(`${relative(ROOT, file)}: словарь '${decl[1]}' не существует по этому пути`)
          dict = null
        }
        continue
      }
      const use = raw.match(/=\s*'\{json_file\(0,(.+?)\)\}'\s*$/)
      if (!use) continue
      if (!dict) continue
      const lens = keyLensOf(dict)
      if (!lens || !lens.size) continue
      // Ключ собран из подстановок; если между ними есть что-то ещё, мерить не берёмся.
      const parts = [...use[1].matchAll(/\{(?:ini|hex)_file\([^,]+,\s*(\d+)\s*\)\}/g)]
      const plain = use[1].replace(/\{(?:ini|hex)_file\([^,]+,\s*\d+\s*\)\}/g, '')
      if (!parts.length || plain.trim()) continue
      let sum = 0, known = true
      for (const m of parts) {
        const w = hexLen.get(Number(m[1]))
        if (!w) { known = false; break }
        sum += w
      }
      if (!known) continue
      if (!lens.has(sum)) {
        bad.push(`${relative(ROOT, file)}: ключ на ${sum} знаков ищется в словаре с ключами по `
               + `${[...lens].join('/')} (${relative(ROOT, dict)}) — на экране встанет «Not available»`)
      }
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `подстановка по словарю промахнётся:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push('every dictionary lookup resolves: the file exists and the key width matches')
}

// ---------------------------- 30. источник пишет всё, что страница читает ключом
//
// БЕДА, КОТОРУЮ ЭТО ЛОВИТ: копия создана одним способом, а страница «что будет
// применено» адресует поле, которого этот способ не пишет. Промах, «null» на экране,
// и — хуже — применение молча пропускает пропущенное. Так импорт профиля KipTool
// ставил режим андервольта GPU, не трогая кривую: получался режим ST2 поверх кривой
// ST2.5, состояние, которого нет ни в одном меню.
//
// Проверка НЕ держит списка источников: она находит их сама. Страница называет каталог
// в своём `file_source`, а производитель — тот, кто кладёт в этот каталог `Path`.
//
// ДВА РАЗНЫХ ПРИГОВОРА, И РАЗНИЦА СУЩЕСТВЕННА:
//   - производитель МОГ записать (смещение есть в его исходной схеме), но не записал —
//     это наша ошибка, CRITICAL;
//   - производителю НЕЧЕГО записать (чужая схема такого поля не содержит вовсе) —
//     это свойство донора, IMPORTANT. Выдумывать значение нельзя, а молчать нечестно.
//
// Списка исключений нет намеренно: список пришлось бы поддерживать руками, и он
// разошёлся бы с картой молча — ровно та беда, от которой мы уже страдали.
//
// PRODUCERS ARE LOOKED FOR IN THE WHOLE PACKAGE, NOT IN ONE FILE. The earlier version read
// only `service/package.ini`, where the import of a foreign backup lives - so OUR OWN backup
// (`Create backup?<revision>`), which sits in `restore-*.ini`, was never checked at all,
// while the success line promised "every source that fills its folder". One source guarded,
// both reported.
{
  const bad = [], soft = []
  let impMap = {}
  try { impMap = JSON.parse(readFileSync(join(ROOT, 'package', 'backup-import.json'), 'utf8')).import_map ?? {} } catch {}

  // A producer is any section of ANY package file that sets `<Key> Path` and then writes
  // fields to that path.
  const producers = []
  for (const pf of iniFiles) {
    for (const sec of readFileSync(pf, 'utf8').split(/^(?=\[)/m)) {
      const title = sec.match(/^\[([^\]]+)\]/)?.[1]
      if (!title) continue
      const pm = sec.match(/set-ini-val '\.\/config\.ini' (\w+) Path '([^']+)'/)
      if (!pm) continue
      // Регулярка ЛИТЕРАЛЬНАЯ, а не собранная строкой: в шаблонной строке обратные
      // слэши съедаются, регулярка выходит без экранирования и молча не находит
      // ничего — сторож при этом светится зелёным. Проверено: так и было.
      const offs = new Set([...sec.matchAll(/\{ini_file\((\w+),Path\)\}' Fields (\d+)/g)]
        .filter(x => x[1] === pm[1]).map(x => Number(x[2])))
      if (!offs.size) continue                       // the section READS the path, does not fill it
      producers.push({ title, path: pm[2], offs })
    }
  }

  let pages = 0, pairs = 0
  for (const file of iniFiles) {
    // basename, а не разбор строки: разделитель пути платформенный, и класс
    // символов с обратным слэшем здесь уже один раз съелся при правке.
    const base = basename(file)
    const mrev = base.match(/^restore-(\w+)\.ini$/)
    if (!mrev) continue
    const rev = mrev[1]
    const text = readFileSync(file, 'utf8')
    const dir = text.match(/^\s*file_source\s+(\S+)\/\*\.ini/m)?.[1]
    if (!dir) continue

    // Ключевые смещения: всё, что страница читает из копии, — и через словарь,
    // и вычислением.
    //
    // ВТОРАЯ ПОЛОВИНА ДОБАВЛЕНА 03.09.2026 И БЕЗ НЕЁ СТОРОЖ ОСЛЕП БЫ на полусотне
    // строк: точки кривой перестали ходить через `json_file`, и прежняя регулярка
    // их просто не находила. Проверка при этом осталась бы ЗЕЛЁНОЙ — худший исход
    // из возможных, потому что заметить его нечем.
    const keys = new Set()
    for (const m of text.matchAll(/=\s*'\{json_file\(0,(.+?)\)\}'/g))
      for (const k of m[1].matchAll(/ini_file\(Fields,(\d+)\)/g)) keys.add(Number(k[1]))
    for (const m of text.matchAll(/=\s*'\{(?:if_==|math|hex_to_decimal)\(.+?\)\}'/g))
      for (const k of m[0].matchAll(/ini_file\(Fields,(\d+)\)/g)) keys.add(Number(k[1]))
    if (!keys.size) continue
    pages++

    // The producers of THIS folder.
    const mine = producers.filter(p => p.path.startsWith(dir + '/'))
    if (!mine.length) {
      bad.push(`${relative(ROOT, file)}: каталог ${dir} никем не наполняется — страница читает из пустоты`)
      continue
    }
    for (const { title, offs } of mine) {
      pairs++
      const missing = [...keys].filter(o => !offs.has(o)).sort((a, b) => a - b)
      if (!missing.length) continue
      // Что производитель В ПРИНЦИПЕ мог бы записать: для импорта — своя схема донора.
      const isImport = /Import/i.test(title)
      const available = new Set(isImport
        ? (impMap[rev] ?? []).flatMap(r => [...(r.offsets ?? []), ...(r.table_offsets ?? [])])
        : missing)                                   // копия читает живой kip: доступно всё
      const couldHave = missing.filter(o => available.has(o))
      const nothingToTake = missing.filter(o => !available.has(o))
      if (couldHave.length) {
        bad.push(`${relative(ROOT, file)}: «${title}» не пишет ${couldHave.join(', ')} — `
               + `а в его схеме они есть; на экране встанет «Not available»`)
      }
      if (nothingToTake.length) {
        soft.push(`${relative(ROOT, file)}: «${title}» не несёт ${nothingToTake.join(', ')} — `
                + `в схеме донора таких полей нет вовсе, значение брать неоткуда`)
      }
    }
  }
  // ZERO SUBJECTS IS RED, NOT GREEN - the gate checks 33 and 34 already carry. No preview
  // page or no producer means the file names or the command shape moved, and from that day
  // the check guards emptiness while still reporting for everyone.
  if (!pages || !pairs) {
    problems.push({ sev: 'CRITICAL', what: `проверка источников не нашла предмет надзора (страниц предпросмотра ${pages}, пар «страница — производитель» ${pairs}) — она смотрит в пустоту` })
  } else {
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `страница читает то, чего источник не пишет:\n     ${bad.slice(0, 6).join('\n     ')}` })
    if (soft.length) problems.push({ sev: 'IMPORTANT', what: `источник не может дать часть строк предпросмотра:\n     ${soft.slice(0, 6).join('\n     ')}` })
    if (!bad.length) ok.push(`every offset a preview page keys on is written by every source that fills its folder (${pages} pages, ${pairs} sources)`)
  }
}

// ------------------- 31. ступени с общим режимом различимы по опорной ячейке
//
// НА ЧЁМ ЭТО ДЕРЖИТСЯ. Три ступени GPU пишут в поле 44 одно и то же значение 01
// и отличаются только содержимым таблицы. Поэтому подпись читает ПАРУ ячеек — режим
// плюс первую ячейку кривой, — и всё опознание держится на том, что первые ячейки
// у них разные: 475000 у ST1.5, 465000 у ST2, 455000 у ST2.5.
//
// Инвариант нигде не закреплён. Достаточно сдвинуть нижний конец одной кривой на клетку
// сетки — и две ступени станут неотличимы при чтении: тюнер назовёт чужую, предпросмотр
// покажет чужую, а сводка молча соврёт. Разведение со списком поиска патчера сдвигает
// значения САМО, то есть случай не гипотетический.
{
  const bad = []
  const walkV = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach(x => walkV(x, acc)); return acc }
    if (!n || typeof n !== 'object') return acc
    if (n.label_probe && (n.values ?? []).length) acc.push(n)
    Object.values(n).forEach(x => walkV(x, acc))
    return acc
  }
  let checked = 0
  for (const item of walkV(menu.sections ?? [])) {
    const off = String(item.label_probe.offset)
    const byMode = new Map()
    for (const v of item.values ?? []) {
      const pr = v.writes?.[off]
      if (!pr) continue
      if (!byMode.has(v.hex)) byMode.set(v.hex, new Map())
      const seen = byMode.get(v.hex)
      if (seen.has(pr)) {
        bad.push(`${item.id ?? item.name}: «${v.name}» и «${seen.get(pr)}» пишут режим ${v.hex} `
               + `и одинаковую опорную ячейку ${off}=${pr} — при чтении они неразличимы`)
      } else seen.set(pr, v.name)
      checked++
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `ступени неразличимы при чтении:\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push(`stages sharing a mode differ in their probe cell (${checked} values checked)`)
}

// ---------------- 32. путь обновления переживает смену версии раскладки kip
//
// ЧТО СТЕРЕЖЁМ И ПОЧЕМУ ЭТО ВАЖНЕЕ, ЧЕМ ВЫГЛЯДИТ.
//
// Пункты тюнера закрыты затвором по версии раскладки: чужой kip — и они исчезают,
// чтобы не писать по неверным адресам. Правильно. Но обновление самого пакета живёт
// ВНУТРИ пакета, и если затвор накроет и его, человек окажется заперт: старый пакет
// не работает, а обновиться нечем. Правило записано в `docs/ONLINE-WIZARD-UPDATE.md`
// §11.1 — «обновление обязано быть доступно ровно тогда, когда тюнер отключён».
//
// Ставки выросли 01.09.2026: из движка убран его собственный экран обновления, и
// пакетный апдейтер стал ЕДИНСТВЕННЫМ способом обновиться с консоли.
//
// НА ЧЁМ ЭТО ДЕРЖАЛОСЬ ДО ЭТОЙ ПРОВЕРКИ. Затвор навешивается на секции, начинающиеся
// со звёздочки, а пункты-действия печатаются без неё. Но звёздочка в движке означает
// «пункт открывает подменю» и про kip не знает ничего. Сегодня два множества совпадают;
// ни одна строка кода не обязывает их совпадать завтра. Достаточно дать пункту
// обновления свою страницу — и он закроется вместе со всеми, молча.
//
// Проверяем четыре вещи, и третья — не про затвор, а про человека: экран должен
// называть выход, иначе прочитавший «тюнер отключён» пойдёт искать компьютер.
{
  const rootIni = join(DIST, 'package.ini')
  // ONE ASSERTION FOR THE WHOLE CHECK. Three greens for one guard - two escape hatches
  // plus the warning screen - inflated the tally at the bottom, so a lost guard read as
  // a lost line rather than a lost check. The parts are counted in the message instead.
  let bad32 = 0, writers32 = 0
  const fail32 = what => { bad32++; problems.push({ sev: 'CRITICAL', what }) }
  if (!existsSync(rootIni)) {
    fail32('нет package.ini — проверить путь обновления не на чем')
  } else {
    const text = readFileSync(rootIni, 'utf8')
    // Режем на секции: заголовок плюс всё до следующего заголовка.
    const chunks = text.split(/^(?=\[)/m).filter(c => c.trim())
    const sectionOf = re => chunks.find(c => re.test(c.split(/\r?\n/)[0] ?? ''))
    const gated = c => /visibility_condition=[^\n]*CUST 4 /.test(c)

    // (а) пункты, ведущие наружу, обязаны быть БЕЗ затвора.
    const escapes = [
      [/^\[Check for updates\]/, 'Check for updates'],
      [/^\[Update\b/,             'Update'],
    ]
    for (const [re, name] of escapes) {
      const sec = sectionOf(re)
      if (!sec) fail32(`в корне нет пункта "${name}" — единственный путь обновиться с консоли исчез`)
      else if (gated(sec)) fail32(`"${name}" закрыт затвором версии kip — при чужом kip человек останется заперт без возможности обновиться`)
    }

    // (б) пункты, пишущие в kip, обязаны быть С затвором. Не по звёздочке в имени,
    //     а по тому, что секция реально трогает kip: так проверка переживёт смену
    //     соглашения об именовании, на которой всё и держалось.
    for (const c of chunks) {
      const head = (c.split(/\r?\n/)[0] ?? '').trim()
      if (!/hex-by-custom|loader\.kip/.test(c)) continue
      if (/^\[@/.test(head)) continue                 // объявление страницы
      if (/^\[Kip version mismatch\]/.test(head)) continue
      writers32++
      if (!gated(c)) fail32(`секция ${head} в корне трогает kip, но не закрыта затвором версии — на чужой раскладке она писала бы по неверным адресам`)
    }
    // ZERO KIP WRITERS IS RED. Finding none, half (b) would be guarding emptiness.
    if (!writers32) fail32('в корне нет ни одной секции, пишущей в kip — затвор версии стеречь не на чем')

    // (в) экран-предупреждение существует, несёт РОВНО обратное условие и называет выход.
    const warnSec = sectionOf(/^\[Kip version mismatch\]/)
    if (!warnSec) {
      fail32('нет экрана "Kip version mismatch" — при чужом kip человек увидит пустой корень без объяснения')
    } else {
      const cond = (warnSec.match(/visibility_condition=([^\r\n]+)/) ?? [])[1] ?? ''
      if (!cond.startsWith('!')) fail32('экран "Kip version mismatch" показывается не по ОБРАТНОМУ условию — он либо не покажется никогда, либо будет висеть поверх работающего тюнера')
      // Текст обязан назвать оба пункта: диагноз без выхода отправляет человека к компьютеру.
      for (const must of ['Check for updates', 'Update']) {
        if (!warnSec.includes(must)) fail32(`экран "Kip version mismatch" не называет пункт "${must}" — человек не поймёт, что средство стоит на том же экране`)
      }
      // Третье обязательное — ПУТЬ НАРУЖУ. Обновления может ещё не быть: тогда экран
      // остаётся единственным, что человек видит, и он обязан сказать, куда идти.
      // Ссылка на группу 4IFIR добавлена 04.09.2026; без сторожа её однажды сотрут
      // при правке текста, и никто не заметит — ровно так уже уходили другие строки.
      if (!warnSec.includes('t.me/kf4fr')) fail32(`экран "Kip version mismatch" не называет путь наружу — ссылку на группу 4IFIR`)
    }
  }
  if (!bad32) ok.push(`the update path survives a kip layout change (2 escape hatches ungated, ${writers32} kip writers gated, mismatch screen names the way out)`)
}

// ---------------- 33. подпись показывает ВЫБРАННОЕ, без дописок
//
// ЧТО СТЕРЕЖЁМ. Решение оператора 02.09.2026: там, где показано уже выбранное значение —
// сводка, предпросмотр копии, футер пункта — подпись не несёт пояснений. `650 mV — DEFAULT`
// стало `650 mV`, `Auto — Eco ST3` стало `Eco ST3`. В СПИСКЕ ВЫБОРА пояснения остаются:
// там они помогают выбирать.
//
// ПОЧЕМУ ЭТО НУЖНО СТЕРЕЧЬ. Короткая форма считается из полного имени функцией
// `shortLabel` в генераторе. Имена приходят из `fields.json` и `menu.json`, то есть
// из данных, которые правятся чаще кода. Появится завтра подпись с новым разделителем
// или новым словом-заполнителем — правило тихо перестанет срабатывать на ней одной,
// и на экране среди коротких подписей окажется одна длинная. Заметить это можно только
// на консоли.
//
// ВТОРАЯ ПОЛОВИНА — ПРО МИГАНИЕ. Подпись под пунктом приходит из ДВУХ файлов: при открытии
// пакета из словаря, а сразу после выбора значения — из списка, по ключу `short`. Нет ключа
// у записи — движок печатает `null`, а пункт после касания показывает пустоту вместо
// значения. При первой правке этого места ключ получили шесть записей из двух тысяч,
// и поймано это было пересчётом, а не проверкой. Теперь есть проверка.
{
  const all = []
  const walkDir = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walkDir(p)
      else if (e.name.endsWith('.json')) all.push(p)
    }
  }
  walkDir(DIST)

  const longLabels = []
  const noShort = []
  let maps = 0, lists = 0, entries = 0

  for (const p of all) {
    let doc
    try { doc = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
    const rel = relative(DIST, p)
    if (p.endsWith('.map.json') || p.endsWith('.flat.json')) {
      const obj = Array.isArray(doc) ? doc[0] : null
      if (!obj || typeof obj !== 'object') continue
      maps++
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.includes(' — ')) longLabels.push(`${rel}: ${k} = «${v}»`)
      }
      continue
    }
    // список выбора: массив записей с `name` и `hex`
    if (!Array.isArray(doc) || !doc.length || typeof doc[0] !== 'object') continue
    if (doc[0].name === undefined || doc[0].hex === undefined) continue
    lists++
    for (const e of doc) {
      if (e.name === undefined) continue
      entries++
      if (typeof e.short !== 'string' || !e.short.length) noShort.push(`${rel}: «${e.name}»`)
    }
  }

  // НОЛЬ НАЙДЕННЫХ ОБЪЕКТОВ НАДЗОРА — КРАСНЫЙ, А НЕ ЗЕЛЁНЫЙ. Не найдя ни словаря,
  // ни списка, проверка обязана кричать: значит переехали каталоги или расширения,
  // и она с этого дня стережёт пустоту.
  if (!maps || !lists) {
    problems.push({ sev: 'CRITICAL', what: `проверка подписей не нашла предмет надзора (словарей ${maps}, списков ${lists}) — она смотрит в пустоту` })
  } else if (longLabels.length) {
    problems.push({ sev: 'CRITICAL', what: `подпись показывает не только выбранное (${longLabels.length}):\n     ${longLabels.slice(0, 6).join('\n     ')}` })
  } else if (noShort.length) {
    problems.push({ sev: 'CRITICAL', what: `у записей списка нет ключа "short" — футер после выбора покажет null (${noShort.length}):\n     ${noShort.slice(0, 6).join('\n     ')}` })
  } else {
    ok.push(`labels show only what is selected (${maps} dictionaries, ${entries} list entries carry "short")`)
  }
}

// ---------------- 34. подпись точки кривой СЧИТАЕТСЯ, а не ищется в словаре
//
// ЧТО СТЕРЕЖЁМ. У точек кривой GPU словаря показа нет с 03.09.2026: подпись собирается
// арифметикой прямо из ячейки. Это заменило прежнюю гарантию «словарь названий не
// сужается» — и заменило её сильнее: вычисление назовёт ЛЮБОЕ значение, а словарь
// умел назвать лишь заранее перечисленное.
//
// ЦЕНА ПРЕЖНЕГО УСТРОЙСТВА, ради которой всё и переделано. Словарь каждой точки был
// полосой ±75 мВ вокруг ЗАВОДСКОГО содержимого ячейки, а настоящая кривая уходит
// от заводской на сотни милливольт. У живого пользователя пятнадцать строк из двадцати
// четырёх показали «Not available» при совершенно исправных данных в kip.
//
// ПОЧЕМУ БЕЗ ЭТОГО СТОРОЖА НЕЛЬЗЯ. Проверки №26, №29 и №30 ищут строки по образцу
// `json_file(0,…)`. Вычисленная строка под него не подпадает — и все три молча
// перестали бы смотреть на полсотни полей, оставаясь зелёными. Ослепший сторож хуже
// отсутствующего: он создаёт уверенность, ничем не обеспеченную.
//
// Проверяем четыре вещи:
//   1. у каждой точки кривой подпись вычислена во ВСЕХ трёх местах (сводка,
//      предпросмотр копии, футер пункта) — иначе экраны разойдутся между собой;
//   2. ни одна точка кривой нигде не ходит через словарь;
//   3. из kip читается ровно три байта — этого хватает и милливольтам Mariko,
//      и микровольтам Erista, а больше брать нельзя: у Erista следом лежит хвост записи;
//   4. Erista делит на тысячу, Mariko не делит — перепутать единицы значит показать
//      675000 mV вместо 675.
{
  const curveFields = fields.filter(f => String(f.series ?? '').startsWith('gpu_curve'))
  const iniText = new Map()
  for (const f of iniFiles) iniText.set(f, readFileSync(f, 'utf8'))

  const bad = []
  let computed = 0, viaDict = 0
  const seenOffsets = new Set()
  const byRole = {}

  for (const [file, text] of iniText) {
    const rel = relative(ROOT, file)
    // Строки показа и футеры, читающие смещение кривой.
    //
    // РАЗБОР ПОСТРОЧНЫЙ, А НЕ ПО КОНЦУ СТРОКИ. Первая редакция требовала, чтобы строка
    // КОНЧАЛАСЬ подстановкой — и потому не видела ни одной строки сводки и ни одного
    // футера: они кончаются словом `mV` после закрывающей скобки. Из трёх отрицательных
    // прогонов покраснел один; два дефекта сторож пропустил. Ровно тот случай, ради
    // которого отрицательный прогон и делается.
    for (const body of text.split(/\r?\n/)) {
      if (!body.includes('hex_to_decimal(')) continue
      const offs = [...body.matchAll(/(?:hex_file\(CUST,(\d+),(\d+)\)|ini_file\(Fields,(\d+)\))/g)]
      for (const o of offs) {
        const off = Number(o[1] ?? o[3])
        const fld = curveFields.find(f => f.offset === off)
        if (!fld) continue
        computed++
        seenOffsets.add(off)
        // Роль файла: сводка, футер пункта, предпросмотр копии. Нужны ВСЕ ТРИ —
        // пропади один, экраны разойдутся между собой, а `computed` останется ненулевым.
        const role = /current\.ini$/.test(rel) ? 'сводка'
          : /restore-\w+\.ini$/.test(rel) ? 'копия'
          : body.includes('footer') ? 'футер' : 'прочее'
        ;(byRole[role] ??= new Set()).add(off)
        if (o[1] !== undefined && o[2] !== '3')
          bad.push(`${rel}: точка кривой ${off} читается ${o[2]} байт вместо трёх`)
        // ИСТОЧНИК ОБЯЗАН СООТВЕТСТВОВАТЬ СТРАНИЦЕ. Читать живой kip на странице копии —
        // значит показать текущее состояние вместо содержимого копии, то есть соврать
        // ровно там, где человек решается нажать удержание.
        if (role === 'копия' && o[1] !== undefined)
          bad.push(`${rel}: точка кривой ${off} на странице копии читает живой kip вместо файла копии`)
        if ((role === 'сводка' || role === 'футер') && o[3] !== undefined)
          bad.push(`${rel}: точка кривой ${off} читает файл копии там, где должен читаться kip`)
        // Единица обязана быть на экране: «485» без неё не значит ничего.
        if (!body.includes(' mV'))
          bad.push(`${rel}: у точки кривой ${off} пропала единица измерения`)
        // Три байта из 24-байтовой ячейки берутся срезом. Без него в число уйдёт
        // весь хвост записи DVFS — самая правдоподобная поломка этой ветки.
        if (o[3] !== undefined && fld.length > 3 && !body.includes('slice('))
          bad.push(`${rel}: точка кривой ${off} читает из копии ${fld.length} байт без среза`)
        // Прочерк на странице копии: отсутствие поля там законно, и показать вместо
        // него «0 mV» значит выдать пустоту за настройку.
        if (role === 'копия' && !body.includes('if_=='))
          bad.push(`${rel}: у точки кривой ${off} на странице копии нет обёртки с прочерком`)
        // Значение футера содержит пробел перед «mV», а `set-ini-val` берёт ровно один
        // разобранный токен — без кавычек единица потерялась бы по дороге.
        if (role === 'футер' && !/footer '/.test(body))
          bad.push(`${rel}: футер точки кривой ${off} записан без кавычек — единица потеряется`)
        const needsDiv = fld.platform === 'erista'
        const hasDiv = body.includes('/1000')
        if (needsDiv !== hasDiv)
          bad.push(`${rel}: точка кривой ${off} (${fld.platform}) ${hasDiv ? 'делится на 1000, хотя хранит милливольты' : 'не делится на 1000, хотя хранит микровольты'}`)
      }
    }
    // Ни одна точка кривой не должна ходить через словарь.
    //
    // РЕГУЛЯРКА БЕРЁТ ВСЮ СТРОКУ (`m[0]`), А НЕ ЗАХВАТ. Первая редакция брала `m[1]`
    // с ленивым `(.+?)` перед `\)\}` — и он съедал закрывающую скобку. Из-за этого
    // альтернатива `hex_file\(CUST,(\d+),` (кончается запятой) выживала, а
    // `ini_file\(Fields,(\d+)\)` (требует скобку) — нет. Итог: откат на словарь
    // ловился на стороне kip и НЕ ловился на страницах копии, то есть ровно там,
    // ради чего правка делалась. Найдено ревью 03.09.2026; отрицательный прогон это
    // пропустил, потому что пробу ставили на кип-стороне.
    for (const m of text.matchAll(/\{json_file\(0,.+?\)\}'/g)) {
      for (const k of m[0].matchAll(/(?:hex_file\(CUST,(\d+),|ini_file\(Fields,(\d+)\))/g)) {
        const off = Number(k[1] ?? k[2])
        if (curveFields.some(f => f.offset === off)) {
          viaDict++
          bad.push(`${rel}: точка кривой ${off} всё ещё ищется в словаре`)
        }
      }
    }
  }

  // НОЛЬ НАЙДЕННЫХ ОБЪЕКТОВ НАДЗОРА — КРАСНЫЙ. Не найдя ни одной вычисленной строки,
  // проверка обязана кричать: значит показ вернули на словарь или переименовали серию,
  // и она с этого дня стережёт пустоту.
  if (!curveFields.length) {
    problems.push({ sev: 'CRITICAL', what: 'проверка подписи кривой не нашла ни одного поля серии gpu_curve — она смотрит в пустоту' })
  } else if (!computed) {
    problems.push({ sev: 'CRITICAL', what: `подпись кривой нигде не вычисляется (${curveFields.length} полей в карте, 0 вычисленных строк) — либо показ вернули на словарь, либо сторож ослеп` })
  } else if (bad.length) {
    problems.push({ sev: 'CRITICAL', what: `подпись точки кривой собрана неверно (${bad.length}):\n     ${bad.slice(0, 6).join('\n     ')}` })
  } else if (seenOffsets.size !== curveFields.length) {
    // НЕПОЛНОЕ ПОКРЫТИЕ — ТОЖЕ ДЕФЕКТ. Без этой сверки зелёным оставалась бы даже
    // одна вычисленная точка из пятидесяти трёх: `computed` считает вхождения,
    // а не полноту.
    const lost = curveFields.filter(f => !seenOffsets.has(f.offset)).map(f => f.offset)
    problems.push({ sev: 'CRITICAL', what: `подпись вычисляется не у всех точек кривой: ${seenOffsets.size} из ${curveFields.length}, потеряны ${lost.slice(0, 8).join(', ')}` })
  } else if (['сводка', 'копия', 'футер'].some(r => (byRole[r]?.size ?? 0) !== curveFields.length)) {
    // ВСЕ ТРИ ПОТРЕБИТЕЛЯ ИЛИ НИ ОДНОГО. Пропади сводка — останутся футеры и копия,
    // общий счёт не ноль, и прежняя редакция сторожа этого не заметила бы.
    const got = ['сводка', 'копия', 'футер'].map(r => `${r}: ${byRole[r]?.size ?? 0}`).join(', ')
    problems.push({ sev: 'CRITICAL', what: `подпись кривой вычисляется не во всех трёх местах (нужно по ${curveFields.length}; ${got})` })
  } else {
    ok.push(`curve points are computed, not looked up (${seenOffsets.size} offsets × 3 places, ${computed} occurrences, ${viaDict} via dictionary)`)
  }
}

// ---------------------------------------------------------------- output

// ---------------- 35. every screen names itself
//
// The engine takes a screen subtitle from the last header in the PARENT list. With no
// header there it prints the internal word "Commands" or the package version - eleven of
// our screens showed the former, a hundred and thirty-seven the latter. `;title=` is
// overwritten on nested levels and `[@Name]` only labels the paging button, so neither
// helps. The fix is the `;subtitle=` key in our fork; this checks the generator never
// forgets it. Details: NOTES 231.
{
  const bad = []
  const seen = new Set()
  const queue = ['package.ini']
  let screens = 0

  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const abs = join(DIST, rel)
    if (!existsSync(abs)) { bad.push(`${rel}: файл не найден, а на него ведёт package_source`); continue }
    const text = readFileSync(abs, 'utf8')

    // ссылки на дочерние экраны — пути относительно каталога этого файла
    for (const m of text.matchAll(/package_source\s+'([^']+)'/g)) {
      const p = m[1].replace(/^\.\//, '')
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
      queue.push((dir + p).split('/').reduce((acc, part) => {
        if (part === '..') acc.pop(); else if (part !== '.') acc.push(part)
        return acc
      }, []).join('/'))
    }

    if (rel === 'package.ini') continue   // корень подписывается версией, это норма
    screens++
    const head = text.slice(0, 400)
    const m = head.match(/^;subtitle='([^']*)'/m)
    if (!m) bad.push(`${rel}: экран без имени — движок подпишет его словом Commands или версией`)
    else if (!m[1].trim()) bad.push(`${rel}: имя экрана пустое`)
    else if (/^commands$/i.test(m[1].trim())) bad.push(`${rel}: имя экрана — внутреннее слово движка`)
  }

  if (!screens) problems.push({ sev: 'IMPORTANT', what: 'ни одного дочернего экрана не найдено — обход package_source сломан' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `экраны без имени:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`every screen names itself (${screens} screens reachable from the root)`)
}

// ---------------- 36. the seven top curve offsets stay where they belong
//
// CUST+184..208 are two things at once: the top seven points of the Mariko GPU voltage
// curve, and row 0 of the Erista CPU table. Writing them is allowed only where the file
// is Mariko-only, plus the factory reset - which must run on BOTH revisions, because it
// is the only way to repair a corrupted row 0. Details: NOTES 232.
{
  const bad = []
  const TOP = [184, 188, 192, 196, 200, 204, 208]
  let writes = 0

  for (const file of iniFiles) {
    const rel = relative(DIST, file).split('\\').join('/')
    const body = readFileSync(file, 'utf8')
    // режем на секции: заголовок + его строки до следующего заголовка
    const chunks = body.split(/^(?=\[)/m)
    for (const c of chunks) {
      const head = (c.match(/^\[[^\]]*\]/) ?? [''])[0]
      const mariko = /^;system=mariko$/m.test(c)
      for (const m of c.matchAll(/hex-by-custom-offset\s+\S+\s+CUST\s+(\d+)/g)) {
        const off = Number(m[1])
        if (!TOP.includes(off)) continue
        writes++
        // Законны три места, и только они:
        //   * сброс — он возвращает ЗАВОДСКИЕ байты и обязан работать на обеих ревизиях,
        //     иначе испорченную строку 0 таблицы CPU Erista нечем вылечить;
        //   * файлы, достижимые только на Mariko: их выбирает форвардер с `;system=mariko`,
        //     сама секция внутри пометки не несёт и нести не обязана;
        //   * секция, помеченная ревизией напрямую.
        if (rel === 'service/reset.ini') continue
        if (rel === 'service/restore-mariko.ini') continue
        if (rel.startsWith('advanced/gpu/gpu-curve-mariko/')) continue
        if (mariko) continue
        bad.push(`${rel} ${head}: пишет ${off} вне мариковского пути и вне сброса`)
      }
    }
    // чтение и перенос: в эристовском восстановлении этих смещений быть не должно вовсе
    if (rel === 'service/restore-erista.ini') {
      for (const m of body.matchAll(/(?:hex_file\(CUST,(\d+),|Fields (\d+))/g)) {
        const off = Number(m[1] ?? m[2])
        if (TOP.includes(off)) bad.push(`${rel}: смещение ${off} попало в эристовскую копию`)
      }
    }
  }

  if (bad.length) problems.push({ sev: 'CRITICAL', what: `верхние точки кривой ушли не туда:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the seven top curve offsets stay on Mariko and in the factory reset (${writes} writes checked)`)
}

// ---------------- 37. the ST1 seeding stays behind the MANUAL gate
//
// Seeding writes 31 cells of loader.kip, seven of them shared with row 0 of the Erista
// CPU table. It may only run for someone who actually turned the manual table on, so the
// guard list has to open with CUST 44 = 03. Without it a visit to the screen writes the
// kip of a user who never asked. There are two entry points now - the curve forwarder and
// the mode item that switches Custom Table on - and the rule is the same for both.
// Details: NOTES 234.
{
  const bad = []
  let blocks = 0

  for (const file of iniFiles) {
    const rel = relative(DIST, file).split('\\').join('/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    let i = 0
    while (i < lines.length) {
      if (lines[i] !== 'try:') { i++; continue }
      let j = i + 1
      while (j < lines.length && lines[j] !== 'try:' && !/^\[/.test(lines[j])) j++
      const body = lines.slice(i + 1, j)
      const offs = l => [...l.matchAll(/CUST\s+(\d+)/g)].map(m => Number(m[1]))
      const writes = body.filter(l => /^hex-by-custom-offset\s/.test(l))
      const guards = body.filter(l => /^matching_hex_val_custom\s/.test(l))
      // посев узнаётся по тому, что блок проверяет и пишет ОДНИ И ТЕ ЖЕ ячейки;
      // восстановление копии тоже пишет пачками, но своих записей не сторожит
      const guarded = new Set(guards.flatMap(offs))
      const seeding = writes.length > 1 && writes.flatMap(offs).some(o => guarded.has(o))
      if (seeding) {
        blocks++
        const mode = /\sCUST 44 03$/.test(guards[0] ?? '')
        if (!mode) bad.push(`${rel}: блок try: пишет ${writes.length} ячеек, но не начинается с проверки режима CUST 44 03`)
        else if (guards.length <= writes.length) bad.push(`${rel}: условий ${guards.length} на ${writes.length} записей — сторож слабее, чем то, что он охраняет`)
      }
      i = j
    }
  }

  if (bad.length) problems.push({ sev: 'CRITICAL', what: `посев без сторожа режима:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`bulk kip writes stay behind the MANUAL gate (${blocks} seeding blocks checked)`)
}

// ---------------- 38. a footer must not eat the item name
//
// The footer sits in the value slot and squeezes the label out of the row: a long
// one leaves the button unreadable. Only plain footers are measured - one built
// from a placeholder is unknown until the console renders it. Debt U21.
{
  const LIMIT = 20
  const bad = []
  let checked = 0
  for (const file of iniFiles) {
    const rel = relative(DIST, file).split(String.fromCharCode(92)).join('/')
    for (const m of readFileSync(file, 'utf8').matchAll(/^set-footer '([^']*)'/gm)) {
      const t = m[1]
      if (t.includes('{')) continue
      checked++
      if (t.length > LIMIT) bad.push(`${rel}: футер в ${t.length} знаков — «${t}»`)
    }
  }
  const NL = String.fromCharCode(10)
  if (bad.length) problems.push({ sev: 'CRITICAL', what: 'футер длиннее ' + LIMIT + ' знаков выдавит имя пункта:' + NL + '     ' + bad.slice(0, 6).join(NL + '     ') })
  else ok.push(`plain footers stay under ${LIMIT} characters (${checked} checked)`)
}

// ---------------- 39. the backup manager keeps the face the operator signed off
//
// The operator froze this screen on 04.09.2026: a two-line passport, no console
// revision anywhere, and a mismatched backup announced by red text that names both
// sides - never by a popup. Apply then refuses in silence. Every part of that is a
// one-line edit away from being lost, and it is only visible on the console.
{
  const bad = []
  const PAGES = [
    { rel: 'service/restore-mariko.ini', here: 'Mariko', other: 'erista', Other: 'Erista' },
    { rel: 'service/restore-erista.ini', here: 'Erista', other: 'mariko', Other: 'Mariko' },
  ]
  const PASSPORT = ['Memory', 'Kip layout']
  const rowOf = l => l.match(/^'([^']*)'\s*=\s*'(.*)'$/)   // строка таблицы: подпись = значение
  let pages = 0

  for (const p of PAGES) {
    const abs = join(DIST, p.rel)
    if (!existsSync(abs)) { bad.push(`${p.rel}: файла нет, а менеджер копий без него не собирается`); continue }
    pages++
    const ls = readFileSync(abs, 'utf8').split(/\r?\n/)

    // нарезка на секции с запоминанием НОМЕРА КАЖДОЙ СТРОКИ: отказ обязан указать место
    const secs = []
    ls.forEach((line, i) => {
      if (/^\[/.test(line)) secs.push({ head: line, at: i + 1, body: [], bodyAt: [] })
      else if (secs.length) { const s = secs[secs.length - 1]; s.body.push(line); s.bodyAt.push(i + 1) }
    })

    // (1) паспорт — ровно две строки и именно эти две
    const passport = secs.filter(s => s.body.some(l => l.includes('{ini_file(Meta,ram)}')))
    if (passport.length !== 1) {
      bad.push(`${p.rel}: блоков паспорта ${passport.length}, а он ровно один`)
    } else {
      const s = passport[0]
      const labels = s.body.map(rowOf).filter(Boolean).map(m => m[1])
      if (labels.length !== PASSPORT.length)
        bad.push(`${p.rel}:${s.at} строк паспорта ${labels.length} («${labels.join(' / ')}»), а их ровно две: ${PASSPORT.join(' и ')}`)
      else if (PASSPORT.some((n, k) => labels[k] !== n))
        bad.push(`${p.rel}:${s.at} паспорт подписан «${labels.join(' / ')}» вместо «${PASSPORT.join(' / ')}»`)
    }

    // (2) ревизия консоли на экран не выводится: она вправе стоять только красным текстом
    for (const s of secs) {
      const red = s.body.includes(';info_text_color=FF0000')
      s.body.forEach((l, k) => {
        const m = rowOf(l)
        if (!m || !m[2].includes('{ini_file(Meta,revision)}')) return
        if (!red) bad.push(`${p.rel}:${s.bodyAt[k]} ревизия копии печатается обычной строкой — постоянной строки с моделью на экране нет`)
      })
    }

    // (3) красный текст — только про несовпадение: условный, с пустой иначе-веткой,
    //     и называющий обе стороны словами, а не «копия не подходит»
    const red = secs.filter(s => s.body.includes(';info_text_color=FF0000'))
    if (red.length !== 1) {
      bad.push(`${p.rel}: блоков красного текста ${red.length}, а предупреждение о чужой ревизии ровно одно`)
    } else {
      const s = red[0]
      const rows = s.body.map((l, k) => [rowOf(l), s.bodyAt[k]]).filter(([m]) => m)
      if (!rows.length) bad.push(`${p.rel}:${s.at} красный блок пуст — предупреждать нечем`)
      for (const [m, at] of rows) {
        const cond = m[2].match(/^\{if_==\(\{ini_file\(Meta,revision\)\},([a-z]+),(.+),\)\}$/)
        if (!cond) bad.push(`${p.rel}:${at} красная строка печатается всегда — совпало, значит текста нет вовсе: «${m[2]}»`)
        else if (cond[1] !== p.other) bad.push(`${p.rel}:${at} красная строка ловит ревизию «${cond[1]}», а чужая для этой страницы — «${p.other}»`)
      }
      const text = rows.map(([m]) => m[2]).join(' ')
      if (!text.includes(p.here) || !text.includes(p.Other))
        bad.push(`${p.rel}:${s.at} предупреждение не называет обе стороны — нужны слова «${p.Other}» и «${p.here}»`)
    }

    // (4) попапов ни про ревизию, ни про раскладку kip
    ls.forEach((l, i) => {
      const m = l.match(/^notify(?:-now)?\s+'([^']*)'/)
      if (m && /erista|mariko|revision|kip *layout|kipver/i.test(m[1]))
        bad.push(`${p.rel}:${i + 1} попап о ревизии или раскладке kip — их не делать: «${m[1]}»`)
    })

    // (5) применение отсекает чужую ревизию и молчит: объяснение уже дал красный текст
    const apply = secs.find(s => /^\[Apply this backup/.test(s.head))
    if (!apply) {
      bad.push(`${p.rel}: пункта «Apply this backup» нет — менеджер копий ничего не применяет`)
    } else {
      // ветвей у применения несколько (свой kip, импортированный, молчаливый исход),
      // и затвор нужен КАЖДОЙ ПИШУЩЕЙ: одной хватило бы, чтобы проверка позеленела
      const gate = new RegExp(`^!matching_ini_val \\S+ Meta revision ${p.other}$`)
      const heads = apply.body.map((l, k) => l === 'try:' ? k : -1).filter(k => k >= 0)
      if (!heads.length) bad.push(`${p.rel}:${apply.at} у применения нет ни одной ветви try:`)
      heads.forEach((from, n) => {
        const to = heads[n + 1] ?? apply.body.length
        const part = apply.body.slice(from + 1, to)
        if (!part.some(l => /^hex-by-custom-offset\s/.test(l))) return   // молчаливый исход ничего не пишет
        if (!part.some(l => gate.test(l)))
          bad.push(`${p.rel}:${apply.bodyAt[from]} ветвь применения пишет kip, не отсекая копию с чужой модели — нужен запрет «Meta revision ${p.other}»`)
      })
      const say = apply.body.findIndex(l => /^notify/.test(l))
      if (say >= 0) bad.push(`${p.rel}:${apply.bodyAt[say]} применение объясняет отказ попапом — при несовпадении оно молчит`)
    }
  }

  if (pages !== PAGES.length) problems.push({ sev: 'CRITICAL', what: `страниц менеджера копий ${pages} из ${PAGES.length} — проверка вида смотрит в пустоту` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `вид менеджера копий изменён, а он зафиксирован решением оператора:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the backup manager keeps its frozen face (${pages} pages: two-line passport, red mismatch text, no popups)`)
}

// ---------------- 40. the manual GPU table is seeded with the ST1 curve
//
// Seeding must hand the user a copy of Eco ST1 and must compare every cell it is
// about to overwrite - one matching cell is not proof the table is untouched. Both
// halves are data, not code: ST1 lives in menu.json, the seeding is a generated
// list, and a row shifted by one would go unnoticed until the console booted.
{
  const bad = []
  const CURVE0 = 88, CURVE_STEP = 4

  // ST1 из карты: ячейки лежат по абсолютным смещениям таблицы, значение — 4 байта µV
  let st1 = null, meta = null
  ;(function findStock(node, path) {
    if (!node || typeof node !== 'object' || st1) return
    if (!Array.isArray(node) && node.stock_tables?.tables?.ST1?.cells) { st1 = node.stock_tables.tables.ST1; meta = node.stock_tables; return }
    for (const k of Object.keys(node)) findStock(node[k], `${path}/${k}`)
  })(menu, '')

  const le = h => { let v = 0; for (let i = h.length - 2; i >= 0; i -= 2) v = v * 256 + parseInt(h.substr(i, 2), 16); return v }
  const expect = new Map()
  if (st1) {
    const rows = Object.keys(st1.cells).map(Number).sort((a, b) => a - b)
    rows.forEach((off, i) => expect.set(CURVE0 + CURVE_STEP * i, le(st1.cells[String(off)]) / 1000))
  }

  // посев в дереве: try:-блок, который сторожит те же ячейки, что и пишет
  let found = 0
  for (const file of iniFiles) {
    const rel = relative(DIST, file).split(String.fromCharCode(92)).join('/')
    const ls = readFileSync(file, 'utf8').split(/\r?\n/)
    let i = 0
    while (i < ls.length) {
      if (ls[i] !== 'try:') { i++; continue }
      let j = i + 1
      while (j < ls.length && ls[j] !== 'try:' && !/^\[/.test(ls[j])) j++
      const writes = [], guards = []
      for (let k = i + 1; k < j; k++) {
        const w = ls[k].match(/^hex-by-custom-offset\s+\S+\s+CUST\s+(\d+)\s+([0-9A-F]+)$/)
        if (w) { writes.push({ off: Number(w[1]), hex: w[2], at: k + 1 }); continue }
        const g = ls[k].match(/^matching_hex_val_custom\s+\S+\s+CUST\s+(\d+)\s+([0-9A-F]+)$/)
        if (g) guards.push({ off: Number(g[1]), hex: g[2], at: k + 1 })
      }
      const guarded = new Set(guards.map(g => g.off))
      if (writes.length > 1 && writes.some(w => guarded.has(w.off))) {
        found++
        const written = new Set(writes.map(w => w.off))
        // (1) сравниваются ВСЕ ячейки, которые будут переписаны, — решение оператора
        const unguarded = writes.filter(w => !guarded.has(w.off)).map(w => w.off)
        if (unguarded.length) bad.push(`${rel}:${i + 1} посев пишет ${unguarded.length} ячеек, которых не сверял: ${unguarded.slice(0, 6).join(', ')}`)
        // (2) и не сверяет лишнего, кроме затвора режима CUST 44
        const extra = guards.filter(g => g.off !== 44 && !written.has(g.off)).map(g => g.off)
        if (extra.length) bad.push(`${rel}:${i + 1} посев сверяет ячейки, которых не пишет: ${extra.slice(0, 6).join(', ')}`)
        // (3) записанное — это ST1, ячейка в ячейку
        for (const w of writes) {
          const want = expect.get(w.off)
          if (want === undefined) { bad.push(`${rel}:${w.at} посев пишет CUST ${w.off} — вне 31 точки кривой, у ST1 такой строки нет`); continue }
          const got = le(w.hex)
          if (got !== want) bad.push(`${rel}:${w.at} CUST ${w.off} = ${got} мВ, а ST1 для этой строки даёт ${want} мВ`)
        }
      }
      i = j
    }
  }

  if (!st1) problems.push({ sev: 'CRITICAL', what: 'в menu.json нет stock_tables.tables.ST1 — сверять посев не с чем' })
  else if (expect.size !== 31) problems.push({ sev: 'CRITICAL', what: `у ST1 ${expect.size} строк вместо 31 — кривая Mariko перестала совпадать с эталоном (kipVer ${meta?.kip_ver})` })
  else if (!found) problems.push({ sev: 'CRITICAL', what: 'посев ручной таблицы не найден ни в одном файле — проверка ST1 смотрит в пустоту' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `посев ручной таблицы разошёлся с ST1:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the manual table is seeded with a cell-for-cell copy of ST1 (${found} ${found === 1 ? 'block' : 'blocks'}, 31 points guarded and written each)`)
}

// ---------------- 41. a value the backup does not carry shows a dash
//
// A row with nothing behind it is normal for an imported backup - the old format
// simply did not store some fields. Without the `null` fallback the engine prints
// "Not available", which reads as a broken screen rather than an empty field. The
// key is added by the generator, so a new dictionary path silently loses it.
{
  const DASH = String.fromCharCode(8212)   // «—», а не дефис: подмена сверяется буквально
  const bad = []
  const maps = []
  const walkJson = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walkJson(p)
      // словари ПОДСТАНОВКИ — только `.map.json`; `.flat.json` читается иначе и запасного ключа не несёт
      else if (e.name.endsWith('.map.json')) maps.push(p)
    }
  }
  walkJson(DIST)

  for (const p of maps) {
    const rel = relative(DIST, p).split(String.fromCharCode(92)).join('/')
    let doc
    try { doc = JSON.parse(readFileSync(p, 'utf8')) } catch { bad.push(`${rel}:1 не читается как JSON`); continue }
    const obj = Array.isArray(doc) ? doc[0] : doc
    if (!obj || typeof obj !== 'object') { bad.push(`${rel}:1 не словарь подстановки`); continue }
    // номер строки ключа — чтобы отказ указывал место, а не только файл
    const at = readFileSync(p, 'utf8').split(/\r?\n/).findIndex(l => l.includes('"null"')) + 1
    if (!Object.prototype.hasOwnProperty.call(obj, 'null')) bad.push(`${rel}:1 нет ключа "null" — пустое значение выйдет на экран как «Not available»`)
    else if (obj['null'] !== DASH) bad.push(`${rel}:${at || 1} ключ "null" даёт «${obj['null']}» вместо прочерка «${DASH}»`)
  }

  if (!maps.length) problems.push({ sev: 'CRITICAL', what: 'словарей подстановки не найдено — проверка прочерка смотрит в пустоту' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `словарь не умеет показать пустое значение прочерком:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`every dictionary shows a missing value as a dash (${maps.length} dictionaries)`)
}

// ---------------- 42. the updater downloads the name the release actually publishes
//
// The asset name is hard-coded on both sides and they must agree letter for letter:
// the package fetches releases/latest/download/<name>, release.ps1 uploads <name>.
// Rename either one and nothing fails loudly - GitHub answers 404, download gives up
// after three tries, and every installed copy simply stops seeing updates. We would
// hear about it from users, not from a build. The version file the package reads to
// decide whether an update exists at all travels the same way and is checked with it.
{
  const relPs1 = join(ROOT, 'scripts', 'release.ps1')
  const bad = []
  if (!existsSync(relPs1)) {
    problems.push({ sev: 'CRITICAL', what: 'release.ps1 не найден — проверка имени ассета смотрит в пустоту' })
  } else {
    const ps = readFileSync(relPs1, 'utf8')
    // Кавычки в PowerShell могут быть любыми, поэтому берём содержимое, а не строку целиком.
    const declared = new Set()
    for (const m of ps.matchAll(/[$]assetName\s*=\s*['"]([^'"]+)['"]/g)) declared.add(m[1])
    for (const m of ps.matchAll(/Join-Path\s+[$]env:TEMP\s+['"](RELEASE\.ini)['"]/gi)) declared.add(m[1])
    // Что пакет реально просит у GitHub: последний сегмент пути releases/latest/download/.
    const wanted = new Set()
    for (const m of text.matchAll(/releases\/latest\/download\/([^'"\s]+)/g)) wanted.add(m[1])
    if (!wanted.size) problems.push({ sev: 'CRITICAL', what: 'в пакете нет ни одной ссылки releases/latest/download — стеречь имя ассета не на чем' })
    else if (!declared.size) problems.push({ sev: 'CRITICAL', what: 'в release.ps1 не нашлось ни одного имени ассета — проверка имени смотрит в пустоту' })
    else {
      for (const w of wanted) if (!declared.has(w)) bad.push(`пакет качает «${w}», а релиз такого ассета не выкладывает: есть ${[...declared].join(', ')}`)
      if (bad.length) problems.push({ sev: 'CRITICAL', what: `обновление просит у GitHub не то имя, что публикует релиз:\n     ${bad.join('\n     ')}` })
      else ok.push(`the updater asks GitHub for the exact names the release publishes (${[...wanted].join(', ')})`)
    }
  }
}

// ---------------- 43. no text promises the reader an engine the archive has not carried since 04.09.2026
//
// Fourteen such claims were found by hand on 04.09.2026, one of them printed on the
// operator's screen after every handoff build. Nothing caught them: check 18 pairs the
// promise in LICENSE and NOTICE with the refusal in release.ps1, and looks nowhere else.
// The composition of the archive is settled in one place and repeated in prose in dozens,
// so prose is what rots. The rule is deliberately coarse - a paragraph that ties the engine
// binary to what we ship must carry a year, which is how this project marks a statement as
// history. Anything still written in the present tense is a promise, and the promise is false.
{
  const SCAN_DIRS = ['docs', 'Guides', 'Make', '.']
  // Журнал и разведка исключены осознанно: это датированные отчёты, и переписывание
  // их убивает провенанс. INSTALL-engine.txt описывает законсервированный отдельный
  // релиз движка, а не наш архив.
  const SKIP = [/^docs[\/]NOTES\.md$/i, /^docs[\/]research[\/]/i, /^docs[\/]INSTALL-engine\.txt$/i]
  // Форма самого утверждения, а не всякое соседство: «архив НЕСЁТ движок».
  // Без глагола обладания в сеть попадали глоссарий, аудит ссылок и шаги сборки.
  const CARRIES = /(нес[ёе]т|содержит|внутри|едет|включает|carr(y|ies|ied)|contains?|ships?|shipped|inside|bundle)/i
  const ARCHIVE = /(архив|релиз|комплект|поставк|release|archive|kit|[.]zip)/i
  // Комплект на передачу автору прошивки движок НЕСЁТ законно, и сборщик движка
  // законно про движок рассказывает. Предмет надзора один: ПУБЛИКУЕМЫЙ архив релиза.
  const EXEMPT = /(handoff|на передач|NoUpload|build(s|ing)? |собирает|сборка движка)/i
  const HISTORY = /(19|20)\d\d/
  // Год — не единственная пометка истории: абзац, прямо говорящий «прежде было так,
  // а теперь нет», честен и без даты. Настоящая ложь — настоящее время без оговорки.
  const PAST = /(прежде|раньше|больше нет|уже не|отпал|ушл(и|о)|отменен|no longer|used to|was |were |former)/i
  const files = []
  const walk = d => {
    let entries = []
    try { entries = readdirSync(join(ROOT, d), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = d === '.' ? e.name : `${d}/${e.name}`
      if (e.isDirectory()) { if (!/^(\.git|node_modules|out|package)$/i.test(e.name) && d !== '.') walk(rel); continue }
      if (!/\.(md|txt|bat)$/i.test(e.name)) continue
      if (SKIP.some(r => r.test(rel.split('/').join(String.fromCharCode(92))) || r.test(rel))) continue
      files.push(rel)
    }
  }
  for (const d of SCAN_DIRS) walk(d)

  const bad = []
  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), 'utf8')
    const lines = raw.split(/\r?\n/)
    // Абзац, а не строка: дату почти всегда пишут в соседнем предложении, и построчная
    // проверка утонула бы в ложных срабатываниях на переносах.
    let start = 0, buf = [], heading = ''
    const flush = () => {
      const para = buf.join(' ')
      if (buf.length && /ovlmenu/i.test(para) && CARRIES.test(para) && ARCHIVE.test(para) && !EXEMPT.test(para) && !PAST.test(para) && !HISTORY.test(para) && !HISTORY.test(heading))
        bad.push(`${rel}:${start + 1} — «${para.replace(/\s+/g, ' ').trim().slice(0, 95)}…»`)
      buf = []
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) { flush(); continue }
      if (/^\s*(#|rem |::|\|)/.test(lines[i]) && !buf.length) heading = lines[i]
      if (!buf.length) start = i
      buf.push(lines[i])
    }
    flush()
  }

  // Отдельно — положительное утверждение, а не поиск запрещённого: инструкция едет
  // ВНУТРИ архива, и она обязана сказать читателю, что движка в нём нет.
  const instAbs = join(ROOT, 'docs', 'INSTALL.txt')
  // 04.09.2026, РАЗОВОЕ ИСКЛЮЧЕНИЕ: последний релиз собирается по-старому, движком
  // и конфигуратором в одном архиве. Пока это так, INSTALL.txt обязан говорить
  // обратное — что движок в архиве ЕСТЬ. Утверждение остаётся положительным: файл
  // обязан назвать состав, а не молчать о нём. Вернуть первую форму сразу после
  // публикации — см. память release-with-engine-exception.
  const instTxt = existsSync(instAbs) ? readFileSync(instAbs, 'utf8') : ''
  const instSays = /THE ENGINE IS NOT HERE/i.test(instTxt) || /LAST ARCHIVE BUILT THIS WAY/i.test(instTxt)

  if (!files.length) problems.push({ sev: 'CRITICAL', what: 'проверка текстов не нашла ни одного файла — она смотрит в пустоту' })
  else if (!existsSync(instAbs)) problems.push({ sev: 'CRITICAL', what: 'docs/INSTALL.txt не найден, а он едет внутри архива' })
  else if (!instSays) problems.push({ sev: 'CRITICAL', what: 'docs/INSTALL.txt не называет состав архива — а он едет внутри архива' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `текст обещает читателю движок в поставке, и это не помечено как история:\n     ${bad.slice(0, 10).join('\n     ')}${bad.length > 10 ? `\n     …и ещё ${bad.length - 10}` : ''}` })
  else ok.push(`no text promises an engine in the archive (${files.length} files scanned; INSTALL.txt states it outright)`)
}

// ---------------- 44. every script is decided: published on purpose, or withheld on purpose
//
// The publish whitelist alone keeps a private script out of GitHub, so a script missing
// from BOTH lists leaks nothing - and that is exactly why it went unnoticed. NOTES 2414
// promised every one-shot map-editing script was also in the deny list, as a second line;
// two had quietly fallen out of both, and the promise had been false for weeks. A name in
// neither list is an undecided name: nobody chose to keep it back, it was merely forgotten.
{
  const pub = join(ROOT, 'scripts', 'publish.ps1')
  if (!existsSync(pub)) {
    problems.push({ sev: 'CRITICAL', what: 'publish.ps1 не найден — проверка списков смотрит в пустоту' })
  } else {
    const ps = readFileSync(pub, 'utf8')
    const listed = new Set()
    // Имена встречаются и голыми, и с путём ('scripts/generate.mjs') — берём последний сегмент.
    for (const m of ps.matchAll(/'(?:[\w.-]+\/)*([\w.-]+[.](?:mjs|ps1))'/g)) listed.add(m[1])
    let names = []
    try { names = readdirSync(join(ROOT, 'scripts')).filter(f => /\.(mjs|ps1)$/.test(f)) } catch {}
    const undecided = names.filter(f => !listed.has(f)).sort()
    if (!names.length) problems.push({ sev: 'CRITICAL', what: 'в scripts/ не найдено ни одного сценария — проверка списков смотрит в пустоту' })
    else if (!listed.size) problems.push({ sev: 'CRITICAL', what: 'в publish.ps1 не разобрано ни одного имени — проверка списков смотрит в пустоту' })
    else if (undecided.length) problems.push({ sev: 'CRITICAL', what: `сценарий не назван ни в белом списке, ни в чёрном — решения по нему нет:\n     ${undecided.join('\n     ')}` })
    else ok.push(`every script in scripts/ is named in publish.ps1, published or withheld on purpose (${names.length})`)
  }
}

// ---------------- 45. every script still parses
//
// merge-fields.mjs sat broken in HEAD for a whole commit on 04.09.2026: a backtick inside
// a template literal closed it mid-sentence, and the file stopped parsing. The full gate
// went green over it, because every check here reads what the generator PRODUCED, and a
// script that is never run in the gate is never even parsed. The broken one is destructive
// (--force rebuilds fields.json from scratch) and runs rarely - exactly the profile that
// hides a syntax error until the day you need the script. One --check each, a second total.
{
  const dir = join(ROOT, 'scripts')
  let files = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.mjs')) } catch {}
  const bad = []
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', join(dir, f)], { encoding: 'utf8' })
    if (r.status !== 0) {
      const line = String(r.stderr || '').split(/\r?\n/).find(l => /SyntaxError|Error:/.test(l)) || 'не разбирается'
      bad.push(`${f}: ${line.trim().slice(0, 90)}`)
    }
  }
  if (!files.length) problems.push({ sev: 'CRITICAL', what: 'в scripts/ нет ни одного .mjs — проверка разбора смотрит в пустоту' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `сценарий не разбирается — запустить его нельзя:\n     ${bad.join('\n     ')}` })
  // .ps1 сюда не входят: разобрать PowerShell из node нечем. Их парсер зовёт
  // check-before-release.bat, и это единственное место, где они проверяются.
  else ok.push(`every .mjs in scripts/ parses (${files.length}; .ps1 are checked by Make/github/check-before-release.bat)`)
}

// ---------------- 46. an offset list bound to a series must not fall behind that series
//
// In dependencies.json an entry that NAMES a series (`series`/`target`) normally spells the
// series out offset by offset, and the generator prints a hint against every offset it finds
// there. The series itself lives in fields.json and grows; that spelled-out copy does not, and
// nothing ever tied the two together. The drift is silent - the hint simply stops appearing.
// REAL CASE 04.09.2026: the Mariko GPU curve grew from 24 points to 31 (88…208), fields.json
// was fixed, `switches[44].enables[0].offsets` stayed at 24, and the top seven curve items
// shipped with no "Needs GPU Undervolt Mode = Custom Table" and no "Stay within 75 mV of the
// Eco ST2 curve" - 31 menu items, 24 hints, tuned blind for weeks. No guard saw it.
// A DELIBERATELY partial list declares itself IN THE DATA, next to the list:
//   "partial_series": { "<series name>": "<why these and not the whole series>" }
// No exceptions by name here, ever - a silent exception is the disease itself.
{
  const SERIES_NAMED_BY = ['series', 'target', 'of_series', 'scope']
  const OFFSET_LIST_KEYS = ['offsets', 'inputs', 'order', 'then', 'claimed_offsets']

  // Membership comes from the field map, the only place that knows the whole series.
  // `series` is a string on most fields and an object with `.name` on the off-grid one (170).
  const seriesMembers = new Map()
  for (const f of fields) {
    const nm = typeof f.series === 'string' ? f.series
      : (f.series && typeof f.series === 'object' ? f.series.name : null)
    if (!nm) continue
    if (!seriesMembers.has(nm)) seriesMembers.set(nm, new Set())
    seriesMembers.get(nm).add(f.offset)
  }

  const bad = []
  let listsSeen = 0, bindings = 0, declaredPartial = 0
  const walkDeps = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walkDeps(v, `${path}[${i}]`)); return }
    if (!node || typeof node !== 'object') return
    const named = [...new Set(SERIES_NAMED_BY
      .map(k => node[k])
      .filter(v => typeof v === 'string' && seriesMembers.has(v)))]
    for (const k of OFFSET_LIST_KEYS) {
      const v = node[k]
      if (!Array.isArray(v) || !v.every(Number.isInteger)) continue
      // An empty list under a named series is the loudest case of falling behind, so it is
      // kept; an empty list with no series named is simply not our subject.
      if (!v.length && !named.length) continue
      listsSeen++
      const have = new Set(v)
      for (const nm of named) {
        bindings++
        const missing = [...seriesMembers.get(nm)].filter(o => !have.has(o)).sort((a, b) => a - b)
        if (!missing.length) continue
        const why = (node.partial_series ?? {})[nm]
        if (typeof why === 'string' && why.trim().length >= 20) { declaredPartial++; continue }
        const total = seriesMembers.get(nm).size
        bad.push(`${path}.${k} названа серией «${nm}», но несёт ${total - missing.length} её смещений из ${total}; отстали ${missing.length}: ${missing.join(', ')}`)
      }
    }
    for (const [k, v] of Object.entries(node)) walkDeps(v, `${path}.${k}`)
  }
  if (deps) walkDeps(deps, 'dependencies')

  if (!deps) problems.push({ sev: 'CRITICAL', what: 'граф зависимостей не прочитан — проверка полноты серий смотрит в пустоту' })
  else if (!seriesMembers.size) problems.push({ sev: 'CRITICAL', what: 'в fields.json не нашлось ни одной серии — проверка полноты серий смотрит в пустоту' })
  else if (!listsSeen) problems.push({ sev: 'CRITICAL', what: 'в графе зависимостей не нашлось ни одного списка смещений — проверка полноты серий смотрит в пустоту' })
  else if (!bindings) problems.push({ sev: 'CRITICAL', what: 'ни один список в графе не назван серией — сверять полноту не с чем, проверка смотрит в пустоту' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `список смещений отстал от серии, которую сам называет:\n     ${bad.join('\n     ')}` })
  else ok.push(`every offset list bound to a series spells it out in full (${listsSeen} lists, ${bindings} list-to-series bindings across ${seriesMembers.size} series${declaredPartial ? `, ${declaredPartial} declared partial` : ''})`)
}

const crit = problems.filter(p => p.sev === 'CRITICAL')
const warn = problems.filter(p => p.sev === 'IMPORTANT')

console.log(`files in package  : ${iniFiles.length}`)
console.log(`offsets written   : ${writtenOffsets.size}`)
console.log(`checks passed     : ${ok.length}`)
console.log(`discrepancies     : ${crit.length} critical, ${warn.length} important`)
console.log()

for (const p of [...crit, ...warn]) console.log(`${p.sev === 'CRITICAL' ? '❌' : '⚠ '} ${p.what}`)

if (!problems.length) {
  console.log('✅ what was generated matches what was intended')
  for (const o of ok) console.log(`   ${o}`)
}

process.exit(crit.length ? 1 : 0)
