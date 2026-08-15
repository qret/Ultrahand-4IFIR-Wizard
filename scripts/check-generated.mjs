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
import { join, dirname } from 'node:path'
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
  const needle = `matching_hex_val_custom`
  const found = lines.some(l => l.includes(needle) && l.includes(` CUST ${v.offset} `))
  if (found) ok.push(`visibility condition for "${it.title ?? it.id}" (on ${v.offset})`)
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

// ---------------------------------------------------------------- 6. boot covers what is written

const bootRead = new Set()
for (const m of text.matchAll(/hex_file\(CUST,(\d+),/g)) bootRead.add(Number(m[1]))
const noFooter = [...writtenOffsets].filter(o => !bootRead.has(o))
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
  for (const m of body.matchAll(/(?:set-ini-val|json_file)\s+'\.\/([^']+)'/g)) {
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
  const sections = [...resetIni.matchAll(/\[Apply factory defaults\?(\w+)\]([\s\S]*?)(?=\n\[|$)/g)]

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
  const pkg = join(DIST, 'service', 'package.ini')
  if (existsSync(pkg)) {
    const text = readFileSync(pkg, 'utf8')
    for (const rev of ['mariko', 'erista']) {
      const from = text.indexOf(`[Create backup?${rev}]`)
      const to = text.indexOf(`[*Restore backup?${rev}]`)
      const restorePath = join(DIST, 'service', `restore-${rev}.ini`)
      if (from < 0 || to < 0 || !existsSync(restorePath)) { bad.push(`нет секций для ${rev}`); continue }
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

// ----------------------------------- 16. точки кривых напряжений построены вокруг заводского
//
// Обе кривые задаются прошивкой как полоса вокруг значения, которое она сама отгружает.
// Донорские словари этого не знали: у Erista была не та сетка (15 мВ вместо 12,5), у Mariko —
// плоские границы 400…900 на все точки. Итог в обоих случаях один: у части точек ЗАВОДСКОЕ
// НАПРЯЖЕНИЕ ОТСУТСТВОВАЛО В СПИСКЕ, и человек, сдвинувший точку, не мог вернуться.
//
// Живого kip здесь нет, поэтому проверяем инвариант, который от него не зависит: у каждой
// точки ровно один пункт помечен Default и стоит РОВНО В СЕРЕДИНЕ — так строится полоса.
// Сместится центр или пропадёт метка — значит словарь снова собран не вокруг заводского.
{
  const bad = []
  const points = fields.filter(f => String(f.series ?? '').startsWith('gpu_curve'))
  for (const f of points) {
    const vals = f.values ?? []
    const at = vals.map((v, i) => [v, i]).filter(([v]) => /default/i.test(v.name)).map(([, i]) => i)
    if (at.length !== 1) { bad.push(`${f.offset} ${f.name}: пунктов Default ${at.length}, нужен ровно один`); continue }
    const mid = (vals.length - 1) / 2
    if (at[0] !== mid) bad.push(`${f.offset} ${f.name}: Default на позиции ${at[0]} из ${vals.length}, середина ${mid}`)
  }
  if (!points.length) problems.push({ sev: 'IMPORTANT', what: 'в карте не нашлось ни одной точки кривых напряжений' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `точки кривых собраны не вокруг заводского значения:\n     ${bad.slice(0, 5).join('\n     ')}` })
  else ok.push(`voltage curve points are centred on the shipped value (${points.length} points)`)
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
