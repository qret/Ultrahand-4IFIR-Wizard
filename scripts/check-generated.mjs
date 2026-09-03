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

for (const it of items) {
  for (const off of it.offsets ?? []) {
    const f = byOffset.get(off)
    if (!f || f.exclude_from_menu) continue
    if (!(f.values ?? []).length) continue          // no dictionary means no item — that is legitimate
    if (writtenOffsets.has(off)) ok.push(`item "${it.title ?? it.id}" → write to ${off}`)
    else problems.push({ sev: 'CRITICAL', what: `item "${it.title ?? it.id}" is declared on offset ${off}, but dist has no write to it` })
  }
}

// ---------------------------------------------------------------- 2. conditional visibility

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
  if (withValue.length) ok.push(`visibility condition for "${it.title ?? it.id}" (on ${v.offset}=${v.value})`)
  else if (onOffset.length) problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" is declared visible when ${v.offset}=${v.value}, but dist checks that cell against a different value` })
  else problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" is declared visible when ${v.offset}=${v.value}, but dist has no visibility_condition` })
}

// ---------------------------------------------------------------- 3. complete series

const bySeries = new Map()
for (const f of fields) {
  if (typeof f.series === 'string' && f.series) {
    if (!bySeries.has(f.series)) bySeries.set(f.series, [])
    bySeries.get(f.series).push(f)
  }
}
for (const it of items) {
  if (!it.series) continue
  const list = (bySeries.get(it.series) ?? []).filter(f => !f.exclude_from_menu && (f.values ?? []).length)
  const missing = list.filter(f => !writtenOffsets.has(f.offset))
  if (!missing.length) ok.push(`series "${it.series}" — all ${list.length} points written`)
  else problems.push({ sev: 'CRITICAL', what: `series "${it.series}": ${missing.length} of ${list.length} not written (${missing.slice(0, 6).map(f => f.offset).join(', ')}…)` })
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
        const p = fields.find(f => f.offset === o)?.platform ?? 'both'
        return p === 'both' || p === rev
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

// ------------------------------------------- 18. LICENSE и NOTICE.md против паспорта сборки
//
// GPL v2 требует не «исходник где-то есть», а «соответствующий исходник указан однозначно».
// В `BUILD.txt` это поле подставляется из `baseline.txt` и потому не врёт. В `LICENSE`
// и `NOTICE.md` те же сведения были вписаны РУКАМИ — и оба файла месяцами утверждали,
// что сборка НЕ изменена и что исходник у ppkantorski, хотя форк уже нёс нашу правку
// (`ahead_of_upstream=1`). Три файла в одном архиве, два против третьего.
//
// Автоподстановки здесь быть не может: LICENSE и NOTICE.md лежат в репозитории и
// публикуются, а не порождаются под каждый билд. Значит нужен сторож.
{
  // Путь ОТНОСИТЕЛЬНЫЙ, и это не стиль. Абсолютный был бы локальным путём
  // конкретной машины, а этот файл публикуется: предохранитель `$SECRETS` в publish.ps1
  // честно остановил публикацию на первой же попытке. Правильная реакция на такое —
  // менять текст, а не правило (`docs/NOTES.md` №48).
  //
  // Сборочное окружение лежит рядом с репозиторием, на уровень выше. У постороннего
  // его нет вовсе — и тогда проверка просто пропускается, как и задумано.
  //
  // Прямые слэши намеренно: Node их понимает на Windows, а обратный слэш в строке JS —
  // это escape. Путь с обратными слэшами молча превращается в мусор с символом забоя
  // посередине, и проверка вечно «пропускается», ничего не проверяя. Первая версия
  // этой строки так и сделала — четвёртый случай того же класса за проект.
  const baselinePath = join(ROOT, '..', 'WorkAround', 'out', 'baseline.txt')
  if (!existsSync(baselinePath)) {
    ok.push('licence-vs-passport check skipped — no baseline.txt (engine never built here)')
  } else {
    const bl = readFileSync(baselinePath, 'utf8')
    const ahead = Number((bl.match(/^ahead_of_upstream\s*=\s*(\d+)/m) || [])[1] ?? NaN)
    const srcUrl = (bl.match(/^source_url\s*=\s*(\S+)/m) || [])[1] || ''
    for (const name of ['LICENSE', 'NOTICE.md']) {
      const f = join(ROOT, name)
      if (!existsSync(f)) { problems.push({ sev: 'IMPORTANT', what: `${name} не найден` }); continue }
      const text = readFileSync(f, 'utf8')
      const claimsUnmodified = /\bunmodified\b/i.test(text)
      if (ahead > 0 && claimsUnmodified) {
        problems.push({ sev: 'CRITICAL', what: `${name} называет сборку движка неизменённой, а форк ушёл от апстрима на ${ahead} — это неверное указание соответствующего исходника (GPL v2)` })
      } else if (ahead > 0 && srcUrl && !text.includes(srcUrl)) {
        problems.push({ sev: 'CRITICAL', what: `${name} не называет ${srcUrl} — репозиторий, из которого собран лежащий в архиве бинарник` })
      } else {
        ok.push(`${name} agrees with baseline.txt on the corresponding source`)
      }
    }
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
  const bad = [], gaps = []
  let checked = 0
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
    if (f.default_label_note) continue
    const marked = (f.values ?? []).filter(v => /(^|[^a-z])default([^a-z]|$)/i.test(String(v.name)))
    if (!marked.length) continue
    checked++
    // Сравниваем по ЗНАЧЕНИЮ, а не по строке: в словарях один и тот же ноль лежит и как
    // `00`, и как `000000`, и это законно — генератор выравнивает их сам.
    const len = f.length ?? 3
    const num = h => parseInt(String(h).padEnd(len * 2, '0').slice(0, len * 2).match(/../g).reverse().join(''), 16)
    if (!marked.some(v => num(v.hex) === num(want)))
      bad.push(`${f.offset} ${f.name}: «Default» стоит на ${marked.map(v => v.name).join(', ')}, а сброс пишет ${want}`)
  }
  if (bad.length || gaps.length) {
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `метка «Default» расходится с эталоном сброса:\n     ${bad.slice(0, 6).join('\n     ')}` })
    if (gaps.length) problems.push({ sev: 'CRITICAL', what: `поля участвуют в сбросе, но в эталоне их нет — сброс их не тронет:\n     ${gaps.slice(0, 8).join('\n     ')}` })
  } else {
    ok.push(`the "Default" label agrees with the reset baseline (${checked} fields), and the baseline covers every field that resets`)
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
// смешанная — 24 точки Mariko и 29 Erista. Вышло 53 строки вместо 24, вдобавок без метки
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
{
  const bad = [], soft = []
  const pkgPath = join(DIST, 'service', 'package.ini')
  const pkg = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : ''
  let impMap = {}
  try { impMap = JSON.parse(readFileSync(join(ROOT, 'package', 'backup-import.json'), 'utf8')).import_map ?? {} } catch {}

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

    // Производители этого каталога — по секциям пакета.
    for (const sec of pkg.split(/^(?=\[)/m)) {
      const title = sec.match(/^\[([^\]]+)\]/)?.[1]
      if (!title) continue
      const pm = sec.match(/set-ini-val '\.\/config\.ini' (\w+) Path '([^']+)'/)
      if (!pm || !pm[2].startsWith(dir + '/')) continue
      // Регулярка ЛИТЕРАЛЬНАЯ, а не собранная строкой: в шаблонной строке обратные
      // слэши съедаются, регулярка выходит без экранирования и молча не находит
      // ничего — сторож при этом светится зелёным. Проверено: так и было.
      const offs = new Set([...sec.matchAll(/\{ini_file\((\w+),Path\)\}' Fields (\d+)/g)]
        .filter(x => x[1] === pm[1]).map(x => Number(x[2])))
      if (!offs.size) continue
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
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `страница читает то, чего источник не пишет:\n     ${bad.slice(0, 6).join('\n     ')}` })
  if (soft.length) problems.push({ sev: 'IMPORTANT', what: `источник не может дать часть строк предпросмотра:\n     ${soft.slice(0, 6).join('\n     ')}` })
  if (!bad.length) ok.push('every offset a preview page keys on is written by every source that fills its folder')
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
  if (!existsSync(rootIni)) {
    problems.push({ sev: 'CRITICAL', what: 'нет package.ini — проверить путь обновления не на чем' })
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
      if (!sec) problems.push({ sev: 'CRITICAL', what: `в корне нет пункта "${name}" — единственный путь обновиться с консоли исчез` })
      else if (gated(sec)) problems.push({ sev: 'CRITICAL', what: `"${name}" закрыт затвором версии kip — при чужом kip человек останется заперт без возможности обновиться` })
      else ok.push(`escape hatch "${name}" survives a kip layout change`)
    }

    // (б) пункты, пишущие в kip, обязаны быть С затвором. Не по звёздочке в имени,
    //     а по тому, что секция реально трогает kip: так проверка переживёт смену
    //     соглашения об именовании, на которой всё и держалось.
    for (const c of chunks) {
      const head = (c.split(/\r?\n/)[0] ?? '').trim()
      if (!/hex-by-custom|loader\.kip/.test(c)) continue
      if (/^\[@/.test(head)) continue                 // объявление страницы
      if (/^\[Kip version mismatch\]/.test(head)) continue
      if (!gated(c)) problems.push({ sev: 'CRITICAL', what: `секция ${head} в корне трогает kip, но не закрыта затвором версии — на чужой раскладке она писала бы по неверным адресам` })
    }

    // (в) экран-предупреждение существует, несёт РОВНО обратное условие и называет выход.
    const warnSec = sectionOf(/^\[Kip version mismatch\]/)
    if (!warnSec) {
      problems.push({ sev: 'CRITICAL', what: 'нет экрана "Kip version mismatch" — при чужом kip человек увидит пустой корень без объяснения' })
    } else {
      const cond = (warnSec.match(/visibility_condition=([^\r\n]+)/) ?? [])[1] ?? ''
      if (!cond.startsWith('!')) problems.push({ sev: 'CRITICAL', what: 'экран "Kip version mismatch" показывается не по ОБРАТНОМУ условию — он либо не покажется никогда, либо будет висеть поверх работающего тюнера' })
      // Текст обязан назвать оба пункта: диагноз без выхода отправляет человека к компьютеру.
      for (const must of ['Check for updates', 'Update']) {
        if (!warnSec.includes(must)) problems.push({ sev: 'CRITICAL', what: `экран "Kip version mismatch" не называет пункт "${must}" — человек не поймёт, что средство стоит на том же экране` })
      }
      if (cond.startsWith('!') && warnSec.includes('Check for updates') && warnSec.includes('Update'))
        ok.push('kip mismatch screen shows the way out by name')
    }
  }
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
