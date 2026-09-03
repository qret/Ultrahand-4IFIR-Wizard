#!/usr/bin/env node
// make-guide — порождает всё, что в гайде обязано быть механическим.
//
// ЗАЧЕМ. Донорский гайд разошёлся не потому, что автор ленив, а потому что навигация
// и оглавление писались руками: вставил страницу в середину — и «предыдущая/следующая»
// врут по всему дереву, а английская половина отстала на четыре файла из семнадцати.
//
// Здесь руками пишется ТОЛЬКО текст страницы. Порождаются:
//   - блоки навигации в шапке и подвале каждой страницы (между маркерами),
//   - оглавление каждого языка (`ru/README.md`, `en/README.md`),
//   - таблица состояния переводов (`STATUS.md`),
//   - метка синхронности в шапке каждой переведённой страницы.
//
// Порядок страниц и их названия — в `Guides/nav.json`, и только там.
//
// ПОЧЕМУ МЕТКА — HTML-КОММЕНТАРИЙ. GitHub вырезает такие комментарии из рендера
// полностью: читатель не видит, скрипт видит, diff показывает. Хеш считается
// от текста БЕЗ порождённых блоков — иначе правка навигации выглядела бы правкой
// содержания и метка протухала бы на ровном месте.
//
// Запуск: node scripts/make-guide.mjs [--check]
//   --check — ничего не писать, вернуть 1 при расхождении (для сборки).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GUIDE = join(ROOT, 'Guides')
const CHECK = process.argv.includes('--check')
/**
 * `--synced` — человек говорит: «перевод сверен с нынешним источником».
 *
 * Отдельная команда, потому что это УТВЕРЖДЕНИЕ, а не наблюдение. Машина видит, что
 * файлы изменились, но не знает, сверял ли кто-нибудь смысл. Раньше она это додумывала
 * и ошибалась в опасную сторону — в зелёную.
 */
const SYNCED = process.argv.includes('--synced')

const nav = JSON.parse(readFileSync(join(GUIDE, 'nav.json'), 'utf8'))
const LANGS = Object.keys(nav.langs)
const SRC = nav.source_lang
const pages = nav.pages

const T = {
  ru: {
    toc: 'Оглавление',
    title: '4IFIR Wizard — руководство',
    gen: 'Оглавление порождается из nav.json — руками не править.',
  },
  en: {
    toc: 'Contents',
    title: '4IFIR Wizard — Guide',
    gen: 'This index is generated from nav.json — do not edit by hand.',
  },
}

const NAV_BEGIN = '<!-- nav:begin -->'
const NAV_END = '<!-- nav:end -->'

/** Убрать всё порождённое: метку и блоки навигации. */
function stripGenerated(text) {
  const out = []
  let inNav = false
  for (const line of text.split('\n')) {
    if (line.startsWith(NAV_BEGIN)) { inNav = true; continue }
    if (line.startsWith(NAV_END)) { inNav = false; continue }
    if (inNav) continue
    if (line.startsWith('<!-- i18n:')) continue
    out.push(line)
  }
  // Хвостовой разделитель — часть ПОРОЖДЁННОГО подвала, а не содержания: его ставит
  // applyNav перед нижним блоком навигации. Считать его содержанием значило бы, что
  // страница меняется от одной перестановки навигации, а справочник не сошёлся бы
  // с собой никогда: он собирается без подвала, а на диске лежит с ним.
  // Пустая строка, на которой стоял снятый блок, содержанием тоже не является:
  // applyNav вставляет блок вместе с ней, и без схлопывания страница отличалась бы
  // от себя же на один перевод строки после каждой перестановки навигации.
  return out.join('\n').replace(/\n*-{3,}\s*$/, '').replace(/\n{3,}/g, '\n\n')
}

/** Хеш содержания без служебных блоков. */
function bodyHash(text) {
  return createHash('sha1').update(stripGenerated(text).trim(), 'utf8').digest('hex').slice(0, 12)
}

function navBlock(lang, page, i) {
  const t = T[lang]
  const prev = i > 0 ? pages[i - 1] : null
  const next = i < pages.length - 1 ? pages[i + 1] : null
  const line1 = [
    prev ? `[← ${prev[lang]}](${prev.file})` : null,
    `[${t.toc}](README.md)`,
    next ? `[${next[lang]} →](${next.file})` : null,
  ].filter(Boolean).join(' · ')
  const line2 = `**${nav.langs[lang]}** · ` + LANGS.filter(l => l !== lang)
    .map(l => `[${nav.langs[l]}](../${l}/${page.file})`).join(' · ')
  return [NAV_BEGIN, line1 + '  ', line2, NAV_END].join('\n')
}

function applyNav(text, block) {
  let body = stripGenerated(text).replace(/\n{3,}/g, '\n\n').trim()
  // хвостовой разделитель прежнего подвала убираем, иначе он копится
  body = body.replace(/\n*-{3,}\s*$/, '').trim()
  const lines = body.split('\n')
  const h1 = lines.findIndex(l => l.startsWith('# '))
  if (h1 >= 0) lines.splice(h1 + 1, 0, '', block)
  else lines.unshift(block, '')
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n\n---\n\n' + block + '\n'
}

const problems = []
const changed = []

// ПОРЯДОК ВАЖЕН: справочник порождается ДО навешивания навигации. Иначе он
// перезаписывает страницу уже с навигацией — и она остаётся без шапки и подвала,
// то есть тупиком, куда ведёт стрелка «дальше», а уйти некуда. Так и было.

// --- справочник настроек: ПОРОЖДАЕТСЯ из собранного пакета ----------------------
//
// Руками такую таблицу не ведут. У донора справочник и меню разошлись: пункты,
// которых в пакете нет, описаны; пункты, которые есть, — нет; а два разных пункта
// получили побайтово одинаковую справку, скопированную без правки.
//
// Здесь источник — то, что реально уехало на карту памяти. Разойтись физически не с чем,
// и переводить нечего: таблица состоит из имён полей и чисел.
{
  const DIST = join(ROOT, 'package', 'dist')
  const fields = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8')).fields
  const byOff = new Map(fields.map(f => [f.offset, f]))

  const REF = {
    ru: { title: 'Справочник настроек', lead:
            'Каждый пункт тюнера, у которого есть список значений, — в порядке меню. Точки кривой ' +
            'напряжений, тайминги и ряды `pMeh`/`sMeh` перечислены поштучно: в меню это отдельные пункты, ' +
            'и здесь они отдельные строки.\n\n' +
            'Действия — копия, восстановление, сброс к заводским, сведения о системе — в таблицу не входят: ' +
            'выбирать в них нечего.\n\n' +
            '«Значений» — длина того самого списка, который открывается на экране. Словарь названий у поля ' +
            'шире: тюнер умеет назвать и значение, которое поставил чужой пакет, но выбрать такое не ' +
            'предлагает, и в счёт оно не идёт. У точек кривой напряжений видеоядра словаря нет вовсе — ' +
            'значение читается прямо из файла настроек, поэтому там называется любое, кем бы оно ' +
            'ни было записано.\n\n' +
            'Таблица порождается из **собранного пакета** — из тех же файлов, которые едут на карту ' +
            'памяти. Разойтись с меню она не может.',
          h: ['Пункт меню', 'Поле в прошивке', 'Ревизия', 'Значений', 'Примеры'],
          both: 'обе' },
    en: { title: 'Settings reference', lead:
            'Every tuner item that offers a list of values, in menu order. Voltage-curve points, timings ' +
            'and the `pMeh`/`sMeh` rows are listed one by one: they are separate items in the menu, so they ' +
            'are separate rows here.\n\n' +
            'Actions — backup, restore, factory reset, system info — are not in the table: there is nothing ' +
            'to pick in them.\n\n' +
            '"Values" is the length of the very list that opens on screen. A field\'s name dictionary is ' +
            'wider: the tuner can name a value some other package wrote, but it does not offer such a value ' +
            'The GPU voltage curve has no dictionary at all: its value is read straight from the settings file, so whatever is written there gets named, by whoever wrote it. ' +
            'for picking, and it is not counted here.\n\n' +
            'The table is generated from the **built package** — the same files that go onto the SD card, ' +
            'so it cannot drift out of step with the menu.',
          h: ['Menu item', 'Firmware field', 'Revision', 'Values', 'Examples'],
          both: 'both' },
  }

  /**
   * ИСТОЧНИК — СОБРАННЫЙ ПАКЕТ, А НЕ КАРТА ПОЛЕЙ: ЭТО ОТВЕТЫ НА РАЗНЫЕ ВОПРОСЫ.
   *
   * `fields.json` отвечает «что мы умеем прочитать»: словарь названий там намеренно шире
   * списка выбора — постоянное решение оператора. Справочник же обещает «что можно выбрать»,
   * а это словари в `package/dist`, ровно те списки, которые открываются на экране. Прежняя
   * редакция брала длину словаря названий и расходилась с меню в разы: у `GPU Min Voltage`
   * стояло 115 против трёх на экране, и справочник спорил со страницами 4 и 5 руководства.
   *
   * Заодно снимается вторая беда. Обход карты меню брал узел только с `offsets` и без
   * `children`, а пять узлов задают настройки ключом `series` — кривые GPU, тайминги, ряды
   * pMeh/sMeh. Сотня пунктов не попадала в таблицу, обещавшую «все». В собранном пакете серия
   * уже развёрнута в отдельные пункты, и разворачивать её второй раз не нужно.
   */
  const readIni = file => {
    const items = []
    let cur = null
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim()
      const head = line.match(/^\[\*(.+)]$/)
      // Звёздочка — признак пункта: переключателя или перехода. Всё прочее в файле это
      // заголовки разделов и страницы-таблицы, выбирать там нечего.
      if (head) { cur = { title: head[1] }; items.push(cur); continue }
      if (line.startsWith('[')) { cur = null; continue }
      if (!cur) continue
      let m
      if ((m = line.match(/^;system=(\w+)/))) cur.system = m[1]
      else if ((m = line.match(/^json_file_source\s+'([^']+)'/))) cur.list = m[1]
      else if ((m = line.match(/^hex-by-custom(?:-rdecimal)?-offset\s+\S+\s+CUST\s+(\d+)/))) cur.offset ??= Number(m[1])
      else if ((m = line.match(/^package_source\s+'([^']+)'/))) cur.forward = m[1]
    }
    return items
  }

  // Словари кривых читаются по разу на точку, а точек полсотни: файл открывается один раз.
  const dicts = new Map()
  const readDict = file => {
    if (!dicts.has(file)) dicts.set(file, JSON.parse(readFileSync(file, 'utf8')))
    return dicts.get(file)
  }

  const rows = []
  const walkDist = (file, path, plat) => {
    const dir = dirname(file)
    for (const it of readIni(file)) {
      // `?метка` приклеена генератором, чтобы одноимённые пункты не затирали друг другу
      // подвал. Движок её прячет при отрисовке, читателю она не нужна тем более.
      const name = it.title.split('?')[0]
      const here = path ? `${path} → ${name}` : name
      // Ревизия наследуется вниз: у раздела `;system=` стоит один раз, а прячется по нему
      // всё его содержимое — так у кривой Erista помечен и переход, и каждая её точка.
      const rev = it.system ?? plat ?? null
      if (it.list) {
        const dictPath = join(dir, it.list)
        if (!existsSync(dictPath)) { problems.push(`нет словаря ${it.list} у пункта «${here}»`); continue }
        const names = readDict(dictPath).map(v => String(v.name).replace(/\|/g, '/'))
        rows.push({
          path: here,
          rev,
          // Имя поля — из карты: оно про блок CUST, а в собранном пакете от поля осталось
          // одно смещение.
          field: byOff.get(it.offset)?.name ?? `CUST+${it.offset}`,
          count: names.length,
          // Ряд из сотни ступеней напряжения первыми тремя пунктами не описывается: читателю
          // нужны концы шкалы, а не её начало.
          sample: names.length > 3
            ? `${names[0]}, ${names[1]} … ${names[names.length - 1]}`
            : names.join(', '),
        })
      }
      if (it.forward) {
        const nested = join(dir, it.forward)
        // Переход ведёт и на страницы без пунктов — сводка текущих настроек тоже переход.
        // Там просто нечего собирать, а вот отсутствующего файла быть не должно.
        if (existsSync(nested)) walkDist(nested, here, rev)
        else problems.push(`переход в никуда: ${it.forward} у пункта «${here}»`)
      }
    }
  }

  const entry = join(DIST, 'package.ini')
  // Справочник читает РЕЗУЛЬТАТ сборки, значит зависит от порядка запуска: сначала
  // `generate.mjs`, потом мы. Нет `dist` — это ошибка порядка, а не повод выпустить
  // страницу «настроек нет»: молча пустая таблица хуже упавшей сборки.
  if (!existsSync(entry)) problems.push('нет package/dist — сначала прогоните scripts/generate.mjs')
  else walkDist(entry, '', null)

  if (rows.length) for (const lang of LANGS) {
    const r = REF[lang]
    const out = [`# ${r.title}`, '', r.lead, '',
      `| ${r.h.join(' | ')} |`, '|---|---|---|---|---|']
    for (const row of rows) {
      const rev = row.rev === 'mariko' ? 'Mariko' : row.rev === 'erista' ? 'Erista' : r.both
      out.push(`| ${row.path} | \`${row.field}\` | ${rev} | ${row.count} | ${row.sample} |`)
    }
    out.push('')
    // ИМЯ БЕРЁТСЯ ИЗ КАРТЫ, А НЕ ЗАШИВАЕТСЯ. Здесь стояло литеральное '12-reference.md',
    // и первая же вставка страницы в середину это вскрыла: страницы переехали на номер
    // вперёд, карта знала новое имя, а справочник писался по старому — на диске появился
    // ДУБЛЬ, которого нет ни в одной навигации. Порождающий код обязан спрашивать карту
    // о том, что она сама и задаёт.
    const refPage = pages.find(p => p.generated)
    if (!refPage) { problems.push('в nav.json нет страницы с "generated": true — справочнику некуда писаться'); break }
    const path = join(GUIDE, lang, refPage.file)
    const text = out.join('\n')
    const before = existsSync(path) ? stripGenerated(readFileSync(path, 'utf8')).trim() : ''
    if (before !== text.trim()) {
      // В `--check` файл не переписывается, а расхождение обязано быть видно: иначе
      // проверка молчала бы ровно там, где справочник разошёлся с пакетом. В обычном
      // прогоне страницу посчитает цикл навигации ниже, второй раз её считать незачем.
      if (CHECK) changed.push(`${lang}/${refPage.file}`)
      else writeFileSync(path, text, 'utf8')
    }
  }
}

// --- навигация и метки переводов на каждой странице: ПОРОЖДАЮТСЯ ---------------
//
// Шапка этого файла обещала порождать навигацию с первого дня, а `navBlock` и `applyNav`
// стояли объявленными и НИ РАЗУ НЕ ВЫЗВАННЫМИ. Блоки писались руками, и обещание
// «руками навигацию не писать: она разъедется при первой же вставке страницы в середину»
// (`nav.json`) держалось на аккуратности, а не на коде. Проверить это было нечем:
// `--check` навигацию не смотрел вовсе.
//
// Цена вскрылась ровно там, где предсказано: понадобилось вставить страницу в середину,
// и полторы сотни ссылок пришлось бы править вручную.
//
// МЕТКА СИНХРОННОСТИ ТОЖЕ ПОРОЖДАЕТСЯ, и это не косметика. В ней два хеша: `sha` —
// каким был русский источник, когда перевод делали, и `self` — каким был сам перевод.
// Читался только `sha`; `self` не порождался и не проверялся никем, то есть врал бы
// молча при первой правке английского мимо генератора.
//
// `SHA` ПЕРЕСТАВЛЯЕТСЯ ТОЛЬКО ПО ЯВНОЙ КОМАНДЕ `--synced`, и вот почему.
//
// Прежняя редакция угадывала намерение: изменился хеш перевода — значит перевод правили,
// значит он сверен с текущим источником, переставляем `sha`. Догадка неверна. Правка
// английского бывает какой угодно: опечатка, вёрстка, заголовок — и к новому русскому
// тексту она отношения не имеет. Генератор в таком случае МОЛЧА объявлял перевод
// актуальным, хотя никто ничего не сверял. Я на это наступил сам, поправив один
// заголовок.
//
// Теперь машина не гадает. Она обновляет `self` (это факт: вот каков перевод сейчас)
// и оставляет `sha` как есть (это утверждение о сверке, а его делает человек). Сверив
// перевод, он говорит `node scripts/make-guide.mjs --synced` — и метка переезжает.
//
// Цена: забыв команду, читатель увидит «ОТСТАЛ» там, где всё в порядке. Это лучше
// обратного — зелёной метки на несверенном переводе.
for (const [i, page] of pages.entries()) {
  for (const lang of LANGS) {
    const path = join(GUIDE, lang, page.file)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')

    let text = applyNav(before, navBlock(lang, page, i))

    if (lang !== SRC) {
      const srcPath = join(GUIDE, SRC, page.file)
      // Порождаемым страницам метка не нужна: их содержание не переводят, а собирают
      // заново на каждом языке.
      if (!page.generated && existsSync(srcPath)) {
        const prev = before.match(/<!-- i18n:[^>]*sha=([0-9a-f]+)[^>]*self=([0-9a-f]+)/)
        const self = bodyHash(text)
        // Без `--synced` прежний `sha` сохраняется; метки у страницы ещё не было —
        // ставим текущий источник, иначе первая же страница родилась бы отставшей.
        const sha = SYNCED ? bodyHash(readFileSync(srcPath, 'utf8')) : (prev?.[1] ?? bodyHash(readFileSync(srcPath, 'utf8')))
        text = `<!-- i18n: source=Guides/${SRC}/${page.file} sha=${sha} self=${self} -->\n` + text
      }
    }

    if (before !== text) {
      changed.push(`${lang}/${page.file}`)
      if (!CHECK) writeFileSync(path, text, 'utf8')
    }
  }
}

// --- оглавление каждого языка -------------------------------------------------
for (const lang of LANGS) {
  const t = T[lang]
  const body = [
    `# ${t.title}`,
    '',
    `**${nav.langs[lang]}** · ` + LANGS.filter(l => l !== lang)
      .map(l => `[${nav.langs[l]}](../${l}/README.md)`).join(' · '),
    '',
    ...pages.map((p, i) => `${i + 1}. [${p[lang]}](${p.file})`),
    '',
    `<!-- ${t.gen} -->`,
    '',
  ].join('\n')
  const path = join(GUIDE, lang, 'README.md')
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (before !== body) {
    changed.push(`${lang}/README.md`)
    if (!CHECK) writeFileSync(path, body, 'utf8')
  }
}

// --- таблица состояния переводов ----------------------------------------------
const status = [
  '# Состояние переводов',
  '',
  'Порождается `scripts/make-guide.mjs`. Руками не править.',
  '',
  '| страница | ' + LANGS.map(l => nav.langs[l]).join(' | ') + ' |',
  '|---|' + LANGS.map(() => '---|').join(''),
]
for (const p of pages) {
  const cells = LANGS.map(l => {
    const path = join(GUIDE, l, p.file)
    if (!existsSync(path)) return 'нет'
    if (l === SRC) return 'источник'
    // Порождаемые страницы метки не несут: они собираются из карты на обоих языках
    // сразу, и «отставать» им не от чего.
    if (p.generated) return 'порождается'
    const src = join(GUIDE, SRC, p.file)
    if (!existsSync(src)) return 'есть'
    const want = bodyHash(readFileSync(src, 'utf8'))
    const got = (readFileSync(path, 'utf8').match(/sha=([0-9a-f]+)/) || [])[1]
    return got === want ? 'свежий' : 'ОТСТАЛ'
  })
  status.push(`| ${p.file} | ${cells.join(' | ')} |`)
}
const statusText = status.join('\n') + '\n'
const statusPath = join(GUIDE, 'STATUS.md')
if (!existsSync(statusPath) || readFileSync(statusPath, 'utf8') !== statusText) {
  changed.push('STATUS.md')
  if (!CHECK) writeFileSync(statusPath, statusText, 'utf8')
}

console.log(`страниц в карте: ${pages.length}, языков: ${LANGS.length}`)
for (const p of problems) console.log('  ❌ ' + p)
if (CHECK) {
  if (changed.length) console.log('  ❌ порождённое разошлось: ' + changed.slice(0, 8).join(', '))
  else console.log('  порождённое совпадает')
  process.exit(problems.length || changed.length ? 1 : 0)
}
console.log(changed.length ? `обновлено файлов: ${changed.length}` : 'изменений нет')
process.exit(problems.length ? 1 : 0)
