#!/usr/bin/env node
// check-menu — checks the menu structure for completeness and sanity.
//
// Two checks a markdown document cannot give you:
//   COVERAGE — every offset in fields.json is attached to some menu item.
//              An unattached one is a feature that silently gets lost in the migration.
//   ORPHANS  — every item points at an offset or a series that actually exists.
//              A reference to nowhere is a dummy item that does nothing.
//
// Plus a duplicate check: the same offset in two items is allowed ONLY when it is an explicit
// alias (emergency pMeh/sMeh access through hekate). Anything else is an error.
//
// Run: node scripts/check-menu.mjs
// Exit code: 0 — clean, 1 — errors found.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fieldsDoc = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8'))
const menu = JSON.parse(readFileSync(join(ROOT, 'package', 'menu.json'), 'utf8'))

const fields = fieldsDoc.fields
const byOffset = new Map(fields.map(f => [f.offset, f]))
const bySeries = new Map()
for (const f of fields) {
  if (typeof f.series === 'string' && f.series) {
    if (!bySeries.has(f.series)) bySeries.set(f.series, [])
    bySeries.get(f.series).push(f.offset)
  }
}

// ---------------------------------------------------------------- menu traversal

const assigned = new Map()   // offset -> [itemId]
const problems = { unknownOffset: [], unknownSeries: [], emptyItem: [] }
const items = []

function walk(node, path = [], inMicro = false) {
  const here = [...path, node.title ?? node.id]
  const micro = inMicro || node.id === 'micro_enhance' || node.preserve_as_is === true
  items.push({ id: node.id, path: here.join(' > '), node, micro })

  const own = []
  for (const off of node.offsets ?? []) {
    if (!byOffset.has(off)) problems.unknownOffset.push({ item: node.id, offset: off })
    else own.push(off)
  }
  if (node.series) {
    const list = bySeries.get(node.series)
    if (!list) problems.unknownSeries.push({ item: node.id, series: node.series })
    else own.push(...list)
  }
  // УСЛОВИЕ ВИДИМОСТИ ССЫЛАЕТСЯ НА СМЕЩЕНИЕ — оно обязано существовать в карте полей.
  //
  // Здесь стоял ключ `gate`, и это была ПУСТАЯ ПРОВЕРКА: такого ключа в карте меню нет
  // ни одного, поле называется `visible_when`. Сторож молчал не потому, что всё хорошо,
  // а потому что смотрел не туда. Найдено аудитом 01.09.2026 и доказано опытом: ссылка
  // на несуществующее смещение проходила все проверки разом, а на консоли страница
  // просто не появлялась — и узнать об этом можно было только с консоли.
  //
  // `visible_when` бывает двух форм: объект со смещением и значением — его и проверяем;
  // и произвольная строка-условие движка (например `path_exists ...`), в которой
  // смещения нет вовсе, и проверять нечего.
  //
  // СМЕЩЕНИЕ УСЛОВИЯ НЕ ДОБАВЛЯЕТСЯ В СПИСОК «СВОИХ», и это важно. Пункт условие ЧИТАЕТ,
  // а владеет полем кто-то другой. Первая редакция правки клала его в `own` — и сторож
  // тут же объявил конфликтом то, что конфликтом не является: три пункта на смещении 44,
  // из которых два им управляют, а третий лишь смотрит на него, чтобы решить, показываться
  // ли. Проверяем существование — и только.
  if (node.visible_when?.offset != null && !byOffset.has(node.visible_when.offset)) {
    problems.unknownOffset.push({ item: node.id, offset: node.visible_when.offset })
  }

  for (const off of own) {
    if (!assigned.has(off)) assigned.set(off, [])
    assigned.get(off).push(node.id)
  }

  const kids = node.children ?? []
  if (!kids.length && !own.length && node.kind !== 'section' && !node.note) {
    problems.emptyItem.push(node.id)
  }
  for (const k of kids) walk(k, here, micro)
}

for (const s of menu.sections) walk(s)

// ---------------------------------------------------------------- analysis

const allOffsets = fields.map(f => f.offset)
const unassignedDeclared = new Set((menu.unassigned?.offsets ?? []).map(x => x.offset))

const covered = [...assigned.keys()]
// `read_only` — поле заведено намеренно без пункта меню: оно сохраняется в бэкап
// и восстанавливается, но задать его вручную нельзя, потому что коды режимов
// не установлены. Отсутствие пункта здесь не потеря, а решение.
const readOnly = new Set(fields.filter(f => f.read_only).map(f => f.offset))
const missing = allOffsets.filter(o => !assigned.has(o) && !unassignedDeclared.has(o) && !readOnly.has(o))
const declaredButCovered = [...unassignedDeclared].filter(o => assigned.has(o))

// duplicates: one offset used by several items
const dupes = []
for (const [off, ids] of assigned) {
  if (ids.length < 2) continue
  const uniq = [...new Set(ids)]
  if (uniq.length < 2) continue
  // A duplicate is allowed when one of the items sits in Micro-Enhance Logic: pMeh/sMeh is a
  // DELIBERATE second way into the same field (emergency access through the KIP tool in hekate).
  // It is an error only when two ordinary items of the main menu edit the same offset.
  const microSide = uniq.filter(id => items.find(i => i.id === id)?.micro)
  const plainSide = uniq.filter(id => !items.find(i => i.id === id)?.micro)
  // Второй законный случай — РАЗНЫЕ РЕВИЗИИ. Одно смещение может значить на Mariko и на
  // Erista разное: у 44 на Mariko это выбор одной из готовых таблиц напряжений, на Erista
  // множитель −12,5 мВ. Тогда пунктов два, но на экране всегда ровно один: движок скрывает
  // чужую ревизию по `;system=`. Условие — у каждого своя ревизия и ни у кого не `both`.
  const plats = uniq.map(id => items.find(i => i.id === id)?.node?.platform)
  const bySystem = plats.length === uniq.length
    && plats.every(p => p === 'mariko' || p === 'erista')
    && new Set(plats).size === plats.length
  const allowed = bySystem || (microSide.length > 0 && plainSide.length <= 1)
  if (bySystem) { dupes.push({ offset: off, items: uniq, allowed, microSide, plainSide, bySystem }); continue }
  dupes.push({ offset: off, items: uniq, allowed, microSide, plainSide })
}

// ---------------------------------------------------------------- output

const pct = n => ((n / allOffsets.length) * 100).toFixed(1)

console.log(`offsets in the map   : ${allOffsets.length}`)
console.log(`attached to items    : ${covered.length}  (${pct(covered.length)}%)`)
console.log(`declared as pending  : ${unassignedDeclared.size}`)
console.log(`NOT attached         : ${missing.length}`)
console.log(`items in the menu    : ${items.length}`)
console.log()

let bad = 0

if (missing.length) {
  bad++
  console.log(`❌ LOST FEATURES — ${missing.length} offsets are in no item at all:`)
  const groups = new Map()
  for (const o of missing) {
    const f = byOffset.get(o)
    const key = (typeof f.series === 'string' && f.series) ? f.series : '(no series)'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  }
  for (const [g, offs] of groups) {
    console.log(`   ${g}: ${offs.length} — ${offs.slice(0, 12).join(', ')}${offs.length > 12 ? ' …' : ''}`)
  }
  console.log()
}

if (problems.unknownOffset.length) {
  bad++
  console.log(`❌ DUMMY ITEMS — reference to an offset that does not exist:`)
  for (const p of problems.unknownOffset) console.log(`   ${p.item} → ${p.offset}`)
  console.log()
}

if (problems.unknownSeries.length) {
  bad++
  console.log(`❌ Unknown series:`)
  for (const p of problems.unknownSeries) console.log(`   ${p.item} → ${p.series}`)
  console.log()
}

const badDupes = dupes.filter(d => !d.allowed)
if (badDupes.length) {
  bad++
  console.log(`❌ Offset used by several items without being marked as an alias:`)
  for (const d of badDupes) console.log(`   ${d.offset} → ${d.items.join(', ')}`)
  console.log()
}

const okDupes = dupes.filter(d => d.allowed && !d.bySystem)
if (okDupes.length) {
  console.log(`✅ Deliberate aliases (emergency access through hekate): ${okDupes.length}`)
  for (const d of okDupes) console.log(`   ${d.offset} → ${d.items.join(' + ')}`)
  console.log()
}

const revDupes = dupes.filter(d => d.bySystem)
if (revDupes.length) {
  console.log(`✅ Split by console revision — one on screen at a time: ${revDupes.length}`)
  for (const d of revDupes) console.log(`   ${d.offset} → ${d.items.join(' + ')}`)
  console.log()
}

if (declaredButCovered.length) {
  console.log(`ℹ Declared as pending but already attached: ${declaredButCovered.join(', ')}`)
  console.log()
}

console.log(bad ? `CHECK FAILED (${bad} kind(s) of error)` : 'CHECK PASSED')
process.exit(bad ? 1 : 0)
