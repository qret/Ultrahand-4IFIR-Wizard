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
import { join, dirname, relative, resolve, basename, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'package', 'dist')

if (!existsSync(DIST)) { console.error('no package/dist — run generate.mjs first'); process.exit(2) }

const menu = JSON.parse(readFileSync(join(ROOT, 'package', 'menu.json'), 'utf8'))
const fields = JSON.parse(readFileSync(join(ROOT, 'package', 'fields.json'), 'utf8')).fields
const byOffset = new Map(fields.map(f => [f.offset, f]))

// THE MARIKO CURVE COMES FROM THE MAP, NOT FROM A HAND-WRITTEN RANGE. It already grew
// once (24 points to 31) and a literal range would have dropped the new points without
// a word. Checks 37, 40 and 50 all key on this list, and on its size.
const CURVE_MARIKO = fields.filter(f => f.series === 'gpu_curve_mariko').map(f => f.offset).sort((a, b) => a - b)
const curveMariko = new Set(CURVE_MARIKO)
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


// ============================================================================
// ОТРИЦАТЕЛЬНЫЙ ПРОГОН: `node scripts/check-generated.mjs --проба-отказа`
//
// Плейбук, §28.3: инструмент доказывается тем, что ОТКАЗЫВАЕТСЯ. Правило 4 того
// же модуля прямо говорит, что показать сторожа красным нужно на состоянии,
// которое ломает предмет надзора, и что «проверка, написанная против конкретной
// порчи, ловит ровно эту порчу» — поэтому пробы бьют по РАЗНЫМ классам:
// переполнение буфера чтения, ложь в тексте, длина подписи, чужой ключ в файле,
// который мы раздаём, и — главное — исчезновение самого предмета надзора.
//
// Механика: порча вписывается в настоящий файл дерева, гейт запускается
// отдельным процессом, файл возвращается в исходный вид в `finally` — байт
// в байт, из памяти. Проба, которую гейт НЕ поймал, даёт КОД ВОЗВРАТА 3,
// отличный от обычного провала (1): «отрицательный прогон не получился,
// инструмент лжёт».
//
// Оговорка честная: пробы врезаются в рабочее дерево на время прогона. Если
// процесс убить между записью и восстановлением, дерево останется грязным —
// но оно под git, и `git checkout -- package/dist docs` вернёт всё.
if (process.argv.includes('--проба-отказа') || process.argv.includes('--self-test')) {
  const { writeFileSync } = await import('node:fs')
  const A = 'a'
  const FOOTER_FILES = iniFiles.filter(f => /^set-footer '/m.test(readFileSync(f, 'utf8')))
  const PROBES = [
    {
      name: 'строка длиннее буфера чтения движка',
      file: join(DIST, 'package.ini'),
      hurt: s => s + '\n;help=' + A.repeat(1100) + '\n',
      expect: /1023/,
    },
    {
      name: 'подпись, выдавливающая имя пункта',
      file: join(DIST, 'package.ini'),
      hurt: s => s + "\nset-footer '" + A.repeat(28) + "'\n",
      expect: /футер длиннее/,
    },
    {
      name: 'текст обещает движок в архиве',
      file: join(ROOT, 'docs', 'STRUCTURE.md'),
      hurt: s => s + '\n\nНаши сборки содержат ovlmenu.ovl прямо в архиве релиза.\n',
      expect: /обещает читателю движок/,
    },
    {
      name: 'предмет надзора исчез — сторож обязан покраснеть, а не смолчать',
      file: join(DIST, 'advanced', 'gpu', 'gpu-curve-mariko', 'package.ini'),
      hurt: s => s.split('hex-by-custom-offset').join('write-custom-offset'),
      expect: /ни один пункт кривой Mariko|ничего не проверив/,
    },
    {
      // Ровно та порча, что прожила в дереве 552 записями: разделитель, который движок
      // не режет. Футер несёт «0», пункт зовётся «0 — Default», галочки нет ни у кого.
      name: 'имя пункта склеено длинным тире — курсор уедет на первую строку',
      file: join(DIST, 'advanced', 'gpu', 'json', 'gpu_vmin_offset.json'),
      hurt: s => s.split('0 - Default').join('0 — Default'),
      expect: /откроется на первой строке/,
    },
    {
      // Check 53, extended 21.09.2026: the em dash sat in the TAIL of the name, right of
      // " - ", where the left-part comparison never looked. Exactly the shipped row.
      name: 'длинное тире в хвосте имени пункта CPU Min Voltage',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.json'),
      hurt: s => s.split('Eco ST1 - Auto - Default').join('Eco ST1 - Auto — Default'),
      expect: /cpu_vmin\.json: «Eco ST1 - Auto — Default» — длинное тире в имени строки/,
    },
    {
      // Check 53 at the source: an em dash back in a fields.json name.
      name: 'длинное тире в имени значения fields.json',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => s.split('"0 - Default"').join('"0 — Default"'),
      expect: /package\/fields\.json: поле \d+, «0 — Default» — длинное тире в имени/,
    },
    {
      // Вторая беда того же сторожа: левые части совпали. Галочку получает ПЕРВЫЙ
      // однофамилец, и курсор встаёт не на то значение, что лежит в kip.
      name: 'два пункта с одной левой частью — галочка достанется первому',
      file: join(DIST, 'advanced', 'gpu', 'json', 'gpu_vmin_offset.json'),
      hurt: s => s.split('+70 mV').join('+75 mV'),
      expect: /одну левую часть/,
    },
    {
      // Ровно та беда, ради которой заведена проверка 54: пересев корневой подписи убран
      // из блока применения, и `eBAMATIC Stage` до конца сеанса врёт доприменённым значением.
      name: 'пересев корневой подписи пропал из блока применения',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split(`\nset-ini-val './../config.ini' '*eBAMATIC Stage' footer`).join(`\n;was-set-ini-val './../config.ini' '*eBAMATIC Stage' footer`),
      expect: /корневая подпись останется устаревшей/,
    },
    {
      // Третья дверь к той же беде: обычный пункт правит корневой байт из подкаталога.
      // Блоки применения при этом целы, поэтому проверка 54 молчит — красным обязана
      // стать общая 55-я.
      name: 'пункт правит корневой байт и не пересевает подпись',
      file: join(DIST, 'advanced', 'micro-enhance', 'pmeh', 'package.ini'),
      hurt: s => s.split(`\nset-ini-val './../../../config.ini' '*eBAMATIC Stage' footer`).join(`\n;was-set-ini-val './../../../config.ini' '*eBAMATIC Stage' footer`),
      expect: /оставляет корневую подпись устаревшей/,
    },
    {
      // SELF-UNDERMINING #1: a root forwarder names loader.kip only inside its own gate
      // line. Delete the gate and, until 05.09.2026, the section left oversight with it:
      // green run, and a foreign kip showed the whole tuner.
      name: 'снят затвор у корневого пункта — секция обязана остаться поднадзорной',
      file: join(DIST, 'package.ini'),
      hurt: s => s.replace(/(\[\*Advanced\]\r?\n);visibility_condition=[^\r\n]*\r?\n/, '$1'),
      expect: /трогает kip, но не закрыта затвором/,
    },
    {
      // SELF-UNDERMINING #2: seeding used to be recognised by guarding the cells it writes.
      // Strip the guards and the block stopped being seeding - 31 kip writes left unwatched.
      name: 'у блока посева сняли сторожей — посев обязан остаться посевом',
      file: join(DIST, 'advanced', 'gpu', 'package.ini'),
      hurt: s => s.split(/\r?\n/).filter(l => !/^matching_hex_val_custom\s/.test(l)).join('\n'),
      expect: /посев без сторожа режима|не начинается с проверки режима/,
    },
    {
      // Единственная проба, бьющая по ОБЩЕМУ затвору, а не по личному сторожу:
      // у проверки подписей своей проверки на пустоту нет, и до 05.09.2026 она
      // печатала «0 checked» зелёным. Ловит её теперь только правило «ноль — красный».
      name: 'счётчик упал в ноль — ловит только общий затвор',
      file: FOOTER_FILES,
      hurt: s => s.split(String.fromCharCode(10) + "set-footer '")
                  .join(String.fromCharCode(10) + "set-caption '"),
      expect: /ничего не проверив/,
    },
    {
      // Заведена 08.09.2026. Проверку 59 до этого дня показывали красной РАЗОВОЙ ручной
      // порчей, а в DECISIONS это было записано как «проверена отрицательным прогоном» —
      // читалось как постоянное покрытие, которого не было. Порча ровно того класса,
      // который уже случался: файл с живой карты попадает в репозиторий вместе с ключом,
      // которого движок НЕ ПИШЕТ НИКОГДА, и мы начинаем раздавать чужую настройку как
      // свою. Значение взято настоящее — `mode_labels` живой карты неизданной сборки 4IFIR.
      name: 'в порядок оверлеев попал ключ, которого движок не пишет',
      file: join(ROOT, 'config', 'ultrahand', 'overlays.ini'),
      hurt: s => s.replace(/(priority=2)(\r?\n)/,
                           '$1$2mode_labels=(Mini, Micro, 4Foundry, FPS Graph, FPS Counter, Game Resolutions)$2'),
      expect: /движок не пишет никогда/,
    },
    {
      // Заведена 08.09.2026 — у проверки 7 постоянной пробы не было, и её показывали
      // красной только руками. Порча ровно того класса, против которого она написана:
      // рядом с отказом появляется ВТОРОЕ условие, то есть ключ «выпустить набор первой
      // установки без порядка оверлеев». Отказ при этом остаётся на месте и выглядит целым.
      //
      // ЦЕНА ПОРЧИ ВЫПУСКАЮЩЕГО СКРИПТА НАЗВАНА ВСЛУХ. release.ps1 гейт не запускает —
      // он читает его как ТЕКСТ (проверки 7, 42), поэтому испорченный скрипт за время
      // пробы не выполняется ни разу. Файл возвращается побайтово из буфера в `finally`,
      // BOM переживает это вместе с остальными байтами. Убитый между записью и
      // восстановлением процесс оставит его грязным — как и любую другую пробу;
      // лечится `git checkout -- scripts/release.ps1`.
      name: 'у отказа по порядку оверлеев появилось второе условие — ключ, которого быть не должно',
      file: join(ROOT, 'scripts', 'release.ps1'),
      hurt: s => s.replace('if (-not (Test-Path -LiteralPath $overlaysInStage))',
                           'if (-not (Test-Path -LiteralPath $overlaysInStage) -and -not $SkipOverlayOrder)'),
      expect: /обязан висеть на одном условии/,
    },
    {
      // Check 19, second half: the donor number comes back into the right column of the RAM
      // frequency list and squeezes the row name to "1…" (operator's photo 13.09.2026).
      name: 'частота в строке списка названа дважды — имя слева станет многоточием',
      file: join(DIST, 'advanced', 'ram', 'json', 'ram_mhz_mariko.json'),
      hurt: s => s.split('"1600MHz - SYK-LOH eb1"').join('"1600MHz - 1600 — SYK-LOH eb1"'),
      expect: /названо в строке списка дважды/,
    },
    {
      // Check 62: one table of the Magician page loses engine_feature pages, so the author's
      // engine would draw it (and `!page_flag view` is true there).
      name: 'таблица третьей страницы потеряла engine_feature pages',
      file: join(DIST, 'current.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        const line = '\n;visibility_condition=engine_feature pages'
        const j = s.indexOf(line, s.indexOf('\n[Info]', at))
        return at < 0 || j < 0 ? s : s.slice(0, j) + s.slice(j + line.length)
      },
      expect: /страница Magician сломана — Current[^]*Current, current\.ini: \[Info\]: нет engine_feature pages/,
    },
    {
      // Check 62, paging: the marker loses ;page_view_source, Y is back to one fixed page.
      name: 'маркер третьей страницы потерял ;page_view_source',
      file: join(DIST, 'current.ini'),
      hurt: s => s.split(/\r?\n/).filter(l => !l.startsWith(';page_view_source=')).join('\n'),
      expect: /Y не листает профили/,
    },
    {
      // Check 62, paging: one slot reads a fixed index again and repeats on every page.
      name: 'слот профиля читает секцию мимо {page_view_first}',
      file: join(DIST, 'current.ini'),
      hurt: s => s.split('{ini_file_sorted({math({page_view_first}+1,true)})}').join('{ini_file_sorted(1)}'),
      expect: /мимо \{page_view_first\}/,
    },
    {
      // Check 62, paging: page size in the marker no longer matches the slots.
      name: 'размер страницы в маркере разошёлся с числом слотов',
      file: join(DIST, 'current.ini'),
      hurt: s => s.replace(/^(;page_view_source=[^\r\n]*,)(\d+)/m, (_, a, n) => a + (Number(n) + 1)),
      expect: /слоты не покрывают страницу/,
    },
    {
      // Check 63: the boot line clearing one footer is gone - "saved …" survives the reboot.
      name: 'из [boot] пропала очистка разовой подписи',
      file: join(DIST, 'boot_package.ini'),
      hurt: s => s.split('\n').filter(l => !/^remove-ini-key .*'Create backup\?mariko' footer\r?$/.test(l)).join('\n'),
      expect: /разовая подпись переживёт вход/,
    },
    {
      // Check 63, second half: the chosen backup is no longer reset on entry.
      name: 'из [boot] пропал сброс выбранной копии',
      file: join(DIST, 'boot_package.ini'),
      hurt: s => s.split('\n').filter(l => !/^set-ini-val .* Restore Path ''\r?$/.test(l)).join('\n'),
      expect: /выбор копии переживёт вход/,
    },
    {
      // Check 63, third part: the path of the backup being created is no longer cleared on entry.
      name: 'из [boot] пропала очистка пути создаваемой копии',
      file: join(DIST, 'boot_package.ini'),
      hurt: s => s.split('\n').filter(l => !/^set-ini-val .* Backup Path ''\r?$/.test(l)).join('\n'),
      expect: /путь создаваемой копии переживёт вход/,
    },
    {
      // Check 39 (6): the Erista import hint loses its empty else-branch and prints for every backup.
      name: 'подсказка про режим андервольта печатается для любой копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/(\{if_==\(\{ini_file\(Meta,kipver\)\},imported,[^,']*),\)\}'/, '$1,Imported)}\''),
      expect: /печатается не только для импортированной копии/,
    },
    {
      // Check 39 (6): the hint turns up on Mariko, where the import does carry the mode.
      name: 'подсказка про режим андервольта попала на Mariko',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s + "\n[Info]\n;mode=table\n;polling=true\n''='{if_==({ini_file(Meta,kipver)},imported,Imported: set GPU undervolt mode by hand,)}'\n",
      expect: /подсказка про режим андервольта на Mariko/,
    },
    {
      // Check 39 (6): the hint is gated on the section, which reads a stale choice.
      name: 'подсказка про режим андервольта закрыта условием секции вместо опроса',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => {
        // the table row, not the chooser's `Restore Want` line that carries the same test
        const at = s.indexOf("''='{if_==({ini_file(Meta,kipver)},imported,")
        const head = s.lastIndexOf('[Info]', at)
        const j = s.indexOf(';polling=true', head)
        return at < 0 || head < 0 || j < 0 || j > at ? s
          : s.slice(0, j) + ';visibility_condition=matching_ini_val ./config.ini Restore Path x' + s.slice(j + ';polling=true'.length)
      },
      expect: /не опрашивается или закрыта условием секции/,
    },
    {
      // Check 51: one value declared twice at two hex lengths, `02` and `020000`.
      name: 'одно значение объявлено дважды разной длиной hex',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => {
        const doc = JSON.parse(s)
        doc.fields.find(f => f.offset === 44)?.values.push({ hex: '020000', name: 'Stage3 - Max' })
        return JSON.stringify(doc, null, 2) + '\n'
      },
      expect: /одно значение объявлено дважды/,
    },
    {
      // Check 19: a RAM frequency rounded up instead of truncated (decision 13.09.2026).
      name: 'частота RAM в списке округлена вверх, а не усечена',
      file: join(DIST, 'advanced', 'ram', 'json', 'ram_mhz_mariko.json'),
      hurt: s => s.split('"1900MHz"').join('"1901MHz"'),
      expect: /подпись словаря обещает не то/,
    },
    {
      // Check 64: "restored" is set, but the page is no longer rebuilt after it.
      name: 'после «restored» пропала перестройка страницы',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/\nrefresh-to 'Apply this backup'[^\n]*/, ''),
      expect: /нет перестройки страницы/,
    },
    {
      // Check 64: the backup chooser returns with a plain `back`, the page stays stale.
      name: 'выбор копии возвращается без перестройки',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.split('\nrefresh-return\n').join('\n'),
      expect: /выбор копии возвращается без перестройки/,
    },
    {
      // Check 64: refresh-to names another item, the cursor would jump away.
      name: 'refresh-to ставит курсор на чужой пункт',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.replace("refresh-to 'Apply factory defaults'", "refresh-to 'Choose backup'"),
      expect: /ставит курсор не на свой пункт/,
    },
    {
      // Check 64, Create backup: the "not saved" branch is gone, a failed write says nothing.
      name: 'у Create backup пропал исход «not saved»',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/\ntry:\nset-footer 'not saved'\nrefresh-to 'Create backup'[^\n]*/, ''),
      expect: /без исхода «not saved»/,
    },
    {
      // Check 64, Create backup: "not saved" is set, but the page is not rebuilt after it.
      name: 'после «not saved» пропала перестройка страницы',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/(\nset-footer 'not saved')\nrefresh-to [^\n]*/, '$1'),
      expect: /нет перестройки страницы/,
    },
    {
      // Check 64, Create backup: one field is written but not read back before "saved".
      name: '«saved» не сверяет одно поле копии',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/\nmatching_ini_val \{ini_file\(Backup,Path\)\} Fields 12 [^\n]*/, ''),
      expect: /«saved» не сверяет/,
    },
    {
      // Check 64, Create backup: the null guard is gone, a missing kip still reads as saved.
      name: '«saved» без защиты от нечитаемого kip',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/\n!matching_ini_val \{ini_file\(Backup,Path\)\} Fields \d+ null/, ''),
      expect: /kip не читался/,
    },
    {
      // Check 64, Create backup: the half-written backup is no longer deleted.
      name: 'недописанная копия не удаляется',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/\ndelete \{ini_file\(Backup,Path\)\}/, ''),
      expect: /недописанная копия не удаляется/,
    },
    {
      // Check 64, Create backup: the delete guard no longer pins the path under .bak/<revision>.
      name: 'удаление копии с путём вне .bak',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace("'/atmosphere/kips/.bak/erista/{slice(", "'/atmosphere/kips/{slice("),
      expect: /удаление без доказательства/,
    },
    {
      // Check 64, Create backup: "saved" keeps the path, a later failure could delete a good backup.
      name: 'после «saved» путь копии не забыт',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("\nset-footer 'saved'\nset-ini-val './config.ini' Backup Path ''", "\nset-footer 'saved'"),
      expect: /путь копии не забыт/,
    },
    {
      // Check 65: System Info goes back to the full model while the heading stays short.
      name: 'System Info Model не по правилу шапки RAM',
      file: join(DIST, 'service', 'package.ini'),
      hurt: s => s.replace(/^'Model'='.*'$/m, "'Model'='{ram_model}'"),
      expect: /System Info Model не по правилу/,
    },
    {
      // Check 65: a copy of the rule that drifted - the passport takes the model's space token.
      name: 'паспорт Memory сокращает не по правилу шапки RAM',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split('{split({list(0)}," ",2)}').join('{split({list(0)}," ",1)}'),
      expect: /паспорт Memory не по правилу/,
    },
    {
      // Check 65: without the list line the row would read the backup file per substitution.
      name: 'паспорт Memory читает Meta ram не через list',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace("list '[{ini_file(Meta,ram)}]'\n", '').split('{list(0)}').join('{ini_file(Meta,ram)}'),
      expect: /не читает Meta ram один раз/,
    },
    {
      // Check 62, backup manager: a page-3 table loses engine_feature pages.
      name: 'таблица страницы Magician в менеджере копий потеряла engine_feature pages',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        const line = '\n;visibility_condition=engine_feature pages'
        const j = s.indexOf(line, s.indexOf('\n[Info]', at))
        return at < 0 || j < 0 ? s : s.slice(0, j) + s.slice(j + line.length)
      },
      expect: /restore-mariko\.ini: \[Info\]: нет engine_feature pages/,
    },
    {
      // Check 62, backup manager: page 3 reads the kip instead of the chosen backup.
      name: 'страница Magician в менеджере копий читает kip',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        const line = "\nini_file '/config/4IFIR/emc_timings.ini'"
        const j = s.indexOf(line, at)
        return at < 0 || j < 0 ? s : s.slice(0, j) + "\nhex_file '/atmosphere/kips/loader.kip'" + s.slice(j)
      },
      expect: /на странице копии есть hex_file/,
    },
    {
      // Check 62, backup manager: page 3 is gone from one revision.
      name: 'у менеджера копий Erista пропала страница Magician',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace('\n[@Magician]\n', '\n[Magician]\n'),
      expect: /restore-erista\.ini нет маркера \[@Magician\]/,
    },
    {
      // Check 62, revision offset: the Erista backup page reads the Mariko clock (Fields 32).
      name: 'страница Magician копии Erista читает частоту Mariko',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split('{ini_file(Fields,24)}').join('{ini_file(Fields,32)}') },
      expect: /страница Magician сломана — Backup manager Erista[^]*читает Fields 32,12352,12492,12524 вместо 24,12352,12492,12524/,
    },
    {
      // Check 62, revision offset: E-Boost read from a wrong offset on the Mariko backup page.
      name: 'страница Magician копии Mariko читает E-Boost мимо 12492',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split('{ini_file(Fields,12492)}').join('{ini_file(Fields,12493)}') },
      expect: /Backup manager Mariko, service\/restore-mariko\.ini: \[\w+\]: читает Fields 32,12352,12493/,
    },
    {
      // Check 62, revision offset: Current's Mariko tables read the Erista clock (CUST 24).
      name: 'Current Mariko на третьей странице читает частоту Erista',
      file: join(DIST, 'current.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split(/\n(?=\[)/).map(x => x.includes(';system=mariko') ? x.split('hex_file(CUST,32,').join('hex_file(CUST,24,').split(' CUST 32 ').join(' CUST 24 ') : x).join('\n') },
      expect: /страница Magician сломана — Current[^]*\(;system=mariko\): читает CUST 24/,
    },
    {
      // Check 62, blind: Current loses ;system=erista on page 3, no Erista table is left to compare.
      name: 'у третьей страницы Current пропали таблицы Erista',
      file: join(DIST, 'current.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split(/\r?\n/).filter(l => l.trim() !== ';system=erista').join('\n') },
      expect: /;system=erista не читает kip — сверка смещений ослепла/,
    },
    {
      // Check 62, binding: one backup header no longer binds the chosen backup, Fields read config.ini.
      name: 'таблица страницы Magician копии потеряла привязку к копии',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        const j = s.indexOf("\nini_file '{ini_file(Restore,Path)}'", s.indexOf('\n[Header]', at))
        return at < 0 || j < 0 ? s : s.slice(0, j) + s.slice(j + "\nini_file '{ini_file(Restore,Path)}'".length)
      },
      expect: /Backup manager Mariko, service\/restore-mariko\.ini: \[Header\]: не привязана к выбранной копии/,
    },
    {
      // Check 62, binding: one backup table loses the rebind to emc_timings.ini, timings read the backup.
      name: 'таблица страницы Magician копии читает тайминги из копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        const line = "\nini_file '/config/4IFIR/emc_timings.ini'"
        const j = s.indexOf(line, s.indexOf('\n[Info]', at))
        return at < 0 || j < 0 ? s : s.slice(0, j) + s.slice(j + line.length)
      },
      expect: /Backup manager Erista, service\/restore-erista\.ini: \[Info\], строка \d+: тайминги читаются до перепривязки/,
    },
    {
      // Check 62, blind: the backup page's current view no longer reads anything at all.
      name: 'таблицы страницы Magician копии перестали читать файлы',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => {
        const at = s.indexOf('[@Magician]')
        if (at < 0) return s
        return s.slice(0, at) + s.slice(at).split(/\n(?=\[)/).map(x => !x.includes('\n;visibility_condition=!page_flag view') ? x
          : x.split('\n').filter(l => !/^(ini_file|list) /.test(l) && !/\{(ini_file|list)\(/.test(l)).join('\n')).join('\n')
      },
      expect: /Backup manager Erista[^]*не читает копию — сверка привязки и смещений ослепла/,
    },
    {
      // Check 62, hint: the current view of Current loses the Y glyph.
      name: 'подсказка вида «текущие» в Current без глифа Y',
      file: join(DIST, 'current.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split(/\n(?=\[)/).map(x => x.includes('\n;visibility_condition=!page_flag view\n') ? x.split('\uE0E3').join('Y') : x).join('\n') },
      expect: /Current, current\.ini: вид «текущие»: нет подсказки с глифами/,
    },
    {
      // Check 62, hint: the profiles view of the Erista backup page loses the A glyph.
      name: 'подсказка вида профилей копии Erista без глифа A',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); return at < 0 ? s : s.slice(0, at) + s.slice(at).split(/\n(?=\[)/).map(x => x.includes('\n;visibility_condition=page_flag view\n') ? x.split('\uE0E0').join('A') : x).join('\n') },
      expect: /Backup manager Erista, service\/restore-erista\.ini: вид «все профили»: нет подсказки с глифами/,
    },
    {
      // Check 62, hint: the old letter hint comes back next to the new one on the Mariko backup page.
      name: 'старая подсказка «A MC» вернулась на страницу копии Mariko',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => { const at = s.indexOf('\n[Note]', s.indexOf('[@Magician]')); return at < 0 ? s : s.slice(0, at) + "\n[Note]\n;mode=table\n;visibility_condition=engine_feature pages\n;visibility_condition=!page_flag view\n''='A MC off · Y profiles'\n" + s.slice(at) },
      expect: /Backup manager Mariko, service\/restore-mariko\.ini: осталась старая подсказка «A MC»/,
    },
    {
      // Check 39 (7): Apply slides onto page 2.
      name: 'кнопка Apply уехала за маркер второй страницы',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace('\n[@Page 2]\n', '\n').replace('\n[Apply this backup', '\n[@Page 2]\n\n[Apply this backup'),
      expect: /кнопка уехала со страницы 1/,
    },
    {
      // Check 39 (8) and 28, the photo of 14.09.2026: the manual table of a backup loses its mode gate.
      name: 'ручная таблица GPU копии Mariko видна при любом режиме',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split(/\n(?=\[)/).map(x => x.includes(',030000,y,null)}') ? x.split('\n;skip_null=true').join('') : x).join('\n'),
      expect: /при Fields 44 = 0[0-2]0000 на второй странице видно таблиц GPU 2/,
    },
    {
      // Check 39 (8): ST1 variant reads a table the backup does not carry, from the backup.
      name: 'вариант ST1 копии читает из файла копии таблицу, которой там нет',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/hex_file\(CUST,7160,4\)/, 'ini_file(Fields,7160)'),
      expect: /при Fields 44 = 000000 «307MHz» читает copy 7160, а нужно kip 7160/,
    },
    {
      // Check 39 (8): the Erista backup page grows a Mariko top curve point.
      name: 'вторая страница копии Erista показывает верхнюю точку кривой Mariko',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace("\n'192MHz' = ", "\n'1228MHz' = '{if_==({ini_file(Fields,184)},null,—,{hex_to_decimal({hex_to_rhex({ini_file(Fields,184)})})} mV)}'\n'192MHz' = "),
      expect: /вторая страница Erista читает точку кривой Mariko 184/,
    },
    {
      // Check 58 (3), the photo of 22.09.2026: the reset page prints the manual array again,
      // top seven cells as "not a voltage", while the factory mode 00 shows ST1 in Current.
      name: 'сброс снова печатает ручную таблицу GPU Mariko с «not a voltage»',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.replace(/hex_file '\/atmosphere\/kips\/loader\.kip'\njson_file '\.\/\.\.\/json\/dvfs_uv\.map\.json'\n((?:'[^']*' = '\{if_null\(\{json_file\(0,\{hex_file\(CUST,\d+,4\)\}\)\},—\)\}'\n)+)/,
        (_, rows) => rows.trim().split('\n').map((l, i) => {
          const lab = l.match(/^'([^']*)'/)[1], o = 88 + 4 * i
          return i < 24 ? `'${lab}' = '{if_==({ini_file(Fields,${o})},null,—,{hex_to_decimal({hex_to_rhex({ini_file(Fields,${o})})})} mV)}'`
                        : `'${lab}' = '{ini_file(Fields,${o})} - not a voltage'`
        }).join('\n') + '\n'),
      expect: /строки «not a voltage» при заводском Fields 44 = 00/,
    },
    {
      // Check 58 (3): the reset page shows another mode's table (the working slot, mode 01).
      name: 'сброс показывает таблицу GPU чужого режима',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.replace('{hex_file(CUST,7160,4)}', '{hex_file(CUST,8896,4)}'),
      expect: /«307MHz» читает kip 8896, а Current при Fields 44 = 00 показывает 7160/,
    },
    {
      // Check 39 (8): a variant label drifts away from Current.
      name: 'подпись таблицы GPU копии разошлась с Current',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/\n'1420MHz' = '\{if_null\(\{list\(0\)\},null,\{if_==/, "\n'1459MHz' = '{if_null({list(0)},null,{if_=="),
      expect: /при Fields 44 = 030000 подписи таблицы GPU расходятся с Current/,
    },
    {
      // Check 39 (8): a variant title loses the backup gate but keeps skip_null and the list.
      name: 'заголовок варианта таблицы GPU копии без затвора',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("\n'GPU Voltage Table' = '{if_null({list(0)},null,)}'", "\n'GPU Voltage Table' = ''"),
      expect: /Fields 44 = 000000: строка «GPU Voltage Table» секции \[Header\] без затвора из копии/,
    },
    {
      // Check 39 (8): a variant indent loses the backup gate but keeps skip_null and the list.
      name: 'отступ варианта таблицы GPU копии без затвора',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("\n'{if_null({list(0)},null,)}'=''\n;gap=6\n\n[Header]", "\n''=''\n;gap=6\n\n[Header]"),
      expect: /Fields 44 = 000000: строка «» секции \[Gap\] без затвора из копии/,
    },
    {
      // Check 62, Optimized Target: the E block goes back to a hard-coded 1600 profile, which on
      // a console left at Target 0 is a profile the firmware never writes.
      name: 'блок E на Current собран литералом 1600CL',
      file: join(DIST, 'current.ini'),
      hurt: s => s.split('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL').join('1600CL'),
      expect: /Current, current\.ini: секция блока E собрана литералом 1600/,
    },
    {
      // Check 62, Optimized Target: the same on the backup page, where the target comes from the copy.
      name: 'блок E на странице копии собран литералом 1600CL',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split('{list(5)}CL{list(3)}').join('1600CL{list(3)}'),
      expect: /Backup manager Mariko, service\/restore-mariko\.ini: секция блока E собрана литералом 1600/,
    },
    {
      // Check 62: a voltage row comes back into the timings table, where the operator said it
      // does not belong — and where `Auto` and `eBAMATIC` would then sit side by side.
      name: 'строка VDDQ вернулась в таблицу таймингов Magician',
      file: join(DIST, 'current.ini'),
      hurt: s => { const at = s.indexOf('[@Magician]'); const j = s.indexOf("\n'RP' = '", at); return at < 0 || j < 0 ? s : s.slice(0, j) + "\n'VDDQ' = 'x'" + s.slice(j) },
      expect: /Current, current\.ini: в таблице таймингов стоит строка «VDDQ»/,
    },
    {
      // Check 66: the Optimized block loses a voltage row, and the value can be set but not seen.
      name: 'из блока Optimized Mode пропала строка VDD2',
      file: join(DIST, 'current.ini'),
      hurt: s => s.split('\n').filter(l => !l.startsWith("'VDD2' = '")).join('\n'),
      expect: /current\.ini: блок Optimized Mode идёт «[^»]*» вместо «Optimized Target · VDDQ · VDD2/,
    },
    {
      // Check 66: the order the operator set is permuted — the two voltages slide to the end.
      name: 'порядок строк блока Optimized Mode переставлен',
      file: join(DIST, 'current.ini'),
      hurt: s => {
        const ls = s.split('\n')
        const i = ls.findIndex(l => l.startsWith("'VDDQ' = '"))
        const j = ls.findIndex(l => l.startsWith("'Efficiency Stages' = '"))
        if (i < 0 || j < 0 || j < i) return s
        const moved = ls.splice(i, 2)
        ls.splice(ls.findIndex(l => l.startsWith("'Efficiency Stages' = '")) + 1, 0, ...moved)
        return ls.join('\n')
      },
      expect: /current\.ini: блок Optimized Mode идёт «Optimized Target · VDDQ-VDD2 Voltage/,
    },
    {
      // Check 66: the block names a zero `Auto` while the menu item calls it eBAMATIC — one
      // value, two names on two screens (operator's decision 20.09.2026).
      name: 'строка VDD2 блока Optimized Mode зовёт ноль Auto',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.split('\n').map(l => l.startsWith("'VDD2' = '") ? l.split('eBAMATIC').join('Auto') : l).join('\n'),
      expect: /restore-erista\.ini: строка «VDD2» не зовёт ноль eBAMATIC/,
    },
    {
      // Check 66: the block addresses a literal profile again — wrong on a console at Target 0.
      name: 'блок Optimized Mode копии собран литералом 1600CL',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split('{if_==({list(3)},2.5,{math({list(2)}/1000,true)},{list(0)})}CL{math({list(1)}*2+8,true)}').join('1600CL12'),
      expect: /restore-mariko\.ini: имя профиля в блоке Optimized Mode несёт литерал частоты/,
    },
    {
      // Check 68: Apply writes a backup's [Optimized] into emc_timings.ini again (22.09.2026: never).
      name: 'применение копии пишет в emc_timings.ini',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("Meta kipver 27\nini_file '{ini_file(Restore,Path)}'\n", "Meta kipver 27\nini_file '{ini_file(Restore,Path)}'\nset-ini-val '/config/4IFIR/emc_timings.ini' '1600CL12' eVDQ '{ini_file(Optimized,eVDQ)}'\n"),
      expect: /restore-mariko\.ini «Apply» \(2\.6: копия 21–22\.09 с \[Optimized\] 650\/1100 и пометкой 2\.5\): применение копии изменило emc_timings\.ini/,
    },
    {
      // Check 68 (operator, 22.09.2026, rejected option): page 2 shows a 21-22.09 backup's own
      // [Optimized] "for reference" - it reads as what Apply will write, and Apply writes nothing.
      name: 'страница 2 показывает напряжения из копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.split("ini_file '/config/4IFIR/emc_timings.ini'\n'VDDQ' = '{if_null({list(0)},null,{if_==({list(1)},0,null,{if_null({ini_file({list(2)},eVDQ)},eBAMATIC,{if_==({ini_file({list(2)},eVDQ)},0,eBAMATIC,{ini_file({list(2)},eVDQ)} mV)})})})}'").join("'VDDQ' = '{if_null({ini_file(Optimized,eVDQ)},eBAMATIC,{ini_file(Optimized,eVDQ)} mV)}'"),
      expect: /restore-erista\.ini стр\. 2 \(2\.6: копия 21–22\.09 с \[Optimized\] 650\/1100[^)]*\): VDDQ\/VDD2 = «650 mV»/,
    },
    {
      // Check 68: Create writes the [Optimized] section again (operator, 22.09.2026: "we do not put them in").
      name: 'копия снова пишет [Optimized]',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace("set-ini-val '{ini_file(Backup,Path)}' Meta fields ", "set-ini-val '{ini_file(Backup,Path)}' Optimized eVDQ '0'\nset-ini-val '{ini_file(Backup,Path)}' Meta fields "),
      expect: /restore-erista\.ini «Create backup»: копия снова пишет секцию \[Optimized\]/,
    },
    {
      // Check 68: the caveat goes back to older backups only - a 21-22.09 backup with [Optimized] shows this
      // console's values without saying so.
      name: 'строка «not the backup» не у всех копий',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.split('{if_==({list(1)},0,null,VDDQ/VDD2: this console - not the backup)}').join('{if_==({list(1)},0,null,{if_null({ini_file(Optimized,eVDQ)},VDDQ/VDD2: this console - not the backup,null)})}'),
      expect: /restore-erista\.ini стр\. 2 \(2\.6: копия 21–22\.09 с \[Optimized\][^)]*\): оговорка «this console - not the backup» не видна/,
    },
    {
      // Check 66 and 68: the reset zeroes keys that are not there and creates the file.
      name: 'сброс создал файл',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('\n').filter(l => !l.startsWith("!matching_ini_val '/config/4IFIR/emc_timings.ini' ")).join('\n'),
      expect: /reset\.ini mariko \(2\.6: нет файла, eBAL 2\)[^\n]*сброс создал файл/,
    },
    {
      // Check 66: the backup page loses the line that says the two voltages are this console's.
      name: 'у блока Optimized Mode копии пропала оговорка про эту консоль',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split('VDDQ/VDD2: this console - not the backup').join('VDDQ and VDD2'),
      expect: /restore-mariko\.ini: у блока Optimized Mode нет оговорки/,
    },
    {
      // Check 21: the copy page loses the rebind back to the backup after the VDD2 row, and the
      // two rows below it ask emc_timings.ini for [Fields]. Reproduced 20.09.2026 — the whole
      // gate stayed green on it before check 21 started tracking the binding itself.
      name: 'блок Optimized Mode копии не вернул привязку к копии после VDD2',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => {
        const i = s.indexOf("'VDD2' = '{if_null({list(0)}")
        if (i < 0) return s
        const eol = s.indexOf('\n', i) + 1
        const drop = "ini_file './config.ini'\nini_file '{ini_file(Restore,Path)}'\n"
        return s.slice(eol, eol + drop.length) === drop ? s.slice(0, eol) + s.slice(eol + drop.length) : s
      },
      expect: /«'VDDQ-VDD2 Voltage'[^»]*» спрашивает \[Fields\], а привязка на этой строке — к \/config\/4IFIR\/emc_timings\.ini/,
    },
    {
      // Check 21: the same block binds emc_timings.ini one line too early, and `Optimized Target`
      // — with both `list` lines that name the profile — reads [Fields] out of the wrong file.
      // The caveat below keeps standing, so the screen contradicts itself. Reproduced 20.09.2026.
      name: 'привязка к emc_timings.ini поднята выше Optimized Target',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => {
        const tim = "ini_file '/config/4IFIR/emc_timings.ini'\n"
        const tgt = "'Optimized Target' = '{json_file(0,{ini_file(Fields,12524)})}'"
        const at = s.indexOf("'Optimized Mode ({list(0)} MHz)' = ''")
        const i = at < 0 ? -1 : s.indexOf(tim, at)
        if (i < 0) return s
        const cut = s.slice(0, i) + s.slice(i + tim.length)
        const j = cut.indexOf(tgt, at)
        return j < 0 ? s : cut.slice(0, j) + tim + cut.slice(j)
      },
      expect: /«'Optimized Target'[^»]*» спрашивает \[Fields\], а привязка на этой строке — к \/config\/4IFIR\/emc_timings\.ini/,
    },
    {
      // Check 66: the rows go and the caveat explaining them stays — the screen says the
      // voltages are this console's while showing none.
      name: 'оговорка блока Optimized Mode осталась без строк напряжений',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.split('\n').filter(l => !/^'VDDQ' = '\{if_null/.test(l) && !/^'VDD2' = '\{if_null/.test(l)).join('\n'),
      expect: /restore-erista\.ini: оговорка «VDDQ\/VDD2: this console - not the backup» стоит без строк напряжений/,
    },
    {
      // Check 66: the factory-reset page loses the two rows, so the screen stops naming half of
      // what the button will write (operator's decision reversed 20.09.2026).
      name: 'со страницы сброса пропали строки напряжений',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('\n').filter(l => l !== "'VDDQ' = 'eBAMATIC'" && l !== "'VDD2' = 'eBAMATIC'").join('\n'),
      expect: /reset\.ini: блок Optimized Mode идёт «[^»]*» вместо «Optimized Target · VDDQ · VDD2/,
    },
    {
      // Check 66: the reset page starts reading the live file instead of naming what it writes —
      // the screen answers a different question than the button.
      name: 'страница сброса показывает нынешнее напряжение вместо eBAMATIC',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split("'VDDQ' = 'eBAMATIC'").join("'VDDQ' = '{ini_file(1600CL12,eVDQ)} mV'"),
      expect: /reset\.ini: строка «VDDQ» на странице сброса это «[^»]*» — она обязана печатать ровно eBAMATIC/,
    },
    {
      // Check 66: the reset stops putting the keys back, and the page keeps promising it does.
      name: 'сброс перестал возвращать напряжения в eBAMATIC',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('\n').filter(l => !/^set-ini-val '\/config\/4IFIR\/emc_timings\.ini'.* eVDQ '0'$/.test(l)).join('\n'),
      expect: /«Apply factory defaults[^»]*»: сброс не возвращает eVDQ в eBAMATIC/,
    },
    {
      // Check 66: the zero write slides below the kip writes. By then eBAL is 000000, the profile
      // name degrades to CL8 and the zero lands in a section the firmware never reads. Nothing
      // on the screen changes, and the kip is written correctly — the defect is invisible.
      name: 'запись нулей сброса стоит после правки eBAL',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => {
        const ls = s.split('\n')
        const i = ls.findIndex(l => /^set-ini-val '\/config\/4IFIR\/emc_timings\.ini'.* eVD2 '0'$/.test(l))
        const j = ls.findIndex(l => l.startsWith("set-footer 'restored'"))
        if (i < 0 || j < 0) return s
        const [moved] = ls.splice(i, 1)
        ls.splice(ls.findIndex(l => l.startsWith("set-footer 'restored'")), 0, moved)
        return ls.join('\n')
      },
      expect: /«Apply factory defaults[^»]*»: запись eVD2 стоит ПОСЛЕ правки kip/,
    },
    {
      // Check 66: the gate goes, and a console already on eBAMATIC eBAL gets a junk `<base>CL8`
      // section written into a file we do not own.
      name: 'запись нулей сброса перестала быть под затвором eBAL',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('\n').filter(l => l !== '!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000').join('\n'),
      expect: /«Apply factory defaults[^»]*»: запись нулей не закрыта затвором/,
    },
    {
      // Check 66: force_failure goes, and the SECOND `try:` meets a successful branch — the
      // engine drops every remaining command (fork, `interpretAndExecuteCommands`). The reset
      // would then write the two zeros and nothing else, silently, on every console whose eBAL
      // is set by hand: the button reports success and the kip is untouched.
      name: 'после записи нулей сброса пропал force_failure',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('\n').filter((l, i, a) => l !== 'force_failure' || i !== a.indexOf('force_failure')).join('\n'),
      expect: /«Apply factory defaults[^»]*»: после записи нулей нет force_failure/,
    },
    {
      // Check 66, вторая половина той же конструкции: `force_failure` на месте, а второй
      // `try:` убран. Флаг отказа поднять некому, и движок молча пропускает весь хвост
      // секции (форк, `source/utils.hpp:4377`) — сброс запишет два нуля и не тронет kip.
      // До 20.09.2026 эта порча проходила гейт зелёным: требовался только `force_failure`.
      name: 'после force_failure пропал второй try:',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('force_failure\ntry:\n').join('force_failure\n'),
      expect: /«Apply factory defaults[^»]*»: после force_failure нет второго «try:»/,
    },
    {
      // Check 66: лишний `try:` встречает уже удавшуюся ветвь, и движок обрывает секцию
      // целиком (`commands = {}; return true`, форк `source/utils.hpp:4344`). На экране —
      // тот же отчёт об успехе, в kip — ничего.
      name: 'в секции сброса появился третий try:',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('force_failure\ntry:\n').join('force_failure\ntry:\ntry:\n'),
      expect: /«Apply factory defaults[^»]*»: «try:» в секции \d+, а их обязано быть 5/,
    },
    {
      // Check 66: the label promises one voltage and the item writes another — the very class
      // check 19 catches for kip items, which cannot see an ini write.
      name: 'подпись напряжения Magician обещает не то, что запишет',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'json', 'emc_evdq.json'),
      hurt: s => s.split('"mv": "650"').join('"mv": "655"'),
      expect: /строка «650 mV» запишет 655/,
    },
    {
      // Check 66: the item writes into a hard-coded profile instead of the one the kip names.
      name: 'пункт напряжения Magician пишет в литеральный профиль',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,12352,3)})})}*2+8,true)}').join('1600CL12'),
      expect: /имя профиля несёт литерал/,
    },
    {
      // Check 66: the way back to automatic stops writing a zero, so it stops being a way back.
      name: 'пункт eBAMATIC перестал писать ноль',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'json', 'emc_evd2.json'),
      hurt: s => s.split('"mv": "0"').join('"mv": "5"'),
      expect: /возврат в автоматику это eBAMATIC = 0/,
    },
    {
      // Check 66: the footer written on entry names the zero differently from the list, and the
      // open list loses its checkmark — check 53 cannot see it, there is no .map.json here.
      name: 'подпись напряжения Magician зовёт ноль Auto, а список eBAMATIC',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split('\n').map(l => l.includes("'*VDDQ' footer") ? l.split('eBAMATIC').join('Auto') : l).join('\n'),
      expect: /подпись не зовёт ноль eBAMATIC/,
    },
    {
      // Check 66: the item stays visible on eBAMATIC eBAL, where the profile name cannot be built
      // at all — the write would go into a section no Magician ever reads.
      name: 'пункт напряжения Magician виден при eBAL = eBAMATIC',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('\n').filter(l => l.trim() !== ';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000').join('\n'),
      expect: /виден при eBAL = eBAMATIC/,
    },
    {
      // Check 66: every hint's eBAL condition is flipped — hints show next to working items and are gone
      // exactly when the items are hidden.
      name: 'подсказка «Set EMC Balance» показывается по условию пунктов',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split(';visibility_condition=matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000').join(';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000'),
      expect: /\(2\.6\/mariko\/eBAL 0\/частота 2265\): видно подсказок 0 — «—», а ждали «Set EMC Balance to use VDDQ\/VDD2»/,
    },
    {
      // Check 66: the 2.6 hint is gone — on eBAMATIC eBAL the items vanish without a word.
      name: 'подсказка «Set EMC Balance» пропала',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.replace(/\[Not in use\][\s\S]*?\n\n/, ''),
      expect: /\(2\.6\/mariko\/eBAL 0\/частота 2265\): видно подсказок 0 — «—», а ждали «Set EMC Balance to use VDDQ\/VDD2»/,
    },
    {
      // Check 66: the hint's indent goes back to 10 and the text sits against the frame.
      name: 'подсказка «Set EMC Balance» прижата к рамке',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split(';offset=13').join(';offset=10'),
      expect: /подсказка с ;offset=10 — текст прижат к рамке/,
    },
    {
      // Check 68: the caveat loses its start gap and lands on the frame of the table above.
      name: 'оговорка «this console» налезает на рамку',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.split(';start_gap=36').join(''),
      expect: /restore-mariko\.ini стр\. 2: оговорка «this console - not the backup» с start_gap 20/,
    },
    {
      // Check 66: the items lose their gate while the hint stays — the page says "set the
      // balance" next to items that are right there.
      name: 'пункты VDDQ/VDD2 без условия, подсказка на месте',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('\n').filter(l => l.trim() !== ';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000').join('\n'),
      expect: /\(2\.5\/mariko\/eBAL 0\/частота 2265\): пунктов eVDQ видно 1, а ждали 0/,
    },
    {
      // Check 67: the 03.09.2026 slide, on a list that still offers eBAMATIC (Boost Clock).
      name: 'eBAMATIC уехал вниз в списке Boost Clock',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_boost.json'),
      hurt: s => { const l = JSON.parse(s); const i = l.findIndex(e => e.short === 'eBAMATIC'); return JSON.stringify([...l.slice(0, i), ...l.slice(i + 1), l[i]], null, 2) },
      expect: /eBAMATIC не первым/,
    },
    {
      // Check 69: the import writes the old pMeh 17 again - the value lands in WL-Set.
      name: 'импорт старой копии снова пишет 12432',
      file: join(DIST, 'service', 'package.ini'),
      hurt: s => s.replace(/(set-ini-val '\{ini_file\(Import,Path\)\}' Meta fields '\d+'\n)/, "$1set-ini-val '{ini_file(Import,Path)}' Fields 12432 '03'\n"),
      expect: /пишет Fields 12432/,
    },
    {
      // Check 69: restore of an imported copy writes WL-Set and DBI from its Fields.
      name: 'восстановление импортированной копии пишет WL-Set и DBI',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("set-footer 'restored (import)'", 'hex-by-custom-offset /atmosphere/kips/loader.kip CUST 12432 {ini_file(Fields,12432)}\nhex-by-custom-offset /atmosphere/kips/loader.kip CUST 12528 {ini_file(Fields,12528)}\n' + "set-footer 'restored (import)'"),
      expect: /импортированная копия не должна его трогать/,
    },
    {
      // Check 15: the imported block writes a field the converter never puts into a copy -
      // safe today only because the engine skips a `null` value (NOTES №349).
      name: 'восстановление импортированной копии пишет поле, которого конвертер не кладёт',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("Meta kipver imported\nini_file '{ini_file(Restore,Path)}'\n", "Meta kipver imported\nini_file '{ini_file(Restore,Path)}'\nhex-by-custom-offset /atmosphere/kips/loader.kip CUST 8 {ini_file(Fields,8)}\n"),
      expect: /mariko: блок импортированных копий пишет то, чего конвертер не кладёт — 8/,
    },
    {
      // Check 69: the isKefir row reads the copy again - its dash rests on an absent key.
      name: 'строка isKefir без явного прочерка у импортированной копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/^'pMeh 22 isKefir' = .*$/m, "'pMeh 22 isKefir' = '{json_file(0,{ini_file(Fields,12452)})}'"),
      expect: /restore-erista\.ini: строка «pMeh 22 isKefir» читает Fields 12452/,
    },
    {
      // Check 69: our own copy stops restoring DBI.
      name: 'своя копия перестала восстанавливать DBI',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace('hex-by-custom-offset /atmosphere/kips/loader.kip CUST 12528 {ini_file(Fields,12528)}\n', ''),
      expect: /DBI \(12528\) стал/,
    },
    {
      // Check 69: the DBI/WL-Set note loses its start gap and lands on the frame of the table above.
      name: 'пометка «DBI/WL-Set» налезает на рамку',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/;start_gap=36\n(;gap=16\n;skip_null=true\nini_file '\.\/config\.ini'\nini_file '\{ini_file\(Restore,Path\)\}'\n''='\{if_==\(\{ini_file\(Meta,kipver\)\},imported,DBI)/, '$1'),
      expect: /restore-erista\.ini стр\. 2: пометка «DBI\/WL-Set: not carried over from an old backup» с start_gap 20/,
    },
    {
      // Check 69: the note loses its null branch and shows under every backup.
      name: 'пометка про DBI/WL-Set видна у своей копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace('not carried over from an old backup,null)}', 'not carried over from an old backup,DBI/WL-Set: not carried over from an old backup)}'),
      expect: /не нужна — это своя копия/,
    },
    {
      // Check 69: page 2 reads WL-Set straight from Fields again - an old import shows its DBI as WL-Set.
      name: 'страница 2 показывает старый DBI как WL-Set',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace(/^'pMeh 17 WL-Set' = .*$/m, "'pMeh 17 WL-Set' = '{json_file(0,{ini_file(Fields,12432)})}'"),
      expect: /WL-Set\/DBI показаны/,
    },
    {
      // Check 69: the DBI row loses its kipver condition - a valid DBI of an imported copy shows.
      name: 'страница 2 показывает DBI импортированной копии',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace(/^'sMeh 17 DBI' = .*$/m, "'sMeh 17 DBI' = '{json_file(0,{ini_file(Fields,12528)})}'"),
      expect: /импорт с валидным 12528 = 02\): WL-Set\/DBI показаны «—\/2»/,
    },
    {
      // Check 66: the Optimized heading goes back to a literal base - wrong at Target 0.
      name: 'заголовок Optimized Mode снова с литералом 1600',
      file: join(DIST, 'service', 'restore-mariko.ini'),
      hurt: s => s.replace("'Optimized Mode ({list(0)} MHz)' = ''", "'Optimized Mode (1600 MHz)' = ''"),
      expect: /restore-mariko\.ini: заголовок «'Optimized Mode \(1600 MHz\)' = ''» несёт литерал базы/,
    },
    {
      // Check 66: Current's heading reads the base from a backup's Fields instead of the kip.
      name: 'заголовок Optimized Mode в Current читает не kip',
      file: join(DIST, 'current.ini'),
      hurt: s => s.replace(/^list '\[\{if_null\(\{hex_file\(CUST,12524,1\)\},—,\{if_==\(\{hex_file\(CUST,12524,1\)\},01,1600,1331\)\}\)\}\]'$/m,
                           "list '[{if_null({ini_file(Fields,12524)},—,{if_==({ini_file(Fields,12524)},01,1600,1331)})}]'"),
      expect: /current\.ini: заголовок блока Optimized Mode не берёт базу из \{hex_file\(CUST,12524,1\)\}/,
    },
    {
      // Check 68: the heading swaps the two bases - a backup at Target 0 is titled 1600.
      name: 'заголовок Optimized Mode копии путает 1600 и 1331',
      file: join(DIST, 'service', 'restore-erista.ini'),
      hurt: s => s.replace("{if_==({ini_file(Fields,12524)},01,1600,1331)})}]'\n'Optimized Mode", "{if_==({ini_file(Fields,12524)},00,1600,1331)})}]'\n'Optimized Mode"),
      expect: /restore-erista\.ini стр\. 2 \(2\.6: копия с Target 0\): заголовок блока «Optimized Mode \(1600 MHz\)», а ждали «Optimized Mode \(1331 MHz\)»/,
    },
    {
      // Check 70: the reset baseline gets zero for field 48 - reset would write eBAMATIC.
      name: 'эталон сброса пишет 0 в поле 48',
      file: join(ROOT, 'package', 'factory-defaults.json'),
      hurt: s => s.replace('"48": "030000"', '"48": "000000"'),
      expect: /factory-defaults\.json: заводское поля 48 = 000000/,
    },
    {
      // Check 70: Default.ini alone drifts to zero.
      name: 'Default.ini пишет 0 в поле 48',
      file: join(DIST, 'service', 'Default.ini'),
      hurt: s => s.replace(/^48=030000$/m, '48=000000'),
      expect: /service\/Default\.ini: заводское поля 48 = 000000/,
    },
    {
      // Check 70: the donor's second mark comes back - check 24 lets this through.
      name: 'вторая метка Default у 620 мВ в карте поля 48',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => { const d = JSON.parse(s); const v = d.fields.find(x => x.offset === 48).values.find(x => x.name === '620mV'); v.name = '620mV - Default'; return JSON.stringify(d, null, 2) + String.fromCharCode(10) },
      expect: /fields\.json: «Default» у поля 48 стоит на/,
    },
    {
      // Check 70: Default slides to another step in the list on screen.
      name: 'Default у Eco ST2 в списке CPU Min Voltage',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.json'),
      hurt: s => { const l = JSON.parse(s); l.find(e => e.hex === '030000').name = 'Eco ST1'; l.find(e => e.hex === '020000').name += ' - Default'; return JSON.stringify(l, null, 2) },
      expect: /cpu_vmin\.json: «Default» у поля 48 стоит на «Eco ST2/,
    },
    {
      // Check 70: zero is offered again, first, as before 21.09.2026.
      name: 'ноль вернулся в список CPU Min Voltage',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.json'),
      hurt: s => JSON.stringify([{ name: 'eBAMATIC - Auto', short: 'eBAMATIC', hex: '000000' }, ...JSON.parse(s)], null, 2),
      expect: /ноль в списке выбора/,
    },
    {
      // Check 70: the map loses not_in_menu - the next generate puts zero back in the list.
      name: 'ноль поля 48 снова предлагается в карте',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => { const d = JSON.parse(s); delete d.fields.find(x => x.offset === 48).values.find(v => v.hex === '000000').not_in_menu; return JSON.stringify(d, null, 2) + String.fromCharCode(10) },
      expect: /ноль поля 48 .* предлагается в меню/,
    },
    {
      // Check 70: Current and backups name zero something other than 0 - Unknown.
      name: 'подпись нуля поля 48 не «0 - Unknown»',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.map.json'),
      hurt: s => s.replace('"000000": "0 - Unknown"', '"000000": "eBAMATIC"'),
      expect: /cpu_vmin\.map\.json: 000000 названо «eBAMATIC»/,
    },
    {
      // Check 70: the subject vanishes - the list is empty.
      name: 'список CPU Min Voltage пуст — сторож заводского обязан покраснеть',
      file: join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.json'),
      hurt: () => '[]',
      expect: /проверка заводского CPU Min Voltage нашла 4 из 5 мест/,
    },
    {
      // Check 66: a 4IFIR 2.5 item writes into the E section 1600CL again - 2.5 never reads it
      // (DECISIONS 22.09.2026), and the page and footer agree with the write, so nothing shows it.
      name: 'пункт 4IFIR 2.5 пишет в раздел 1600CL',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => { const at = s.indexOf('[*VDDQ?25mariko]'); const i = s.indexOf('{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,32,3)})})}/1000,true)}CL', at); return at < 0 || i < 0 ? s : s.slice(0, i) + '{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL' + s.slice(i + '{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,32,3)})})}/1000,true)}CL'.length) },
      expect: /«VDDQ\?25mariko»: пункт 4IFIR 2\.5 пишет в профиль Optimized Target/,
    },
    {
      // Check 66: the 2.6 item writes into the S section - 2.6 takes the E-state voltages from E.
      name: 'пункт 4IFIR 2.6 пишет в раздел частоты S',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => { const at = s.indexOf('[*VDDQ]'); const i = s.indexOf('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL', at); return at < 0 || i < 0 ? s : s.slice(0, i) + '{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,32,3)})})}/1000,true)}CL' + s.slice(i + '{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL'.length) },
      expect: /«VDDQ»: пункт 4IFIR 2\.6 пишет в раздел частоты S/,
    },
    {
      // Check 68: the reset on 2.6 zeroes the S section instead of E.
      name: 'сброс на 4IFIR 2.6 обнуляет раздел частоты S',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split("\nmatching_ini_val './config.ini' Firmware gen 2.6\n").join("\nmatching_ini_val './config.ini' Firmware gen 2.5\n"),
      expect: /reset\.ini mariko \(2\.6: ключи есть, eBAL 2\): emc_timings\.ini стал/,
    },
    {
      // Check 66: the items lose their generation gate - without 4IFIR.ovl they are shown (operator:
      // "without 4IFIR.ovl this is not 4IFIR").
      name: 'пункты VDDQ/VDD2 видны без 4IFIR',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('\n').filter(l => l !== ';visibility_condition=matching_ini_val ./config.ini Firmware gen 2.6').join('\n'),
      expect: /\(none\/mariko\/eBAL 2\/частота 2265\): пунктов eVDQ видно 1, а ждали 0/,
    },
    {
      // Check 68: Current page 2 shows the voltage rows on a console without 4IFIR.
      name: 'страница 2 Current показывает напряжения без 4IFIR',
      file: join(DIST, 'current.ini'),
      hurt: s => s.split('{if_==({ini_file(Firmware,gen)},2.6,{if_==({hex_file(CUST,12524,1)},01,1600,1331)},null)}').join('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}'),
      expect: /current\.ini стр\. 2 \(none, mariko: без 4IFIR\): VDDQ\/VDD2 = «1111 mV»/,
    },
    {
      // Check 68: Erista's reset names the S section from the Mariko clock (CUST 32).
      name: 'сброс Erista на 4IFIR 2.5 берёт частоту Mariko',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('{hex_file(CUST,24,3)}').join('{hex_file(CUST,32,3)}'),
      expect: /reset\.ini erista \(2\.5: ключи в разделе S, eBAL 2\): emc_timings\.ini стал/,
    },
    {
      // Check 66: the Erista item reads the Mariko clock.
      name: 'пункт Erista 4IFIR 2.5 читает частоту Mariko',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => { const at = s.indexOf('[*VDD2?25erista]'); const e = s.indexOf('\n\n', at); return at < 0 ? s : s.slice(0, at) + s.slice(at, e).split('CUST,24,3').join('CUST,32,3') + s.slice(e) },
      expect: /«VDD2\?25erista»: имя профиля 4IFIR 2\.5 не собрано из частоты S своей ревизии/,
    },
    {
      // Check 71: a condition reads the 2 MB overlay itself instead of the flag [boot] left.
      name: 'условие читает 4IFIR.ovl само',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split(';visibility_condition=matching_ini_val ./config.ini Firmware gen 2.5').join(';visibility_condition=matching_hex_val_custom /switch/.overlays/4IFIR.ovl Houdini 0 48'),
      expect: /читает 4IFIR\.ovl сам — поколение спрашивается у \[Firmware\] gen/,
    },
    {
      // Check 68: a 2.5 branch ends the tail (no force_failure) - the fingerprint is never stored and
      // every entry on 2.5 reads the whole overlay again.
      name: 'ветвь 2.5 обрывает хвост до записи отпечатка',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split("Firmware gen '2.5'\nforce_failure\n").join("Firmware gen '2.5'\n"),
      expect: /по шагам: «тот же оверлей 2\.5»: тот же оверлей прочитан поиском/,
    },
    {
      // Check 71: the flag is left to [boot] again - the forwarder into Optimized Mode stops detecting, [boot]
      // detects instead; under quick launch the items would read a stale or missing flag.
      name: 'флаг читается только из [boot]',
      file: [join(DIST, 'advanced', 'ram', 'package.ini'), join(DIST, 'boot_package.ini')],
      hurt: s => {
        if (s.startsWith('[boot]')) return s + "\nset-ini-val './advanced/ram/ram-optimized/config.ini' Firmware gen '2.6'\n"
        const i = s.indexOf("package_source './ram-optimized/package.ini'\n")
        return i < 0 ? s : s.slice(0, i) + "package_source './ram-optimized/package.ini'" + s.slice(s.indexOf('\n\n', i))
      },
      expect: /advanced\/ram\/package\.ini «Optimized Mode \(1600 MHz\)» ведёт в advanced\/ram\/ram-optimized\/package\.ini, спрашивающий поколение, а не пересчитывает его/,
    },
    {
      // Check 66: on 2.5 an eBAMATIC RAM clock hides the items without a word.
      name: 'подсказка «Set Frequency» пропала',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split("''='Set Frequency to use VDDQ/VDD2'").join("''=''"),
      expect: /\(2\.5\/mariko\/eBAL 2\/частота 0\): видно подсказок 0 — «—», а ждали «Set Frequency to use VDDQ\/VDD2»/,
    },
    {
      // Check 66: the old wording comes back - the operator asked for "Set Frequency".
      name: 'подсказка не та',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split("''='Set Frequency to use VDDQ/VDD2'").join("''='Set RAM Frequency to use VDDQ/VDD2'"),
      expect: /подсказка гласит «Set RAM Frequency to use VDDQ\/VDD2»/,
    },
    {
      // Check 66: the 2.5 items lose their clock gate - on an eBAMATIC clock they write into `0CL…`.
      name: 'на 2.5 при частоте 0 видны пункты',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('\n').filter(l => l !== ';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 32 000000').join('\n'),
      expect: /\(2\.5\/mariko\/eBAL 2\/частота 0\): пунктов eVDQ видно 1, а ждали 0/,
    },
    {
      // Check 68 and 71: 2.6 is recognised by its name Nextgen - a 2.7 under a new name keeps whatever flag
      // was there and loses the items (operator, 22.09.2026: only 2.5's name is checked).
      name: 'поколение 2.6 опознаётся по имени Nextgen',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split("try:\nset-ini-val './ram-optimized/config.ini' Firmware gen '2.6'\n").join("try:\nmatching_hex_val_custom /switch/.overlays/4IFIR.ovl Nextgen 0 4E\nset-ini-val './ram-optimized/config.ini' Firmware gen '2.6'\n"),
      expect: /\(4IFIR 2\.7 с неизвестным именем, mariko, было: не записан\): поколение записано как —/,
    },
    {
      // Check 68: the fingerprint is never compared - every entry reads the whole overlay again.
      name: 'отпечаток не сравнивается: поиск на каждом входе',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split("matching_hex_val /switch/.overlays/4IFIR.ovl 64 '{ini_file(Firmware,ovl_id)}'").join('force_failure'),
      expect: /отпечаток совпал, а оверлей всё равно прочитан поиском/,
    },
    {
      // Check 68: any stored fingerprint is taken on trust - after an AIO update 2.5 -> 2.6 the flag stays 2.5.
      name: 'отпечаток не сравнивается: поиска не бывает',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split("\nmatching_hex_val /switch/.overlays/4IFIR.ovl 64 '{ini_file(Firmware,ovl_id)}'").join(''),
      expect: /по шагам: «обновление AIO 2\.5→2\.6»: поколение 2\.5, а ждали 2\.6/,
    },
    {
      // Check 68: a build-id of zeros is stored and trusted - every zero-id build looks the same.
      name: 'нулевой build-id принимается как отпечаток',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.split('\n!matching_hex_val /switch/.overlays/4IFIR.ovl 64 0000000000000000000000000000000000000000').join(''),
      expect: /нулевой build-id отпечатком не служит/,
    },
    {
      // Check 68: entering Optimized Mode writes into emc_timings.ini (operator, 22.09.2026: values already
      // there are read and shown, never rewritten on entry).
      name: 'вход на страницу пишет в emc_timings.ini',
      file: join(DIST, 'advanced', 'ram', 'package.ini'),
      hurt: s => s.replace("package_source './ram-optimized/package.ini'", "set-ini-val '/config/4IFIR/emc_timings.ini' '{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,12352,3)})})}*2+8,true)}' eVDQ '0'\npackage_source './ram-optimized/package.ini'"),
      expect: /advanced\/ram\/package\.ini «Optimized Mode \(1600 MHz\)» \([^)]*\): вход на страницу изменил emc_timings\.ini/,
    },
    {
      // Check 66: two hints at once on 2.5 with both on eBAMATIC — the eBAL hint loses its "clock is set" gate.
      name: 'две подсказки сразу на 2.5',
      file: join(DIST, 'advanced', 'ram', 'ram-optimized', 'package.ini'),
      hurt: s => s.split('\n').filter(l => l !== ';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 24 000000').join('\n'),
      expect: /\(2\.5\/erista\/eBAL 0\/частота 0\): видно подсказок 2/,
    },
    {
      // Check 72, РОВНО ТА ПОРЧА, ЧТО РОНЯЛА КОНСОЛИ: офсет vMin снова объявлен однобайтовым,
      // и плюсовая сторона ряда ложится в kip как 242…255. Длина 4 стоит только у этих двух
      // полей, поэтому замена бьёт по обоим разом.
      name: 'офсет vMin снова пишется одним байтом',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => s.split('"length": 4').join('"length": 1'),
      expect: /старшие байты останутся нулями/,
    },
    {
      // Check 72: ширина та, а старший байт у отрицательного значения не FF. В поле ляжет
      // 16 711 154 вместо −14 — та же беда, только тише: словарь и подпись сойдутся.
      name: 'отрицательное смещение vMin не расширено знаком',
      file: join(ROOT, 'package', 'fields.json'),
      hurt: s => s.replace('"hex": "F2FFFFFF"', '"hex": "F2FF00FF"'),
      expect: /не расширено знаком/,
    },
    {
      // Check 72: восстановление старой копии снова пишет байт как есть. На консоли, где
      // уже лежит наш FCFFFFFF, старый `01` дал бы 01FFFFFF.
      name: 'восстановление vMin без добивки до ширины поля',
      file: join(DIST, 'service', 'reset.ini'),
      hurt: s => s.split('{if_==({ini_file(Fields,12440)},null,null,{slice({ini_file(Fields,12440)}00000000,0,8)})}').join('{ini_file(Fields,12440)}'),
      expect: /без добивки до 8 знаков/,
    },
    {
      // Check 72(e): импорт снова добивает нулями. Профиль старого инструмента несёт
      // элемент в два байта; снятый с kip, куда наша сборка записала FCFFFFFF, он даёт
      // FCFF, и нули превращают +25 мВ в 65532 — та же поломка загрузки.
      name: 'импорт чужого профиля добивает офсет vMin нулями',
      file: join(DIST, 'service', 'package.ini'),
      hurt: s => s.replace(/\{if_>\(\{hex_to_decimal\(\{slice\(\{json_file\(19,pMEH\(12-21\)\)\},37,38\)\}\)\},7,FFFF,0000\)\}/, '00000000'),
      expect: /добивает узкий элемент профиля нулями/,
    },
  ]
  let failed = 0, skipped = 0
  console.log('отрицательный прогон: ' + PROBES.length + ' проб\n')
  for (const p of PROBES) {
    const files = Array.isArray(p.file) ? p.file : [p.file]
    // ПРОБА БЕЗ СВОЕГО ФАЙЛА ПРОПУСКАЕТСЯ ВСЛУХ, А НЕ ПАДАЕТ НА ЧТЕНИИ. Заведено
    // 08.09.2026 вместе с пробой проверки 7: её предмет — текст `scripts/release.ps1`,
    // который в публикацию не входит ($FORBIDDEN в publish.ps1:61).
    const missing = files.filter(f => !existsSync(f))
    if (missing.length) {
      skipped++
      console.log('  ⏭ пропущена  ' + p.name + ' — в этом дереве нет ' + missing.map(f => relative(ROOT, f)).join(', '))
      continue
    }
    const before = files.map(f => readFileSync(f))
    let out = ''
    try {
      files.forEach((f, i) => writeFileSync(f, p.hurt(before[i].toString('utf8')), 'utf8'))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
      out = (r.stdout ?? '') + (r.stderr ?? '')
    } finally {
      files.forEach((f, i) => writeFileSync(f, before[i]))
    }
    const caught = p.expect.test(out)
    if (!caught) failed++
    console.log((caught ? '  ✅ поймана  ' : '  ❌ ПРОПУЩЕНА ') + p.name)
  }
  const after = readFileSync(join(DIST, 'package.ini'))
  console.log('')
  if (failed) {
    console.error('ОТРИЦАТЕЛЬНЫЙ ПРОГОН НЕ ПОЛУЧИЛСЯ: ' + failed + ' из ' + PROBES.length
      + ' проб гейт не заметил. Инструмент лжёт о своей работе.')
    process.exit(3)
  }
  console.log('все ' + (PROBES.length - skipped) + ' проб пойманы'
    + (skipped ? ', ' + skipped + ' пропущено — файлов нет в этом дереве' : '') + '; дерево восстановлено')
  process.exit(0)
}

const problems = []
const okRaw = []

// ЗЕЛЁНАЯ СТРОКА С НУЛЁМ — ЭТО КРАСНАЯ СТРОКА (заведено 05.09.2026).
//
// Опыт над сторожами показал: 22 проверки из 49 не замечают пропажи своего предмета —
// выпотроши то, что они стерегут, и прогон останется зелёным, только счётчик в строке
// станет нулём. Затвор на пустоту стоял у 21 блока из 49, а дописывать его в остальные
// по одному значит ошибиться там же ещё раз.
//
// Поэтому затвор общий и стоит на выходе: любая зелёная строка, в которой счётчик равен
// нулю, превращается в КРИТИЧЕСКОЕ замечание. «Проверено 0 штук» — это не успех, это
// проверка, смотрящая в пустоту, и разница между ними видна только по числу.
//
// Отсюда же второе требование: зелёная строка ОБЯЗАНА нести счётчик. Строка без числа
// этим затвором не охраняется — она молчит одинаково и когда всё цело, и когда предмета
// не стало.
// SUBJECT GONE IS CRITICAL, NOT A WARNING (raised 05.09.2026). A verdict that says the
// watched thing is missing, or that the check went blind, used to be IMPORTANT - and
// IMPORTANT never failed the run, so losing the subject was quieter than finding a fault
// in it. Seven such verdicts were raised; the IMPORTANT ones left are real findings.
// ANY ISOLATED ZERO, NOT A ZERO BEFORE A KNOWN WORD. The unit dictionary let five green
// lines through - `(0)`, `(0, both languages)`, `0 names`, `0 stages, 0 cells` - because
// their unit was missing or simply not in the list. A counter is a number, so look for the
// number. Data quoted in «…» is not a counter: it carries labels and names of its own.
// A zero that is not part of a bigger number: a neighbouring dot or comma counts as part
// of the number only between digits (1,000 and 0.5 are numbers, "(0, both languages)" is a zero).
const ZERO_COUNT = /(?<!\d)(?<!\d[.,])0(?!\d)(?![.,]\d)/
const countable = line => line.replace(/«[^»]*»/g, '«»')
const ok = {
  push (line) {
    if (ZERO_COUNT.test(countable(line)))
      problems.push({ sev: 'CRITICAL', what: `проверка отчиталась зелёным, ничего не проверив: «${line}» — ноль предметов значит, что стеречь стало нечего` })
    else {
      // Строка без числа этим затвором не охраняется — она молчит одинаково и когда всё
      // цело, и когда предмета не стало. 05.09.2026 таких было тринадцать из пятидесяти
      // одной; счётчики дописаны, и правило закреплено здесь, чтобы новая проверка не
      // завелась без числа.
      if (!/\d/.test(line))
        problems.push({ sev: 'IMPORTANT', what: `зелёная строка без счётчика: «${line}» — по ней нельзя отличить «всё цело» от «предмета не осталось»` })
      okRaw.push(line)
    }
  },
  get length () { return okRaw.length },
  [Symbol.iterator] () { return okRaw[Symbol.iterator]() },
}

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
// THE STRING FORM WAS THROWN AWAY. `if (!v?.offset) continue` dropped the second
// visible_when in menu.json ("path_exists ./updater/newer.flag") without a word, and the
// green line said «1 conditions» - not zero, so the zero gate stayed quiet too. A shape
// this check does not understand is now red, not silent.
{
  let bad = 0, checked = 0
  const norm = s => String(s).replace(/\.\/(?:\.\.\/)*/g, './').replace(/\s+/g, ' ').trim()
  const rawConds = lines.filter(l => /^;visibility_condition=/.test(l.trim()))
                        .map(l => norm(l.trim().replace(/^;visibility_condition=/, '')))
  for (const it of items) {
  const v = it.visible_when
  if (v == null) continue
  if (typeof v === 'string') {
    checked++
    if (!rawConds.includes(norm(v))) {
      bad++
      problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" is declared visible when \`${v}\`, but dist has no such visibility_condition` })
    }
    continue
  }
  if (typeof v !== 'object' || Array.isArray(v) || !v.offset) {
    bad++
    problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" объявляет visible_when в форме, которой проверка не понимает: ${JSON.stringify(v)} — молча пропустить её нельзя` })
    continue
  }
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
  if (last === '[Reboot the console]') ok.push(`«Reboot the console» — последний из ${menuItems.length} пунктов корня`)
  else problems.push({ sev: 'IMPORTANT', what: `«Reboot the console» должен быть последним пунктом корня, а последний — ${last}` })
}

/**
 * ВИДЖЕТ СУЖАЕТ ШАПКУ ВТРОЕ — И ЭТО ЗАМЕЧАЕТСЯ ТОЛЬКО НА КОНСОЛИ.
 *
 * Директива `;show_widget=true` включает часы и датчики в шапке, а заодно урезает бокс
 * под название и подпись с 408 пикселей до 214 (`s.maxW = widgetDrawn ? 214 :
 * (tsl::cfg::FramebufferWidth - 40);` в `calcScrollWidth()` — константа приколочена;
 * `lib/libultrahand/libtesla/include/tesla.hpp:6806`, ЧИТАНО В ПОДМОДУЛЕ С НАЛОЖЕННЫМИ
 * `patches/*.patch`, у автора прошивки — `:6944`; 408 — это те самые
 * `FramebufferWidth - 40` при штатных 448, `libultra/source/tsl_utils.cpp:65`).
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
} else ok.push(`every written offset is read in [boot] (${writtenOffsets.size} offsets)`)

/**
 * Footer paths must resolve FROM THEIR OWN FILE'S DIRECTORY.
 *
 * Forwarder commands run with the `packagePath` of the file the forwarder lives in
 * (`interpretAndExecuteCommands(std::move(getSourceReplacement(commands, keyName, i,
 * packagePath)), packagePath, keyName)` in the KEY_A handler under
 * `if (commandMode == FORWARDER_STR)` -- fork source/main.cpp:5715,
 * author's fork :5710). A forwarder in `advanced/ram/package.ini` runs from `advanced/ram/`, not
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
} else ok.push(`footer paths resolve from their own file's directory (${iniFiles.length} files)`)

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
    // СЧЁТ СНИМАЕМ ДО ЦИКЛА. 05.09.2026: он снимался ПОСЛЕ, поэтому отказ, найденный
    // внутри цикла, уже входил в «норму», и зелёная строка печаталась вместе с ним:
    // прогон говорил «все проверки пройдены», пока проверка кричала.
    const beforeReset = problems.length
    for (const [, rev, sec] of sections) {
      const written = new Set()
      // ЗНАЧЕНИЕ БЕРЁТСЯ НЕ ВСЕГДА ГОЛЫМ `{ini_file(Fields,N)}`. У полей, сменивших
      // ширину (`legacy_length` в карте: 12440/12448 с 22.09.2026), генератор оборачивает
      // чтение добивкой до ширины поля, и прежний строгий образец переставал видеть
      // такую строку вовсе — сторож объявлял смещение пропущенным в сбросе, хотя оно там.
      // Ключей в обёртке два, и оба обязаны совпасть со смещением записи.
      for (const m of sec.matchAll(/CUST (\d+) (\S+)/g)) {
        const keys = [...m[2].matchAll(/ini_file\(Fields,(\d+)\)/g)].map(x => x[1])
        if (!keys.length) continue
        for (const k of keys) if (k !== m[1]) problems.push({ sev: 'CRITICAL', what: `сброс пишет в ${m[1]}, а значение берёт из ключа ${k}` })
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
    const badApply = beforeReset

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
      // и табуляции (`// Trim value` → `while (val_start < end && (*val_start == ' ' ||
      // *val_start == '\t')) ++val_start;` → `value.assign(val_start, end);` —
      // `libultra/source/ini_funcs.cpp:601-605` в подмодуле с наложенными
      // `patches/*.patch`, в чистом `HEAD` `:600-604`), точку с запятой комментарием не считает —
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
  else ok.push(`no zero dictionary entry is narrower than its field (${fields.length} fields)`)
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
  else ok.push(`every table heading has a gap in front of it (${iniFiles.length} files)`)
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
  else ok.push(`fields.json _meta matches its own contents (${fields.length} offsets)`)
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
  else ok.push(`backup file name is built from keys declared before use (${iniFiles.length} files)`)
}

// --------------------------------------- 15. копия и восстановление несут одно и то же
//
// Списки строились по-разному: копия — по карте, восстановление — по набору пунктов меню,
// куда `read_only` не попадает. `8 Memory Timing Mode` сохранялся и не возвращался никогда:
// из 90 полей восстанавливалось 89, и слово «restored» было неправдой ровно на одно поле.
// Обратное направление тоже важно: запись поля, которого нет в копии, взяла бы значение
// из пустоты. И дубликаты: раньше восстановление писало 95 команд на 90 значений.
{
  let seenPairs = 0
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
      const writesOf = t => [...t.matchAll(/CUST (\d+) \{(?:ini_file|if_==)/g)].map(m => Number(m[1]))
      const blocks = (sections[0] ?? '').split(/^try:$/m).filter(b => writesOf(b).length)
      if (blocks.length !== 2) bad.push(`${rev}: блоков записи ${blocks.length}, ожидается 2 (своя раскладка и импортированная)`)
      const writes = writesOf(blocks[0] ?? '')
      const wrote = new Set(writes)
      // The imported block writes exactly the Fields the converter of this revision puts into
      // a copy: WL-Set, DBI (check 69) and whatever the old format never held are left alone
      // explicitly, not by the engine skipping a `null` value. NOTES №349.
      const impSec = readFileSync(join(DIST, 'service', 'package.ini'), 'utf8')
        .split(/\n(?=\[)/).find(s => s.startsWith(`[*Import old 4IFIR backup?${rev}]`))
      if (!impSec) bad.push(`${rev}: нет секции импорта в service/package.ini — не с чем сверить блок импортированных копий`)
      else if (blocks[1]) {
        const conv = new Set([...impSec.matchAll(/ Fields (\d+) '/g)].map(m => Number(m[1])))
        const impW = writesOf(blocks[1])
        const extraImp = impW.filter(o => !conv.has(o))
        const lostImp = [...conv].filter(o => !impW.includes(o))
        if (!conv.size) bad.push(`${rev}: конвертер не пишет ни одного Fields — сверять не с чем`)
        if (extraImp.length) bad.push(`${rev}: блок импортированных копий пишет то, чего конвертер не кладёт — ${extraImp.join(', ')}`)
        if (lostImp.length) bad.push(`${rev}: конвертер кладёт, а блок импортированных копий не пишет — ${lostImp.join(', ')}`)
        if (String(impW) !== String(writes.filter(o => conv.has(o)))) bad.push(`${rev}: блок импортированных копий пишет не в порядке своей копии`)
      }
      seenPairs += saved.size
      const lost = [...saved].filter(o => !wrote.has(o))
      const extra = [...wrote].filter(o => !saved.has(o))
      if (lost.length) bad.push(`${rev}: сохраняется, но не восстанавливается — ${lost.join(', ')}`)
      if (extra.length) bad.push(`${rev}: восстанавливается, но не сохраняется — ${extra.join(', ')}`)
      if (writes.length !== wrote.size) bad.push(`${rev}: ${writes.length - wrote.size} дублирующихся команд записи`)
    }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `копия и восстановление разошлись:\n     ${bad.join('\n     ')}` })
  else ok.push(`backup and restore carry exactly the same fields, and an imported copy restores exactly what the converter puts into it (${seenPairs} offsets compared)`)
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
  if (!points.length) problems.push({ sev: 'CRITICAL', what: 'в карте не нашлось ни одной точки кривых напряжений — проверка списков ослепла' })
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
    if (!claims.length) problems.push({ sev: 'CRITICAL', what: 'в README не нашлось утверждения о числе смещений — проверка ослепла' })
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
  // Обещание СНЯТЬ — законно: файл перестаёт его давать. А переформулировать и не заметить,
  // что проверка его больше не узнаёт, — тихая беда: гейт уходит в зелёную ветку «нечего
  // подкреплять». Файл, который всё ещё говорит про состав архива, но не в узнаваемой форме,
  // поднимает флаг: не отказ, но и не молчание.
  const MENTIONS = new RegExp('release archives?[\\s\\S]{0,120}configurator|configurator[\\s\\S]{0,120}release archives?', 'i')
  const promising = [], absent = [], reworded = []
  for (const name of ['LICENSE', 'NOTICE.md']) {
    const f = join(ROOT, name)
    if (!existsSync(f)) { absent.push(name); continue }
    const txt = readFileSync(f, 'utf8')
    if (PROMISE.test(txt)) promising.push(name)
    else if (MENTIONS.test(txt)) reworded.push(name)
  }
  // Флаг ставится ОТДЕЛЬНО от цепочки: если один файл переформулировали, а второй
  // ещё обещает, цепочка ушла бы в зелёную ветку и о первом промолчала.
  if (reworded.length) problems.push({ sev: 'CRITICAL', what: `${reworded.join(' и ')} говорит про состав релизного архива, но не в той форме, которую узнаёт проверка — она это обещание не подкрепляет и промолчала бы о нём` })
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
      // 05.09.2026: у отказа появился ИМЕНОВАННЫЙ обход -WithEngine — оператор дважды
      // переступил решение 04.09 осознанно. Сторож принимает и форму с обходом, но
      // ТОЛЬКО именованную: `-not $NoUpload` без второго условия либо с ним. Любой
      // другой способ пропустить движок мимо отказа по-прежнему красный.
      if (!/if \(Test-Path -LiteralPath \$ovlInStage\)[\s\S]{0,400}?if \(-not \$NoUpload(?: -and -not \$WithEngine)?\)[\s\S]{0,160}?throw/.test(region))
        bad.push('release.ps1 не отказывает, когда движок в комплекте, а релиз уходит на GitHub')
      // Обратное требование — «движок в комплекте обязан быть» — отменено тем же решением.
      // Обход обязан быть громким и обязан проверять тексты архива: INSTALL.txt и
      // NOTICE.md обещают читателю обратное, и подмена этих текстов — часть пути,
      // а не пожелание. Молчаливый -WithEngine хуже, чем его отсутствие.
      if (/\$WithEngine/.test(ps) && !/THE ENGINE IS NOT HERE[\s\S]{0,400}?throw/.test(ps))
        bad.push('release.ps1 знает -WithEngine, но не проверяет, что INSTALL.txt в архиве перестал обещать «движка здесь нет»')
      if (/\$WithEngine/.test(ps) && !/no engine binary[\s\S]{0,400}?throw/.test(ps))
        bad.push('release.ps1 знает -WithEngine, но не проверяет, что NOTICE.md в архиве перестал обещать «no engine binary»')
      if (/-not \(Test-Path -LiteralPath \$ovlInStage\)/.test(region))
        bad.push('release.ps1 всё ещё требует движок в комплекте — это отменено 04.09.2026')
    }
    if (bad.length) problems.push({ sev: 'CRITICAL', what: `${promising.join(' и ')} обещают архив без движка, а выпуск это не держит:\n     ${bad.join('\n     ')}` })
    else ok.push(`the archive-contents promise in ${promising.join(' and ')} is backed by the release refusal (${promising.length} files)`)
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
// частоты RAM — килогерцы с усечением (2707200 кГц → «2707MHz»).
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
  const twice = []
  let labels = 0
  for (const file of dicts) {
    let data
    try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    if (!Array.isArray(data)) continue
    for (const e of data) {
      if (!e || typeof e.name !== 'string' || typeof e.hex !== 'string') continue
      // FRACTIONS COUNT TOO. Integers only skipped 423 of 3129 labels, among them the
      // 18 memory voltages written as «962.5 mV» - exactly the place where a label that
      // names one value and writes another would never be noticed on the screen.
      const m = e.name.match(/^(\d+(?:\.\d+)?)\s*(mV|uV|MHz|kHz)\b/)
      if (!m || e.hex.length % 2) continue
      labels++
      // A bare number right after " - " repeats the value in the right column, which then
      // squeezes the row name to "1…" (RAM MHz, operator's photo 13.09.2026).
      if (/^ - \d+(\.\d+)?( |$)/.test(e.name.slice(m[0].length))) twice.push(`${relative(ROOT, file)}: «${e.name}»`)
      const want = Number(m[1])
      let got = 0
      for (let i = e.hex.length - 2; i >= 0; i -= 2) got = got * 256 + parseInt(e.hex.slice(i, i + 2), 16)
      // The value itself, in thousandths or millionths, truncated to the label's digits:
      // 1900800 kHz is "1900MHz" and never "1901MHz" (decision 13.09.2026).
      const scale = 10 ** ((m[1].split('.')[1] ?? '').length)
      const fits = [1, 1e3, 1e6].some(k => Math.trunc(got * scale / k) === Math.round(want * scale))
      if (!fits) liars.push(`${relative(ROOT, file)}: «${e.name}» запишет ${got}`)
    }
  }
  // COUNT THE SUBJECT, NOT THE CONTAINER. The line used to print the number of json files,
  // so gutting the label regexp still read «170 dictionaries» and the zero gate never fired.
  if (liars.length) problems.push({ sev: 'CRITICAL', what: `подпись словаря обещает не то, что запишет: ${liars.join('; ')}` })
  else if (twice.length) problems.push({ sev: 'CRITICAL', what: `значение названо в строке списка дважды — правая колонка выдавит имя до многоточия (${twice.length}): ${twice.slice(0, 4).join('; ')}` })
  else ok.push(`every numeric dictionary label encodes the value it names, once (${labels} labels in ${dicts.length} dictionaries)`)
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
      return digits(Math.trunc(khz / 1000))
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
  if (!paths.length) problems.push({ sev: 'CRITICAL', what: 'не нашлось ни одной строки, задающей имя копии — проверка длины ослепла' })

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
// любое значение со словом `null` на «Not available» (`infoText = (infoTextRaw.find(NULL_STR)
// != std::string::npos) ? UNAVAILABLE_SELECTION : infoTextRaw;` в `buildTableDrawerLines` —
// `source/utils.hpp:1418`, одинаково в форке и у автора прошивки).
//
// Дефект не даёт ни ошибки, ни пустоты — он даёт правдоподобное «недоступно», которое
// читается как свойство копии, а не как поломка экрана. Поймать его можно только так:
// после перепривязки ни одна строка не смеет спрашивать секции, живущие в `config.ini`.
//
// РАСШИРЕНО 20.09.2026 — ПРИВЯЗКА ВЕДЁТСЯ ПОЛНОСТЬЮ, А НЕ ОДНИМ ФЛАГОМ «была перепривязка».
// Первая редакция знала ровно одно направление (config.ini → файл копии) и ровно один
// набор секций. Блок `Optimized Mode` на второй странице сделал направлений три: одна
// таблица по очереди привязана к `./config.ini`, к выбранной копии и к
// `/config/4IFIR/emc_timings.ini`, и каждая строка читается под той привязкой, которая
// объявлена ВЫШЕ неё. Две однострочные порчи проходили весь гейт молча:
//   * убрать возврат привязки к копии после строки `VDD2` — `VDDQ-VDD2 Voltage`
//     и `Efficiency Stages` спрашивают [Fields] у `emc_timings.ini`;
//   * поднять `ini_file '…/emc_timings.ini'` выше `Optimized Target` — ту же [Fields]
//     спрашивает уже он сам, и с ним обе строки `list`, из которых собрано имя профиля.
// Класс тот же, что у `File` в 2026-08: секции в привязанном файле нет, движок отдаёт
// `null`. Поэтому расширяется ЭТА проверка, а не заводится своя в №66.
//
// Модель ровно та, что у движка (`getSourceReplacement`, `buildTableDrawerLines` в
// `source/utils.hpp` форка): `ini_file`/`hex_file`/`json_file`/`list` — независимые
// последовательные объявления, каждое действует до следующего и не переживает границу
// секции. Файлов три класса, и состав секций у каждого известен:
//   `cfg`  — литерал с именем `config.ini`: наши [Restore]/[Backup]/[Import];
//   `data` — копия (`{ini_file(Restore,Path)}`) или `Default.ini`: [Fields]/[Meta];
//   `emc`  — `/config/4IFIR/emc_timings.ini`: только профили `<МГц>CL<n>`, ни тех, ни этих.
// Читаются под привязкой не только строки таблицы, но и аргументы `list` — движок
// разрешает подстановки в аргументе ДО того, как присвоит источник.
{
  const OWN_SECTIONS = ['Restore', 'Backup', 'Import', 'Firmware']   // секции нашего config.ini ([Firmware] — поколение 4IFIR, с 22.09.2026)
  const DATA_SECTIONS = ['Fields', 'Meta']  // секции копии и Default.ini ([Optimized] 21–22.09.2026 больше не читается)
  const EMC21 = '/config/4IFIR/emc_timings.ini'
  const strays = []
  const mixed = []
  let tables21 = 0, reads21 = 0
  // `ini_file '<arg>'` → класс файла, или null, если судить не о чем (чужой ini, wildcard).
  const classOf21 = arg => {
    if (arg === EMC21) return 'emc'
    if (arg.includes('{ini_file(Restore,Path)}')) return 'data'
    if (arg.includes('{')) return null                      // иная подстановка — файл неизвестен
    const base = arg.split('/').pop()
    if (base === 'config.ini') return 'cfg'
    if (base === 'Default.ini') return 'data'
    return null
  }
  const SAY21 = { cfg: 'нашему config.ini', data: 'файлу данных (копия / Default.ini)', emc: EMC21 }
  for (const f of iniFiles) {
    let rebound = false
    let bind = null, bindArg = '', isTable = false, secName = ''
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim()
      if (line.startsWith('[')) {                              // привязка не переживает границу секции
        rebound = false; bind = null; bindArg = ''; isTable = false
        secName = line
        continue
      }
      if (line === ';mode=table') { isTable = true; tables21++; continue }
      const decl = line.match(/^ini_file\s+'([^']*)'$/)
      if (decl) {
        // Перепривязка — это `ini_file` с аргументом-подстановкой, а не с литеральным путём.
        if (decl[1].startsWith('{')) rebound = true
        bind = classOf21(decl[1]); bindArg = decl[1]
        continue
      }
      // Только СТРОКИ ТАБЛИЦЫ вида 'подпись' = 'значение'. Команды тоже принимают
      // `{ini_file(Restore,Path)}`, но там это аргумент-путь, а не чтение из привязки:
      // `matching_ini_val {ini_file(Restore,Path)} Meta kipver …` совершенно законно.
      const isRow = /^'[^']*'\s*=\s*'/.test(line) || /^''\s*=\s*'/.test(line)
      if (rebound && isRow) {
        for (const sec of OWN_SECTIONS) {
          if (line.includes(`{ini_file(${sec},`)) {
            strays.push(`${relative(ROOT, f)}: «${line}» читает [${sec}] уже из чужого файла`)
          }
        }
      }
      // Вторая половина: под КАКОЙ файл попала строка. Только таблицы — там движок
      // не выполняет команд, и порядок строк равен порядку чтения.
      if (!isTable || !bind) continue
      const isList = /^list\s+'/.test(line)
      if (!isRow && !isList) continue
      const asked = [...line.matchAll(/\{ini_file\(([A-Za-z][^,{}]*),/g)].map(m => m[1])
      if (!asked.length) continue
      reads21++
      for (const sec of new Set(asked)) {
        const home = OWN_SECTIONS.includes(sec) ? 'cfg' : (DATA_SECTIONS.includes(sec) ? 'data' : null)
        if (!home || home === bind) continue
        const short = line.length > 90 ? line.slice(0, 90) + '…' : line
        mixed.push(`${relative(ROOT, f)} ${secName}: «${short}» спрашивает [${sec}], а привязка на этой строке — к ${SAY21[bind]} (${bindArg})`)
      }
    }
  }
  if (strays.length || mixed.length) problems.push({ sev: 'CRITICAL', what: `строка таблицы спрашивает секцию, которой в привязанном файле нет — на экране будет «Not available» или пусто (${strays.length + mixed.length}):\n     ${[...strays, ...mixed].slice(0, 8).join('\n     ')}` })
  else ok.push(`every table row and list argument is read under a binding whose file carries the section it asks for (${iniFiles.length} files, ${tables21} tables, ${reads21} named-section reads)`)
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
    problems.push({ sev: 'CRITICAL', what: 'словарь GPU Min Voltage не найден — проверка ослепла' })
  } else {
    const list = JSON.parse(readFileSync(vmin, 'utf8'))
    const numeric = list.filter(e => /^\s*\d/.test(String(e.name)))
    if (numeric.length) {
      problems.push({ sev: 'CRITICAL', what: `GPU Min Voltage снова предлагает милливольты (${numeric.length}): фиксированное число бьёт по обоим режимам памяти сразу, ступень — по каждому отдельно. Разбор — docs/NOTES.md` })
    } else if (!list.length) {
      problems.push({ sev: 'CRITICAL', what: 'GPU Min Voltage остался вовсе без вариантов' })
    } else {
      // Подпись обязана уметь прочитать больше, чем меню предлагает выбрать.
      // ПРОПАЖА ФАЙЛА — ЭТО ДИАГНОЗ, А НЕ ПАДЕНИЕ. 05.09.2026 опыт показал: переименуй
      // словарь, и проверка не краснела, а роняла весь прогон стеком Node — то есть
      // ноль проверок вместо одного внятного отказа. Худший вид затвора из возможных.
      const mapPath = vmin.replace(/\.json$/, '.map.json')
      const map = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8'))[0] : null
      if (!map) {
        problems.push({ sev: 'CRITICAL', what: `словарь подписи GPU Min Voltage не найден: ${relative(ROOT, mapPath)}` })
      } else if (Object.keys(map).length <= list.length) {
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
    problems.push({ sev: 'CRITICAL', what: 'ступени андервольта GPU не найдены — проверка ослепла; если их убрали намеренно, уберите и её' })
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
    // The list goes in «…»: it is DATA - field offsets and labels - and the digits inside
    // it are not counters, so they must not trip the zero gate.
    const tail = unmarked.length
      ? `; ${unmarked.length} без метки, заводское зовётся своим именем: «${unmarked.join(', ')}»`
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
  else ok.push(`every footer command addresses an item that exists in the same file (${iniFiles.length} files)`)
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
      else if (!existsSync(mapFile.replace(/\.map\.json$/, '.json')))
        bad.push(`${relative(ROOT, mapFile)}: рядом нет списка значений — проверять сужение не с чем`)
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
/**
 * Gate read from a backup (14.09.2026): a ;skip_null table whose list line turns one Fields
 * value into `y` or `null`, and every row goes null with it. A section condition cannot read
 * the backup, so this is how backup pages hide variants. Evaluated over every value the field
 * can hold in a backup (map, menu, and `null` for an imported or empty one).
 */
function copyGateOf(sec) {
  if (!/^;skip_null=true$/m.test(sec)) return null
  const m = sec.match(/^list '\[(.*)\]'$/m)
  if (!m) return null
  const offs = [...new Set([...m[1].matchAll(/ini_file\(Fields,(\d+)\)/g)].map(x => Number(x[1])))]
  if (offs.length !== 1) return null
  const tpl = m[1]
  const on = v => {
    let s = tpl.split(`{ini_file(Fields,${offs[0]})}`).join(v)
    for (let guard = 0; guard < 100; guard++) {
      const i = Math.max(s.lastIndexOf('{if_=='), s.lastIndexOf('{if_null'))
      if (i < 0) break
      const close = s.indexOf(')}', i)
      const inner = s.slice(s.indexOf('(', i) + 1, close)
      const p = inner.split(',')
      const val = s.startsWith('{if_==', i) ? (p[0] === p[1] ? p[2] : (p[3] ?? p[0])) : (p[0] === 'null' ? p[1] : (p[2] ?? p[0]))
      s = s.slice(0, i) + val + s.slice(close + 2)
    }
    return s === 'y'
  }
  return { off: offs[0], tpl, on }
}
function gateDomain(off) {
  const f = fields.find(x => x.offset === off)
  const len = (f?.length ?? 3) * 2
  const pad = h => { const s = String(h ?? '').toUpperCase().replace(/[^0-9A-F]/g, ''); return s ? (s + '0'.repeat(len)).slice(0, len) : '' }
  const out = new Set((f?.values ?? []).map(v => pad(v.hex)))
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n.offsets) && n.offsets.map(Number).includes(off)) for (const v of n.values ?? []) out.add(pad(v.hex))
    for (const x of Object.values(n)) if (x && typeof x === 'object') walk(x)
  })(menu)
  out.delete('')
  return [...out, 'null']
}

{
  const bad = []
  let seenTitles = 0
  for (const file of iniFiles) {
    const secs = readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)
    const blocks = []
    for (let i = 0; i < secs.length; i++) {
      if (!/^\[Header\]/.test(secs[i]) || !/^;mode=table/m.test(secs[i])) continue
      const title = secs[i].match(/^'([^']*)'\s*=/m)?.[1]
      // A title built from placeholders (Magician profiles: `{list(1)} MHz`) names data, not a
      // block: equal text there is not "two variants of one block". Check 62 guards that page.
      if (!title || title.includes('{')) continue
      const info = secs.slice(i + 1).find(x => /^\[Info\]/.test(x))
      const cond = secs[i].match(/CUST (\d+) ([0-9A-F]+)/)
      blocks.push({
        title,
        rev: secs[i].match(/^;system=(\w+)/m)?.[1] ?? 'both',
        // Условие раскладываем на смещение и значение: только так видно, исключают ли
        // два условия друг друга, или просто отличаются текстом.
        off: cond ? cond[1] : null,
        val: cond ? cond[2] : null,
        gate: copyGateOf(secs[i]),
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
      seenTitles++
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const sameConsole = a.rev === b.rev || a.rev === 'both' || b.rev === 'both'
        if (!sameConsole) continue                       // разные ревизии — вместе не встретятся
        const both = a.gate && b.gate && a.gate.off === b.gate.off
          ? gateDomain(a.gate.off).filter(v => a.gate.on(v) && b.gate.on(v)) : null
        const exclusive = (a.off && b.off && a.off === b.off && a.val !== b.val) || (both && !both.length)
        if (!exclusive) {
          const say = x => x.gate ? `Fields ${x.gate.off} из копии` : x.off ? `${x.off}=${x.val}` : 'без условия'
          bad.push(`${relative(ROOT, file)}: «${title}» — два блока могут показаться разом `
                 + `(${a.rev}/${say(a)} и ${b.rev}/${say(b)}${both?.length ? `; оба при ${both.join(', ')}` : ''})`)
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
  else ok.push(`same-named summary blocks cannot appear together and equal-length variants agree (${seenTitles} names)`)
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
  let seenLookups = 0
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
      // ТРИ АРГУМЕНТА ТОЖЕ. 05.09.2026: образец был написан под двухаргументный вызов
      // `{ini_file(Fields,N)}`, а сводка читает прошивку тремя — `{hex_file(CUST,N,3)}`.
      // Значит ширину ключа проверка мерила только на страницах восстановления и
      // сброса, а вторую страницу сводки не покрывала вовсе, при зелёной строке,
      // обещающей обратное.
      const parts = [...use[1].matchAll(/\{(?:ini|hex)_file\([^,]+,\s*(\d+)\s*(?:,\s*\d+\s*)?\)\}/g)]
      const plain = use[1].replace(/\{(?:ini|hex)_file\([^,]+,\s*\d+\s*(?:,\s*\d+\s*)?\)\}/g, '')
      if (!parts.length || plain.trim()) continue
      seenLookups++
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
  else ok.push(`every dictionary lookup resolves: the file exists and the key width matches (${seenLookups} lookups)`)
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
      // Что производитель В ПРИНЦИПЕ мог бы записать: для импорта — своя схема донора.
      const isImport = /Import/i.test(title)
      // WL-Set and DBI rows show a dash for an imported copy on purpose (check 69).
      const missing = [...keys].filter(o => !offs.has(o) && !(isImport && (o === 12432 || o === 12528))).sort((a, b) => a - b)
      if (!missing.length) continue
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
    //
    // THE EVIDENCE MUST NOT BE THE GUARD ITSELF. Three root forwarders name loader.kip
    // in one place only - their own ;visibility_condition - so deleting the gate also
    // deleted the reason to watch them, and the run stayed green. Judge on the body with
    // the condition lines removed, and count a forwarder into a sub-page as a kip writer.
    const bodyOf = c => c.split(/\r?\n/).filter(l => !/^\s*;visibility_condition=/.test(l)).join('\n')
    for (const c of chunks) {
      const head = (c.split(/\r?\n/)[0] ?? '').trim()
      const body = bodyOf(c)
      if (!/hex-by-custom|loader\.kip/.test(body) && !/^package_source\s/m.test(body)) continue
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
    // "none", not "0": here zero is the DESIRED state, and as a digit it would trip the
    // zero gate exactly like a lost subject would.
    ok.push(`curve points are computed, not looked up (${seenOffsets.size} offsets × 3 places, ${computed} occurrences, ${viaDict || 'none'} via dictionary)`)
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

  if (!screens) problems.push({ sev: 'CRITICAL', what: 'ни одного дочернего экрана не найдено — обход package_source сломан' })
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
      // A SEEDING BLOCK IS RECOGNISED BY WHAT IT WRITES, NEVER BY ITS OWN GUARDS. It used
      // to be "writes cells it also checks", so stripping the guards took the block out of
      // oversight and the run stayed green. Now: a bulk write landing wholly inside the
      // curve series. A backup restore also writes in bulk, but far beyond the curve.
      const written = writes.flatMap(offs)
      const seeding = writes.length > 1 && written.every(o => curveMariko.has(o))
      if (seeding) {
        blocks++
        const guarded = new Set(guards.flatMap(offs))
        const mode = /\sCUST 44 03$/.test(guards[0] ?? '')
        if (!mode) bad.push(`${rel}:${i + 1} блок try: пишет ${writes.length} ячеек кривой, но не начинается с проверки режима CUST 44 03`)
        else if (guards.length <= writes.length) bad.push(`${rel}:${i + 1} условий ${guards.length} на ${writes.length} записей — сторож слабее, чем то, что он охраняет`)
        else if (!written.every(o => guarded.has(o))) bad.push(`${rel}:${i + 1} посев пишет ячейки, которых не сверял`)
      }
      i = j
    }
  }

  // Both entry points - the curve forwarder and the mode item - have to be there: lose one
  // and the tally merely reads 1, while that seeding ships unguarded.
  const SEEDING_BLOCKS = 2
  if (blocks !== SEEDING_BLOCKS) problems.push({ sev: 'CRITICAL', what: `блоков посева ${blocks}, а точек входа ${SEEDING_BLOCKS} (форвардер кривой и пункт включения режима) — либо посев пропал, либо завёлся лишний` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `посев без сторожа режима:\n     ${bad.slice(0, 8).join('\n     ')}` })
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

      // A FOOTER BUILT FROM A DICTIONARY IS STILL A FOOTER. The loop above skips anything
      // with a placeholder -- the footer of EVERY dictionary-backed item, and the blind spot
      // where a 20-character label pushed the item's own name off the row on 05.09.2026.
      // The operator found that, not this check.
      for (const sec of readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)) {
        if (!/^set-footer '\{json_file_source\(\*,short\)\}'/m.test(sec)) continue
        const src = sec.match(/^json_file_source '([^']+)'/m)
        if (!src) continue
        const dictPath = join(dirname(file), src[1].replace(/^\.\//, '').split('/').join(String.fromCharCode(92)))
        if (!existsSync(dictPath)) continue
        let dict = []
        try { dict = JSON.parse(readFileSync(dictPath, 'utf8')) } catch { continue }
        if (!Array.isArray(dict)) continue
        for (const e of dict) {
          if (typeof e?.short !== 'string') continue
          checked++
          if (e.short.length > LIMIT)
            bad.push(`${rel}: подпись из словаря в ${e.short.length} знаков — «${e.short}»`)
        }
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

    // (6) import hint (13.09.2026): Erista only, one polled row printed only for an imported
    //     backup. Polled, not a section condition: the row must stay right even if the
    //     rebuild after a choice (check 64) does not happen.
    const hints = []
    secs.forEach(s => s.body.forEach((l, k) => {
      const m = rowOf(l)
      // a row that IS the condition; dictionary keys and the skip_null DBI/WL-Set note (check 69) are not
      if (m && m[2].startsWith('{if_==({ini_file(Meta,kipver)},imported,') && !s.body.includes(';skip_null=true')) hints.push({ s, m, at: s.bodyAt[k] })
    }))
    if (p.here === 'Mariko') {
      for (const h of hints) bad.push(`${p.rel}:${h.at} подсказка про режим андервольта на Mariko — импорт там режим переносит, она только для Erista`)
    } else if (hints.length !== 1) {
      bad.push(`${p.rel}: подсказок про режим андервольта после импорта ${hints.length}, а на Erista она ровно одна`)
    } else {
      const { s, m, at } = hints[0]
      if (!/^\{if_==\(\{ini_file\(Meta,kipver\)\},imported,[^,()]*undervolt[^,()]*,\)\}$/.test(m[2]))
        bad.push(`${p.rel}:${at} подсказка про режим андервольта печатается не только для импортированной копии: «${m[2]}»`)
      if (!s.body.includes(';polling=true') || s.body.some(l => l.startsWith(';visibility_condition=')))
        bad.push(`${p.rel}:${s.at} подсказка про режим андервольта не опрашивается или закрыта условием секции — строка обязана быть верной и без перестройки страницы`)
      if (!s.body.includes("ini_file '{ini_file(Restore,Path)}'"))
        bad.push(`${p.rel}:${s.at} подсказка про режим андервольта читает не выбранную копию`)
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

    // (7) Apply and Delete stay on page 1: every page marker after the first comes after both.
    const del39 = secs.find(s => /^\[Delete this backup/.test(s.head))
    if (!del39) bad.push(`${p.rel}: пункта «Delete this backup» нет`)
    const marks39 = secs.filter(s => /^\[@/.test(s.head)).slice(1)
    for (const b of [apply, del39].filter(Boolean))
      for (const m of marks39)
        if (m.at < b.at) bad.push(`${p.rel}:${b.at} «${b.head}» стоит после маркера ${m.head} (строка ${m.at}) — кнопка уехала со страницы 1`)
  }

  /**
   * (8) Page 2 shows ONE GPU curve table per undervolt mode, the one Current shows (14.09.2026).
   * The operator saw two: the working table and the manual one, both ungated, the manual one
   * printing the factory bytes of 184...208 as "408000 mV". For every value Fields 44 can hold
   * exactly one table is visible; its labels and offsets equal Current's variant for that mode
   * (a backup without Fields 44 counts as mode 01); a cell the backup carries is read from the
   * backup, one it does not carry from the kip; Erista has one table and no Mariko curve cell.
   */
  const gpu = { tables: 0, modes: 0 }
  {
    const pageSecs = (txt, from) => {
      const at = txt.search(new RegExp(`^\\[@${from}\\]\\s*$`, 'm'))
      if (at < 0) return []
      const rest = txt.slice(at)
      const end = rest.slice(1).search(/^\[@/m)
      return (end < 0 ? rest : rest.slice(0, end + 1)).split(/\r?\n(?=\[)/)
    }
    const rowsOf = sec => sec.split(/\r?\n/).map(l => l.match(/^'([^']*)'\s*=\s*'(.*)'$/)).filter(Boolean).map(m => {
      const h = m[2].match(/hex_file\(CUST,(\d+),(\d+)\)/), f = m[2].match(/ini_file\(Fields,(\d+)\)/)
      return { label: m[1], value: m[2], kind: h ? 'kip' : f ? 'copy' : null, off: Number((h ?? f)?.[1]), via: m[2].includes('json_file(') ? 'json' : 'calc' }
    })
    const tablesOf = secs => secs.map((s, i) => ({ s, i })).filter(({ s }) => /^\[Header\]/.test(s) && /^'GPU Voltage Table[^']*'\s*=/m.test(s))
      .map(({ s, i }) => ({ head: s, gap: secs[i - 1], info: secs.slice(i + 1).find(x => /^\[Info\]/.test(x)) ?? '',
        rev: s.match(/^;system=(\w+)/m)?.[1] ?? 'both', mode: s.match(/CUST 44 ([0-9A-F]{2})/)?.[1] ?? null, gate: copyGateOf(s) }))
    const cur = tablesOf(pageSecs(readFileSync(join(DIST, 'current.ini'), 'utf8'), 'Page 2'))
    if (!cur.length) bad.push('current.ini: на второй странице нет таблиц «GPU Voltage Table» — сверять копию не с чем')
    const curveM = new Set(fields.filter(f => f.series === 'gpu_curve_mariko').map(f => f.offset))

    for (const p of PAGES) {
      const abs = join(DIST, p.rel)
      if (!existsSync(abs)) continue
      const txt = readFileSync(abs, 'utf8')
      const carried = new Set([...txt.matchAll(/^set-ini-val '\{ini_file\(Backup,Path\)\}' Fields (\d+) /gm)].map(m => Number(m[1])))
      const mine = tablesOf(pageSecs(txt, 'Page 2'))
      gpu.tables += mine.length
      const rev = p.here.toLowerCase()
      const domain = gateDomain(44)
      // First, so the cap on printed lines cannot hide it behind per-mode mismatches.
      if (rev === 'erista') {
        for (const s of pageSecs(txt, 'Page 2'))
          for (const m of s.matchAll(/(?:ini_file\(Fields,|hex_file\(CUST,)(\d+)/g))
            if (curveM.has(Number(m[1]))) bad.push(`${p.rel}: вторая страница Erista читает точку кривой Mariko ${m[1]} — на Erista это строка таблицы CPU`)
      }
      if (!mine.length) { bad.push(`${p.rel}: на второй странице копии нет таблицы GPU — сторож смотрит в пустоту`); continue }
      for (const t of mine) {
        if (!t.gate) continue
        const gl = t.gate.tpl
        for (const [name, sec] of [['[Gap]', t.gap], ['[Info]', t.info]])
          if (!sec || copyGateOf(sec)?.tpl !== gl)
            bad.push(`${p.rel}: ${name} таблицы GPU с затвором «${gl}» не несёт тот же затвор — останется пустой ${name === '[Gap]' ? 'отступ' : 'рамка'}`)
        for (const r of rowsOf(t.info))
          if (!r.value.startsWith('{if_null({list(0)},null,')) bad.push(`${p.rel}: строка «${r.label}» таблицы GPU с затвором печатается при любом режиме`)
        // Title and indent rows need the same wrapper: a shared list alone still prints them in every mode.
        const variant = domain.filter(v => t.gate.on(v)).map(v => v === 'null' ? 'без Fields 44' : v).join(', ')
        for (const [name, sec] of [['[Header]', t.head], ['[Gap]', t.gap]])
          for (const r of rowsOf(sec ?? ''))
            if (!r.label.startsWith('{if_null({list(0)},null,') && !r.value.startsWith('{if_null({list(0)},null,'))
              bad.push(`${p.rel}: вариант таблицы GPU для Fields 44 = ${variant}: строка «${r.label}» секции ${name} без затвора из копии — ${name === '[Gap]' ? 'отступ' : 'заголовок'} печатается при любом режиме`)
      }
      for (const v of domain) {
        gpu.modes++
        const shown = mine.filter(t => !t.gate || t.gate.on(v))
        const say = v === 'null' ? 'без Fields 44' : `Fields 44 = ${v}`
        if (shown.length !== 1) { bad.push(`${p.rel}: при ${say} на второй странице видно таблиц GPU ${shown.length}, а ровно одна`); continue }
        const want = rev === 'erista'
          ? cur.find(t => t.rev === 'erista')
          : cur.find(t => t.rev === 'mariko' && t.mode === (v === 'null' ? '01' : v.slice(0, 2)))
        if (!want) { bad.push(`${p.rel}: при ${say} в Current нет варианта таблицы GPU для сверки`); continue }
        const a = rowsOf(shown[0].info), b = rowsOf(want.info)
        if (a.map(r => r.label).join('|') !== b.map(r => r.label).join('|'))
          bad.push(`${p.rel}: при ${say} подписи таблицы GPU расходятся с Current (${a.length} и ${b.length} строк; «${a.map(r => r.label).find((l, k) => l !== b[k]?.label) ?? '—'}»)`)
        // One mismatch per mode is enough to name the defect; more would crowd out other lines.
        b.some((w, k) => {
          const r = a[k]
          if (!r) return false
          const need = carried.has(w.off) ? 'copy' : 'kip'
          if (r.off !== w.off || r.kind !== need)
            return bad.push(`${p.rel}: при ${say} «${r.label}» читает ${r.kind} ${r.off}, а нужно ${need} ${w.off} (копия ${carried.has(w.off) ? 'несёт' : 'не несёт'} эту ячейку)`)
          if (r.via !== w.via)
            return bad.push(`${p.rel}: при ${say} «${r.label}» показывается ${r.via === 'json' ? 'словарём' : 'вычислением'}, а в Current наоборот — единицы разойдутся`)
          return false
        })
      }
    }
  }

  if (pages !== PAGES.length) problems.push({ sev: 'CRITICAL', what: `страниц менеджера копий ${pages} из ${PAGES.length} — проверка вида смотрит в пустоту` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `вид менеджера копий изменён, а он зафиксирован решением оператора:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the backup manager keeps its frozen face (${pages} pages: two-line passport, red mismatch text, no popups, import hint on Erista only; page 2 shows one GPU curve table per mode, as Current: ${gpu.tables} tables over ${gpu.modes} page-mode pairs)`)
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
      // Same recognition rule as check 37: by the cells written, not by the guards -
      // otherwise removing the guards removes the block from oversight.
      const guarded = new Set(guards.map(g => g.off))
      if (writes.length > 1 && writes.every(w => curveMariko.has(w.off))) {
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
  else if (found !== 2) problems.push({ sev: 'CRITICAL', what: `блоков посева ручной таблицы ${found}, а точек входа две — проверка ST1 сверяет не всё, что пишет кривую` })
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

// ---------------- 43. no text promises the engine inside the ORDINARY release archive
//
// SUBJECT: the ordinary published release archive, which carries no engine. The with-engine
// kit is a separate, and since 08.09.2026 a NORMAL second path (DECISIONS.md) - it is not
// this check's subject, and its own texts are exempt (EXEMPT/SKIP below, INSTALL-engine.txt).
// The heading said "an engine the archive has not carried since 04.09.2026" until 08.09.2026;
// that premise stopped being true while the check itself stayed right.
//
// Fourteen such claims were found by hand on 04.09.2026, one of them printed on the
// operator's screen after every handoff build. Nothing caught them: check 18 pairs the
// promise in LICENSE and NOTICE with the refusal in release.ps1, and looks nowhere else.
// The composition of the archive is settled in one place and repeated in prose in dozens,
// so prose is what rots.
//
// WHAT THIS GUARD ACTUALLY DOES, AND WHAT IT DOES NOT. It does NOT parse tense, and the
// heading of this block must not claim it does. It fires on a paragraph that spells
// `ovlmenu`, ties it to what we ship, and carries no history marker. Until 08.09.2026 a bare
// four-digit year ANYWHERE in the paragraph was such a marker, so a paragraph could date
// itself and go on lying in the present tense; the cross-check found three live ones that
// way. A year now excuses only from the ENCLOSING MARKDOWN HEADING CHAIN, which is where
// this project actually writes "how it worked until 04.09.2026", and the same chain now
// carries EXEMPT. Measured 08.09.2026 over the whole corpus of that day (73 files, 4214
// paragraphs): 0 extra catches, and the heading-chain exemption blinds exactly 2 - RELEASE.md
// "Как это работало до 04.09.2026" and the with-engine composition table under "Релиз с движком".
//
// TWO HOLES LEFT OPEN ON PURPOSE, priced before the decision:
//   * the literal `ovlmenu` is REQUIRED, so "the archive ships the engine" is not looked at
//     at all. Widening it to движок/engine catches 12 more paragraphs, 11 of them false -
//     build steps, the directory map, and the very sentences saying the archive has NO
//     engine. Not widened. Consequence to name out loud: growing CARRIES (везёт/кладёт were
//     added 08.09.2026) buys much less than it reads, because the paragraph must still
//     spell `ovlmenu`.
//   * EXEMPT is read over the WHOLE paragraph, so a paragraph mixing an ordinary-archive
//     claim with a with-engine mention drops out of oversight entirely. Reading EXEMPT per
//     sentence instead catches 6 more, all 6 false. Not narrowed.
{
  const SCAN_DIRS = ['docs', 'Guides', 'Make', '.']
  // Журнал и разведка исключены осознанно: это датированные отчёты, и переписывание
  // их убивает провенанс. INSTALL-engine.txt НЕ законсервирован: с 05.09.2026
  // make-build.ps1 подставляет его вместо INSTALL.txt в каждый комплект С ДВИЖКОМ.
  // Исключён он потому, что описывает именно такой комплект, а предмет надзора здесь
  // один — обычный публикуемый архив релиза, в котором движка нет.
  const SKIP = [/^docs[\/]NOTES\.md$/i, /^docs[\/]research[\/]/i, /^docs[\/]INSTALL-engine\.txt$/i]
  // Форма самого утверждения, а не всякое соседство: «архив НЕСЁТ движок».
  // Без глагола обладания в сеть попадали глоссарий, аудит ссылок и шаги сборки.
  // 08.09.2026 добавлены «везёт» и «кладёт»: ими проза проекта пользуется постоянно
  // («архив везёт config/ultrahand», «сборщик кладёт движок»), а словарь их не знал —
  // то есть самая ходовая форма утверждения проходила мимо сторожа насквозь.
  const CARRIES = /(нес[ёеу]т|содерж(ит|ат)|внутри|едет|везёт|везут|кладёт|кладут|включа(ет|ют)|carr(y|ies|ied)|contains?|ships?|shipped|inside|bundle)/i
  // ОТРИЦАНИЕ СНИМАЕТСЯ ДО ПРОВЕРКИ. Найдено 05.09.2026: сторож ловил глагол обладания
  // где угодно, в том числе внутри «архив НЕ несёт движок» — то есть краснел ровно на той
  // фразе, ради которой заведён. И наоборот: форма множественного числа («сборки
  // содержат ovlmenu.ovl») мимо словаря проходила. Отрицаемые обороты вырезаются
  // из абзаца, и обладание ищется в остатке: абзац, где сказано и «не несёт
  // движок», и «несёт конфигуратор», разбирается по-прежнему верно.
  const NEGATED = /(не\s+(нес[ёеу]т|содерж(ит|ат)|включа(ет|ют)|кладётся|кладутся|кладёт|кладут|едет|везёт|везут)|больше\s+не\s+\S+|does\s+not\s+(carry|contain|ship|include)|no\s+longer\s+\S+|without)/gi
  const ARCHIVE = /(архив|релиз|комплект|поставк|release|archive|kit|[.]zip)/i
  // Комплект на передачу автору прошивки движок НЕСЁТ законно, и сборщик движка
  // законно про движок рассказывает. Предмет надзора один: ОБЫЧНЫЙ публикуемый архив.
  //
  // 08.09.2026 СЮДА ДОБАВЛЕН НАБОР С ДВИЖКОМ, И ЭТО ИСПРАВЛЕНИЕ ДЕФЕКТА, А НЕ ПОБЛАЖКА.
  // С 08.09.2026 выпуск с движком — второй ШТАТНЫЙ состав (`DECISIONS.md`), и он движок
  // несёт законно. А сторож этого состава не знал и краснел на КАЖДОМ честном абзаце
  // про него. Поймано в тот же день: агент, писавший правду про набор первой установки,
  // трижды получил красное и переформулировал абзацы так, чтобы обойти сторожа.
  // КЛАСС ОШИБКИ: СТОРОЖ, ОТСТАВШИЙ ОТ ПРЕДМЕТА, НАЧИНАЕТ ЗАПРЕЩАТЬ ПРАВДУ — и хуже
  // того, учит её не писать, а обход выглядит как зелёный прогон. Изъятие сделано по
  // ЯВНЫМ признакам второго состава (ключ сборки, «с движком», «набор первой установки»),
  // а не ослаблением словаря: обычный архив по-прежнему под полным надзором.
  const EXEMPT = /(handoff|на передач|NoUpload|build(s|ing)? |собирает|сборка движка|-WithEngine|с движком|наборе? первой установки|with the engine|first-install kit)/i
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
    // Цепочка markdown-заголовков H1…H6 над абзацем. Именно она, а не сам абзац, объявляет
    // раздел историей («Как это работало до 04.09.2026») или вторым составом («Релиз
    // с движком»). Год внутри абзаца индульгенцией больше не считается.
    const chain = []
    let path = ''
    const flush = () => {
      const para = buf.join(' ')
      const claim = para.replace(NEGATED, ' ')
      if (buf.length && /ovlmenu/i.test(para) && CARRIES.test(claim) && ARCHIVE.test(para)
        && !EXEMPT.test(para) && !EXEMPT.test(path)
        && !PAST.test(para) && !HISTORY.test(heading) && !HISTORY.test(path))
        bad.push(`${rel}:${start + 1} — «${para.replace(/\s+/g, ' ').trim().slice(0, 95)}…»`)
      buf = []
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) { flush(); continue }
      const h = lines[i].match(/^(#{1,6})\s+(.*)$/)
      if (h) { chain.length = h[1].length - 1; chain[h[1].length - 1] = h[2]; path = chain.filter(Boolean).join(' / ') }
      if (/^\s*(#|rem |::|\|)/.test(lines[i]) && !buf.length) heading = lines[i]
      if (!buf.length) start = i
      buf.push(lines[i])
    }
    flush()
  }

  // Отдельно — положительное утверждение, а не поиск запрещённого: инструкция едет
  // ВНУТРИ архива, и она обязана сказать читателю, что движка в нём нет.
  const instAbs = join(ROOT, 'docs', 'INSTALL.txt')
  // ОБЕ ПОЛОВИНЫ. Файл двуязычный, и до 04.09.2026 стереглась только английская:
  // русский абзац можно было вырезать целиком, а прогон оставался зелёным. Читатель
  // у этого файла в основном русскоязычный — охранялась не та половина.
  const instTxt = existsSync(instAbs) ? readFileSync(instAbs, 'utf8') : ''
  const instHalves = [['английская', /THE ENGINE IS NOT HERE/i], ['русская', /\u0414\u0412\u0418\u0416\u041a\u0410\u0020\u0417\u0414\u0415\u0421\u042c\u0020\u041d\u0415\u0422/]]
  const instMissing = instHalves.filter(([, r]) => !r.test(instTxt)).map(([n]) => n)
  const instSays = existsSync(instAbs) && !instMissing.length

  if (!files.length) problems.push({ sev: 'CRITICAL', what: 'проверка текстов не нашла ни одного файла — она смотрит в пустоту' })
  else if (!existsSync(instAbs)) problems.push({ sev: 'CRITICAL', what: 'docs/INSTALL.txt не найден, а он едет внутри архива' })
  else if (!instSays) problems.push({ sev: 'CRITICAL', what: `docs/INSTALL.txt не говорит читателю, что движка в архиве нет — а он едет внутри архива (${instMissing.join(' и ')} половина молчит)` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `текст обещает читателю движок в поставке, и это не помечено как история:\n     ${bad.slice(0, 10).join('\n     ')}${bad.length > 10 ? `\n     …и ещё ${bad.length - 10}` : ''}` })
  else ok.push(`no text promises an engine in the archive (${files.length} files scanned; INSTALL.txt states it outright)`)
}

// ---------------- 44. every script is decided: published on purpose, or withheld on purpose
//
// The publish whitelist alone keeps a private script out of GitHub, so a script missing
// from BOTH lists leaks nothing - and that is exactly why it went unnoticed. NOTES №80
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
    // A WHOLE DIRECTORY MAY BE DECIDED AT ONCE: 'scripts/uhlint' in $PUBLISH, 'scripts/wsl'
    // and 'scripts/hooks' in $FORBIDDEN. Without this the recursive walk below would call
    // every file under them undecided.
    const listedDirs = new Set()
    for (const m of ps.matchAll(/'scripts\/([\w.-]+)'/g)) if (!/\.(mjs|ps1)$/.test(m[1])) listedDirs.add(m[1])
    // RECURSIVE: uhlint/index.mjs and uhlint/tables.mjs were decided by nobody, because the
    // walk only looked at the top level of scripts/.
    const walkScripts = (dir, prefix = '', acc = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walkScripts(join(dir, e.name), prefix + e.name + '/', acc)
        else if (/\.(mjs|ps1)$/.test(e.name)) acc.push(prefix + e.name)
      }
      return acc
    }
    let names = []
    try { names = walkScripts(join(ROOT, 'scripts')) } catch {}
    const decided = f => listed.has(f.split('/').pop()) || listedDirs.has(f.split('/')[0])
    const undecided = names.filter(f => !decided(f)).sort()
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
  // RECURSIVE. The flat listing never reached scripts/uhlint/index.mjs (476 lines) or
  // uhlint/tables.mjs - and uhlint runs FIRST in publish.ps1, so a syntax error there
  // stops publication. That is the very case this check was raised for.
  const walkScripts = (d, prefix = '', acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walkScripts(join(d, e.name), prefix + e.name + '/', acc)
      else if (/\.(mjs|ps1)$/.test(e.name)) acc.push(prefix + e.name)
    }
    return acc
  }
  let all = []
  try { all = walkScripts(dir) } catch {}
  const files = all.filter(f => f.endsWith('.mjs'))
  const bad = []
  const ps1 = all.filter(f => f.endsWith('.ps1'))
  for (const f of ps1) {
    // Парсер PowerShell зовём его же средствами: разбор без исполнения, ошибки в $e.
    const src = join(dir, f).split(String.fromCharCode(92)).join('/')
    const cmd = `$e=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile('${src}',[ref]$null,[ref]$e);if($e.Count){$e[0].Message}`
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' })
    const out = String(r.stdout || '').trim()
    if (out) bad.push(f + ": " + out.split(String.fromCharCode(10))[0].trim().slice(0, 90))
  }
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', join(dir, f)], { encoding: 'utf8' })
    if (r.status !== 0) {
      const line = String(r.stderr || '').split(/\r?\n/).find(l => /SyntaxError|Error:/.test(l)) || 'не разбирается'
      bad.push(`${f}: ${line.trim().slice(0, 90)}`)
    }
  }
  if (!files.length) problems.push({ sev: 'CRITICAL', what: 'в scripts/ нет ни одного .mjs — проверка разбора смотрит в пустоту' })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `сценарий не разбирается — запустить его нельзя:\n     ${bad.join('\n     ')}` })
  // .ps1 РАЗБИРАЮТСЯ ТОЖЕ, через парсер самого PowerShell. 05.09.2026 выяснилось, что
  // прежняя редакция обещала «их проверяет check-before-release.bat» — батник ничего
  // подобного не делает, он лишь запускает publish.ps1 вхолостую, то есть касается одного
  // файла из четырёх. release.ps1, make-build.ps1 и sync-fork.ps1 не разбирал НИКТО, при том
  // что сама эта проверка заведена после того, как сломанный .mjs пролежал целый коммит.
  else ok.push(`every script in scripts/ parses (${files.length} .mjs + ${ps1.length} .ps1)`)
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

// ---------------- 47. no Erista curve choice can be shifted onto a firmware search constant
//
//
// ⚠ ЭТО ПРЕДУПРЕЖДЕНИЕ, А НЕ ОТКАЗ, И ВОТ ПОЧЕМУ. 05.09.2026 посчитаны вхождения искомых
// чисел в СТОКОВОЙ прошивке 4IFIR (loader.kip, 431700 байт, якорь CUST на 406548):
// 1125000 — два раза (CUST−880 и CUST+6936), 1150000 — ТРИ раза (CUST+2992, +4728, +6992).
// Предел записи «MEM Volt» равен 2. Значит по нашей модели нетронутая консоль уже стояла
// бы за пределом и не грузилась — а она грузится. Модель неполна: либо сканер смотрит не
// те области, либо предел означает не то, либо представление в файле не то, что ищется
// в памяти. Разбора обработчика у нас нет. Поэтому проверка НАЗЫВАЕТ находки, но не
// роняет прогон, и значения из меню не убраны. Понизить до отказа — только после разбора.
// GUARDED: every voltage a human can PICK for an Erista GPU curve point, measured as the
// PCV scanner will see it. The scanner aborts with the descriptor's name on screen when a
// searched constant matches MORE times than its limit; entry 10 `MEM Volt` searches
// 1 125 000 uV and allows two. The compare is raw, so a curve point is indistinguishable.
// FOUR VALUES, NOT ONE: on Erista CUST[44] is a multiplier, V_scanned = V_row - 12500*code,
// and the field takes four codes - 1125.0 / 1137.5 / 1150.0 / 1162.5 mV all reach it.
// REAL CASE: the ±75 mV band around the factory value walks into that family at the four
// top points - twelve non-factory offers today. Check 27 could not see them: it walks
// `series === 'gpu_curve_mariko'`, and the Mariko `scan_guard` list has no 1125000 at all.
// CAVEAT, KEPT HONEST: whether the scanner sees the Erista GPU table AT ALL is NOT PROVEN -
// entry 10's handler was never disassembled. This is a hypothesis, held true because the
// guard is cheap and the failure is a console that will not boot.
{
  // Constants and mode step travel in the map (`scan_guard_erista`) exactly as the Mariko
  // half travels in `scan_guard`, so the gate needs no kip. The two lists stay separate on
  // purpose - see `why_separate_key` beside them.
  let guard = null, carrier = null
  const walkG = n => {
    if (Array.isArray(n)) return n.forEach(walkG)
    if (!n || typeof n !== 'object') return
    if (n.scan_guard_erista && !guard) { guard = n.scan_guard_erista; carrier = n }
    Object.values(n).forEach(walkG)
  }
  walkG(menu.sections ?? [])

  const consts = (guard?.consts ?? []).filter(Number.isInteger)
  const step = Number(guard?.mode_step)
  const series = guard?.series
  // The number of mode codes is the carrier's own option list: it IS the CUST[44] selector,
  // so a fifth code added tomorrow widens the ban by itself instead of quietly not widening.
  const codes = (carrier?.values ?? []).length
  const seriesFields = series ? fields.filter(f => f.series === series) : []

  // Dictionaries are looked up in what actually SHIPPED, not in fields.json: the human picks
  // from the file in dist/, and a check that reads the source would miss a generator that
  // drops or widens the list on the way out.
  const dictByOffset = new Map()
  if (series) {
    const rx = new RegExp(`^${series}_(\\d+)\\.json$`)
    const walkJson = dir => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) { walkJson(p); continue }
        const m = rx.exec(n)
        if (m) dictByOffset.set(Number(m[1]), p)
      }
    }
    walkJson(DIST)
  }

  const banned = new Map()   // forbidden value -> how it is reached
  for (const c of consts)
    for (let k = 0; k < codes; k++)
      if (!banned.has(c + step * k)) banned.set(c + step * k, `${c} при CUST[44]=${k}`)

  const bad = []
  let dicts = 0, offers = 0, factorySkipped = 0
  for (const f of seriesFields) {
    const file = dictByOffset.get(f.offset)
    if (!file) { bad.push(`точка ${f.name} (смещение ${f.offset}) серии «${series}» не имеет словаря в dist — проверять нечего, а пункт в меню есть`); continue }
    dicts++
    const list = JSON.parse(readFileSync(file, 'utf8'))
    for (const v of Array.isArray(list) ? list : []) {
      const uv = parseInt(String(v.hex ?? '').slice(0, 8).match(/../g)?.reverse().join('') ?? '', 16)
      if (!Number.isInteger(uv)) continue
      // The factory value is the one explicit exception: it already stands in the table,
      // nobody picks it, and banning it would ban a stock console. Only new picks add matches.
      if (/default/i.test(String(v.name ?? ''))) { factorySkipped++; continue }
      offers++
      if (banned.has(uv))
        bad.push(`${relative(ROOT, file)}: «${v.name}» = ${uv} мкВ даёт совпадение с ${banned.get(uv)} — лишнее совпадение сканера PCV`)
    }
  }

  if (!guard) problems.push({ sev: 'CRITICAL', what: 'в карте меню нет ключа `scan_guard_erista` — сторож эристовской кривой смотрит в пустоту' })
  else if (!consts.length) problems.push({ sev: 'CRITICAL', what: '`scan_guard_erista.consts` пуст — сторож эристовской кривой смотрит в пустоту' })
  else if (!Number.isInteger(step) || step <= 0) problems.push({ sev: 'CRITICAL', what: `\`scan_guard_erista.mode_step\` = ${guard.mode_step} — сдвиг режима не задан, сторож эристовской кривой смотрит в пустоту` })
  else if (!codes) problems.push({ sev: 'CRITICAL', what: 'у носителя `scan_guard_erista` нет вариантов режима — число кодов CUST[44] неизвестно, сторож смотрит в пустоту' })
  else if (!seriesFields.length) problems.push({ sev: 'CRITICAL', what: `в fields.json нет ни одного поля серии «${series}» — сторож эристовской кривой смотрит в пустоту` })
  else if (!dicts) problems.push({ sev: 'CRITICAL', what: `в dist не нашлось ни одного словаря серии «${series}» — сторож эристовской кривой смотрит в пустоту` })
  else if (!offers) problems.push({ sev: 'CRITICAL', what: `в словарях серии «${series}» не нашлось ни одного НЕзаводского варианта — сторож эристовской кривой смотрит в пустоту` })
  else if (bad.length) problems.push({ sev: 'IMPORTANT', what: `предложенное значение точки кривой Erista даёт лишнее совпадение сканера — консоль не загрузится с надписью «MEM Volt»:\n     ${bad.slice(0, 8).join('\n     ')}${bad.length > 8 ? `\n     … и ещё ${bad.length - 8}` : ''}` })
  else ok.push(`no Erista curve choice lands on a firmware search constant (${offers} offers over ${dicts} points against ${banned.size} banned values from ${consts.length} constants x ${codes} mode codes, ${factorySkipped} factory values excluded)`)
}

// ---------------- 48. no generated line is longer than the engine's read buffer
//
// The engine reads ini files with fgets(buffer, 1024, ...) — libultra/source/ini_funcs.cpp,
// both loadOptionsFromIni and the write path. A longer line is torn in half SILENTLY: no
// error, no log, just a command that ends mid-argument and a second one made of the tail.
// The same buffer is used when any neighbouring key is rewritten, so a too-long line in the
// TARGET file breaks later, far from the change that caused it. Nothing guarded this: the
// longest line in the package is the fan curve at ~630 bytes, and it fit by luck. Bytes,
// not characters — «°» is two of them in UTF-8, and the fan sections are full of it.
{
  const LIMIT = 1023, WARN = 900
  const over = [], near = []
  let lines = 0
  for (const f of iniFiles) {
    const rel = relative(ROOT, f)
    let n = 0
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      n++; lines++
      const bytes = Buffer.byteLength(line, 'utf8')
      if (bytes > LIMIT) over.push(`${rel}:${n} — ${bytes} байт при пределе ${LIMIT}`)
      else if (bytes > WARN) near.push(`${rel}:${n} — ${bytes} байт, до предела ${LIMIT - bytes}`)
    }
  }
  if (!lines) problems.push({ sev: 'CRITICAL', what: 'ни одной строки в собранном пакете — проверка длины смотрит в пустоту' })
  else if (over.length) problems.push({ sev: 'CRITICAL', what: `строка длиннее буфера движка — она будет разорвана пополам молча:\n     ${over.join('\n     ')}` })
  else if (near.length) problems.push({ sev: 'IMPORTANT', what: `строка подошла к пределу буфера движка вплотную:\n     ${near.join('\n     ')}` })
  else ok.push(`every generated line fits the engine's 1023-byte read buffer (${lines} lines checked)`)
}

// ---------------- 50. an item that writes the manual table stays behind the mode gate
//
// Every point of the Mariko curve writes straight into loader.kip, and every one of them
// carries ;visibility_condition=... CUST 44 03 so it only appears while Custom Table is on.
// In any other mode the firmware does not read that array at all, so the item would let a
// person edit bytes that do nothing — and, worse, leave a half-written table behind for the
// day they do switch the mode on. On 05.09.2026 an experiment stripped 31 of those 32
// conditions and the whole gate stayed green: nothing watched them. The seeding guards
// (37, 40) look at try: blocks, not at item visibility, and check 2 searches the package
// as one blob, so a single surviving condition satisfied it for all of them.
//
// TWO HAND-WRITTEN NARROWINGS REMOVED 05.09.2026. The offsets came from a literal range
// `CUST (8[89]|9[26]|1[0-9][0-9]|20[048])`, and the curve has already grown once (24 -> 31):
// the next growth would have left the new points outside it in silence. And only ONE file
// was read, while five more sections in three other files write the same cells. Now the
// offsets come from the map, every ini is scanned, and the number of per-point items must
// equal the number of points the map declares. Bulk writers (seeding, reset, restore) are
// counted apart: they are legitimately ungated and are guarded by checks 36, 37 and 40.
{
  const GATE = /CUST 44 03/
  const writers = [], bare = [], bulk = []
  for (const file of iniFiles) {
    const rel = relative(DIST, file).split(String.fromCharCode(92)).join('/')
    for (const sec of readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)) {
      const name = (sec.match(/^\[([^\]]+)\]/) || [])[1]
      if (!name) continue
      const hits = [...sec.matchAll(/^hex-by-custom-offset[^\n]*CUST (\d+) /gm)]
        .map(m => Number(m[1])).filter(o => curveMariko.has(o))
      if (!hits.length) continue
      if (hits.length > 1) { bulk.push(`${rel} ${name}`); continue }   // seeding / reset / restore
      writers.push(`${rel} ${name}`)
      const vis = sec.split(/\r?\n/).filter(l => l.startsWith(';visibility_condition='))
      if (!vis.some(l => GATE.test(l) && !l.includes('=!'))) bare.push(name)
    }
  }
  if (!curveMariko.size) problems.push({ sev: 'CRITICAL', what: 'в fields.json нет серии gpu_curve_mariko — проверка затвора у точек кривой смотрит в пустоту' })
  else if (!writers.length) problems.push({ sev: 'CRITICAL', what: 'ни один пункт кривой Mariko не пишет в kip — проверка затвора смотрит в пустоту' })
  else if (bare.length) problems.push({ sev: 'CRITICAL', what: `пункт правит ручную таблицу без затвора по режиму — он покажется там, где прошивка её не читает:\n     ${bare.slice(0, 8).join(', ')}${bare.length > 8 ? ` …и ещё ${bare.length - 8}` : ''}` })
  else if (writers.length !== curveMariko.size) problems.push({ sev: 'CRITICAL', what: `пунктов кривой ${writers.length}, а точек в карте ${curveMariko.size} — часть кривой правится не пунктом меню или пункт потерян` })
  else ok.push(`every item that writes the manual curve stays behind the Custom Table gate (${writers.length} items of ${curveMariko.size} mapped points, ${bulk.length} bulk writers left to checks 36/37/40)`)
}

// ИЗВЕСТНЫЕ ПРЕДУПРЕЖДЕНИЯ — ЯВНЫМ СПИСКОМ, И ОН ЕДИНСТВЕННЫЙ.
//
// Everything at IMPORTANT that is not listed here fails the run. Until 05.09.2026 the exit
// looked at CRITICAL alone, so all 21 IMPORTANT verdicts were decoration - and the two
// permanent ones below also killed check 49, whose silence test read "problems is empty".
// Listed warnings are printed, never fail, and each says since when, why, and where the
// reasoning lives. Adding a line here is a decision, not a way to make a run green.
const KNOWN_WARNINGS = [
  {
    since: '30.08.2026',
    match: /^источник не может дать часть строк предпросмотра/,
    why: 'схема донора этих полей не содержит вовсе — значение брать неоткуда, выдумывать нельзя',
    where: 'docs/NOTES.md №193',
  },
  {
    since: '05.09.2026',
    match: /^предложенное значение точки кривой Erista даёт лишнее совпадение сканера/,
    why: 'в kip лежат символы pcv::erista::Patch(uintptr_t, size_t) и pcv::mariko::Patch(…) — сигнатура «адрес, размер» принадлежит патчеру отображённого модуля PCV, а не блоку CUST: пользовательская кривая туда пишется, а не сканируется',
    where: 'docs/IMPROVEMENTS.md U20, docs/NOTES.md №253, №254 и №262',
  },
]
const knownWarning = q => q.sev === 'IMPORTANT' && KNOWN_WARNINGS.find(k => k.match.test(q.what))

// ---------------------------------------------------------------- 52. help reaches the screen

/**
 * КАЖДАЯ СПРАВКА ИЗ КАРТЫ ОБЯЗАНА БЫТЬ В ПАКЕТЕ.
 *
 * Справку пишет человек, а собирает её в страницу `[@Info]` генератор — и делал это только
 * для тех узлов, чей путь он умел обходить. Пункт-форвардер, свёрнутый в подпакет раздел и
 * пункт корня в этот путь не попадали, поэтому их `help` уходил в буфер, который никто не
 * печатал. Ни одна из проверок этого не видела: дерево валидно, смещения на месте, текста
 * просто нет. Четыре справки так и пролежали ненапечатанными до аудита 05.09.2026.
 *
 * Строки в ini переносятся по ширине экрана (`wrap`), поэтому искать надо не построчно:
 * подряд идущие `''='…'` склеиваются обратно в одну строку, и уже в ней ищется текст карты.
 * Апостроф генератор заменяет на обратную кавычку — та же замена делается и в образце.
 */
{
  const unquote = s => s.replace(/'/g, '`').replace(/\s+/g, ' ').trim()
  // склеиваем подряд идущие текстовые строки обратно: перенос по ширине — не разрыв смысла
  const glued = []
  let run = []
  for (const l of lines) {
    const m = l.match(/^''='(.*)'$/)
    if (m) { run.push(m[1]); continue }
    if (run.length) { glued.push(run.join(' ')); run = [] }
  }
  if (run.length) glued.push(run.join(' '))
  const hay = unquote(glued.join('\n'))

  let bad = 0, checked = 0
  for (const it of items) {
    if (typeof it.help !== 'string' || !it.help.trim()) continue
    checked++
    if (hay.includes(unquote(it.help))) continue
    bad++
    problems.push({ sev: 'CRITICAL', what: `"${it.title ?? it.id}" declares help in menu.json, but no screen in dist prints it` })
  }
  if (!checked) problems.push({ sev: 'CRITICAL', what: 'ни один узел карты не объявляет help — проверка справки смотрит в пустоту' })
  else if (!bad) ok.push(`every help line in menu.json is printed somewhere in dist (${checked} texts)`)
}

// ---------------------------------------------------------------- 60. the platform layer is still there
//
// RENUMBERED 53 -> 60 on 08.09.2026: two different guards shared 53. The number went to the
// other one ("открытый список выбора встаёт на текущее значение"), which six references point
// at against this one's single reference (NOTES №271). 1…59 were all taken. NOTES №294.
//
// WHY THIS LIVES HERE AND NOT IN merge-fields. The platform of 43 fields was set BY HAND on
// 13.08.2026 from customize.cpp, because the donors' own marking contradicted itself. No
// script produces it: the source is confidential and will never be in the repository. A
// rebuild of the map silently returns those fields to "both", the ;system= filter collapses,
// and an Erista owner is shown Mariko's curve again — the exact defect that hand-marking fixed.
//
// The loss detector inside merge-fields cannot catch this: it compares offsets and dictionary
// sizes, not attributes, and the _meta counters it checks are rewritten by the same run. A
// guard belongs where the destroyer cannot reach it. Numbers below are floors, not copies:
// they fail on a rollback and survive honest growth.
{
  const withSrc = fields.filter(f => typeof f.platform_source === 'string' && f.platform_source.trim())
  const named   = withSrc.filter(f => /^(mariko|erista)/i.test(f.platform_source))
  const wrong   = named.filter(f => f.platform !== (/^mariko/i.test(f.platform_source) ? 'mariko' : 'erista'))
  const mariko  = fields.filter(f => /gpu_curve_mariko/.test(f.series ?? ''))
  const loose   = mariko.filter(f => f.platform === 'both')
  const sysLines = lines.filter(l => l.startsWith(';system=')).length

  const bad = []
  // 37 today. A drop means the hand-made layer was rebuilt away, not that a field was renamed.
  if (withSrc.length < 30)
    bad.push(`полей с platform_source ${withSrc.length}, а было 37 — ручной слой платформы откатили`)
  // The map must agree with its own trail: a symbol named mariko* cannot be an erista field.
  for (const f of wrong)
    bad.push(`смещение ${f.offset}: platform=${f.platform ?? 'нет'}, а platform_source начинается с «${f.platform_source.slice(0, 12)}»`)
  // 88…208 belong to Mariko by disassembly, not by name: the symbol is declared 24 long.
  if (!mariko.length) bad.push('ни одной точки кривой Mariko в карте — проверка платформы смотрит в пустоту')
  else for (const f of loose)
    bad.push(`точка кривой Mariko ${f.offset} помечена both — на Erista эти байты чужая структура`)
  // What actually breaks. 191 today; a rollback of 33 fields takes a visible bite out of it.
  if (sysLines < 150)
    bad.push(`директив ;system= в пакете ${sysLines}, а было 191 — фильтр по ревизии консоли рассыпался`)

  if (bad.length) problems.push({ sev: 'CRITICAL', what: `разметка по ревизии консоли откатилась:\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the hand-made platform layer is intact (${withSrc.length} fields with a source, ${sysLines} ;system= lines)`)
}

// ---------------- 53. открытый список выбора встаёт на текущее значение, а не на первую строку
//
// ЧТО ПРОВЕРЯЕТСЯ. Открывая `;mode=option`, движок ищет пункт с ГАЛОЧКОЙ и ставит фокус
// на него (`jumpItemValue = CHECKMARK_SYMBOL` под `commandMode == OPTION_STR || … SLOT_STR`,
// форк `source/main.cpp:5808`, у автора прошивки — `:5803`; разрешается
// в `List::resolveJumpImmediately()` → `m_items[i]->matchesJumpCriteria(m_jumpToText,
// m_jumpToValue, m_jumpToExactMatch)`, `libtesla/include/tesla.hpp:7465-7470` в подмодуле
// С НАЛОЖЕННЫМИ `patches/*.patch`, у автора `:7589-7594`). Галочку получает пункт, чьё ИМЯ
// ДО ASCII `" - "` равно футеру, который родитель записал в свой `config.ini`
// (`pos = selectedItem.find(" - ")` … `itemName = selectedItem.substr(0, pos)` режет имя —
// форк `main.cpp:3931-3936`, у автора `:3926-3931`; `if (selectedFooterDict[
// specifiedFooterKey] == itemName)` сравнивает — форк `main.cpp:3958`, у автора `:3953`).
// Не совпало — штатный откат ставит фокус на ПЕРВУЮ строку (`// FALLBACK: If no match found,
// focus first item instead`, `tesla.hpp:7502` в подмодуле с заплатами, `:7466` в чистом
// `HEAD`, у автора `:7626`), и в ряду из 31 значения до своего человек листает шестнадцать
// раз при каждом заходе.
//
// ПОЧЕМУ СТОРОЖ. Обе стороны сравнения порождаем мы сами: левую — ключ `name` словаря,
// правую — ключ `short` (он же значение в словаре подписи). Пока их никто не сверял,
// разошлись 552 записи в 110 словарях из 114, и это прошло все три машинные приёмки
// молча: синтаксис безупречен, смещения на месте, значения влезают. Дефект виден только
// на консоли и только тому, кто заметит, что курсор всегда наверху.
//
// ТРИ УСЛОВИЯ, И КАЖДОЕ ЛОВИТ СВОЮ БЕДУ.
//  1. `short` равен левой части `name` — иначе галочки нет ни у кого.
//  2. Левые части в списке уникальны — иначе галочка достанется первому однофамильцу,
//     и курсор встанет не на то значение, что лежит в kip.
//  3. Словарь подписи называет запись тем же текстом — это ВТОРОЙ писатель футера
//     (`[boot]`, `set-ini-val … footer {json_file(…)}`), и он работает при открытии
//     пакета, тогда как `set-footer` — сразу после выбора. Разойдись они, подпись
//     менялась бы при первом касании, а курсор ломался бы через раз.
//
// Точки кривой третьего условия не имеют: у них подпись СЧИТАЕТСЯ из kip, словаря
// подписи нет вовсе (проверка «curve points are computed» рядом). Там сверяются первые
// два, а согласие счёта с `short` держит `curveShort` в генераторе.
{
  const rows = []          // {rel, list, name, short}
  let sections = 0, checked = 0, entries = 0
  const bad = []

  for (const file of iniFiles) {
    const dir = dirname(file)
    // Секция кончается следующим `[`; внутри ищем связку «выбор + список + футер».
    for (const sec of readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)) {
      const title = (sec.match(/^\[\*([^\]]+)]/) || [])[1]
      if (!title || !/^;mode=option\s*$/m.test(sec)) continue
      sections++
      const src = sec.match(/^json_file_source\s+'([^']+)'\s+name\s*$/m)
      // `file_source` тоже бывает `;mode=option` (выбор копии, импорт): там словаря нет
      // и движок имя не режет вовсе — сверять нечего.
      if (!src) continue
      const listPath = resolve(dir, src[1])
      const rel = relative(ROOT, listPath)
      if (!existsSync(listPath)) { bad.push(`«${title}»: словаря ${src[1]} нет — пункт открывает пустоту`); continue }
      // Оба писателя футера обязаны брать ОДИН ключ. `set-footer` с чем-нибудь другим —
      // это возврат ровно той беды, ради которой ключ `short` и заводился.
      if (!/^set-footer\s+'\{json_file_source\(\*,short\)}'\s*$/m.test(sec)) {
        bad.push(`«${title}»: после выбора футер пишется не ключом short — он разойдётся с подписью при открытии пакета`)
        continue
      }
      let list
      try { list = JSON.parse(readFileSync(listPath, 'utf8')) } catch { bad.push(`«${title}»: словарь ${src[1]} не читается`); continue }
      if (!Array.isArray(list) || !list.length) { bad.push(`«${title}»: словарь ${src[1]} пуст`); continue }
      checked++

      // Словарь подписи лежит рядом под тем же именем. У кривой его нет — подпись считается.
      const mapPath = listPath.replace(/\.json$/, '.map.json')
      const map = existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, 'utf8'))[0] ?? null) : null

      const seenLeft = new Map()
      for (const e of list) {
        if (!e || typeof e.name !== 'string') continue
        entries++
        const p = e.name.indexOf(' - ')
        const left = p === -1 ? e.name : e.name.slice(0, p)
        // "On" and "Off" may not be a row name. `applyLangReplacements(itemName, true);` runs
        // AFTER the item is built (fork source/main.cpp:3951, author's fork :3946 --
        // the `new tsl::elm::ListItem(itemName, …)` above it is fork :3943), so the comparison uses the translated
        // string while the cache keeps the untranslated one -- such a row loses its
        // checkmark for good, even right after being picked. Zero today; this keeps it so.
        if (/^(On|Off)$/.test(left)) bad.push(`${rel}: строка названа «${left}» — движок переводит это имя перед сравнением, но не перед записью в кэш, и галочка теряется навсегда`)
        // DECISIONS 05.09.2026 bans the em dash in `name` outright, not only left of " - ":
        // the tail escaped this guard and shipped «Eco ST1 - Auto — Default» (NOTES №344).
        if (e.name.includes('—')) bad.push(`${rel}: «${e.name}» — длинное тире в имени строки, разделитель только ASCII " - "`)
        if (left !== e.short) bad.push(`${rel}: «${e.name}» → движок ищет «${left}», а футер несёт «${e.short}»`)
        else if (seenLeft.has(left)) bad.push(`${rel}: «${e.name}» и «${seenLeft.get(left)}» дают одну левую часть «${left}» — галочка достанется первой`)
        else seenLeft.set(left, e.name)
        // Ключ подписи обычно равен значению поля — тогда сверяем текст в текст. Но у
        // ступеней ключ составной (значение поля + контрольная ячейка таблицы), и по
        // одному hex запись не адресуется: пар с этим hex несколько, и они РАЗНЫЕ
        // намеренно. Там требуем меньшего и достаточного — чтобы подпись вообще умела
        // назвать эту запись, иначе футер не совпадёт с ней никогда.
        if (map && typeof e.hex === 'string') {
          if (Object.prototype.hasOwnProperty.call(map, e.hex)) {
            if (map[e.hex] !== e.short) bad.push(`${rel}: подпись при открытии пакета зовёт ${e.hex} «${map[e.hex]}», а список — «${e.short}»`)
          } else if (!Object.values(map).includes(e.short)) {
            bad.push(`${rel}: «${e.short}» не встречается в словаре подписи — при открытии пакета футер назовёт запись иначе`)
          }
        }
        rows.push(e)
      }
    }
  }

  // The same ban at the source: fields.json names feed every list, so an em dash there is
  // one generator change away from the screen.
  for (const f of fields) for (const v of f.values ?? [])
    if (typeof v.name === 'string' && v.name.includes('—')) bad.push(`package/fields.json: поле ${f.offset}, «${v.name}» — длинное тире в имени, разделитель только ASCII " - "`)

  // НОЛЬ НАЙДЕННЫХ СПИСКОВ — КРАСНЫЙ. Переименуйся ключ `json_file_source` или каталог
  // словарей, и проверка с этого дня стерегла бы пустоту, печатая зелёную строку.
  if (!sections || !checked || !entries) {
    problems.push({ sev: 'CRITICAL', what: `проверка курсора в списке выбора не нашла предмета надзора (секций ${sections}, словарей ${checked}, записей ${entries}) — она смотрит в пустоту, ничего не проверив` })
  } else if (bad.length) {
    problems.push({ sev: 'CRITICAL', what: `список выбора откроется на первой строке, а не на текущем значении (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}${bad.length > 8 ? `\n     … и ещё ${bad.length - 8}` : ''}` })
  } else {
    ok.push(`the open option list lands on the current value (${checked} dictionaries, ${entries} entries, ${sections} option sections)`)
  }
}

// ---------------- 54. КОРНЕВАЯ ПОДПИСЬ ПЕРЕСЕВАЕТСЯ ПОСЛЕ КАЖДОГО ПРИМЕНЕНИЯ
//
// У разделов подпись чинит форвардер над ними: вошёл — перечитал kip — переписал
// `*/config.ini`. Над КОРНЕМ форвардера нет, и его подпись сеется единственный раз,
// секцией `[boot]` при входе в пакет. Значит любой блок, пишущий kip мимо корневого
// пункта (сброс, восстановление копии), обязан пересеять её сам — иначе `eBAMATIC Stage`
// показывает доприменённое значение до конца сеанса, а человек читает подпись как факт.
//
// Стережём три вещи разом: что блок применения вообще есть, что за каждым `set-footer
// 'restored…'` идёт пересев, и что пересев берёт ТОТ ЖЕ словарь и ТО ЖЕ смещение, что
// и `[boot]`. Третье важнее первых двух: разойдись они, подпись меняла бы смысл
// в зависимости от того, кто её написал последним.
{
  const bootPath = join(DIST, 'boot_package.ini')
  const bootTxt = existsSync(bootPath) ? readFileSync(bootPath, 'utf8') : ''
  // Корневые писатели футера — те, чей путь `./config.ini`, без подкаталога, и пишут они `footer`:
  // флаг поколения 4IFIR (`[Firmware] gen`, 22.09.2026) живёт в том же файле, но подписью не является.
  const rootSeeds = bootTxt.split(/\r?\n/).filter(l => /^set-ini-val '\.\/config\.ini' '[^']+' footer /.test(l))
  // Из `service/` тот же файл и тот же словарь адресуются на уровень выше.
  const want = rootSeeds.map(l => l.replace(/'\.\//g, `'./../`))
  const SERVICE = ['reset.ini', 'restore-mariko.ini', 'restore-erista.ini']
  const bad = []
  let blocks = 0

  for (const name of SERVICE) {
    const p = join(DIST, 'service', name)
    if (!existsSync(p)) { bad.push(`${name}: файла нет — блоку применения негде быть`); continue }
    const ls = readFileSync(p, 'utf8').split(/\r?\n/)
    for (let i = 0; i < ls.length; i++) {
      if (!/^set-footer 'restored/.test(ls[i])) continue
      blocks++
      // Хвост блока — от подписи до его конца: пустая строка, `try:` или новая секция.
      // Длину не считаем: у пересева на каждый пункт своё объявление словаря.
      const tail = []
      for (let j = i + 1; j < ls.length && ls[j].trim() && ls[j] !== 'try:' && ls[j][0] !== '['; j++) tail.push(ls[j])
      if (!tail.includes(`hex_file '/atmosphere/kips/loader.kip'`))
        bad.push(`${name}:${i + 1} «${ls[i]}» — за подписью нет объявления kip, читать нечего`)
      for (const w of want) {
        if (!tail.includes(w)) bad.push(`${name}:${i + 1} «${ls[i]}» — корневая подпись не пересеяна: ждали «${w}»`)
      }
    }
  }

  if (!rootSeeds.length || !blocks) {
    problems.push({ sev: 'CRITICAL', what: `проверка пересева корневой подписи не нашла предмета надзора (корневых подписей ${rootSeeds.length}, блоков применения ${blocks}) — она смотрит в пустоту, ничего не проверив` })
  } else if (bad.length) {
    problems.push({ sev: 'CRITICAL', what: `корневая подпись останется устаревшей до конца сеанса (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}${bad.length > 8 ? `\n     … и ещё ${bad.length - 8}` : ''}` })
  } else {
    ok.push(`the root footer is re-seeded after every apply (${blocks} blocks, ${rootSeeds.length} root footers)`)
  }
}

// ---------------- 55. ЛЮБОЙ ПИШУЩИЙ БАЙТ КОРНЕВОЙ ПОДПИСИ ПЕРЕСЕВАЕТ ЕЁ
//
// Проверка 54 стережёт блоки применения — сброс и восстановление копии. Но тот же байт
// правит обычный пункт: `pMeh 18` пишет 12436 из `advanced/micro-enhance/pmeh/`, и после
// него корневая подпись врёт до конца сеанса. Дверь другая, дефект тот же.
//
// Поэтому правило общее и без имён: берём смещения, которые читают корневые подписи,
// и требуем пересева от КАЖДОГО блока `try:`, который в эти смещения пишет, — в любом
// файле дерева и на любой глубине. Глубина считается по пути: движок разрешает пути
// пакета от каталога, где лежит его ini.
{
  const KIPL = '/atmosphere/kips/loader.kip'
  const bootPath = join(DIST, 'boot_package.ini')
  const bootTxt = existsSync(bootPath) ? readFileSync(bootPath, 'utf8') : ''
  const rootSeeds = bootTxt.split(/\r?\n/).filter(l => /^set-ini-val '\.\/config\.ini' '[^']+' footer /.test(l))
  const rootOffsets = new Set(rootSeeds.flatMap(l =>
    [...l.matchAll(/hex_file\(CUST,(\d+),\d+\)/g)].map(m => Number(m[1]))))
  const WRITE = /^hex-by-\S+\s+\S+\s+CUST\s+(\d+)\s/
  const bad = []
  let writers = 0

  for (const p of iniFiles) {
    const rel = p.slice(DIST.length + 1).split(/[\\/]/)
    const up = rel.length - 1
    const want = [`hex_file '${KIPL}'`, ...rootSeeds.map(l => l.replace(/'\.\//g, `'./${'../'.repeat(up)}`))]
    const ls = readFileSync(p, 'utf8').split(/\r?\n/)
    let start = 0, header = '', writesAt = 0

    const judge = (end) => {
      if (!writesAt) return
      writers++
      const block = ls.slice(start, end)
      // На глубине 0 подпись пункта пишет его собственный `set-footer`, поэтому свою строку
      // с него не спрашиваем; чужую — спрашиваем, второй корневой пункт на том же байте
      // сам себя не починит.
      const self = header.replace(/^\[\*?/, '').replace(/\]$/, '')
      const need = up === 0
        ? want.filter(l => !l.startsWith(`set-ini-val './config.ini' '*${self}' footer `))
        : want
      if (!need.some(l => l.startsWith('set-ini-val'))) return
      for (const w of need) {
        if (!block.includes(w)) bad.push(`${rel.join('/')}:${writesAt} «${header}» — корневая подпись не пересеяна: ждали «${w}»`)
      }
    }

    for (let i = 0; i < ls.length; i++) {
      if (ls[i].startsWith('[') || ls[i] === 'try:') {
        judge(i)
        start = i; writesAt = 0
        if (ls[i].startsWith('[')) header = ls[i]
      }
      const m = WRITE.exec(ls[i])
      if (m && rootOffsets.has(Number(m[1]))) writesAt = i + 1
    }
    judge(ls.length)
  }

  if (!rootSeeds.length || !rootOffsets.size || !writers) {
    problems.push({ sev: 'CRITICAL', what: `общая проверка пересева корневой подписи не нашла предмета надзора (подписей ${rootSeeds.length}, смещений ${rootOffsets.size}, пишущих блоков ${writers}) — она смотрит в пустоту, ничего не проверив` })
  } else if (bad.length) {
    problems.push({ sev: 'CRITICAL', what: `есть пункт, который правит корневой байт и оставляет корневую подпись устаревшей (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}${bad.length > 8 ? `\n     … и ещё ${bad.length - 8}` : ''}` })
  } else {
    ok.push(`every block writing a root-footer byte re-seeds that footer (${writers} blocks, ${rootOffsets.size} offsets)`)
  }
}

// ---------------- 57. the factory-reset screen mirrors the summary
//
// СБРОС ПОКАЗЫВАЕТ ТО ЖЕ И ТАК ЖЕ, ЧТО СВОДКА.
//
// Экран `Restore Factory Defaults` — это сводка, прочитанная из `Default.ini` вместо
// живого kip. Расходиться им нельзя: человек сравнивает два экрана глазами, переводя
// взгляд с одного на другой. Сброс ВПРАВЕ показать меньше строк — заводской снимок
// несёт не всё, — но не вправе показать их в другом порядке, под другим заголовком
// или с другой подписью. Ровно эти три беды и нашлись 05.09.2026, и ни один сторож
// их не видел: оба экрана порождаются из одного набора строк, но между собой
// не сверялись никогда.
{
  // «Подпоследовательность»: пропустить строку, которой нет в снимке, можно;
  // переставить оставшиеся — нельзя.
  const isSub = (small, big) => {
    let j = 0
    for (const s of small) { j = big.indexOf(s, j); if (j < 0) return false; j++ }
    return true
  }
  const parseScreen = file => {
    const out = []
    let sec = null, sys = '', cur = null
    for (const raw of readFileSync(join(DIST, file), 'utf8').split(/\r?\n/)) {
      const l = raw.trim()
      if (l.startsWith('[')) { sec = l; sys = ''; continue }
      if (l.startsWith(';system=')) { sys = l.slice(8); continue }
      if (!l || l.startsWith(';')) continue
      const kv = l.match(/^'([^']*)'\s*=\s*'(.*)'$/)
      if (sec === '[Header]' && kv) { cur = { head: kv[1], ctx: kv[2], sys, rows: [] }; out.push(cur); continue }
      if (sec === '[Info]' && kv && cur) cur.rows.push(kv[1])
    }
    // заголовок без строк — это подпись страницы («What it will apply»), а не блок
    return out.filter(b => b.rows.length)
  }
  const forRev = (blocks, rev) => blocks.filter(b => !b.sys || b.sys === rev)
  const summary = parseScreen('current.ini')
  const reset = parseScreen(join('service', 'reset.ini'))
  let compared = 0
  for (const rev of ['mariko', 'erista']) {
    const S = forRev(summary, rev), R = forRev(reset, rev)
    let i = 0
    for (const rb of R) {
      const at = S.findIndex((sb, k) => k >= i && sb.head === rb.head && isSub(rb.rows, sb.rows))
      if (at < 0) {
        problems.push({ sev: 'CRITICAL', what: `${rev}: блок «${rb.head}» на экране сброса не повторяет сводку — либо такого заголовка там нет, либо строки идут в другом порядке или названы иначе (${rb.rows.slice(0, 4).join(', ')}…)` })
        continue
      }
      if (S[at].ctx !== rb.ctx)
        problems.push({ sev: 'CRITICAL', what: `${rev}: у блока «${rb.head}» подпись справа «${rb.ctx}», а в сводке «${S[at].ctx}» — заголовки двух экранов обязаны совпадать` })
      i = at
      compared += rb.rows.length
    }
  }
  if (!compared) problems.push({ sev: 'CRITICAL', what: 'экран сброса не дал ни одной строки для сверки со сводкой — проверка смотрит в пустоту' })
  else ok.push(`the factory-reset screen mirrors the summary, block for block (${compared} rows compared across both revisions)`)
}

// ---------------- 58. кривые GPU в эталоне сброса, и семь общих ячеек не зовутся напряжением
//
// Дыра была настоящей: до 05.09.2026 сброс кривые не трогал, и на Erista андервольт
// переживал «Apply factory defaults» — сравнения с полем 44 в её коде нет вовсе.
// Разбор — NOTES №278, решение — DECISIONS 05.09.2026.
//
// Стережём три тихие вещи (третья — ниже, у самой сверки):
//   1. ПОЛНОТА. Список смещений выводится из карты (`series === 'gpu_curve_*'`), а не
//      перечисляется. Пропади вывод — эталон вернётся к 74 полям молча: роли `reset`
//      у точек кривой нет, и полнота из проверки 24 их не видит.
//   2. ПОКАЗ. Заводское содержимое 184…208 — не напряжение (`factory_not_a_value`),
//      и печатать его милливольтами значит показать «786986 mV».
{
  const factory = JSON.parse(readFileSync(join(ROOT, 'package', 'factory-defaults.json'), 'utf8')).defaults
  const curve = fields.filter(f => f.series === 'gpu_curve_mariko' || f.series === 'gpu_curve_erista')
  const notAValue = new Set(fields.filter(f => f.factory_not_a_value).map(f => f.offset))
  const bad = []

  // Ноль поднадзорных — красный: серию переименовали, и сторож смотрит в пустоту.
  if (!curve.length)
    bad.push('ни одной точки кривой в карте — проверка эталона кривой смотрит в пустоту')
  if (!notAValue.size)
    bad.push('ни одного поля с factory_not_a_value — половина о показе смотрит в пустоту')

  for (const f of curve) {
    if (blacklist.has(f.offset)) continue
    const hex = factory[String(f.offset)]
    if (hex === undefined) { bad.push(`${f.offset} ${f.name}: точки кривой нет в эталоне — сброс её не тронет`); continue }
    // Длина обязана равняться полю: 24-байтовая запись Erista, обрезанная до трёх байт,
    // затёрла бы хвост записи DVFS нулями выравнивания.
    if (hex.length !== (f.length ?? 3) * 2)
      bad.push(`${f.offset} ${f.name}: в эталоне ${hex.length / 2} байт вместо ${f.length}`)
  }
  // Чёрный список в эталон попадать не должен: 170 лежит вне сетки шага 4.
  for (const off of blacklist)
    if (factory[String(off)] !== undefined)
      bad.push(`${off}: смещение из чёрного списка попало в эталон сброса`)

  const reset = readFileSync(join(DIST, 'service', 'reset.ini'), 'utf8')
  for (const line of reset.split(/\r?\n/)) {
    const m = line.match(/ini_file\(Fields,(\d+)\)/)
    if (!m || !notAValue.has(Number(m[1]))) continue
    if (/hex_to_decimal|mV/.test(line))
      bad.push(`service/reset.ini: ${m[1]} печатается напряжением, хотя заводское содержимое им не является`)
  }

  //   3. ВЫБОР ТАБЛИЦЫ (22.09.2026, фото photo_2026-09-22_10-25-50). Таблица GPU Mariko
  //      на сбросе — та, что Current покажет для заводского Fields 44: подписи и смещения
  //      как у его варианта; ячейку, которую сброс пишет, — из Default.ini, прочие — из kip.
  //      «not a voltage» допустимо только при заводском режиме 03, как мусор в Current.
  const mode58 = String(factory['44'] ?? '').slice(0, 2)
  if (!mode58) bad.push('в эталоне сброса нет поля 44 — таблицу GPU для сверки не выбрать')
  const gpuTables58 = txt => {
    const secs = txt.split(/\r?\n(?=\[)/)
    return secs.map((s, i) => ({ s, i })).filter(({ s }) => /^\[Header\]/.test(s) && /^'GPU Voltage Table'\s*=/m.test(s))
      .map(({ s, i }) => ({
        rev: s.match(/^;system=(\w+)/m)?.[1] ?? 'both', mode: s.match(/CUST 44 ([0-9A-F]{2})/)?.[1] ?? null,
        rows: (secs.slice(i + 1).find(x => /^\[Info\]/.test(x)) ?? '').split(/\r?\n/)
          .map(l => l.match(/^'([^']*)'\s*=\s*'(.*)'$/)).filter(Boolean).map(m => {
            const h = m[2].match(/hex_file\(CUST,(\d+),\d+\)/), f = m[2].match(/ini_file\(Fields,(\d+)\)/)
            return { label: m[1], value: m[2], kind: h ? 'kip' : f ? 'ini' : null, off: Number((h ?? f)?.[1]) }
          }),
      }))
  }
  const rt58 = gpuTables58(reset)
  const cur58 = gpuTables58(readFileSync(join(DIST, 'current.ini'), 'utf8'))
  const rm58 = rt58.filter(t => t.rev === 'mariko'), re58 = rt58.filter(t => t.rev === 'erista')
  if (rm58.length !== 1) bad.push(`service/reset.ini: таблиц GPU Mariko ${rm58.length}, а ровно одна`)
  if (re58.length !== 1) bad.push(`service/reset.ini: таблиц GPU Erista ${re58.length}, а ровно одна`)
  const want58 = cur58.find(t => t.rev === 'mariko' && t.mode === mode58)
  if (mode58 && !want58) bad.push(`current.ini: нет варианта таблицы GPU для режима ${mode58} — сверять сброс не с чем`)
  if (rm58.length === 1 && want58) {
    const a = rm58[0].rows, b = want58.rows
    if (a.map(r => r.label).join('|') !== b.map(r => r.label).join('|'))
      bad.push(`service/reset.ini: подписи таблицы GPU Mariko расходятся с Current при заводском Fields 44 = ${mode58} (${a.length} и ${b.length} строк)`)
    b.some((w, k) => {
      const r = a[k]
      if (!r) return false
      const need = factory[String(w.off)] !== undefined ? 'ini' : 'kip'
      if (r.off !== w.off || r.kind !== need)
        return bad.push(`service/reset.ini: «${r.label}» читает ${r.kind} ${r.off}, а Current при Fields 44 = ${mode58} показывает ${w.off} — нужно ${need} ${w.off}`)
      return false
    })
  }
  if (mode58 && mode58 !== '03' && /not a voltage/.test(reset))
    bad.push(`service/reset.ini: строки «not a voltage» при заводском Fields 44 = ${mode58} — Current в этом режиме ручную таблицу не показывает`)
  const curveM58 = new Set(fields.filter(f => f.series === 'gpu_curve_mariko').map(f => f.offset))
  for (const t of re58)
    for (const r of t.rows)
      if (curveM58.has(r.off)) bad.push(`service/reset.ini: таблица GPU Erista читает точку кривой Mariko ${r.off}`)

  if (bad.length) problems.push({ sev: 'CRITICAL', what: `эталон кривой GPU собран неверно (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the GPU curves are in the factory baseline and the shared cells are not called a voltage (${curve.length} points, ${notAValue.size} cells flagged); the reset page shows the Mariko GPU table Current shows for factory mode ${mode58}`)
}

// ---------------- 51. одно значение — одна запись в словаре поля
//
// ПОРЯДОК СТРОК В КАРТЕ МОЛЧА РЕШАЕТ, КАКАЯ ПОДПИСЬ ПОПАДЁТ НА ЭКРАН.
//
// И список выбора, и карту подписи генератор собирает одним проходом по `values`,
// схлопывая повторы по значению: побеждает ЗАПИСЬ, СТОЯЩАЯ ВЫШЕ (`emitDicts`, ключ
// `dedup`). Значит две записи с одним значением — не безобидный повтор, а выбор подписи,
// сделанный порядком строк. Поменяй их местами при любой будущей правке — и пункт сменит
// имя на экране, не изменив в kip ни одного байта, и диффа с подписью в этом не будет.
//
// Это лежало в дереве, а не выдумано: у `12336 Speed Shift` значение `000000` стояло
// дважды — `eBAMATIC` и `eBamatic`, наследство двух доноров. Перепись по всей карте дала
// 16 таких пар в 12 полях, все убраны 07.09.2026 (NOTES №285); порождённое от этого
// не изменилось ни на байт — лишние записи и так проигрывали.
//
// Ни один сторож их не видел: проверка 19 сверяет подпись с тем, что запись ЗАПИШЕТ,
// внутри одной записи, а «намеренные двойники» в check-menu.mjs — про СМЕЩЕНИЯ, занятые
// двумя пунктами, и к значениям внутри поля отношения не имеют.
//
// ЗАКОННЫЙ ДВОЙНИК ОДИН, И ОН ОБЪЯВЛЯЕТСЯ НЕ СПИСКОМ, А КЛЮЧОМ. Ступени андервольта GPU
// пишут в поле режима один и тот же код и различаются ТОЛЬКО таблицей — поэтому ключ
// здесь тот же, что у генератора: значение ПЛЮС `writes`. Других исключений нет, и
// поимённого списка тоже нет: сегодня в карте нет ни одной пары, которую пришлось бы
// прощать по имени.
//
// Values are compared padded to the field length, exactly as `padHex` in `emitDicts`:
// donor `02` and `020000` are one value and one entry (pruned 13.09.2026, NOTES №305).
{
  const norm = h => String(h ?? '').toUpperCase().replace(/[^0-9A-F]/g, '')
  const pad = (h, len) => { const s = norm(h); return !s ? '' : s.length >= len * 2 ? s.slice(0, len * 2) : s + '0'.repeat(len * 2 - s.length) }
  const dictKey = (v, len) => { const h = pad(v.hex, len); return h && h + (v.writes ? '|' + JSON.stringify(v.writes) : '') }
  const lenAt = new Map(fields.map(f => [f.offset, f.length ?? 3]))
  const dicts = []
  for (const f of fields) if ((f.values ?? []).length) dicts.push({ where: `${f.offset} ${f.name}`, values: f.values, len: f.length ?? 3 })
  // Пункт меню вправе объявить свой ряд вместо ряда поля — это тоже словарь, и он
  // порождается тем же `emitDicts`, с той же дедупликацией.
  ;(function walk (n) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n.values) && n.values.length && n.id !== undefined)
      dicts.push({ where: `пункт «${n.id}»`, values: n.values, len: lenAt.get(n.offsets?.[0]) ?? 3 })
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v)
  })(menu)

  const twins = []
  let entries = 0
  for (const d of dicts) {
    const seen = new Map()
    for (const v of d.values) {
      entries++
      const k = dictKey(v, d.len)
      if (!k) continue
      if (seen.has(k)) twins.push(`${d.where}: значение ${v.hex} объявлено дважды — «${seen.get(k)}» и «${v.name}»; на экран попадёт первое`)
      else seen.set(k, v.name)
    }
  }
  // Ноль поднадзорных — красный: словари переехали, и сторож смотрит в пустоту.
  if (!dicts.length || !entries)
    problems.push({ sev: 'CRITICAL', what: 'ни одного словаря значений в карте — проверка на двойников значений смотрит в пустоту' })
  else if (twins.length)
    problems.push({ sev: 'CRITICAL', what: `одно значение объявлено дважды (${twins.length}) — подпись выбирается порядком строк:\n     ${twins.slice(0, 8).join('\n     ')}` })
  else
    ok.push(`no dictionary declares the same value twice (${dicts.length} dictionaries, ${entries} entries)`)
}

// ---------------- 56. обновление отводит настройки оверлея в сторону и возвращает их
//
// ЧТО СТЕРЕЖЁМ. Цепочка обновления распаковывает архив В КОРЕНЬ КАРТЫ, а `unzip`
// затирает безусловно: ни фильтра, ни пропуска существующего, ни третьего аргумента
// у него нет. Всё, что архив несёт по живым путям движка, ложится поверх настроенного
// человеком. Под ударом ровно две вещи, которых больше неоткуда взять:
// `config/ultrahand/config.ini` — комбинация клавиш, тема, язык, звук — и
// `config/ultrahand/overlays.ini` — порядок, звёзды и скрытые оверлеи. Языки, звуки,
// темы и картинки сюда НЕ входят намеренно: это наша поставка, её обновлять и надо.
//
// ЧТО УЖЕ СЛУЧИЛОСЬ. Механизм спасения был — восемь команд `.keep` копировали настройки
// в сторону перед распаковкой и возвращали после. 04.09.2026 их вырезали с доводом
// «архив больше не несёт `config/ultrahand/`, спасать нечего». Довод был верен три дня:
// 07.09.2026 вышел релиз с движком, архив снова привёз 41 файл по тем же путям, а защиты
// уже не было. КЛАСС ОШИБКИ: ЗАЩИТУ СНЯЛИ, ПОТОМУ ЧТО ИСЧЕЗ ПРЕДМЕТ, И НЕ ВЕРНУЛИ,
// КОГДА ПРЕДМЕТ ВЕРНУЛСЯ. Разбор — `docs/NOTES.md`, решение — `docs/DECISIONS.md`.
//
// ПОЧЕМУ ПРОВЕРКА НЕ СМОТРИТ В АРХИВ. Состав архива решается НА СБОРКЕ — ключом
// `-WithEngine`, который оператор разрешает отдельно на каждый выпуск. Гейт смотрит
// на ПАКЕТ, и пакет обязан быть готов к худшему составу, а не к сегодняшнему: отведение
// ничего не стоит, когда затирать нечего, а условное поведение — ровно та развилка,
// на которой мы и погорели. Поэтому проверка требует отведения ВСЕГДА и безусловно.
//
// 08.09.2026 `overlays.ini` СНАЧАЛА перестал ездить в архиве, и вопрос «убрать ли его
// отсюда» встал ровно в той же форме, что 04.09: предмета не стало — снять защиту.
// НЕ СНЯЛИ — и правильно сделали: к вечеру того же дня изъятие отменили (довод под ним
// оказался наполовину ложным, `NOTES` №293), файл снова в архиве, и защита понадобилась
// ровно там, где её собирались убрать. Довод, который тогда удержал: состав архива
// решается ключом на сборке, а этот список — про то, что цепочка обязана УМЕТЬ.
// Отвод лишнего файла стоит двух команд и не стоит ничего на карте, где файла нет.
//
// ПОЧЕМУ КАЖДЫЙ ШАГ ДОКАЗЫВАЕТСЯ ОТДЕЛЬНО. `copy`, `move` и `delete` об ошибке
// не сообщают вовсе (`path_funcs.cpp`: возвращают void и молча выходят по неудачному
// `stat`), поэтому «отвели» подтверждается только `path_exists` на отводе. А «вернули»
// на живом пути не подтверждается ничем — файл там лежит в любом случае, его только что
// положила распаковка; отсюда возврат через `move` и `!path_exists` на опустевшем отводе.
{
  // Список поднадзорного объявлен здесь и пуст быть не может: пустой список сделал бы
  // проверку зелёной ровно в том случае, ради которого она и заведена.
  const USER_SETTINGS = [
    ['/config/ultrahand/config.ini', 'комбинация клавиш, тема, язык, звук'],
    ['/config/ultrahand/overlays.ini', 'порядок, звёзды и скрытые оверлеи'],
  ]
  let bad56 = 0, kept56 = 0, proofs56 = 0, branches56 = 0
  const fail56 = what => { bad56++; problems.push({ sev: 'CRITICAL', what }) }
  // Разбор строки на команду и аргументы: пути в пакете стоят в одинарных кавычках,
  // но не все — `delete /config/...zip` написан без них.
  const argsOf = line => (line.match(/'[^']*'|\S+/g) ?? []).map(a => a.replace(/^'|'$/g, ''))
  const rootIni56 = join(DIST, 'package.ini')
  if (!USER_SETTINGS.length) {
    fail56('список настроек оверлея пуст — проверке на отведение нечего стеречь')
  } else if (!existsSync(rootIni56)) {
    fail56('нет package.ini — цепочку обновления проверить не на чем')
  } else {
    const chunks56 = readFileSync(rootIni56, 'utf8').split(/^(?=\[)/m).filter(c => c.trim())
    const upd = chunks56.find(c => /^\[Update\b/.test(c.split(/\r?\n/)[0] ?? '') && /^unzip\s/m.test(c))
    if (!upd) {
      fail56('в корне нет пункта обновления с распаковкой — предмет надзора исчез, а не исправился')
    } else {
      // Блоки `try:` — это ветви: первая ставит обновление, вторая откатывает.
      // Возврат обязан быть в ОБЕИХ: откат возвращает пакет уже после того, как
      // распаковка успела затереть настройки.
      const blocks = [[]]
      for (const raw of upd.split(/\r?\n/).slice(1)) {
        const l = raw.trim()
        if (l === 'try:') blocks.push([])
        else if (l) blocks[blocks.length - 1].push(l)
      }
      const main = blocks[1] ?? []
      const rollback = blocks[2] ?? []
      const unzipAt = main.findIndex(l => /^unzip\s/.test(l))
      if (unzipAt < 0) {
        fail56('в первой ветви обновления нет распаковки — проверять отведение не от чего')
      } else {
        for (const [live, what] of USER_SETTINGS) {
          // (а) отвод ДО распаковки: команда, читающая живой путь и кладущая копию в сторону.
          const stashAt = main.findIndex((l, i) => {
            const a = argsOf(l)
            return i < unzipAt && (a[0] === 'copy' || a[0] === 'move') && a[1] === live && a[2] && a[2] !== live
          })
          if (stashAt < 0) {
            fail56(`обновление не отводит «${live}» в сторону перед распаковкой — ${what} будут затёрты архивом без следа`)
            continue
          }
          const side = argsOf(main[stashAt])[2]
          if (side.startsWith('/switch/.packages/')) {
            fail56(`«${live}» отводится в «${side}» — это каталог пакета, его же и переносит обновление; отвод обязан лежать вне зоны работ`)
            continue
          }
          // (б) отвод ДОКАЗАН: `copy` молчит об ошибке, значит копия проверяется явно.
          const stashProved = main.some((l, i) => i > stashAt && i < unzipAt && /^path_exists\s/.test(l) && argsOf(l)[1] === side)
          if (!stashProved) {
            fail56(`отвод «${live}» ничем не подтверждён — copy об ошибке не сообщает, нужен path_exists на «${side}» до распаковки`)
            continue
          }
          proofs56++
          // (в) и (г) возврат ПОСЛЕ распаковки, в обеих ветвях, и он тоже доказан.
          let branchesFor = 0
          for (const [name, block, after] of [['своей', main, unzipAt], ['откатной', rollback, -1]]) {
            const backAt = block.findIndex((l, i) => {
              const a = argsOf(l)
              return i > after && (a[0] === 'copy' || a[0] === 'move') && a[1] === side && a[2] === live
            })
            if (backAt < 0) {
              fail56(`в ${name} ветви обновления «${live}» не возвращается из «${side}» — ${what} останутся нашими поставочными`)
              continue
            }
            // Доказательство возврата — на ОТВОДЕ, а не на живом пути: живой путь
            // существует в любом случае, его только что заполнила распаковка.
            const backProved = block.some((l, i) => i > backAt && /^!path_exists\s/.test(l) && argsOf(l)[1] === side)
            if (!backProved) {
              fail56(`возврат «${live}» в ${name} ветви ничем не подтверждён — нужен !path_exists на опустевшем «${side}», проверка живого пути не доказывает ничего`)
              continue
            }
            proofs56++
            branchesFor++
          }
          if (branchesFor === 2) kept56++
          branches56 = Math.max(branches56, branchesFor)
        }
      }
    }
  }
  if (!bad56)
    ok.push(`the updater stashes overlay settings and puts them back (${kept56} files, ${branches56} branches each, ${proofs56} proofs)`)
}

// ---------------- 7. набор первой установки везёт порядок оверлеев, и это требование безусловно
//
// ЧТО СТЕРЕЖЁМ. `config/ultrahand/overlays.ini` — ЕДИНСТВЕННЫЙ носитель порядка оверлеев
// на экране. Нет файла — движок строит список сам, всем ставит `priority=20`
// (форк source/main.cpp:6794-6800, у автора прошивки
// source/main.cpp:6787-6793 — от overlaySection[PRIORITY_STR] = "20"
// до overlaySection["custom_version"] = ""; снимок адресов 08.09.2026)
// и выстраивает по алфавиту из NACP. Поэтому у комплекта, который
// несёт `config/ultrahand/` (то есть у набора первой установки, собираемого с движком),
// этот файл обязан быть.
//
// ПОЧЕМУ ТРЕБОВАНИЕ, А НЕ ЗАПРЕТ. До 08.09.2026 под этим номером стоял ОБРАТНЫЙ сторож:
// файл не должен ехать никогда. Довод был — `mode_args`/`mode_labels` у
// Status-Monitor-Overlay.ovl движок только ЧИТАЕТ (`splitIniList(getValue("mode_args"))`
// и `splitIniList(getValue("mode_labels"))` — форк source/main.cpp:2226, 2248, 2250, 2378,
// у автора прошивки — :2221, 2243, 2245, 2373; снимок адресов 08.09.2026),
// а наш файл сотрёт их безвозвратно. Первая половина довода верна: записи этих ключей
// в движке нет ни одной. Вторая ЛОЖНА, и это выяснилось только на четвёртой проверке:
// оба списка значений ВМЕСТЕ С ИМЕНЕМ СВОЕЙ СЕКЦИИ лежат внутри самого
// Status-Monitor-Overlay.ovl (смещения ~1088368 и ~1203904 в двух его версиях). Держать
// значения в себе нужно, только чтобы их ПИСАТЬ — оверлей прописывает их себе сам.
// КЛАСС ОШИБКИ: СТОРОЖА ПОСТАВИЛИ НА НЕПРОВЕРЕННУЮ ПОЛОВИНУ ДОВОДА, и он полсуток
// стерёг ровно то, чего делать было не надо.
//
// ПОЧЕМУ ПРОПАЖУ ФАЙЛА ОБЯЗАН ЛОВИТЬ СКРИПТ. Она не ломает ничего громко: комплект
// соберётся, поставится и запустится — и покажет чужой порядок. 08.09.2026 это
// обнаружилось единственным способом, каким такое и обнаруживается: человек поставил
// набор на новую карту и увидел глазами. Второй раз так узнавать нельзя.
//
// ПОЧЕМУ ПРОВЕРКА СМОТРИТ В ТЕКСТ СКРИПТА. Архива у гейта нет и быть не может: гейт
// гоняют на пакете, а комплект собирается отдельно и позже. Зато отказ — это текст,
// и его исчезновение видно. Форма та же, что у проверки 18.
//
// И ТРЕБОВАНИЕ ОБЯЗАНО БЫТЬ БЕЗУСЛОВНЫМ — внутри своей ветви. Внешнее условие про наличие
// каталога это не ключ, а адресат: комплект без движка его не несёт вовсе (make-build.ps1,
// ветвь `-PackageOnly`) и порядка оверлеев не требует. А сам отказ внутри обязан висеть
// на одном условии — отсутствии файла; любой `-and`/`-or` рядом с ним есть тот самый
// ключ, которого здесь быть не должно.
//
// ПОСТОЯННАЯ ПРОБА ЕСТЬ (08.09.2026): «у отказа по порядку оверлеев появилось второе
// условие» в PROBES. До этого дня сторожа показывали красным только разовой ручной
// порчей. Риск порчи выпускающего скрипта взвешен и назван там же: гейт release.ps1
// не ЗАПУСКАЕТ, а читает как текст, поэтому испорченным он никогда не исполняется.
{
  const relPs7 = join(ROOT, 'scripts', 'release.ps1')
  const REQUIRED7 = [
    ['путь до overlays.ini в стейдже не назван — проверять нечего',
      /\$overlaysInStage\s*=\s*Join-Path\s+\$stage\s+'config\\ultrahand\\overlays\.ini'/],
    ['отказа по собранному комплекту нет — набор первой установки уедет без порядка оверлеев молча',
      /if\s*\(-not \(Test-Path -LiteralPath \$overlaysInStage\)\)\s*\{[\s\S]{0,900}?throw/],
    ['отказ не привязан к наличию config\\ultrahand — он сработал бы и на комплекте без движка, где этого каталога нет намеренно',
      /if\s*\(Test-Path -LiteralPath \(Join-Path \$stage 'config\\ultrahand'\)\)\s*\{/],
  ]
  let bad7 = 0, have7 = 0
  if (!existsSync(relPs7)) {
    // Выпускающий скрипт в публикацию не входит; у постороннего дерева второй стороны нет.
    // Пропуск назван вслух, а не выдан за проверку — так же, как в проверке 18.
    ok.push('the first-install kit requirement is unreadable here — scripts/release.ps1 is withheld from publication (1 side missing)')
  } else {
    const ps7 = readFileSync(relPs7, 'utf8')
    for (const [what, re] of REQUIRED7) {
      if (re.test(ps7)) have7++
      else { bad7++; problems.push({ sev: 'CRITICAL', what: `release.ps1: ${what}` }) }
    }
    // Условие самого отказа читается целиком и обязано быть ровно одно.
    const at7 = ps7.indexOf('$overlaysInStage =')
    const guard7 = at7 < 0 ? null : ps7.slice(at7).match(/\bif\s*\(-not \(([^\r\n]+?)\)\)\s*\{/)
    if (guard7 && guard7[1].trim() !== 'Test-Path -LiteralPath $overlaysInStage') {
      bad7++
      problems.push({ sev: 'CRITICAL', what: `отказ по overlays.ini обусловлен «${guard7[1].trim()}» — он обязан висеть на одном условии: ключа, разрешающего выпустить набор первой установки без порядка оверлеев, не предусмотрено` })
    }
    if (!bad7) ok.push(`the release refuses a first-install kit with no overlay order in it (${have7} clauses, no switch lifts it)`)
  }
}

// ---------------- 59. порядок оверлеев объявлен один раз и не несёт чужих ключей
//
// ЧТО СТЕРЕЖЁМ, ПЕРВОЕ: САМ ПОРЯДОК. Он записан в `config/ultrahand/overlays.ini` и
// больше нигде — второго списка приоритетов в дереве нет. Значит и сверять его не с чем:
// сторож несёт эталон в себе. Порядок задан оператором словами — «4IFIR NextGen, под ним
// Status Monitor, дальше FPS Locker, InfoNX, ReverseNX; остальные как получится» — и
// именно эти пять имён, именно в этом порядке, тут и проверяются. Правка файла без правки
// этой строки означает, что порядок поменяли, не заметив.
//
// ЧТО СТЕРЕЖЁМ, ВТОРОЕ: ЧУЖИЕ КЛЮЧИ. Файл распаковывается в корень карты и ложится
// ЦЕЛИКОМ, поверх того, что там было. Пока в нём только `priority`, потеря невелика:
// остальные ключи движок пересоздаёт сам теми же значениями (форк source/main.cpp:6794-6800, у автора прошивки
// source/main.cpp:6787-6793 — от overlaySection[PRIORITY_STR] = "20"
// до overlaySection["custom_version"] = ""; снимок адресов 08.09.2026).
// Но стоит попасть в него ключу, которого движок НЕ пишет, — и мы начинаем раздавать
// чужое как своё. Так уже случалось в этом проекте: файл с живой карты попадает в
// репозиторий вместе с `mode_args`, `mode_labels`, `star=true`, `custom_name`. Список
// разрешённого — ровно те семь ключей, которые движок заводит сам.
//
// ПОЧЕМУ НЕ СВЕРЯЕТСЯ С ЖИВОЙ КАРТОЙ. Неизданная сборка 4IFIR — снимок обжитой карты, а не эталон
// поставки: рядом лежат `fuse.ini` (калибровка конкретной консоли), `theme.ini`,
// `RELEASE.ini`. В самой сборке 4IFIR каталога `config/ultrahand` нет вовсе. Сверять наш
// файл с чужим снимком значило бы объявить эталоном чью-то настройку.
{
  const ordPath = join(ROOT, 'config', 'ultrahand', 'overlays.ini')
  // Порядок, заданный оператором. Первый столбец — имя файла оверлея, второй — приоритет.
  const ORDER59 = [
    ['4IFIR.ovl', 1],
    ['Status-Monitor-Overlay.ovl', 2],
    ['FPSLocker.ovl', 3],
    ['InfoNX-ovl.ovl', 4],
    ['ReverseNX-RT-ovl.ovl', 5],
  ]
  // Семь ключей, которые движок заводит сам (форк source/main.cpp:6794-6800, у автора прошивки
  // source/main.cpp:6787-6793; снимок адресов 08.09.2026). Всё, чего здесь нет,
  // движок только читает, а значит мы бы это раздавали, а не восстанавливали.
  const ENGINE_KEYS59 = ['priority', 'star', 'hide', 'use_launch_args', 'launch_args', 'custom_name', 'custom_version']
  let bad59 = 0
  const fail59 = what => { bad59++; problems.push({ sev: 'CRITICAL', what }) }
  if (!existsSync(ordPath)) {
    fail59('нет config/ultrahand/overlays.ini — порядок оверлеев задать больше негде, набор первой установки покажет алфавитный')
  } else {
    const txt59 = readFileSync(ordPath, 'utf8')
    const sections59 = []
    let cur59 = null
    for (const raw of txt59.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith(';')) continue
      const m = line.match(/^\[(.+)\]$/)
      if (m) { cur59 = { name: m[1], keys: new Map() }; sections59.push(cur59); continue }
      const kv = line.match(/^([^=]+)=(.*)$/)
      if (kv && cur59) cur59.keys.set(kv[1].trim(), kv[2].trim())
    }
    if (!sections59.length) fail59('config/ultrahand/overlays.ini не содержит ни одной секции — порядок оверлеев пуст')
    const got59 = sections59.map(x => `${x.name}=${x.keys.get('priority')}`).join(', ')
    const want59 = ORDER59.map(([n, pr]) => `${n}=${pr}`).join(', ')
    if (got59 !== want59)
      fail59(`порядок оверлеев в config/ultrahand/overlays.ini разошёлся с заданным: «${got59}» вместо «${want59}» — если порядок поменяли намеренно, поправьте эталон в проверке 59`)
    for (const sec of sections59)
      for (const k of sec.keys.keys())
        if (!ENGINE_KEYS59.includes(k))
          fail59(`config/ultrahand/overlays.ini, секция [${sec.name}]: ключ «${k}» движок не пишет никогда — он приехал с чужой карты, и мы бы раздавали его как свой`)
    if (!bad59) ok.push(`the shipped overlay order says what the operator asked (${sections59.length} sections, priorities ${ORDER59.map(x => x[1]).join('-')}, no keys the engine never writes)`)
  }
}

// ---------------- 62. the Magician page is invisible to an engine that cannot page it
//
// The third Current page exists only on our engine. The author's engine treats an unknown
// condition mode as false, so a section carrying `engine_feature pages` is not drawn there
// and the marker stops being a marker. One section without it and that engine shows it on
// page 2, or renames page 2. And `!page_flag view` is TRUE there, so the view condition
// alone hides nothing. Each section also has to belong to exactly one view.
// Paged Y view (fork 71cc8f43): the marker names the file and the page size, every profile
// slot reads its section through {page_view_first}, and the slots cover exactly one page -
// fewer and profiles fall between pages, more and they repeat on the next one.
// Backup manager (14.09.2026): the same page for the chosen backup. Its values come from the
// backup file, never from the kip, so page 3 there carries no hex_file.
// Revision offset (14.09.2026): the RAM clock is CUST 32 on Mariko and CUST 24 on Erista, eBAL
// and E-Boost are 12352 and 12492 on both. Current picks the revision by ;system=, a backup
// page by its file name; each current-view table reads its own clock offset and nothing else.
// Optimized Target (20.09.2026): the E-state profile is named after the base clock the kip
// picks - 1600 with CUST 12524 = 01, 1331 with 00 - so the page must build that name from the
// field and never from a literal 1600. The menu items eVDQ/eVD2 write by the same name, so a
// literal here would also mean writing into a profile the firmware never reads. The timings
// table itself holds twelve timings and nothing else: the two Magician voltages belong to the
// Optimized Mode block on page 2, not here (operator, 20.09.2026; guarded by check 66).
// Button hint: each view carries a row with the A and Y glyphs (U+E0E0, U+E0E3); `A MC` is gone.
// Backup binding: every current-view table that reads anything binds config.ini, then the
// chosen backup (Fields/Meta read only there), then emc_timings.ini (timings only after it).
{
  const FEAT62 = ';visibility_condition=engine_feature pages'
  const CUR62 = ';visibility_condition=!page_flag view'
  const ALL62 = ';visibility_condition=page_flag view'
  const FREQ62 = { mariko: 32, erista: 24 }
  const SHARED62 = [12352, 12492, 12524]
  const LABEL62 = { 'current.ini': 'Current', 'service/restore-mariko.ini': 'Backup manager Mariko', 'service/restore-erista.ini': 'Backup manager Erista' }
  const CFG62 = "ini_file './config.ini'"
  const BIND62 = "ini_file '{ini_file(Restore,Path)}'"
  const TIM62 = "ini_file '/config/4IFIR/emc_timings.ini'"
  const SPLIT_NL = new RegExp('\r?\n')
  const said62 = []
  const bad = []
  const broken62 = new Set()
  let perCur62 = 0
  for (const rel62 of ['current.ini', 'service/restore-mariko.ini', 'service/restore-erista.ini']) {
  const cur = join(DIST, rel62)
  const copy62 = rel62 !== 'current.ini'
  const txt62 = existsSync(cur) ? readFileSync(cur, 'utf8') : ''
  const at62 = txt62.search(/^\[@Magician\]\s*$/m)
  if (at62 < 0) {
    broken62.add(LABEL62[rel62])
    bad.push(`${LABEL62[rel62]}: в ${rel62} нет маркера [@Magician] — третья страница пропала, сторож смотрит в пустоту`)
  } else {
    const secs = txt62.slice(at62).split(/\r?\n(?=\[)/)
    const has = (s, d) => s.split(/\r?\n/).some(l => l.trim() === d)
    const from62 = bad.length
    let nCur = 0, nAll = 0
    if (!has(secs[0], FEAT62)) bad.push('маркер [@Magician] без engine_feature pages — движок автора сочтёт его страницей и переименует вторую')
    if (!has(secs[0], ';page_toggle')) bad.push('маркер [@Magician] без ;page_toggle — A и Y на странице не заработают')
    const pv62 = secs[0].split(/\r?\n/).map(l => l.trim()).map(l => l.match(/^;page_view_source=\/config\/4IFIR\/emc_timings\.ini,(\d+)$/)).find(Boolean)
    const perPage62 = pv62 ? Number(pv62[1]) : 0
    if (!perPage62) bad.push('маркер [@Magician] без ;page_view_source=/config/4IFIR/emc_timings.ini,<perPage> — Y не листает профили')
    const body62 = secs.slice(1).join('\n')
    const reads62 = body62.split('{ini_file_sorted(').length - 1
    const slots62 = new Set([...body62.matchAll(/\{ini_file_sorted\(\{math\(\{page_view_first\}\+(\d+),true\)\}\)\}/g)].map(m => Number(m[1])))
    const paged62 = [...body62.matchAll(/\{ini_file_sorted\(\{math\(\{page_view_first\}\+\d+,true\)\}\)\}/g)].length
    if (!reads62) bad.push('в виде «все профили» нет ни одного {ini_file_sorted} — слоты профилей пропали')
    else if (paged62 !== reads62) bad.push(`${reads62 - paged62} из ${reads62} чтений {ini_file_sorted} идут мимо {page_view_first} — Y покажет одни и те же профили на каждой странице`)
    if (perPage62 && (slots62.size !== perPage62 || [...slots62].some(k => k >= perPage62))) bad.push(`слоты не покрывают страницу: слотов ${slots62.size}, в маркере по ${perPage62}`)
    if (/Only the first \d+ profiles/.test(body62)) bad.push('осталась сноска «Only the first N profiles» — при листании она лжёт')
    // The E-state profile name comes from Optimized Target, never from a literal clock.
    const TGT62 = copy62 ? '{ini_file(Fields,12524)}' : '{hex_file(CUST,12524,1)}'
    if (/1600CL/.test(body62)) bad.push('секция блока E собрана литералом 1600 — при Optimized Target = 0 база 1331, и тайминги с напряжениями уедут в чужой профиль')
    if (!body62.includes(TGT62)) bad.push(`блок E не читает Optimized Target (${TGT62}) — базовая частота профиля взята с потолка`)
    // The two Magician voltages are NOT timings and must not sit in this table: the operator
    // moved them to the Optimized Mode block on page 2, where check 66 guards them.
    for (const nm62 of ['VDDQ', 'VDD2']) {
      if (body62.split(SPLIT_NL).some(l => l.startsWith(`'${nm62}' = '`)))
        bad.push(`в таблице таймингов стоит строка «${nm62}» — напряжения не тайминги, их место в блоке Optimized Mode на странице 2`)
    }
    if (!copy62) perCur62 = perPage62
    else {
      if (perPage62 !== perCur62) bad.push(`размер страницы профилей ${perPage62}, а в Current ${perCur62} — Y листает иначе, чем там`)
      if (/^hex_file /m.test(body62)) bad.push('на странице копии есть hex_file — частота и eBAL обязаны браться из выбранной копии, а не из kip')
      if (!body62.includes("ini_file '{ini_file(Restore,Path)}'")) bad.push('страница копии не читает выбранную копию (нет ini_file на {ini_file(Restore,Path)})')
    }
    for (const s of secs.slice(1)) {
      const name = s.split(/\r?\n/)[0]
      if (!has(s, FEAT62)) bad.push(`${name}: нет engine_feature pages — на движке автора таблица покажется`)
      const c = has(s, CUR62), a = has(s, ALL62)
      if (c === a) bad.push(`${name}: ${c ? 'оба вида сразу' : 'ни одного вида'} — секция обязана нести ровно одно из page_flag view / !page_flag view`)
      else if (c) nCur++
      else nAll++
    }
    if (!nCur || !nAll) bad.push(`видов на странице: текущие ${nCur}, все профили ${nAll} — один из видов пропал`)
    let src62 = ''
    if (!copy62) {
      // Current: a table that touches the kip names one revision and reads that revision's clock.
      const clock62 = { mariko: 0, erista: 0 }
      for (const s of secs.slice(1)) {
        if (!has(s, CUR62)) continue
        const ls = s.split(/\r?\n/).map(l => l.trim())
        const name = ls[0]
        const offs = new Set(ls.flatMap(l => [...l.matchAll(/^;visibility_condition=!?matching_hex_val_custom \S+ CUST (\d+) |\{hex_file\(CUST,(\d+),/g)].map(m => Number(m[1] ?? m[2]))))
        if (!offs.size) continue
        const sys = ls.filter(l => l.startsWith(';system=')).map(l => l.slice(8))
        if (sys.length !== 1 || !(sys[0] in FREQ62)) {
          bad.push(`${name}: читает kip (CUST ${[...offs].join(', ')}), но ревизия не задана одним ;system= (${sys.join(', ') || 'нет'}) — частоту одной ревизии покажет на другой`)
          continue
        }
        const rev = sys[0], own = FREQ62[rev]
        const alien = [...offs].filter(o => o !== own && !SHARED62.includes(o))
        if (alien.length) bad.push(`${name} (;system=${rev}): читает CUST ${alien.join(', ')} — частота ${rev} лежит в CUST ${own}, eBAL и E-Boost в CUST ${SHARED62.join(' и ')}`)
        const reads = new Set(ls.flatMap(l => [...l.matchAll(/\{hex_file\(CUST,(\d+),/g)].map(m => Number(m[1]))))
        if (!reads.size) continue
        clock62[rev]++
        if (!ls.includes("hex_file '/atmosphere/kips/loader.kip'")) bad.push(`${name} (;system=${rev}): читает CUST без hex_file на loader.kip`)
        if (!reads.has(own) || !reads.has(SHARED62[0])) bad.push(`${name} (;system=${rev}): таблица читает CUST ${[...reads].join(', ')} — нет частоты CUST ${own} или eBAL CUST ${SHARED62[0]}`)
      }
      // blind lines go first: the headline shows only six
      for (const rev in FREQ62) if (!clock62[rev]) bad.splice(from62, 0, `ни одна таблица вида «текущие» с ;system=${rev} не читает kip — сверка смещений ослепла`)
      src62 = `, kip read by ${clock62.mariko} Mariko / ${clock62.erista} Erista tables`
    } else {
      // Backup page: revision from the file name. A table with no source and no substitution
      // (the A/Y hint) shows nothing from a file and is skipped; gaps and footnotes do read the
      // backup - each decides through ;skip_null whether it is drawn - so they are checked too.
      const rev = rel62.match(/restore-(\w+)\.ini$/)[1], own = FREQ62[rev]
      const want = [own, ...SHARED62].join(',')
      let data62 = 0, plain62 = 0
      for (const s of secs.slice(1)) {
        if (!has(s, CUR62)) continue
        const ls = s.split(/\r?\n/).map(l => l.trim())
        const name = ls[0]
        if (!ls.some(l => /^(ini_file|hex_file|list) /.test(l) || /\{(ini_file|list)\(/.test(l))) { plain62++; continue }
        data62++
        const srcs = ls.filter(l => /^(ini_file|hex_file) /.test(l))
        if (srcs[0] !== CFG62 || srcs[1] !== BIND62 || srcs.length > 3 || (srcs.length === 3 && srcs[2] !== TIM62)) {
          bad.push(`${name}: не привязана к выбранной копии — источники «${srcs.join(' → ') || 'нет'}» вместо «${CFG62} → ${BIND62} → ${TIM62}»`)
          continue
        }
        const iBind = ls.indexOf(BIND62), iTim = srcs.length === 3 ? ls.indexOf(TIM62) : ls.length
        // one line per table per fault, so one broken table does not hide the others
        const iFm = ls.findIndex((l, i) => !/^(ini_file|hex_file) /.test(l) && /\{ini_file\((Fields|Meta),/.test(l) && !(i > iBind && i < iTim))
        const iTr = ls.findIndex((l, i) => !/^(ini_file|hex_file) /.test(l) && /\{ini_file\((?!Fields,|Meta,)/.test(l) && i < iTim)
        if (iFm >= 0) bad.push(`${name}, строка ${iFm + 1}: Fields/Meta читаются не из выбранной копии`)
        if (iTr >= 0) bad.push(`${name}, строка ${iTr + 1}: тайминги читаются до перепривязки к emc_timings.ini — из копии или config.ini`)
        const offs = [...new Set(ls.flatMap(l => [...l.matchAll(/\{ini_file\(Fields,(\d+)\)\}/g)].map(m => Number(m[1]))))].sort((a, b) => a - b).join(',')
        if (offs !== want) bad.push(`${name}: читает Fields ${offs || 'ничего'} вместо ${want} — частота ${rev} в копии лежит в Fields ${own}, eBAL и E-Boost в ${SHARED62.join(' и ')}`)
      }
      if (!data62) bad.splice(from62, 0, 'ни одна таблица вида «текущие» не читает копию — сверка привязки и смещений ослепла')
      src62 = `, ${data62} backup-bound tables + ${plain62} plain, clock Fields ${own}`
    }
    // Button hint (14.09.2026): both views name A and Y by the system-font glyphs, as the footer
    // does; the old letters read as plain text on the console.
    for (const [view62, cond62] of [['текущие', CUR62], ['все профили', ALL62]]) {
      const rows62 = secs.slice(1).filter(x => has(x, cond62)).flatMap(x => x.split(/\r?\n/))
      if (!rows62.some(l => l.includes('\uE0E0') && l.includes('\uE0E3')))
        bad.push(`вид «${view62}»: нет подсказки с глифами кнопок A (U+E0E0) и Y (U+E0E3)`)
    }
    if (/\bA MC\b/.test(body62)) bad.push('осталась старая подсказка «A MC» — A и Y на консоли читаются как буквы')
    if (bad.length > from62) broken62.add(LABEL62[rel62])
    for (let k = from62; k < bad.length; k++) bad[k] = `${LABEL62[rel62]}, ${rel62}: ${bad[k]}`
    said62.push(`${rel62} ${secs.length} sections, ${nCur} current-view, ${nAll} all-profiles${src62}`)
  }
  }
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `страница Magician сломана — ${[...broken62].join(', ')} (${bad.length}):\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push(`the Magician page carries engine_feature pages everywhere, marker with page_toggle, profiles paged by ${perCur62}, each table on its revision's offsets backup tables bound to the backup and glyph hints in both views (${said62.join('; ')})`)
}

// ---------------- 63. one-shot footers and the backup choice do not outlive a new entry
//
// Operator, 13.09.2026: "saved …", "restored", "up to date" and the chosen backup are
// cleared when the wizard is entered. set-footer writes <own dir>/config.ini under the raw
// section name (`?rev` and trailing space included), so [boot] must name exactly that.
// A footer read from the kip is not one-shot: [boot] re-seeds it anyway.
{
  const bootPath = join(DIST, 'boot_package.ini')
  const bl = existsSync(bootPath) ? readFileSync(bootPath, 'utf8').split(/\r?\n/) : []
  const from = bl.indexOf('[boot]')
  let to = bl.findIndex((l, i) => i > from && /^\[/.test(l))
  if (to < 0) to = bl.length
  const inBoot = new Set(from < 0 ? [] : bl.slice(from + 1, to))
  const bad = []
  let footers = 0, choices = 0, backupPaths = 0

  for (const file of iniFiles) {
    if (file === bootPath) continue
    const rel = relative(DIST, file).split(String.fromCharCode(92)).join('/')
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const cfg = `'./${dir ? dir + '/' : ''}config.ini'`
    const ls = readFileSync(file, 'utf8').split(/\r?\n/)
    const seen = new Set()
    const cleared = new Set()
    let head = null, picks = false, creates = false
    ls.forEach((l, i) => {
      const h = l.match(/^\[(.*)\]$/)
      if (h) { head = h[1]; return }
      if (head === null) return
      if (/^set-footer '/.test(l) && !/\{(json_file|hex_file)/.test(l) && !seen.has(head)) {
        seen.add(head)
        footers++
        const want = `remove-ini-key ${cfg} '${head}' footer`
        if (!inBoot.has(want)) bad.push(`${rel}:${i + 1} «[${head}]» — разовая подпись переживёт вход: в [boot] нет «${want}»`)
      }
      if (/^set-ini-val '\.\/config\.ini' Restore Path '\{file_source\}'$/.test(l)) picks = true
      if (/^set-ini-val '\.\/config\.ini' Backup Path '[^']+'$/.test(l)) creates = true
      const c = l.match(/^set-ini-val '\.\/config\.ini' Restore (\w+) ''$/)
      if (c) cleared.add(c[1])
    })
    // A stale create path must not reach the "not saved" delete (NOTES 311): cleared on entry too.
    if (creates) {
      backupPaths++
      const want = `set-ini-val ${cfg} Backup Path ''`
      if (!inBoot.has(want)) bad.push(`${rel} — путь создаваемой копии переживёт вход: в [boot] нет «${want}»`)
    }
    if (picks) {
      choices++
      // Path always; plus whatever the delete button clears, so both empty states match.
      for (const k of new Set(['Path', ...cleared])) {
        const want = `set-ini-val ${cfg} Restore ${k} ''`
        if (!inBoot.has(want)) bad.push(`${rel} — выбор копии переживёт вход: в [boot] нет «${want}»`)
      }
    }
  }

  if (!footers || !choices || !backupPaths) problems.push({ sev: 'CRITICAL', what: `проверка разовых подписей не нашла предмета (подписей ${footers}, страниц выбора копии ${choices}, страниц создания копии ${backupPaths}) — она смотрит в пустоту, ничего не проверив` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `разовое состояние не очищается при входе (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`one-shot footers, the backup choice and the create path are cleared on entry (${footers} footers, ${choices} choice pages, ${backupPaths} create pages)`)
}

// ---------------- 64. a result footer is seen at once: the page is rebuilt after it
//
// Operator, 13.09.2026: "saved", "restored", "not applied" show right after the action, and what
// depends on the chosen backup shows right after the choice. A plain item's footer is re-read only
// when the page is built (handleInterpreterCompletion, fork source/main.cpp:594-664), so every
// try-block that sets a literal footer or clears the choice must end in a rebuild: `refresh`, or
// `refresh-to` naming its own item (cursor stays). The backup chooser returns with `refresh-return`.
// Create backup (operator, 13.09.2026): writes report nothing, so "saved" follows a read-back of
// the passport and every field, and a second try-block says "not saved" and rebuilds too.
// Since the same day that failure block first deletes the half-written file, guarded to a path
// under .bak/<revision> that is not the chosen backup; a third block says "not saved" otherwise.
{
  const bad = []
  let blocks = 0, choosers = 0
  const RESULT = l => (/^set-footer '/.test(l) && !/\{(json_file|hex_file)/.test(l)) || /^set-ini-val '\.\/config\.ini' Restore \w+ ''$/.test(l)
  for (const file of iniFiles) {
    if (file === join(DIST, 'boot_package.ini')) continue
    const rel = relative(DIST, file).split(String.fromCharCode(92)).join('/')
    const ls = readFileSync(file, 'utf8').split(/\r?\n/)
    let head = null, block = [], picks = null, returns = false
    const closeBlock = () => {
      let last = -1
      block.forEach(({ l }, k) => { if (RESULT(l)) last = k })
      if (head !== null && last >= 0) {
        blocks++
        const r = block.slice(last + 1).find(({ l }) => /^refresh(-to\s|$)/.test(l))
        if (!r) bad.push(`${rel}:${block[last].n} «[${head}]» — после подписи-результата нет перестройки страницы, её увидят только после перезахода`)
        else if (r.l.startsWith('refresh-to')) {
          const m = r.l.match(/^refresh-to '([^']+)'/)
          if (!m || !head.split('?')[0].includes(m[1]))
            bad.push(`${rel}:${r.n} «[${head}]» — refresh-to ставит курсор не на свой пункт: «${m ? m[1] : r.l}»`)
        }
      }
      block = []
    }
    const closeSection = () => {
      closeBlock()
      if (picks !== null) {
        choosers++
        if (!returns) bad.push(`${rel}:${picks} «[${head}]» — выбор копии возвращается без перестройки страницы: нужен refresh-return`)
      }
      picks = null; returns = false
    }
    ls.forEach((l, i) => {
      const h = l.match(/^\[(.*)\]$/)
      if (h) { closeSection(); head = h[1]; return }
      if (l === 'try:') { closeBlock(); return }
      block.push({ l, n: i + 1 })
      if (/^set-ini-val '\.\/config\.ini' Restore Path '\{file_source\}'$/.test(l)) picks = i + 1
      if (l === 'refresh-return') returns = true
    })
    closeSection()
  }
  let creates = 0
  for (const rev of ['mariko', 'erista']) {
    const rel = `service/restore-${rev}.ini`
    const abs = join(DIST, 'service', `restore-${rev}.ini`)
    if (!existsSync(abs)) continue
    const ls = readFileSync(abs, 'utf8').split(/\r?\n/)
    const from = ls.indexOf(`[Create backup?${rev}]`)
    if (from < 0) continue
    creates++
    let to = ls.findIndex((l, i) => i > from && /^\[/.test(l))
    if (to < 0) to = ls.length
    const parts = [[]]
    for (const l of ls.slice(from + 1, to)) l === 'try:' ? parts.push([]) : parts[parts.length - 1].push(l)
    const [writes, good = [], drop = [], fail = []] = parts
    const head = `${rel} «[Create backup?${rev}]»`
    if (parts.length !== 4 || !fail.includes(`set-footer 'not saved'`)) {
      bad.push(`${head} — копия без исхода «not saved»: нужны три блока try:, сверка с «saved», удаление недописанной и запасной с «not saved»`)
      continue
    }
    // Half-written backup (operator, 13.09.2026): deleted only in the drop block, only after the
    // path is proven to sit under this revision's .bak, and "not saved" follows the delete.
    const dir = `/atmosphere/kips/.bak/${rev}`
    const P = '{ini_file(Backup,Path)}'
    const del = `delete ${P}`
    const inside = `matching_ini_val './config.ini' Backup Path '${dir}/{slice(${P},${dir.length + 1},512)}'`
    const delAt = drop.indexOf(del)
    if (delAt < 0) bad.push(`${head} — недописанная копия не удаляется: в блоке после сверки нет «${del}»`)
    else {
      if (!drop.slice(0, delAt).includes(inside))
        bad.push(`${head} — удаление без доказательства, что путь внутри ${dir}/: нужна строка «${inside}» до «delete»`)
      for (const g of [`!matching_ini_val './config.ini' Restore Path '${P}'`, `!matching_ini_val './config.ini' Restore Path 'sdmc:${P}'`, `path_exists ${P}`])
        if (!drop.slice(0, delAt).includes(g)) bad.push(`${head} — перед удалением нет стража «${g}»`)
      if (!drop.slice(delAt).includes(`set-footer 'not saved'`)) bad.push(`${head} — после удаления нет «not saved»`)
    }
    const stray = [...writes, ...good, ...fail].filter(l => /^(del|delete)\s/.test(l))
    if (stray.length) bad.push(`${head} — удаление вне блока недописанной копии: ${stray[0]}`)
    const forget = `set-ini-val './config.ini' Backup Path ''`
    if (!good.slice(good.indexOf(`set-footer 'saved'`)).includes(forget))
      bad.push(`${head} — после «saved» путь копии не забыт: старый путь достанется удалению при следующем сбое`)
    const savedAt = good.indexOf(`set-footer 'saved'`)
    if (savedAt < 0) { bad.push(`${head} — в блоке сверки нет «saved»`); continue }
    // what the passport and the fields wrote, against what the block compares before "saved"
    const W = /^set-ini-val '\{ini_file\(Backup,Path\)\}' (Meta|Fields) (\S+) '([^']*)'$/
    const C = /^matching_ini_val \{ini_file\(Backup,Path\)\} (Meta|Fields) (\S+) '?([^']*?)'?$/
    const checked = new Set(good.slice(0, savedAt).map(l => l.match(C)).filter(Boolean).map(m => `${m[1]} ${m[2]} ${m[3]}`))
    const unchecked = writes.map(l => l.match(W)).filter(Boolean)
      .filter(m => m[1] === 'Fields' || ['revision', 'kipver', 'fields'].includes(m[2]))
      .map(m => `${m[1]} ${m[2]} ${m[3]}`).filter(k => !checked.has(k))
    if (unchecked.length) bad.push(`${head} — «saved» не сверяет ${unchecked.length} записей: ${unchecked.slice(0, 3).join('; ')}`)
    if (!good.slice(0, savedAt).some(l => /^!matching_ini_val \{ini_file\(Backup,Path\)\} Fields \d+ null$/.test(l)))
      bad.push(`${head} — kip не читался: значения «null» совпадут сами с собой, а подпись скажет «saved»`)
  }
  if (creates !== 2) bad.push(`секций Create backup найдено ${creates}, а их две (mariko и erista) — исход «not saved» проверять не на чем`)
  if (!blocks || !choosers) problems.push({ sev: 'CRITICAL', what: `проверка перестройки после подписи не нашла предмета (блоков ${blocks}, выборов копии ${choosers}) — она смотрит в пустоту, ничего не проверив` })
  else if (bad.length) problems.push({ sev: 'CRITICAL', what: `подпись-результат или выбор копии не видны сразу (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`result footers and the backup choice rebuild the page at once (${blocks} blocks, ${choosers} choosers); Create backup reads back before saved (${creates} sections)`)
}

// ---------------- 65. the short RAM model is one rule on every screen that shows it
//
// Operator, 14.09.2026: System Info "Model" and the backup passport "Memory" show the short model
// (NEE, AA-MGCL) exactly like the RAM heading. All three come from ramShort() in generate.mjs;
// here the other two are derived from the heading found in dist, so a hand edit or a second copy
// of the rule turns red. The passport reads Meta ram once into `list`; Meta ram stays full.
{
  const bad = []
  const read = rel => existsSync(join(DIST, rel)) ? readFileSync(join(DIST, rel), 'utf8').split(/\r?\n/) : null
  const heads = []
  for (const rel of ['current.ini', 'service/reset.ini']) {
    const ls = read(rel)
    if (!ls) { bad.push(`${rel}: файла нет`); continue }
    ls.forEach(l => { const m = l.match(/^'RAM' = '\{ram_vendor\} (.+)'$/); if (m) heads.push({ rel, v: m[1] }) })
  }
  const H = heads[0]?.v
  for (const h of heads) if (h.v !== H) bad.push(`${h.rel}: шапка RAM построена иначе, чем в ${heads[0].rel}`)
  if (H && !H.includes('{split({ram_model}," ",1)}')) bad.push('шапка RAM не похожа на правило ramShort — нет второго пробельного токена модели')

  let sys = 0
  const svc = read('service/package.ini') ?? []
  svc.forEach((l, i) => {
    const m = l.match(/^'Model'\s*=\s*'(.*)'$/)
    if (!m) return
    sys++
    if (m[1] !== H) bad.push(`service/package.ini:${i + 1} System Info Model не по правилу шапки RAM: «${m[1].slice(0, 60)}»`)
  })

  const S = '{list(0)}'
  const want = H && `{if_null({split(${S},"-",1)},${S},{split(${S}," ",0)} ${H.split('{ram_model}').join(S).split(`{split(${S}," ",1)}`).join(`{split(${S}," ",2)}`)})}`
  let pass = 0
  for (const rev of ['mariko', 'erista']) {
    const rel = `service/restore-${rev}.ini`
    const ls = read(rel)
    if (!ls) continue
    ls.forEach((l, i) => {
      const m = l.match(/^'Memory'\s*=\s*'(.*)'$/)
      if (!m) return
      pass++
      if (ls[i - 1] !== `list '[{ini_file(Meta,ram)}]'`) bad.push(`${rel}:${i + 1} паспорт Memory не читает Meta ram один раз в list перед строкой`)
      if (m[1] !== want) bad.push(`${rel}:${i + 1} паспорт Memory не по правилу шапки RAM: «${m[1].slice(0, 60)}»`)
    })
    if (!ls.some(l => l.includes(`Meta ram '{ram_vendor} {ram_model}'`))) bad.push(`${rel}: Meta ram больше не пишется целиком — копия потеряет полную модель (решение 07.09.2026)`)
  }
  if (heads.length < 4 || !sys || pass < 2)
    problems.push({ sev: 'CRITICAL', what: `проверка короткой модели RAM не нашла предмета (шапок ${heads.length}, System Info ${sys}, паспортов ${pass}) — она смотрит в пустоту, ничего не проверив` })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `короткая модель RAM разошлась с правилом шапки (${bad.length}):\n     ${bad.slice(0, 6).join('\n     ')}` })
  else ok.push(`the short RAM model is one rule: ${heads.length} headings, System Info and ${pass} passports; Meta ram written in full`)
}

// ---------------- 66. the Magician voltage items write what their label promises, into the right profile
//
// eVDQ and eVD2 are the first settings of this package that live OUTSIDE loader.kip: they are
// keys of /config/4IFIR/emc_timings.ini, written by the 4IFIR system module and read by it under
// the profile of the current base clock and eBAL. Nothing guarding kip items reaches them —
// check 19 measures a `hex`, check 24 compares a factory byte, check 53 leans on the `.map.json`
// these items do not have. So an item could promise 650 mV and write 655, or address a profile
// the firmware never touches, and every guard would stay green.
//
// Five things, and each is a way the item breaks quietly:
//   1. the profile name is built from Optimized Target (CUST 12524) and eBAL (CUST 12352), never
//      from a literal — on a console left at Target 0 the base clock is 1331, not 1600;
//   2. the section declares loader.kip, or the name resolves to `null` and the write lands in a
//      section nobody reads;
//   3. the item is hidden while eBAL is eBAMATIC — the profile name cannot be built at all then;
//   4. every label is the number it writes plus the unit, the row is strictly ascending, and
//      eBAMATIC stands first writing a zero (operator, 20.09.2026);
//   5. the footer re-seeded on entry reads the same file, key and profile and names a zero
//      eBAMATIC. The list and the footer are the two halves of check 53's comparison, and here
//      they come from two different places in the generator, so they can drift apart.
//   6. (21.09.2026) while they are hidden, a hint under them says exactly
//      "Set EMC Balance to use VDDQ/VDD2", on the negation of their gate and nothing else.
//
// SECOND HALF (20.09.2026): WHERE THE VALUES ARE SHOWN. The operator put them in the
// `Optimized Mode (<base> MHz)` block of page 2 — "in the timings table this is out of place, it
// is not a timing" — in this exact order:
//     Optimized Target · VDDQ · VDD2 · VDDQ-VDD2 Voltage · Efficiency Stages
// Order is the decision, so it is guarded, not left to the order of the field map. The block
// exists on four pages and the rule differs on each. Current and both backup previews read the
// live file under the profile their own source names. On a backup page the block mixes two
// sources, so it also carries the line that says so — and the line and the rows stand or fall
// together: a screen that keeps the caveat after the rows are gone contradicts itself.
//
// THE FACTORY-RESET PAGE, 20.09.2026 — RULE REVERSED BY THE OPERATOR. It used to be forbidden
// to print the voltages there, because the reset wrote the kip only. Now the reset puts both
// keys back to eBAMATIC, so the page prints that word — flat, not read from the file: the page
// answers "what will be written", and the value standing there now is a different question.
// The write itself is guarded here too, because it has an order it cannot survive losing: the
// profile is named after the LIVE eBAL, and the reset sets eBAL to 000000, so the two
// `set-ini-val` lines must come BEFORE the first `hex-by-custom-offset`. They also must stay
// behind the `try:` gate — with eBAL already on eBAMATIC the name degrades to `CL8`, a profile
// the firmware never reads, and the write would litter a file we do not own.
//
// WHICH FILE EACH ROW IS READ FROM is guarded by check 21, not here: it tracks the binding
// through every table in the package and knows which file carries [Fields], [Meta] and our own
// [Restore]. What it cannot know is the block's own two rules, so they live here: the voltage
// rows address the profile through `{list(N)}`, a section name no static check can attribute,
// and they must sit under the emc_timings.ini binding; and on Current the kip rows of the same
// block must sit under loader.kip, a channel check 21 does not follow at all.
{
  const EMC66 = '/config/4IFIR/emc_timings.ini'
  const KIP66 = '/atmosphere/kips/loader.kip'
  const WRITE66 = new RegExp("^set-ini-val '" + EMC66 + "' '([^']+)' (\\w+) '\\{json_file_source\\(\\*,(\\w+)\\)\\}'$", 'm')
  const GATE66 = ';visibility_condition=!matching_hex_val_custom /atmosphere/kips/loader.kip CUST 12352 000000'
  // The generation flag [boot] leaves in the config.ini next to the page (DECISIONS 22.09.2026).
  const FW66 = v => `matching_ini_val ./config.ini Firmware gen ${v}`
  const FREQ66 = { mariko: 32, erista: 24 }
  const writers66 = []
  const bad = []
  let items66 = 0, entries66 = 0
  // Every footer written by name anywhere in the package, so an item can be asked for its own.
  const footers66 = []
  for (const f of iniFiles) {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^set-ini-val '[^']*config\.ini' '\*([^']+)' footer '(.+)'$/)
      if (m) footers66.push({ file: f, name: m[1], expr: m[2] })
    }
  }
  for (const f of iniFiles) {
    const dir = dirname(f)
    for (const sec of readFileSync(f, 'utf8').split(/\n(?=\[)/)) {
      const title = (sec.match(/^\[\*([^\]]+)]/) || [])[1]
      if (!title || !sec.includes("set-ini-val '" + EMC66 + "'")) continue
      items66++
      const w = sec.match(WRITE66)
      if (!w) { bad.push(`«${title}»: запись в ${EMC66} не той формы — ждали set-ini-val '<файл>' '<профиль>' <ключ> '{json_file_source(*,mv)}'`); continue }
      const [, profile, key, valKey] = w
      if (valKey !== 'mv') bad.push(`«${title}»: значение берётся ключом ${valKey}, а список несёт милливольты в mv`)
      // WHICH PLACE THE ITEM WRITES IS DECIDED BY ITS NAME TAG (DECISIONS 22.09.2026): no tag - the
      // E section 4IFIR 2.6+ reads; `?25<rev>` - the S section 4IFIR 2.5 reads, clock at the
      // revision's offset. Each is shown only on its generation, so none is shown without 4IFIR.
      const lsec = sec.split('\n').map(l => l.trim())
      const v25 = (title.match(/\?25(mariko|erista)$/) || [])[1] ?? null
      const sys = lsec.filter(l => l.startsWith(';system='))
      const conds = lsec.filter(l => l.startsWith(';visibility_condition='))
      writers66.push({ file: f, title, key, rev: v25, conds })
      if (v25) {
        const fo = FREQ66[v25], other = FREQ66[v25 === 'mariko' ? 'erista' : 'mariko']
        if (sys.join('|') !== `;system=${v25}`) bad.push(`«${title}»: пункт 4IFIR 2.5 для ${v25} несёт «${sys.join(' ') || 'без ;system='}» — частота S у каждой ревизии своя`)
        if (profile.includes('{hex_file(CUST,12524,')) bad.push(`«${title}»: пункт 4IFIR 2.5 пишет в профиль Optimized Target (12524) — это раздел E, который 2.5 не читает никогда`)
        if (!profile.includes(`{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,${fo},3)})})}/1000,true)}CL`))
          bad.push(`«${title}»: имя профиля 4IFIR 2.5 не собрано из частоты S своей ревизии (CUST ${fo}, МГц с отбрасыванием дроби)`)
        if (profile.includes(`{hex_file(CUST,${other},`)) bad.push(`«${title}»: имя профиля ${v25} читает частоту другой ревизии (CUST ${other})`)
        if (!conds.includes(`;visibility_condition=${FW66('2.5')}`)) bad.push(`«${title}»: пункт 4IFIR 2.5 виден не только на 2.5 — «${FW66('2.5')}» нет`)
        if (!conds.includes(`;visibility_condition=!matching_hex_val_custom ${KIP66} CUST ${fo} 000000`))
          bad.push(`«${title}»: пункт 4IFIR 2.5 виден при частоте eBAMATIC — раздел S тогда не собрать`)
      } else {
        if (sys.length) bad.push(`«${title}»: пункт 4IFIR 2.6 несёт ${sys.join(' ')} — раздел E общий для ревизий`)
        if (!profile.includes('{hex_file(CUST,12524,')) bad.push(`«${title}»: имя профиля не читает Optimized Target (CUST 12524) — при Target 0 база 1331, и значение уедет в профиль 1600`)
        if (/\{hex_file\(CUST,(32|24),/.test(profile)) bad.push(`«${title}»: пункт 4IFIR 2.6 пишет в раздел частоты S — 2.6 берёт напряжения ступени E из раздела E`)
        if (!conds.includes(`;visibility_condition=${FW66('2.6')}`)) bad.push(`«${title}»: пункт 4IFIR 2.6 виден не только на 2.6 — «${FW66('2.6')}» нет`)
      }
      if (!profile.includes('{hex_file(CUST,12352,')) bad.push(`«${title}»: имя профиля не читает eBAL (CUST 12352) — CL профиля взят с потолка`)
      if (/\d{3,4}CL\d/.test(profile)) bad.push(`«${title}»: имя профиля несёт литерал «${profile}» — профиль обязан собираться из kip`)
      if (!lsec.includes("hex_file '/atmosphere/kips/loader.kip'"))
        bad.push(`«${title}»: имя профиля читает CUST, а hex_file на loader.kip в секции нет — имя разрешится в null`)
      if (!lsec.includes(GATE66))
        bad.push(`«${title}»: пункт виден при eBAL = eBAMATIC — имя профиля тогда не собрать, а запись всё равно пойдёт`)
      // the dictionary
      const src = sec.match(/^json_file_source\s+'([^']+)'\s+name\s*$/m)
      if (!src) { bad.push(`«${title}»: нет списка значений`); continue }
      const dictPath = resolve(dir, src[1])
      if (!existsSync(dictPath)) { bad.push(`«${title}»: словаря ${src[1]} нет`); continue }
      let list
      try { list = JSON.parse(readFileSync(dictPath, 'utf8')) } catch { bad.push(`«${title}»: словарь ${src[1]} не читается`); continue }
      if (!Array.isArray(list) || !list.length) { bad.push(`«${title}»: словарь ${src[1]} пуст`); continue }
      if (list[0].name !== 'eBAMATIC' || list[0].mv !== '0')
        bad.push(`«${title}»: первая строка списка «${list[0].name}» = ${list[0].mv}, а возврат в автоматику это eBAMATIC = 0 и стоит он первым`)
      let prev = null
      const seen = new Set()
      for (const e of list.slice(1)) {
        entries66++
        const m = String(e.name).match(/^(\d+) mV$/)
        if (!m) { bad.push(`«${title}»: строка «${e.name}» не названа числом милливольт`); continue }
        if (m[1] !== String(e.mv)) bad.push(`«${title}»: строка «${e.name}» запишет ${e.mv}`)
        if (e.short !== e.name) bad.push(`«${title}»: строка «${e.name}» несёт подпись «${e.short}» — курсор списка встанет не на неё`)
        const n = Number(e.mv)
        if (seen.has(n)) bad.push(`«${title}»: значение ${n} объявлено дважды`)
        seen.add(n)
        if (prev !== null && n <= prev) bad.push(`«${title}»: ${n} стоит после ${prev} — ряд не по возрастанию`)
        prev = n
      }
      // the footer re-seeded when the section is entered
      const foot = footers66.find(x => x.name === title)
      if (!foot) { bad.push(`«${title}»: подпись при входе в раздел не пересевается — на экране останется прежнее значение`); continue }
      if (!foot.expr.includes(`{ini_file(${profile},${key})}`))
        bad.push(`«${title}»: подпись читает не тот профиль или не тот ключ, что пишет пункт`)
      if (!foot.expr.includes('eBAMATIC'))
        bad.push(`«${title}»: подпись не зовёт ноль eBAMATIC — курсор списка не найдёт строку, на которую вставать`)
      if (!readFileSync(foot.file, 'utf8').split('\n').some(l => l.trim() === `ini_file '${EMC66}'`))
        bad.push(`«${title}»: подпись читает ${EMC66}, а объявления ini_file на него в ${relative(ROOT, foot.file)} нет`)
    }
  }
  // ---- the hint that stands in for the hidden items (operator, 21.09.2026; 22.09.2026)
  //
  // Where the items are hidden the page says why, in exactly one line (operator, 22.09.2026):
  // 2.6+ - `Set EMC Balance…` on an eBAMATIC eBAL; 2.5 names the section after the RAM clock too,
  // so `Set EMC Balance…`, `Set Frequency…` or `Set Frequency and EMC Balance…` by what is on
  // eBAMATIC; no 4IFIR - and no flag at all - nothing. Judged by RUNNING the conditions on every
  // console (generation x revision x eBAL x clock): a hint next to working items, two hints, or
  // items gone without a word all read as a broken page.
  const HINT66 = 'Set EMC Balance to use VDDQ/VDD2'
  const HINT66C = 'Set Frequency to use VDDQ/VDD2'
  const HINT66B = 'Set Frequency and EMC Balance to use VDDQ/VDD2'
  const HINTS66 = [HINT66, HINT66C, HINT66B]
  // visibility of a section on a made-up console: `;system=` and the two condition kinds used
  // here; gen null = the flag is missing from config.ini, which no `matching_ini_val` matches
  const vis66 = (lines, env) => lines.every(l => {
    if (l.startsWith(';system=')) return l.slice(8) === env.rev
    if (!l.startsWith(';visibility_condition=')) return true
    let c = l.slice(22); const neg = c.startsWith('!'); if (neg) c = c.slice(1)
    const t = c.split(' ')
    let r
    if (t[0] === 'matching_ini_val' && t[1] === './config.ini' && t[2] === 'Firmware' && t[3] === 'gen') r = env.gen === t.slice(4).join(' ')
    else if (t[0] === 'matching_hex_val_custom' && t[1] === KIP66 && t[2] === 'CUST') r = (env.kip[t[3]] ?? '000000').slice(0, t[4].length) === t[4]
    else return false                               // unknown to this model: never shown
    return neg ? !r : r
  })
  const hintText66 = s => s.split('\n').map(l => l.trim()).filter(l => l.startsWith("''='")).map(l => l.slice(4, -1)).join(' ')
  let hints66 = 0
  for (const f of iniFiles) {
    const secs = readFileSync(f, 'utf8').split(/\n(?=\[)/)
    const writers = secs.filter(s => /^\[\*/.test(s) && s.includes("set-ini-val '" + EMC66 + "'"))
    if (!writers.length) continue
    const rel = relative(ROOT, f)
    // every table on the page that talks about VDDQ/VDD2 is a hint and must say one of the three
    const hints = secs.filter(s => /^\[[^*@]/.test(s) && /;mode=table/.test(s) && hintText66(s).includes('VDDQ/VDD2'))
    hints66 += hints.length
    for (const hs of hints) {
      const h = hs.split('\n').map(l => l.trim())
      const text = hintText66(hs)
      if (!HINTS66.includes(text)) bad.push(`${rel}: подсказка гласит «${text}», а ждали одну из «${HINTS66.join('», «')}»`)
      // Framed table, text in the value column: below x+13 (the label column) it touches the frame.
      const off = +(h.find(l => l.startsWith(';offset=')) || ';offset=164').slice(8)
      if (off < 13) bad.push(`${rel}: подсказка с ;offset=${off} — текст прижат к рамке, нужно не меньше 13`)
      for (const w of writers) {
        if (secs.indexOf(w) > secs.indexOf(hs)) bad.push(`${rel}: подсказка стоит выше пункта «${(w.match(/^\[\*([^\]]+)]/) || [])[1]}», а место ей под пунктами`)
      }
    }
    // Every console: exactly one item per key when the profile can be named on its generation,
    // none otherwise; exactly the one hint that names what is on eBAMATIC, or none.
    const byKey = new Map()
    for (const w of writers) {
      const k = (w.match(WRITE66) || [])[2]
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), w])
    }
    for (const gen of ['2.5', '2.6', 'none', null]) for (const rev of ['mariko', 'erista']) for (const bal of ['020000', '000000']) for (const clk of ['009222', '000000']) {
      const env = { gen, rev, kip: { '12352': bal, [FREQ66[rev]]: clk, [FREQ66[rev === 'mariko' ? 'erista' : 'mariko']]: '10791C', '12524': '01' } }
      const name = `${gen ?? 'без флага'}/${rev}/eBAL ${bal === '000000' ? 0 : 2}/частота ${clk === '000000' ? 0 : 2265}`
      const bal0 = bal === '000000', clk0 = clk === '000000'
      const can = (gen === '2.6' && !bal0) || (gen === '2.5' && !bal0 && !clk0)
      for (const [k, ws] of byKey) {
        const shown = ws.filter(w => vis66(w.split('\n').map(l => l.trim()), env))
        if (shown.length !== (can ? 1 : 0))
          bad.push(`${rel} (${name}): пунктов ${k} видно ${shown.length}, а ждали ${can ? 1 : 0}${shown.length ? ` — «${shown.map(w => (w.match(/^\[\*([^\]]+)]/) || [])[1]).join('», «')}»` : ''}`)
        else if (can) {
          const t = (shown[0].match(/^\[\*([^\]]+)]/) || [])[1] || ''
          if (gen === '2.5' ? !t.endsWith(`?25${rev}`) : t.includes('?'))
            bad.push(`${rel} (${name}): виден пункт «${t}», а ждали ${gen === '2.5' ? `пункт 4IFIR 2.5 для ${rev}` : 'пункт раздела E'}`)
        }
      }
      const want = gen === '2.6' ? (bal0 ? HINT66 : null)
        : gen === '2.5' ? (bal0 && clk0 ? HINT66B : bal0 ? HINT66 : clk0 ? HINT66C : null)
        : null
      const said = hints.filter(s => vis66(s.split('\n').map(l => l.trim()), env)).map(hintText66)
      if (said.join(' | ') !== (want ?? ''))
        bad.push(`${rel} (${name}): видно подсказок ${said.length} — «${said.join('» + «') || '—'}», а ждали «${want ?? '—'}»`)
    }
  }
  if (!hints66) bad.push(`подсказок про VDDQ/VDD2 нет ни на одной странице с пунктами VDDQ/VDD2`)
  for (const k of ['eVDQ', 'eVD2']) {
    const tags = writers66.filter(w => w.key === k).map(w => w.rev ?? '2.6').sort().join(',')
    if (tags !== '2.6,erista,mariko') bad.push(`пункты ${k}: места записи «${tags}», а ждали по одному на 4IFIR 2.6 и на 4IFIR 2.5 каждой ревизии`)
  }

  // ---- where the values are shown
  const OPT66 = "'Optimized Mode ({list(0)} MHz)' = ''"
  const SEC66 = /\n(?=\[)/
  const NL66 = '\n'
  const WANT66 = ['Optimized Target', 'VDDQ', 'VDD2', 'VDDQ-VDD2 Voltage', 'Efficiency Stages']
  const RESET66 = 'service/reset.ini'
  const CAVEAT66 = 'VDDQ/VDD2: this console - not the backup'
  const PAGES66 = ['current.ini', 'service/restore-mariko.ini', 'service/restore-erista.ini']
  let blocks66 = 0, writes66 = 0
  // A literal base in a page-2 heading is forbidden: at Target 0 the base is 1331 (21.09.2026).
  for (const f of iniFiles) {
    const lit = readFileSync(f, 'utf8').split(NL66).find(l => /^'Optimized Mode \(\d+ MHz\)'\s*=/.test(l))
    if (lit) bad.push(`${relative(DIST, f).replace(/\\/g, '/')}: заголовок «${lit}» несёт литерал базы — у консоли с Target 0 база 1331`)
  }
  for (const rel of [...PAGES66, RESET66]) {
    const f = join(DIST, rel)
    if (!existsSync(f)) { bad.push(`${rel}: файла нет — блок Optimized Mode искать негде`); continue }
    const txt = readFileSync(f, 'utf8')
    const at = txt.indexOf(OPT66)
    if (at < 0) { bad.push(`${rel}: блока «Optimized Mode (<база> MHz)» нет — проверка состава смотрит в пустоту`); continue }
    // THE HEADING NAMES THE BASE OF THIS PAGE'S SOURCE (operator, 21.09.2026): 1600 or 1331 by
    // 12524 — the kip in Current, Fields of the backup or of the factory set elsewhere.
    {
      const head = txt.slice(txt.lastIndexOf('[Header]', at), at)
      const src66 = rel === 'current.ini' ? '{hex_file(CUST,12524,1)}' : '{ini_file(Fields,12524)}'
      if (!head.split(NL66).some(l => l.startsWith("list '[") && l.includes(`{if_==(${src66},01,1600,1331)}`)))
        bad.push(`${rel}: заголовок блока Optimized Mode не берёт базу из ${src66} — число в нём не про эту страницу`)
    }
    // The block is the [Info] table right after the heading. On Current it comes in three
    // variants, one per place the firmware reads (DECISIONS 22.09.2026): each is checked, and on
    // every console exactly one of them is shown.
    const after66 = txt.slice(txt.indexOf('[Info]', at)).split(SEC66)
    const infos = after66.slice(0, Math.max(1, after66.findIndex(x => !x.startsWith('[Info]')))).map(x => x.split(NL66))
    const onReset = rel === RESET66
    if (rel === 'current.ini') {
      for (const gen of ['2.5', '2.6', 'none', null]) for (const rev of ['mariko', 'erista']) {
        const n = infos.filter(i => vis66(i.map(l => l.trim()), { gen, rev, kip: {} })).length
        if (n !== 1) bad.push(`${rel}: на консоли ${gen}/${rev} видно ${n} таблиц блока Optimized Mode, а ждали одну`)
      }
    } else if (infos.length !== 1) bad.push(`${rel}: у блока Optimized Mode ${infos.length} таблиц, а ждали одну — ревизия страницы и так известна`)
    for (const info of infos) {
    const rows = info.map(l => (l.match(/^'([^']*)' = '/) || [])[1]).filter(x => x != null && x !== '')
    blocks66++
    // The order is the operator's decision on every page, reset included (20.09.2026).
    if (rows.join('|') !== WANT66.join('|'))
      bad.push(`${rel}: блок Optimized Mode идёт «${rows.join(' · ')}» вместо «${WANT66.join(' · ')}» — порядок задан оператором 20.09.2026`)
    if (onReset) {
      // "What will be applied" — the word the reset writes, flat, never a read of the file:
      // the value standing there now answers a different question.
      for (const nm of ['VDDQ', 'VDD2']) {
        const row = info.find(l => l.startsWith(`'${nm}' = '`))
        if (!row) continue                             // already reported by the order check
        if (row !== `'${nm}' = 'eBAMATIC'`)
          bad.push(`${rel}: строка «${nm}» на странице сброса это «${row}» — она обязана печатать ровно eBAMATIC, то, что сброс ЗАПИШЕТ, а не то, что стоит в файле сейчас`)
      }
    } else {
      if (!info.some(l => l.trim() === ';skip_null=true'))
        bad.push(`${rel}: у блока Optimized Mode нет ;skip_null=true — при eBAMATIC-eBAL строки напряжений останутся с «null»`)
      if (!info.some(l => l.trim() === `ini_file '${EMC66}'`))
        bad.push(`${rel}: блок Optimized Mode не читает ${EMC66} — напряжения брать неоткуда`)
      const tgt66 = rel === 'current.ini' ? '{hex_file(CUST,12524,1)}' : '{ini_file(Fields,12524)}'
      const lists = info.filter(l => l.startsWith("list '["))
      const sys66 = (info.find(l => l.startsWith(';system=')) || '').slice(8)
      const cond66 = info.filter(l => l.startsWith(';visibility_condition='))
      if (rel === 'current.ini' && sys66) {
        // 4IFIR 2.5: the S section by this revision's clock; E is never read there
        const fo = FREQ66[sys66], other = FREQ66[sys66 === 'mariko' ? 'erista' : 'mariko']
        if (!cond66.includes(`;visibility_condition=${FW66('2.5')}`)) bad.push(`${rel}: таблица блока Optimized Mode для ${sys66} видна не только на 4IFIR 2.5`)
        if (!lists.some(l => l.includes(`{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,${fo},3)})})}/1000,true)}CL`)))
          bad.push(`${rel}: блок Optimized Mode для 4IFIR 2.5 ${sys66} не собирает раздел из частоты S (CUST ${fo})`)
        if (lists.some(l => l.includes(`{hex_file(CUST,${other},`))) bad.push(`${rel}: блок Optimized Mode ${sys66} читает частоту другой ревизии (CUST ${other})`)
        if (lists.some(l => l.includes('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL'))) bad.push(`${rel}: блок Optimized Mode для 4IFIR 2.5 читает раздел E, которого 2.5 не читает`)
      } else {
        if (!lists.length || !lists.some(l => l.includes(tgt66)))
          bad.push(`${rel}: имя профиля в блоке Optimized Mode не собрано из Optimized Target (${tgt66})`)
        if (!lists.some(l => l.includes('{ini_file(Firmware,gen)}')))
          bad.push(`${rel}: блок Optimized Mode не спрашивает поколение 4IFIR — без 4IFIR строки напряжений останутся`)
        if (rel !== 'current.ini' && !lists.some(l => l.includes(`{ini_file(Fields,${FREQ66[rel.includes('erista') ? 'erista' : 'mariko']})}`)))
          bad.push(`${rel}: блок Optimized Mode копии не читает частоту S копии — на 4IFIR 2.5 раздел не собрать`)
      }
      if (lists.some(l => /\d{3,4}CL\d/.test(l)))
        bad.push(`${rel}: имя профиля в блоке Optimized Mode несёт литерал частоты — при Target 0 база 1331`)
      for (const nm of ['VDDQ', 'VDD2']) {
        const row = info.find(l => l.startsWith(`'${nm}' = '`))
        const key = nm === 'VDDQ' ? 'eVDQ' : 'eVD2'
        if (!row) continue                             // already reported by the order check
        if (!row.includes(key)) bad.push(`${rel}: строка «${nm}» читает не ключ ${key}`)
        if (!row.includes('eBAMATIC')) bad.push(`${rel}: строка «${nm}» не зовёт ноль eBAMATIC — на экране и в меню одно значение назовётся по-разному`)
      }
      // ПОРЯДОК ПРИВЯЗОК ВНУТРИ БЛОКА. `ini_file`/`hex_file`/`json_file` — независимые
      // последовательные объявления (форк, `buildTableDrawerLines`), и строка читается под
      // той привязкой, что объявлена ВЫШЕ неё. Проверка 21 ведёт это по всему пакету для
      // именованных секций; сюда вынесено то, чего она знать не может: профиль у строк
      // напряжений назван через `{list(N)}`, а `hex_file` она не отслеживает вовсе.
      let ini66 = null, hex66 = null
      for (const raw of info) {
        const l = raw.trim()
        const di = l.match(/^ini_file\s+'([^']*)'$/); if (di) { ini66 = di[1]; continue }
        const dh = l.match(/^hex_file\s+'([^']*)'$/); if (dh) { hex66 = dh[1]; continue }
        if (!/^'[^']*'\s*=\s*'/.test(l)) continue
        const nm = l.match(/^'([^']*)'/)[1]
        if (/\{ini_file\(\{list\(\d+\)\},(eVDQ|eVD2)\)\}/.test(l) && ini66 !== EMC66)
          bad.push(`${rel}: строка «${nm}» читает профиль из ${EMC66}, а привязка на этой строке — «${ini66 ?? 'нет'}»: раздела с таким именем там нет, строка выпадет по ;skip_null`)
        if (/\{hex_file\(CUST,/.test(l) && hex66 !== KIP66)
          bad.push(`${rel}: строка «${nm}» читает kip, а hex_file на этой строке — «${hex66 ?? 'нет'}»`)
      }
    }
    }
    const info = infos[0]
    const hasVolts = ['VDDQ', 'VDD2'].every(nm => info.some(l => l.startsWith(`'${nm}' = '`)))
    // ОГОВОРКА И СТРОКИ — ОДНО ЦЕЛОЕ. Экран, на котором оговорка пережила строки, которые
    // она объясняет, противоречит сам себе: «здесь напряжения этой консоли, а не копии» —
    // а напряжений нет вовсе. Оговорка законна ТОЛЬКО там, где блок смешивает два источника.
    const saidCaveat = txt.slice(at).split(SEC66).slice(0, 3).join('\n').includes(CAVEAT66)
    const needCaveat = !onReset && rel !== 'current.ini' && hasVolts
    if (needCaveat && !saidCaveat)
      bad.push(`${rel}: у блока Optimized Mode нет оговорки «VDDQ/VDD2: this console» — читатель примет напряжения за значения копии`)
    if (!needCaveat && saidCaveat)
      bad.push(`${rel}: оговорка «${CAVEAT66}» стоит ${hasVolts ? 'на странице, где блок ничего не смешивает' : 'без строк напряжений, которые она объясняет'} — экран противоречит сам себе`)
  }
  // ---- what the factory reset writes, and in which order
  //
  // The profile is named after the LIVE eBAL, and the reset sets eBAL to 000000. Placeholders
  // are resolved per command, right before it runs (fork, `interpretAndExecuteCommands`), so
  // the order of the lines IS the order of reading: a zero write below the first
  // `hex-by-custom-offset` would address `<base>CL8` — a profile the firmware never reads.
  {
    const rf = join(DIST, RESET66)
    const txt = existsSync(rf) ? readFileSync(rf, 'utf8') : ''
    for (const sec of txt.split(SEC66)) {
      const head = (sec.match(/^\[([^\]]+)]/) || [])[1]
      if (!head || !/^Apply factory defaults/.test(head)) continue
      writes66++
      const ls = sec.split(NL66).map(l => l.trim())
      const keys = ['eVDQ', 'eVD2']
      const rrev = head.endsWith('?erista') ? 'erista' : 'mariko'
      const fo = FREQ66[rrev]
      const atKip = ls.findIndex(l => l.startsWith('hex-by-custom-offset '))
      if (!ls.includes(`hex_file '${KIP66}'`))
        bad.push(`${RESET66} «${head}»: раздел записи читает CUST, а hex_file на ${KIP66} в секции нет — имя разрешится в null`)
      // TWO BRANCHES PER KEY (22.09.2026), one per generation: `try:` → eBAL gate → the generation
      // → (2.5: a fixed clock) → "key exists" → the zero → `force_failure` → next `try:`.
      // `force_failure` drops the flag (fork `setCommandFailed`), only `try:` raises it again, and
      // a `try:` meeting a SUCCESSFUL branch ends the section (`commands = {}; return true`) — so
      // exactly one `try:` per branch plus one for the kip.
      const tries = ls.reduce((a, l, i) => (l === 'try:' && a.push(i), a), [])
      const want = keys.length * 2 + 1
      keys.forEach(k => {
        const ws = ls.reduce((a, l, i) => (l.startsWith(`set-ini-val '${EMC66}' '`) && l.endsWith(`' ${k} '0'`) && a.push(i), a), [])
        if (!ws.length) { bad.push(`${RESET66} «${head}»: сброс не возвращает ${k} в eBAMATIC — записи set-ini-val '${EMC66}' … ${k} '0' нет`); return }
        const kinds = new Set()
        for (const w of ws) {
          const prof = ls[w].match(/^set-ini-val '[^']*' '([^']*)'/)[1]
          const isS = prof.includes(`{math({hex_to_decimal({hex_to_rhex({hex_file(CUST,${fo},3)})})}/1000,true)}CL`)
          const isE = prof.includes('{if_==({hex_file(CUST,12524,1)},01,1600,1331)}CL')
          const gen = isS ? '2.5' : '2.6'
          kinds.add(isS && !isE ? 'S' : isE && !isS ? 'E' : '?')
          if (atKip >= 0 && w > atKip) bad.push(`${RESET66} «${head}»: запись ${k} стоит ПОСЛЕ правки kip — к этому моменту eBAL уже 000000, и ноль уедет в раздел CL8, которого прошивка не читает`)
          if (!prof.includes('{hex_file(CUST,12352,')) bad.push(`${RESET66} «${head}»: раздел записи собран не из живого kip (12352) — «${prof}»`)
          if (/\{hex_file\(CUST,(32|24),/.test(prof) && !isS) bad.push(`${RESET66} «${head}»: раздел записи ${k} читает частоту другой ревизии — «${prof}»`)
          if (/\d{3,4}CL\d/.test(prof)) bad.push(`${RESET66} «${head}»: раздел записи несёт литерал частоты — «${prof}»`)
          const open = tries.filter(t => t < w).pop()
          const close = ls.findIndex((l, j) => j > w && (l === 'try:' || l === 'force_failure' || l.startsWith('hex-by-custom-offset ')))
          const branch = open === undefined ? [] : ls.slice(open, w)
          if (open === undefined || !branch.includes(`!matching_hex_val_custom ${KIP66} CUST 12352 000000`))
            bad.push(`${RESET66} «${head}»: запись нулей не закрыта затвором «try: + !matching_hex_val_custom … CUST 12352 000000» (${k}) — при eBAL = eBAMATIC ноль уедет в раздел CL8`)
          else if (!branch.includes(`matching_ini_val './config.ini' Firmware gen ${gen}`))
            bad.push(`${RESET66} «${head}»: ноль ${k} в раздел ${isS ? 'S' : 'E'} пишется не только на 4IFIR ${gen} — затвора поколения нет`)
          else if (isS && !branch.includes(`!matching_hex_val_custom ${KIP66} CUST ${fo} 000000`))
            bad.push(`${RESET66} «${head}»: ноль ${k} в раздел S пишется и при частоте eBAMATIC — раздел тогда не собрать`)
          else if (!branch.includes(`!matching_ini_val '${EMC66}' '${prof}' ${k} ''`))
            bad.push(`${RESET66} «${head}»: ноль ${k} пишется без проверки «ключ уже есть» — на чистой консоли сброс создаст файл и профиль, которых никто не сохранял`)
          if (close < 0 || ls[close] !== 'force_failure')
            bad.push(`${RESET66} «${head}»: после записи нулей нет force_failure (${k}) — следующий try: оборвёт секцию, и сам сброс kip не выполнится`)
          else if (ls[close + 1] !== 'try:')
            bad.push(`${RESET66} «${head}»: после force_failure нет второго «try:» (${k}) — флаг отказа никто не поднимет, и весь сброс kip будет пропущен молча`)
        }
        if (ws.length !== 2 || kinds.size !== 2 || kinds.has('?'))
          bad.push(`${RESET66} «${head}»: ${k} обнуляется в ${ws.length} местах (${[...kinds].join(', ')}), а ждали два — раздел E для 4IFIR 2.6 и раздел S частоты ${rrev} для 4IFIR 2.5`)
      })
      if (tries.length !== want)
        bad.push(`${RESET66} «${head}»: «try:» в секции ${tries.length}, а их обязано быть ${want} — по одному на ветвь ключа и поколения и один на сброс kip; лишний встретит удавшуюся ветвь и оборвёт секцию целиком`)
      else if (atKip >= 0 && tries[want - 1] > atKip)
        bad.push(`${RESET66} «${head}»: последний «try:» стоит ПОСЛЕ первой правки kip — команды до него выполнены не будут`)
    }
    if (!writes66) bad.push(`${RESET66}: нет ни одной секции «Apply factory defaults» — проверка записи нулей смотрит в пустоту`)
  }
  if (!blocks66) bad.push('ни одной страницы с блоком Optimized Mode — проверка места показа смотрит в пустоту')

  if (!items66 || !entries66 || !blocks66 || !writes66)
    problems.push({ sev: 'CRITICAL', what: `проверка пунктов, пишущих напряжения Magician, не нашла предмета надзора (пунктов ${items66}, значений ${entries66}, блоков показа ${blocks66}, ветвей сброса ${writes66}) — она смотрит в пустоту` })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `пункт напряжения Magician пишет не то или не туда (${bad.length}):\n     ${bad.slice(0, 40).join('\n     ')}` })
  else
    ok.push(`the Magician voltage items address the profile the console's 4IFIR reads (E on 2.6+, the S clock on 2.5, none without 4IFIR), write the millivolts they name, are hidden where it cannot be named with the hint shown exactly then, are shown in the Optimized block in the operator's order and are put back to eBAMATIC by the reset before it touches the kip (${items66} items, ${entries66} values, ${hints66} hints, ${blocks66} blocks, ${writes66} reset branches)`)
}

// ---------------- 67. eBAMATIC opens every option list that offers it
//
// Zero hands the choice back to the firmware - the most general pick, so it heads the list
// (operator, 30.08.2026, for CPU Min Voltage). On 03.09.2026 a forced rerun of fix-vmin-scales
// sorted it below the Eco steps of field 48 and nothing noticed for 18 days (NOTES №337).
// Checked on the generated list, i.e. on screen. Exceptions only by name, with date and
// whose decision. Since 21.09.2026 field 48 offers no zero at all (operator; check 70), so
// this check neither needs nor expects it there.
const EBAMATIC_NOT_FIRST67 = new Map([
  // ['<offset> or <list path under package/dist>', 'date - why, whose decision']. Empty today.
])
{
  const lists = new Map()   // rel -> {offsets, idx}
  const bad = []
  for (const file of iniFiles) {
    const dir = dirname(file)
    for (const sec of readFileSync(file, 'utf8').split(/\r?\n(?=\[)/)) {
      if (!/^;mode=option\s*$/m.test(sec)) continue
      const src = sec.match(/^json_file_source\s+'([^']+)'\s+name\s*$/m)
      if (!src) continue
      const listPath = resolve(dir, src[1])
      const rel = relative(DIST, listPath).split(String.fromCharCode(92)).join('/')
      let list
      try { list = JSON.parse(readFileSync(listPath, 'utf8')) } catch { continue }   // check 53 reports it
      if (!Array.isArray(list)) continue
      const idx = list.findIndex(e => e && e.short === 'eBAMATIC')
      if (idx === -1) continue
      const e = lists.get(rel) ?? { offsets: new Set(), idx, first: list[0]?.name }
      for (const m of sec.matchAll(/CUST (\d+) \{json_file_source/g)) e.offsets.add(Number(m[1]))
      lists.set(rel, e)
    }
  }
  for (const [rel, e] of lists) {
    if (e.idx === 0) continue
    const excused = EBAMATIC_NOT_FIRST67.has(rel) || [...e.offsets].some(o => EBAMATIC_NOT_FIRST67.has(o))
    if (!excused) bad.push(`${rel} (${[...e.offsets].join(', ') || 'без смещения'}): eBAMATIC не первым, а ${e.idx + 1}-м — список открывается с «${e.first}»`)
  }
  if (!lists.size)
    problems.push({ sev: 'CRITICAL', what: 'проверка «eBAMATIC первым» не нашла ни одного списка с eBAMATIC — она смотрит в пустоту, ничего не проверив' })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `eBAMATIC не первым в списке выбора (${bad.length}):\n     ${bad.join('\n     ')}` })
  else ok.push(`eBAMATIC opens every option list that offers it (${lists.size} lists, ${EBAMATIC_NOT_FIRST67.size ? `${EBAMATIC_NOT_FIRST67.size} excused` : 'none excused'})`)
}

// ---------------- 68. VDDQ/VDD2 on entry, in backups and on page 2, run on a model of the engine
//
// Operator, 22.09.2026: "we cancel and do not put them in" - a backup carries no VDDQ/VDD2 and no
// `Meta firmware` (it existed for the voltages only), Apply never touches emc_timings.ini, and a
// 21-22.09.2026 backup's [Optimized] is ignored. Page 2 of every backup shows THIS console's
// values under the backup's profile, with the caveat "this console".
//
// WHICH PROFILE depends on the console's 4IFIR (DECISIONS 22.09.2026). 2.6+ reads the E section
// `<1600|1331>CL<n>`, 2.5 the S section `<RAM MHz>CL<n>` (clock at CUST 32 on Mariko, 24 on
// Erista), a console without 4IFIR.ovl nothing. The forwarder into each page that asks reads the
// overlay afresh and leaves [Firmware] gen next to the page: [boot] is skipped under quick launch.
// Entering only reads the file (operator, 22.09.2026: values already set are shown, not rewritten).
//
// Read as text, all these places look right after most one-line breakages, so the sections are
// RUN: a small model of the engine's command loop (try:/force_failure/skip, bindings per command,
// placeholders innermost first, `mariko:`/`erista:` labels, `;system=` and the conditions the
// pages use - fork `interpretAndExecuteCommands`, `evaluateMenuCondition`) plays every forwarder,
// [boot], Create, Apply, the reset and page 2 on made-up consoles of every generation and revision.
{
  const EMC68 = '/config/4IFIR/emc_timings.ini'
  const KIP68 = '/atmosphere/kips/loader.kip'
  const OVL68 = '/switch/.overlays/4IFIR.ovl'
  const FQ68 = { mariko: '32', erista: '24' }
  const bad = []
  let runs68 = 0

  // ---- the engine model: tokens as parseCommandLine, placeholders innermost first
  const tok68 = line => {
    const out = []; let i = 0
    while (i < line.length) {
      while (line[i] === ' ' || line[i] === '\t') i++
      if (i >= line.length) break
      if (line[i] === "'" || line[i] === '"') { const q = line[i++]; const s = i; while (i < line.length && line[i] !== q) i++; out.push(line.slice(s, i)); i++ }
      else { const s = i; while (i < line.length && !" \t'\"".includes(line[i])) i++; const t = line.slice(s, i); if (t !== '=') out.push(t) }
    }
    return out
  }
  const norm68 = p => (p || '').replace(/^sdmc:/, '')
  const resolve68 = (arg, st) => {
    const re = /\{([A-Za-z_=!<>]+)(?:\(([^{}]*)\))?\}/
    for (let guard = 0; guard < 200; guard++) {
      const m = arg.match(re)
      if (!m) return arg
      const [all, fn, a = ''] = m
      const p = a.split(',')
      let v
      if (fn === 'hex_file') {
        const [, off, len] = p
        v = st.hex === KIP68 ? (st.kip[off] ?? '00'.repeat(Number(len))).slice(0, Number(len) * 2)
          : st.bins?.[norm68(st.hex)] ? (hexAt68(st, st.hex, p[0], off, Number(len)) || 'UNRESOLVED_HEX_FILE') : 'null'
      } else if (fn === 'ini_file') v = st.files[norm68(st.ini)]?.[p[0]]?.[p.slice(1).join(',')] || 'null'
      else if (fn === 'list') v = st.list[Number(p[0])] ?? 'null'
      else if (fn === 'if_==') v = p[0] === p[1] ? p[2] : (p.length > 3 ? p.slice(3).join(',') : p[0])
      else if (fn === 'if_null') v = p[0] === 'null' ? p[1] : (p.length > 2 ? p.slice(2).join(',') : p[0])
      else if (fn === 'hex_to_rhex') v = (p[0].match(/../g) || []).reverse().join('')
      else if (fn === 'hex_to_decimal') v = /^[0-9A-Fa-f]+$/.test(p[0]) ? String(parseInt(p[0], 16)) : 'null'
      else if (fn === 'math') v = /^[\d+\-*/(). ]+$/.test(p[0]) ? String(Math.trunc(Function(`return (${p[0]})`)())) : 'null'
      else v = 'X'                                             // timestamp, ram_*, json_file, slice
      arg = arg.replace(all, v)
    }
    return arg
  }
  // `matching_hex_val_custom` and `{hex_file()}` on any file: the kip by its cells, any other file
  // (the overlay, a Buffer) by its bytes at the first pattern + offset. As in libultra, finding the
  // pattern reads the whole file (st.scans) and only a hit is cached (hexSumCache, st.hcache).
  // A missing file matches nothing.
  const hexOf68 = b => b.toString('hex').toUpperCase()
  const hexAt68 = (st, path, pat, off, len) => {
    if (norm68(path) === KIP68) return (st.kip[off] ?? '00'.repeat(len)).slice(0, len * 2)
    const buf = st.bins?.[norm68(path)]
    if (!buf) return ''
    const key = `${norm68(path)}?${pat}`
    let at = (st.hcache ??= {})[key]
    if (at === undefined) { st.scans = (st.scans ?? 0) + 1; at = buf.indexOf(pat); if (at >= 0) st.hcache[key] = at }
    const from = at + Number(off)
    return at < 0 || from + len > buf.length ? '' : hexOf68(buf.subarray(from, from + len))
  }
  // `matching_hex_val`: fopen, fseek, fread of the bytes asked - no search (fork `hexValMatches`).
  const absAt68 = (st, path, off, len) => {
    const buf = st.bins?.[norm68(path)]
    if (!buf) return ''
    st.reads = (st.reads ?? 0) + 1
    return Number(off) + len > buf.length ? '' : hexOf68(buf.subarray(Number(off), Number(off) + len))
  }
  const hexOk68 = h => h.length > 0 && h.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(h)
  const run68 = (secText, st) => {
    st.footer = null; st.kipWrites = 0
    let inTry = false, okFlag = true, plat = null
    for (const raw of secText.split('\n').slice(1)) {
      const line = raw.trim()
      if (!line || line.startsWith(';')) continue
      if (line === 'mariko:' || line === 'erista:') { plat = line.slice(0, -1); continue }
      if (plat && plat !== st.rev) continue                    // dropped before the loop runs
      if (line === 'try:') { if (inTry && okFlag) return st; okFlag = true; inTry = true; continue }
      if (inTry && !okFlag) continue
      const [cmd, ...args] = tok68(line).map(t => resolve68(t, st))
      const file = p => (st.files[norm68(p)] ??= {})
      if (cmd === 'ini_file') st.ini = args[0]
      else if (cmd === 'hex_file') st.hex = args[0]
      else if (cmd === 'set-ini-val') { const f = file(args[0]); (f[args[1]] ??= {})[args[2]] = args[3] }
      else if (cmd === 'matching_ini_val' || cmd === '!matching_ini_val') {
        const act = st.files[norm68(args[0])]?.[args[1]]?.[args[2]] ?? ''
        okFlag = (act === args.slice(3).join(' ')) === (cmd === 'matching_ini_val')
      } else if (cmd === 'matching_hex_val_custom' || cmd === '!matching_hex_val_custom') {
        const [kp, pat, off, hex = ''] = args
        const act = hexAt68(st, kp, pat, off, hex.length / 2)
        okFlag = (act !== '' && act.toUpperCase() === hex.toUpperCase()) === (cmd === 'matching_hex_val_custom')
      } else if (cmd === 'matching_hex_val' || cmd === '!matching_hex_val') {
        const [kp, off, hex = ''] = args
        const act = hexOk68(hex) ? absAt68(st, kp, off, hex.length / 2) : ''
        okFlag = (act !== '' && act === hex.toUpperCase()) === (cmd === 'matching_hex_val')
      } else if (cmd === 'force_failure') okFlag = false
      else if (cmd === 'path_exists' || cmd === '!path_exists') okFlag = (norm68(args[0]) in st.files || norm68(args[0]) in (st.bins ?? {})) === (cmd === 'path_exists')
      else if (cmd === 'remove-ini-key') delete st.files[norm68(args[0])]?.[args[1]]?.[args[2]]
      else if (cmd === 'delete') delete st.files[norm68(args[0])]
      else if (cmd === 'set-footer') st.footer = args[0]
      else if (cmd === 'hex-by-custom-offset') { if (args[3] !== 'null') { st.kip[args[2]] = args[3]; st.kipWrites++ } }
    }
    return st
  }
  // A section's visibility, as evaluateMenuCondition and `;system=` decide it: every line holds.
  const shown68 = (sec, st) => sec.split('\n').map(l => l.trim()).every(l => {
    if (l.startsWith(';system=')) return l.slice(8) === st.rev
    if (!l.startsWith(';visibility_condition=')) return true
    let c = l.slice(22); const neg = c.startsWith('!'); if (neg) c = c.slice(1)
    const t = c.split(' ')
    let r
    if (t[0] === 'matching_ini_val') r = (st.files[norm68(t[1])]?.[t[2]]?.[t[3]] ?? '') === t.slice(4).join(' ')
    else if (t[0] === 'matching_hex_val_custom') { const act = hexAt68(st, t[1], t[2], t[3], t[4].length / 2); r = act !== '' && act.toUpperCase() === t[4].toUpperCase() }
    else return false
    return neg ? !r : r
  })
  // Rows of a table, bindings and lists as the table builder reads them.
  const rows68 = (sec, st) => {
    const rows = {}
    for (const raw of sec.split('\n')) {
      const l = raw.trim()
      const d = l.match(/^(ini_file|hex_file|list)\s+'(.*)'$/)
      if (d) { const v = resolve68(d[2], st); if (d[1] === 'ini_file') st.ini = v; else if (d[1] === 'hex_file') st.hex = v; else st.list = v.replace(/^\[|\]$/g, '').split(',').map(x => x.trim()); continue }
      const r = l.match(/^'([^']*)'\s*=\s*'(.*)'$/)
      if (r) rows[resolve68(r[1], st)] = resolve68(r[2], st)
    }
    return rows
  }
  const clone = o => JSON.parse(JSON.stringify(o))
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  // The clock of the made-up console: 2265.6 MHz here, 1866 MHz at the OTHER revision's offset -
  // a profile named from the wrong offset lands in the trap section 1866CL12.
  const CLK = '009222', TRAP = '10791C'
  const kipOf = (rev, bal, tgt, clk = CLK) => ({ '12352': bal, '12524': tgt, [FQ68[rev]]: clk, [FQ68[rev === 'mariko' ? 'erista' : 'mariko']]: TRAP })
  const EMC_OTHER = { '1600CL12': { eVDQ: '1111', eVD2: '2222', tRAS: '7' }, '1866CL16': { tRCD: '9' } }
  // A file both generations have written to: E, the S section of this clock, the trap.
  const EMC_BOTH = { '1600CL12': { eVDQ: '1111', eVD2: '2222', tRAS: '7' }, '2265CL12': { eVDQ: '3333', eVD2: '4444', sRP: '5' }, '1866CL12': { eVDQ: '9', eVD2: '9' } }

  // ---- entry: every forwarder into a page that reads the flag detects the generation afresh
  //
  // The engine skips [boot] when the package's boot is off or quick launch is on (fork main.cpp,
  // `useQuickLaunch`), so a flag left there could be stale after a 2.5 -> 2.6 update or missing.
  // Each forwarder into a page that asks [Firmware] gen runs the detection before the page is
  // built; here each is RUN on four overlays x two revisions, starting from a right, a wrong and a
  // missing flag. And entering writes nothing into emc_timings.ini (operator, 22.09.2026: values
  // already there are only read and shown): every forwarder and [boot] run on a console with the
  // file, which must come out unchanged.
  const readsGen68 = t => t.split('\n').some(l => !l.startsWith('set-ini-val ') && !l.endsWith("Firmware gen ''") && /Firmware gen |\{ini_file\(Firmware,gen\)\}/.test(l))
  const forwarders68 = []
  for (const f of iniFiles) {
    const rel = relative(DIST, f).split(String.fromCharCode(92)).join('/')
    const dir = posix.dirname(rel)
    for (const sec of readFileSync(f, 'utf8').split(/\n(?=\[)/)) {
      if (!/^;mode=forwarder$/m.test(sec)) continue
      const src = sec.match(/^package_source '([^']+)'$/m)
      forwarders68.push({ rel, title: (sec.match(/^\[\*?([^\]]+)]/) || [])[1], sec, target: src ? posix.join(dir, src[1]) : null })
    }
  }
  // Made-up overlays with the layout of the real ones (docs/research/tools/zovlgen.py): NRO0 at 0x10,
  // build-id at 0x40, ASET, NACP right after its 0x38-byte header unless an icon comes first.
  // 2.7+ under a name nobody knows yet reads VDDQ/VDD2 like 2.6 (operator, 22.09.2026).
  const bid68 = n => Buffer.alloc(20, n)
  const mkOvl68 = ({ name, bid, icon = false, code = '' }) => {
    const b = Buffer.alloc(0x2000)
    b.write('NRO0', 0x10, 'latin1'); bid.copy(b, 0x40); b.write(code, 0x200, 'latin1')
    const a = 0x1000, nacp = icon ? 0x138 : 0x38
    b.write('ASET', a, 'latin1'); b.writeBigUInt64LE(icon ? 0x38n : 0n, a + 8); b.writeBigUInt64LE(icon ? 0x100n : 0n, a + 16)
    b.writeBigUInt64LE(BigInt(nacp), a + 24); b.writeBigUInt64LE(0x400n, a + 32); b.write(name, a + nacp, 'latin1')
    return { buf: b, bid: bid.toString('hex').toUpperCase() }
  }
  const ZERO68 = '00'.repeat(20)
  const O25 = mkOvl68({ name: '4IFIR Houdini', bid: bid68(0x25), code: 'Houdini' })
  const O26 = mkOvl68({ name: '4IFIR Nextgen', bid: bid68(0x26) })
  const O27 = mkOvl68({ name: '4IFIR Futurename', bid: bid68(0x27) })
  const OZERO = mkOvl68({ name: '4IFIR Nextgen', bid: bid68(0) })
  const OVLS68 = [
    ['4IFIR 2.5', O25, '2.5'], ['4IFIR 2.6', O26, '2.6'], ['4IFIR 2.7 с неизвестным именем', O27, '2.6'],
    ['4IFIR 2.7, «Houdini» в коде', mkOvl68({ name: '4IFIR Futurename', bid: bid68(0x28), code: 'Houdini' }), '2.6'],
    ['4IFIR 2.5 с иконкой (NACP сдвинут)', mkOvl68({ name: '4IFIR Houdini', bid: bid68(0x29), icon: true, code: 'Houdini' }), '2.5'],
    ['4IFIR 2.6 с иконкой', mkOvl68({ name: '4IFIR Nextgen', bid: bid68(0x2A), icon: true }), '2.6'],
    ['4IFIR 2.6 с нулевым build-id', OZERO, '2.6'],
    ['без 4IFIR.ovl', null, 'none'],
  ]
  // What the page's config.ini held before: a right flag, a flag with another overlay's fingerprint,
  // a flag without one, nothing, a hand-made zero fingerprint, a fingerprint without a flag.
  const WAS68 = [
    ['2.5 с отпечатком 2.5', { gen: '2.5', ovl_id: O25.bid }], ['2.6 с отпечатком 2.6', { gen: '2.6', ovl_id: O26.bid }],
    ['2.5 без отпечатка', { gen: '2.5' }], ['не записан', null], ['2.5 с нулевым отпечатком', { gen: '2.5', ovl_id: ZERO68 }],
    ['отпечаток без флага', { ovl_id: O26.bid }],
  ]
  // The fingerprint is trusted only when it is this overlay's, not zero, and the flag is there.
  const trusted68 = (ovl, was) => !!ovl && !!was?.gen && was.ovl_id === ovl.bid && ovl.bid !== ZERO68
  const entryState68 = (rev, ovl, files) => ({ kip: kipOf(rev, '020000', '01'), hex: null, ini: null, list: [], rev,
    bins: ovl ? { [OVL68]: ovl.buf } : {}, hcache: {}, scans: 0, reads: 0, files: { [EMC68]: clone(EMC_BOTH), ...clone(files) } })
  let entries68 = 0, trustedRuns68 = 0
  for (const fw of forwarders68) {
    const tf = fw.target && join(DIST, fw.target)
    const reads = !!tf && existsSync(tf) && readsGen68(readFileSync(tf, 'utf8'))
    const cfgs = [...new Set([...fw.sec.matchAll(/^set-ini-val '([^']+)' Firmware gen /gm)].map(m => m[1]))]
    const where = `${fw.rel} «${fw.title}» → ${fw.target}`
    for (const [name, ovl, want] of OVLS68) for (const rev of ['mariko', 'erista']) for (const [wasName, was] of WAS68) {
      runs68++
      const st = entryState68(rev, ovl, Object.fromEntries(cfgs.map(c => [c, was ? { Firmware: { ...was } } : {}])))
      run68(fw.sec, st)
      if (!same(st.files[EMC68], EMC_BOTH))
        bad.push(`${fw.rel} «${fw.title}» (${name}, ${rev}): вход на страницу изменил emc_timings.ini — ${JSON.stringify(st.files[EMC68])}`)
      if (!reads) continue
      entries68++
      const trust = trusted68(ovl, was)
      const wantGen = trust ? was.gen : want
      const wantId = trust ? was.ovl_id : (ovl && ovl.bid !== ZERO68 ? ovl.bid : undefined)
      const got = cfgs.map(c => st.files[c]?.Firmware?.gen ?? '—')
      const ids = cfgs.map(c => st.files[c]?.Firmware?.ovl_id)
      const ctx = `${where} (${name}, ${rev}, было: ${wasName})`
      if (!cfgs.length || got.some(g => g !== wantGen))
        bad.push(`${ctx}: поколение записано как ${got.join('/') || 'никак'}, а ждали ${wantGen}`)
      if (ids.some(i => i !== wantId))
        bad.push(`${ctx}: ovl_id = ${ids.map(i => i ?? '—').join('/')}, а ждали ${wantId ?? 'пусто'}${ovl?.bid === ZERO68 ? ' — нулевой build-id отпечатком не служит' : ''}`)
      if (trust) {
        trustedRuns68++
        if (st.scans) bad.push(`${ctx}: отпечаток совпал, а оверлей всё равно прочитан поиском ${st.scans} раз — на совпадении полных проходов быть не должно`)
      } else if (ovl && !st.scans) bad.push(`${ctx}: отпечаток не совпал, а поколение не определялось (полных проходов 0)`)
    }
    if (!reads) continue
    // The operator's scenarios on one console in a row, each a fresh visit (empty hexSumCache).
    const SEQ68 = [
      ['первая установка 2.5', O25], ['тот же оверлей 2.5', O25], ['обновление AIO 2.5→2.6', O26], ['тот же оверлей 2.6', O26],
      ['ручной откат 2.6→2.5', O25], ['2.7 с новым именем', O27], ['build-id нули', OZERO], ['build-id нули, снова', OZERO],
      ['файла нет', null], ['снова 2.6', O26],
    ]
    let files = {}, prev
    for (const [step, ovl] of SEQ68) {
      runs68++
      const st = entryState68('mariko', ovl, files)
      run68(fw.sec, st)
      files = Object.fromEntries(cfgs.map(c => [c, st.files[c] ?? {}]))
      const want = ovl === null ? 'none' : ovl === O25 ? '2.5' : '2.6'
      const got = cfgs.map(c => st.files[c]?.Firmware?.gen ?? '—')
      const ctx = `${where}, по шагам: «${step}»`
      if (got.some(g => g !== want)) bad.push(`${ctx}: поколение ${got.join('/')}, а ждали ${want}`)
      const kept = !!prev && !!ovl && prev.bid === ovl.bid && ovl.bid !== ZERO68
      if (kept && st.scans) bad.push(`${ctx}: тот же оверлей прочитан поиском ${st.scans} раз — ждали одно чтение build-id`)
      if (ovl && !kept && !st.scans) bad.push(`${ctx}: оверлей сменился или без отпечатка, а поколение не определялось`)
      prev = ovl
    }
  }
  if (entries68 && !trustedRuns68) bad.push('ни одного входа с совпавшим отпечатком — чтение без поиска не проверено')
  if (!entries68) bad.push('ни один форвардер не ведёт на страницу, спрашивающую поколение, — пересчёт флага при входе не проверен')
  {
    const bf = join(DIST, 'boot_package.ini')
    if (existsSync(bf)) for (const [name, ovl] of OVLS68) {
      runs68++
      const st = { kip: kipOf('mariko', '020000', '01'), hex: null, ini: null, list: [], rev: 'mariko', bins: ovl ? { [OVL68]: ovl.buf } : {}, files: { [EMC68]: clone(EMC_BOTH) } }
      run68(readFileSync(bf, 'utf8'), st)
      if (!same(st.files[EMC68], EMC_BOTH)) bad.push(`boot_package.ini (${name}): вход в пакет изменил emc_timings.ini — ${JSON.stringify(st.files[EMC68])}`)
    }
  }

  for (const rev of ['mariko', 'erista']) {
    const rel = `service/restore-${rev}.ini`
    const f = join(DIST, rel)
    if (!existsSync(f)) { bad.push(`${rel}: файла нет`); continue }
    const secs = readFileSync(f, 'utf8').split(/\n(?=\[)/)
    const create = secs.find(s => s.startsWith(`[Create backup?${rev}]`))
    const apply = secs.find(s => s.startsWith('[Apply this backup'))
    if (!create || !apply) { bad.push(`${rel}: нет секции ${create ? 'Apply this backup' : 'Create backup'}`); continue }
    const kipver = (create.match(/ Meta kipver '([^']+)'/) || [])[1]
    const cls = create.split('\n').map(l => l.trim())
    const als = apply.split('\n').map(l => l.trim())
    const fq = FQ68[rev]
    const other = rev === 'mariko' ? 'erista' : 'mariko'

    // -- text: a backup carries no voltages and no generation mark, Apply never names the file
    if (cls.some(l => / Optimized (eVDQ|eVD2) /.test(l))) bad.push(`${rel} «Create backup»: копия снова пишет секцию [Optimized] — напряжения в копию не кладём (DECISIONS 22.09.2026)`)
    if (cls.some(l => / Meta firmware /.test(l))) bad.push(`${rel} «Create backup»: копия пишет пометку Meta firmware — она была нужна только напряжениям`)
    if (cls.some(l => l.includes(EMC68))) bad.push(`${rel} «Create backup»: создание копии читает emc_timings.ini — копия напряжений не несёт`)
    const touch = als.filter(l => l.includes(EMC68) || / Optimized /.test(l) || / Meta firmware /.test(l))
    if (touch.length) bad.push(`${rel} «Apply»: применение копии трогает emc_timings.ini или [Optimized] копии — «${touch[0]}»`)

    // -- run: Create on consoles of every generation
    // emc = null: the file does not exist (a clean 4IFIR)
    const baseSt = (kip, emc, gen) => ({
      kip: { ...kip }, hex: null, ini: null, list: [], rev,
      files: { './config.ini': gen ? { Firmware: { gen } } : {}, ...(emc ? { [EMC68]: clone(emc) } : {}) },
    })
    const creates = [
      { name: '2.6, eBAL 2', gen: '2.6', kip: kipOf(rev, '020000', '01'), emc: EMC_BOTH },
      { name: '2.5, eBAL 2', gen: '2.5', kip: kipOf(rev, '020000', '01'), emc: EMC_BOTH },
      { name: '2.5, частота eBAMATIC', gen: '2.5', kip: kipOf(rev, '020000', '01', '000000'), emc: EMC_BOTH },
      { name: 'без 4IFIR', gen: 'none', kip: kipOf(rev, '020000', '01'), emc: EMC_BOTH },
      { name: '2.6, нет файла', gen: '2.6', kip: kipOf(rev, '020000', '01'), emc: null },
    ]
    const made = {}
    for (const c of creates) {
      runs68++
      const st = run68(create, baseSt(c.kip, c.emc, c.gen))
      // the create path is forgotten after "saved", so the backup is found by its folder
      const bak = Object.entries(st.files).find(([k]) => k.startsWith(`/atmosphere/kips/.bak/${rev}/`))?.[1]
      if (st.footer !== 'saved') bad.push(`${rel} «Create backup» (${c.name}): подпись «${st.footer}», а ждали saved`)
      if (bak?.Optimized) bad.push(`${rel} «Create backup» (${c.name}): копия снова несёт [Optimized] ${JSON.stringify(bak.Optimized)}`)
      if (bak?.Meta?.firmware !== undefined) bad.push(`${rel} «Create backup» (${c.name}): копия несёт пометку Meta firmware = «${bak.Meta.firmware}»`)
      if (!same(st.files[EMC68], c.emc)) bad.push(`${rel} «Create backup» (${c.name}): создание копии изменило emc_timings.ini`)
      made[c.name] = bak ? clone(bak) : null
    }

    // -- run: Apply never touches emc_timings.ini - whatever the backup holds, on every console
    const P = `/atmosphere/kips/.bak/${rev}/x.ini`
    const nb = (bal, tgt, volts, fw, clk = CLK) => ({
      Meta: { revision: rev, kipver, ...(fw ? { firmware: fw } : {}) },
      Fields: { '12352': bal, '12524': tgt, [fq]: clk },
      ...(volts ? { Optimized: { eVDQ: volts[0], eVD2: volts[1] } } : {}),
    })
    const kinds = [
      { name: 'новая копия', bak: made['2.6, eBAL 2'], footer: 'restored' },
      { name: 'копия 21–22.09 с [Optimized] 650/1100 и пометкой 2.5', bak: nb('020000', '01', ['650', '1100'], '2.5'), footer: 'restored' },
      { name: 'копия 21–22.09 с [Optimized] 0/0 и пометкой 2.6', bak: nb('020000', '01', ['0', '0'], '2.6'), footer: 'restored' },
      { name: 'копия 21.09 с [Optimized] 1150/0 без пометки, Target 00', bak: nb('060000', '00', ['1150', '0']), footer: 'restored' },
      { name: 'старая копия без [Optimized]', bak: nb('020000', '01', null), footer: 'restored' },
      { name: 'импортированная копия', bak: { ...nb('020000', '01', null), Meta: { revision: rev, kipver: 'imported' } }, footer: 'restored (import)' },
      { name: `копия с ${other}`, bak: { ...nb('020000', '01', ['1200', '1200'], '2.6'), Meta: { revision: other, kipver } }, footer: 'not applied' },
    ]
    for (const gen of ['2.6', '2.5', 'none', null]) for (const k of kinds) for (const emc0 of [EMC_BOTH, null]) {
      if (!k.bak) { bad.push(`${rel} «Apply» (${k.name}): копию создать не удалось — сценарий не проверен`); continue }
      runs68++
      const st = baseSt({ '12352': '000000', '12524': '01' }, emc0, gen)
      st.files['./config.ini'].Restore = { Path: 'sdmc:' + P }
      st.files[P] = clone(k.bak)
      run68(apply, st)
      const nm = `${gen ?? 'без флага'}: ${k.name}${emc0 ? '' : ', файла нет'}`
      if (st.footer !== k.footer) bad.push(`${rel} «Apply» (${nm}): подпись «${st.footer}», а ждали «${k.footer}»`)
      if (k.footer !== 'not applied' && !st.kipWrites) bad.push(`${rel} «Apply» (${nm}): kip не восстановлен`)
      if (k.footer === 'not applied' && st.kipWrites) bad.push(`${rel} «Apply» (${nm}): kip записан при отказе`)
      if (!same(st.files[EMC68], emc0))
        bad.push(`${rel} «Apply» (${nm}): применение копии изменило emc_timings.ini — стал ${JSON.stringify(st.files[EMC68])}${emc0 ? '' : ' (файла не было)'}`)
    }

    // -- run: factory reset (reset.ini, this revision's button): a zero only into a key that exists
    const EMC_NOKEY = { '1600CL12': { tRAS: '7' }, '1866CL16': { tRCD: '9' } }
    const S = (q, d) => ({ ...clone(EMC_BOTH), '2265CL12': { ...EMC_BOTH['2265CL12'], ...(q != null ? { eVDQ: q } : {}), ...(d != null ? { eVD2: d } : {}) } })
    {
      const rf68 = join(DIST, 'service', 'reset.ini')
      const rtxt = existsSync(rf68) ? readFileSync(rf68, 'utf8') : ''
      const rsec = rtxt.split(/\n(?=\[)/).find(x => x.startsWith('[Apply factory defaults') && x.split('\n')[0].endsWith(`?${rev}]`))
      if (!rsec) bad.push(`service/reset.ini: нет кнопки сброса для ${rev}`)
      else {
        const anyField = new Proxy({}, { get: (_, k) => typeof k === 'string' ? '000000' : undefined })
        const resets = [
          { gen: '2.6', name: 'нет файла, eBAL 2', kip: kipOf(rev, '020000', '01'), emc0: null, emc: null },
          { gen: '2.6', name: 'раздел без ключей, eBAL 2', kip: kipOf(rev, '020000', '01'), emc0: EMC_NOKEY, emc: EMC_NOKEY },
          { gen: '2.6', name: 'ключи есть, eBAL 2', kip: kipOf(rev, '020000', '01'), emc0: EMC_BOTH, emc: { ...clone(EMC_BOTH), '1600CL12': { eVDQ: '0', eVD2: '0', tRAS: '7' } } },
          { gen: '2.6', name: 'только eVD2 есть, eBAL 2', kip: kipOf(rev, '020000', '01'), emc0: { '1600CL12': { eVD2: '1200' } }, emc: { '1600CL12': { eVD2: '0' } } },
          { gen: '2.6', name: 'eBAL 0', kip: kipOf(rev, '000000', '01'), emc0: { ...clone(EMC_OTHER), '1600CL8': { eVDQ: '999', eVD2: '888' } }, emc: { ...clone(EMC_OTHER), '1600CL8': { eVDQ: '999', eVD2: '888' } } },
          { gen: '2.5', name: 'ключи в разделе S, eBAL 2', kip: kipOf(rev, '020000', '01'), emc0: EMC_BOTH, emc: S('0', '0') },
          { gen: '2.5', name: 'нет файла', kip: kipOf(rev, '020000', '01'), emc0: null, emc: null },
          { gen: '2.5', name: 'раздел S без ключей', kip: kipOf(rev, '020000', '01'), emc0: { '2265CL12': { sRP: '5' } }, emc: { '2265CL12': { sRP: '5' } } },
          { gen: '2.5', name: 'частота eBAMATIC', kip: kipOf(rev, '020000', '01', '000000'), emc0: { ...EMC_BOTH, '0CL12': { eVDQ: '7', eVD2: '7' } }, emc: { ...EMC_BOTH, '0CL12': { eVDQ: '7', eVD2: '7' } } },
          { gen: '2.5', name: 'eBAL 0', kip: kipOf(rev, '000000', '01'), emc0: { ...EMC_BOTH, '2265CL8': { eVDQ: '7' } }, emc: { ...EMC_BOTH, '2265CL8': { eVDQ: '7' } } },
          { gen: 'none', name: 'без 4IFIR, ключи есть', kip: kipOf(rev, '020000', '01'), emc0: EMC_BOTH, emc: EMC_BOTH },
        ]
        for (const r of resets) {
          runs68++
          const st = baseSt(r.kip, r.emc0, r.gen)
          st.files['./Default.ini'] = { Fields: anyField }
          run68(rsec, st)
          const nm = `${r.gen}: ${r.name}`
          if (st.footer !== 'restored' || !st.kipWrites) bad.push(`service/reset.ini ${rev} (${nm}): подпись «${st.footer}», записей kip ${st.kipWrites} — сброс kip не выполнен`)
          if (!same(st.files[EMC68], r.emc))
            bad.push(`service/reset.ini ${rev} (${nm}): emc_timings.ini стал ${JSON.stringify(st.files[EMC68])}, а ждали ${JSON.stringify(r.emc)}${r.emc0 ? '' : ' — сброс создал файл'}`)
        }
      }
    }

    // -- page 2: the Optimized block shows THIS console's values under the backup's profile, and
    // says so under every backup whose rows are shown (22.09.2026)
    const at = secs.findIndex(s => s.includes("'Optimized Mode ({list(0)} MHz)' = ''"))
    const block = at < 0 ? null : secs.slice(at + 1).find(s => s.startsWith('[Info]'))
    const note = block ? secs[secs.indexOf(block) + 1] : null
    if (!block || !note || !note.includes('not the backup')) { bad.push(`${rel}: блок Optimized Mode страницы 2 или его оговорка не найдены`); continue }
    // The frame of the table above reaches 16 px into the note; a 16 px line needs its baseline
    // at 32 or lower to clear it (photo 2026-09-22 09-36-22: the line sat on the frame).
    const sg = +(note.match(/^;start_gap=(\d+)$/m) || [])[1] || 20
    if (sg < 32) bad.push(`${rel} стр. 2: оговорка «this console - not the backup» с start_gap ${sg} — строка налезает на рамку таблицы над ней, нужно не меньше 32`)
    const pageSt = (bak, gen) => {
      const st = baseSt({}, EMC_BOTH, gen)
      st.files['./config.ini'].Restore = { Path: P }
      st.files[P] = clone(bak)
      return st
    }
    const views = [
      { gen: '2.6', name: 'новая копия', bak: made['2.6, eBAL 2'], vq: '1111 mV', v2: '2222 mV', caveat: true },
      { gen: '2.6', name: 'копия 21–22.09 с [Optimized] 650/1100 — значения консоли, не копии', bak: nb('020000', '01', ['650', '1100'], '2.6'), vq: '1111 mV', v2: '2222 mV', caveat: true },
      { gen: '2.6', name: 'старая копия', bak: nb('020000', '01', null), vq: '1111 mV', v2: '2222 mV', caveat: true },
      { gen: '2.6', name: 'копия с eBAL 0', bak: nb('000000', '01', null), vq: 'null', v2: 'null', caveat: false },
      { gen: '2.6', name: 'копия с Target 0', bak: nb('020000', '00', null), vq: 'eBAMATIC', v2: 'eBAMATIC', caveat: true },
      { gen: '2.5', name: 'новая копия — раздел S этой консоли', bak: made['2.5, eBAL 2'], vq: '3333 mV', v2: '4444 mV', caveat: true },
      { gen: '2.5', name: 'копия 21–22.09 с [Optimized] 650/1100', bak: nb('020000', '01', ['650', '1100'], '2.5'), vq: '3333 mV', v2: '4444 mV', caveat: true },
      { gen: '2.5', name: 'копия с частотой eBAMATIC', bak: nb('020000', '01', null, null, '000000'), vq: 'null', v2: 'null', caveat: false },
      { gen: 'none', name: 'копия без 4IFIR', bak: nb('020000', '01', ['1100', '0'], '2.6'), vq: 'null', v2: 'null', caveat: false },
      { gen: null, name: 'флага нет', bak: nb('020000', '01', null), vq: 'null', v2: 'null', caveat: false },
    ]
    for (const v of views) {
      if (!v.bak) { bad.push(`${rel} стр. 2 (${v.name}): копию создать не удалось — сценарий не проверен`); continue }
      runs68++
      const rows = rows68(block, pageSt(v.bak, v.gen))
      const cav = rows68(note, pageSt(v.bak, v.gen))['']
      const wantHead = `Optimized Mode (${v.bak.Fields['12524'] === '01' ? 1600 : 1331} MHz)`
      const head = Object.keys(rows68(secs[at], pageSt(v.bak, v.gen))).pop()
      const nm = `${v.gen ?? 'без флага'}: ${v.name}`
      if (head !== wantHead) bad.push(`${rel} стр. 2 (${nm}): заголовок блока «${head}», а ждали «${wantHead}»`)
      if (rows.VDDQ !== v.vq || rows.VDD2 !== v.v2) bad.push(`${rel} стр. 2 (${nm}): VDDQ/VDD2 = «${rows.VDDQ}»/«${rows.VDD2}», а ждали «${v.vq}»/«${v.v2}»`)
      const shown = cav !== undefined && cav !== 'null'
      if (shown !== v.caveat) bad.push(`${rel} стр. 2 (${nm}): оговорка «this console - not the backup» ${shown ? 'видна' : 'не видна'}, а ${v.caveat ? 'нужна — строки читают эту консоль у любой копии' : 'не нужна — строк нет'}`)
    }
  }

  // -- Current, page 2: one of the block's tables is shown, and it reads the place the firmware reads
  {
    const cf = join(DIST, 'current.ini')
    const secs = existsSync(cf) ? readFileSync(cf, 'utf8').split(/\n(?=\[)/) : []
    const at = secs.findIndex(s => s.includes("'Optimized Mode ({list(0)} MHz)' = ''"))
    const infos = []
    for (let i = at + 1; at >= 0 && i < secs.length && secs[i].startsWith('[Info]'); i++) infos.push(secs[i])
    if (!infos.length) bad.push('current.ini: блок Optimized Mode страницы 2 не найден')
    const cur = [
      { gen: '2.6', name: 'eBAL 2', bal: '020000', clk: CLK, vq: '1111 mV', v2: '2222 mV' },
      { gen: '2.6', name: 'eBAL 0', bal: '000000', clk: CLK, vq: 'null', v2: 'null' },
      { gen: '2.5', name: 'eBAL 2', bal: '020000', clk: CLK, vq: '3333 mV', v2: '4444 mV' },
      { gen: '2.5', name: 'частота eBAMATIC', bal: '020000', clk: '000000', vq: 'null', v2: 'null' },
      { gen: '2.5', name: 'eBAL 0', bal: '000000', clk: CLK, vq: 'null', v2: 'null' },
      { gen: 'none', name: 'без 4IFIR', bal: '020000', clk: CLK, vq: 'null', v2: 'null' },
      { gen: null, name: 'флага нет', bal: '020000', clk: CLK, vq: 'null', v2: 'null' },
    ]
    for (const rev of ['mariko', 'erista']) for (const c of cur) {
      if (!infos.length) break
      runs68++
      const st = { kip: kipOf(rev, c.bal, '01', c.clk), hex: null, ini: null, list: [], rev,
        files: { './config.ini': c.gen ? { Firmware: { gen: c.gen } } : {}, [EMC68]: clone(EMC_BOTH) } }
      const vis = infos.filter(s => shown68(s, st))
      const nm = `${c.gen ?? 'без флага'}, ${rev}: ${c.name}`
      if (vis.length !== 1) { bad.push(`current.ini стр. 2 (${nm}): видно ${vis.length} таблиц блока Optimized Mode, а ждали одну`); continue }
      const rows = rows68(vis[0], st)
      if (rows.VDDQ !== c.vq || rows.VDD2 !== c.v2) bad.push(`current.ini стр. 2 (${nm}): VDDQ/VDD2 = «${rows.VDDQ}»/«${rows.VDD2}», а ждали «${c.vq}»/«${c.v2}»`)
    }
  }
  if (!runs68)
    problems.push({ sev: 'CRITICAL', what: 'проверка VDDQ/VDD2 при входе, в копии и на страницах не нашла предмета надзора — она смотрит в пустоту, ничего не проверив' })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `VDDQ/VDD2: вход на страницу, копия, применение или показ идут не так (${bad.length}):\n     ${bad.join('\n     ')}` })
  else ok.push(`entering a page that reads the 4IFIR generation detects it afresh (quick launch skips [boot]), entering writes nothing into emc_timings.ini, a backup carries no VDDQ/VDD2 and no Meta firmware, Apply never touches emc_timings.ini whatever the backup holds (21-22.09.2026 ones with [Optimized] included), page 2 of every backup shows THIS console's values under the backup's profile with the caveat (${runs68} runs of the engine model on both revisions and three generations; the flag is kept without a search while the overlay's NRO build-id matches ovl_id, ${trustedRuns68} such entries)`)
}

// ---------------- 69. WL-Set and DBI never come from an old Wizard backup
//
// Operator, 21.09.2026: "values of DBI/WL-Set from an old backup are not carried over". The old
// format keeps pMeh 17 "DBI" at CUST+12432, where current firmware has WL-Set and moved DBI to
// sMeh 17 (12528), and nothing in the file tells the two layouts apart. So the import writes
// neither key, restore of an imported copy (also one imported earlier, with DBI under Fields
// 12432) writes neither field, a copy of our own layout restores both, and page 2 shows a dash
// for both rows plus one note - only for an imported copy. The sections are RUN on the same
// kind of engine model as check 68 (placeholders innermost first, try:/force_failure,
// bindings per command). NOTES №341.
{
  const KIP69 = '/atmosphere/kips/loader.kip'
  const WL = '12432', DBI = '12528'
  const NOTE69 = 'DBI/WL-Set: not carried over from an old backup'
  const bad = []
  let runs69 = 0
  const tok69 = line => {
    const out = []; let i = 0
    while (i < line.length) {
      while (line[i] === ' ' || line[i] === '\t') i++
      if (i >= line.length) break
      if (line[i] === "'" || line[i] === '"') { const q = line[i++]; const s = i; while (i < line.length && line[i] !== q) i++; out.push(line.slice(s, i)); i++ }
      else { const s = i; while (i < line.length && !" \t'\"".includes(line[i])) i++; const t = line.slice(s, i); if (t !== '=') out.push(t) }
    }
    return out
  }
  const norm69 = p => (p || '').replace(/^sdmc:/, '')
  const resolve69 = (arg, st) => {
    for (let guard = 0; guard < 400; guard++) {
      const m = arg.match(/\{([A-Za-z_=!<>]+)(?:\(([^{}]*)\))?\}/)
      if (!m) return arg
      const [all, fn, a = ''] = m
      const p = a.split(',')
      let v
      if (fn === 'hex_file') v = st.hex === KIP69 ? (st.kip[p[1]] ?? '00'.repeat(Number(p[2]))) : 'null'
      else if (fn === 'ini_file') v = st.files[norm69(st.ini)]?.[p[0]]?.[p.slice(1).join(',')] || 'null'
      else if (fn === 'if_==') v = p[0] === p[1] ? p[2] : (p.length > 3 ? p.slice(3).join(',') : p[0])
      else if (fn === 'if_null') v = p[0] === 'null' ? p[1] : (p.length > 2 ? p.slice(2).join(',') : p[0])
      else v = 'X'
      arg = arg.replace(all, v)
    }
    return arg
  }
  const run69 = (secText, st) => {
    st.footer = null
    let inTry = false, okFlag = true
    for (const raw of secText.split('\n').slice(1)) {
      const line = raw.trim()
      if (!line || line.startsWith(';')) continue
      if (line === 'try:') { if (inTry && okFlag) return st; okFlag = true; inTry = true; continue }
      if (inTry && !okFlag) continue
      const [cmd, ...args] = tok69(line).map(t => resolve69(t, st))
      const file = p => (st.files[norm69(p)] ??= {})
      if (cmd === 'ini_file') st.ini = args[0]
      else if (cmd === 'hex_file') st.hex = args[0]
      else if (cmd === 'set-ini-val') { const f = file(args[0]); (f[args[1]] ??= {})[args[2]] = args[3] }
      else if (cmd === 'matching_ini_val' || cmd === '!matching_ini_val') {
        const act = st.files[norm69(args[0])]?.[args[1]]?.[args[2]] ?? ''
        okFlag = (act === args.slice(3).join(' ')) === (cmd === 'matching_ini_val')
      } else if (cmd === 'force_failure') okFlag = false
      else if (cmd === 'path_exists') okFlag = norm69(args[0]) in st.files
      else if (cmd === 'set-footer') st.footer = args[0]
      else if (cmd === 'hex-by-custom-offset') { if (args[3] !== 'null') st.kip[args[2]] = args[3] }
    }
    return st
  }

  const pkgPath69 = join(DIST, 'service', 'package.ini')
  const pkgTxt = existsSync(pkgPath69) ? readFileSync(pkgPath69, 'utf8') : ''
  for (const rev of ['mariko', 'erista']) {
    const rel = `service/restore-${rev}.ini`
    const f = join(DIST, rel)
    if (!existsSync(f)) { bad.push(`${rel}: файла нет`); continue }
    const secs = readFileSync(f, 'utf8').split(/\n(?=\[)/)
    const apply = secs.find(s => s.startsWith('[Apply this backup'))
    const create = secs.find(s => s.startsWith(`[Create backup?${rev}]`))
    const kipver = (create?.match(/ Meta kipver '([^']+)'/) || [])[1]
    const imp = pkgTxt.split(/\n(?=\[)/).find(s => s.startsWith(`[*Import old 4IFIR backup?${rev}]`))
    if (!apply || !kipver || !imp) { bad.push(`${rel}: нет ${!apply ? 'секции Apply' : !kipver ? 'версии раскладки в Create backup' : 'секции импорта в service/package.ini'}`); continue }

    // -- page 2: a row the converter does not carry is an explicit dash for an imported copy
    //    (like WL-Set/DBI), a row it carries reads the copy. NOTES №349.
    const conv69 = new Set([...imp.matchAll(/ Fields (\d+) '/g)].map(m => Number(m[1])))
    for (const line of secs.join('\n').split('\n')) {
      const m = line.match(/^'([^']+)' = '\{json_file\(0,(.*)\)\}'$/)
      const refs = m ? [...m[2].matchAll(/ini_file\(Fields,(\d+)\)/g)].map(x => Number(x[1])) : []
      if (refs.length !== 1) continue
      runs69++
      const dash = m[2] === `{if_==({ini_file(Meta,kipver)},imported,null,{ini_file(Fields,${refs[0]})})}`
      if (!conv69.has(refs[0]) && !dash) bad.push(`${rel}: строка «${m[1]}» читает Fields ${refs[0]}, которого импорт не кладёт, без явного null для импортированной копии — прочерк держится на пустом ключе`)
      if (conv69.has(refs[0]) && dash) bad.push(`${rel}: строка «${m[1]}» прячет перенесённое импортом поле ${refs[0]} за прочерком`)
    }

    // -- the converter writes neither key, whatever the donor holds
    runs69++
    for (const o of [WL, DBI])
      if (imp.split('\n').some(l => l.includes(` Fields ${o} `))) bad.push(`service/package.ini импорт ${rev}: пишет Fields ${o} — значение старой копии уедет в ${o === WL ? 'WL-Set' : 'DBI'}`)

    // -- restore: imported (now and before 21.09.2026) and copies of our own layout
    const P = `/atmosphere/kips/.bak/${rev}/x.ini`
    const KIP0 = { [WL]: '01', [DBI]: '02' }
    const cases = [
      { name: 'импорт, полей нет', meta: 'imported', fields: {}, footer: 'restored (import)', kip: KIP0, view: ['—', '—'], note: true },
      { name: 'импорт до 21.09, 12432 = 00', meta: 'imported', fields: { [WL]: '00' }, footer: 'restored (import)', kip: KIP0, view: ['—', '—'], note: true },
      { name: 'импорт до 21.09, 12432 = 01', meta: 'imported', fields: { [WL]: '01' }, footer: 'restored (import)', kip: { [WL]: '00', [DBI]: '00' }, view: ['—', '—'], note: true },
      { name: 'импорт до 21.09, 12432 = 03', meta: 'imported', fields: { [WL]: '03' }, footer: 'restored (import)', kip: KIP0, view: ['—', '—'], note: true },
      { name: 'импорт с битым 12432 и 12528', meta: 'imported', fields: { [WL]: 'nu', [DBI]: '07' }, footer: 'restored (import)', kip: KIP0, view: ['—', '—'], note: true },
      // A valid DBI under an imported copy: without the kipver condition the row would print it.
      { name: 'импорт с валидным 12528 = 02', meta: 'imported', fields: { [DBI]: '02' }, footer: 'restored (import)', kip: KIP0, view: ['—', '—'], note: true },
      { name: 'своя копия', meta: kipver, fields: { [WL]: '01', [DBI]: '03' }, footer: 'restored', kip: { [WL]: '00', [DBI]: '00' }, want: { [WL]: '01', [DBI]: '03' }, view: ['1', '3'], note: false },
      { name: 'своя копия, нули', meta: kipver, fields: { [WL]: '00', [DBI]: '00' }, footer: 'restored', kip: KIP0, want: { [WL]: '00', [DBI]: '00' }, view: ['0', '0'], note: false },
    ]
    const dict = n => { try { return JSON.parse(readFileSync(join(DIST, 'service', n), 'utf8'))[0] } catch { return null } }
    // the note: a skip_null table whose row resolves to NOTE69 for the backup, null otherwise
    const noteSecs = secs.filter(s => s.includes(NOTE69))
    if (noteSecs.length !== 1) bad.push(`${rel}: пометок «${NOTE69}» ${noteSecs.length}, а нужна ровно одна`)
    else if (!noteSecs[0].split('\n').includes(';skip_null=true')) bad.push(`${rel}: пометка про DBI/WL-Set без ;skip_null=true — у своей копии останется пустая строка`)
    // As in check 68: the frame of the table above reaches 16 px into the note, start_gap 32 or
    // more clears it (photo 2026-09-22 12-54-52: the line sat on the frame).
    if (noteSecs.length === 1) {
      const sg = +(noteSecs[0].match(/^;start_gap=(\d+)$/m) || [])[1] || 20
      if (sg < 32) bad.push(`${rel} стр. 2: пометка «${NOTE69}» с start_gap ${sg} — строка налезает на рамку таблицы над ней, нужно не меньше 32`)
    }
    for (const c of cases) {
      runs69++
      const bak = { Meta: { revision: rev, kipver: c.meta }, Fields: { '12352': '020000', '12524': '01', ...c.fields } }
      const st = {
        kip: { ...c.kip }, hex: null, ini: null,
        files: { './config.ini': { Restore: { Path: 'sdmc:' + P } }, [P]: JSON.parse(JSON.stringify(bak)) },
      }
      run69(apply, st)
      const want = c.want ?? c.kip
      if (st.footer !== c.footer) bad.push(`${rel} «Apply» (${c.name}): подпись «${st.footer}», а ждали «${c.footer}»`)
      for (const [o, nm] of [[WL, 'WL-Set'], [DBI, 'DBI']])
        if (st.kip[o] !== want[o]) bad.push(`${rel} «Apply» (${c.name}): ${nm} (${o}) стал ${st.kip[o]}, а ждали ${want[o]}${c.meta === 'imported' ? ' — импортированная копия не должна его трогать' : ''}`)
      // page 2: resolve each row's key against the backup and look it up in the row's dictionary
      const vst = () => ({ kip: {}, hex: null, ini: P, files: { [P]: bak, './config.ini': { Restore: { Path: P } } } })
      const view = ['pMeh 17 WL-Set', 'sMeh 17 DBI'].map(label => {
        const at = secs.findIndex(s => s.includes(`\n'${label}' = `))
        if (at < 0) return '(строки нет)'
        const lines = secs[at].split('\n')
        const k = lines.findIndex(l => l.startsWith(`'${label}' = `))
        const map = lines.slice(0, k).reverse().find(l => l.startsWith('json_file '))?.match(/'\.\/(.+)'/)?.[1]
        const key = lines[k].match(/= '\{json_file\(0,(.*)\)\}'$/)?.[1]
        if (!map || !key) return '(строка без словаря)'
        const d = dict(map)
        const kv = resolve69(key, vst())
        return d ? (d[kv] ?? d.null ?? 'Not available') : '(словаря нет)'
      })
      if (view.join('/') !== c.view.join('/')) bad.push(`${rel} стр. 2 (${c.name}): WL-Set/DBI показаны «${view.join('/')}», а ждали «${c.view.join('/')}»`)
      if (noteSecs.length === 1) {
        const row = noteSecs[0].split('\n').find(l => l.includes(NOTE69))
        const shown = resolve69(row.match(/^''='(.*)'$/)?.[1] ?? '', vst())
        if ((shown === NOTE69) !== c.note) bad.push(`${rel} стр. 2 (${c.name}): пометка про DBI/WL-Set ${shown === NOTE69 ? 'видна' : `не видна («${shown}»)`}, а ${c.note ? 'нужна' : 'не нужна — это своя копия'}`)
      }
    }
  }
  if (!runs69)
    problems.push({ sev: 'CRITICAL', what: 'проверка WL-Set/DBI старых копий не нашла предмета надзора — она смотрит в пустоту, ничего не проверив' })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `WL-Set/DBI старой копии переносятся, восстанавливаются или показываются не так (${bad.length}):\n     ${bad.join('\n     ')}` })
  else ok.push(`an old Wizard backup carries neither WL-Set nor DBI: the import writes neither, restore of an imported copy (also one imported earlier) leaves both as they are, our own copies restore both, page 2 shows a dash and the note for imported copies only, and a dash for every row the import does not carry (${runs69} runs of the engine model on both revisions)`)
}

// ---------------- 70. CPU Min Voltage (48): factory Eco ST1, zero named but never offered
//
// The live kip, the firmware's Default.json and the firmware source all put 03 (Eco ST1)
// into CUST+48; zero came from a donor package and the source does not describe it.
// Operator, 21.09.2026: zero leaves the list, and where the kip already holds it Current,
// backups and reset call it `0 - Unknown`. So: the reset writes 03, the only "Default" is
// Eco ST1 (check 24 accepts two marks if one is right; this one does not), zero is absent
// from the option list and marked not_in_menu in the map, the label map names it exactly.
{
  const WANT70 = '030000'
  const ZERO70 = '0 - Unknown'
  const bad = []
  const isDef = n => /(^|[^a-z])default([^a-z]|$)/i.test(String(n ?? ''))
  const num70 = h => { const b = String(h).toUpperCase().padEnd(6, '0').slice(0, 6).match(/../g); return parseInt(b.reverse().join(''), 16) }
  let seen70 = 0

  const factory70 = JSON.parse(readFileSync(join(ROOT, 'package', 'factory-defaults.json'), 'utf8')).defaults?.['48']
  if (factory70 !== undefined) { seen70++; if (String(factory70).toUpperCase() !== WANT70) bad.push(`factory-defaults.json: заводское поля 48 = ${factory70}, а ждали ${WANT70} (Eco ST1)`) }

  const defIni70 = join(DIST, 'service', 'Default.ini')
  if (existsSync(defIni70)) {
    const m = readFileSync(defIni70, 'utf8').match(/^48=([0-9A-Fa-f]+)\s*$/m)
    if (m) { seen70++; if (m[1].toUpperCase() !== WANT70) bad.push(`service/Default.ini: заводское поля 48 = ${m[1]}, сброс запишет не Eco ST1`) }
  }

  const resetIni70 = join(DIST, 'service', 'reset.ini')
  if (existsSync(resetIni70) && !readFileSync(resetIni70, 'utf8').includes('CUST 48 {ini_file(Fields,48)}'))
    bad.push('service/reset.ini: сброс не пишет поле 48 из Default.ini')

  const oneDefault = (list, where) => {
    const def = list.filter(v => isDef(v.name))
    if (def.length !== 1 || num70(def[0].hex) !== 3)
      bad.push(`${where}: «Default» у поля 48 стоит на ${def.length ? def.map(v => `«${v.name}»`).join(', ') : 'ничём'}, а должен ровно на Eco ST1 (03)`)
  }
  const f70 = byOffset.get(48)
  if (f70?.values?.length) {
    seen70++
    oneDefault(f70.values.filter(v => !v.not_in_menu), 'fields.json')
    const zero = f70.values.filter(v => num70(v.hex) === 0)
    if (!zero.length) bad.push('fields.json: у поля 48 нет записи 0 — стоящий в kip ноль некому будет назвать (словарь названий не сужается)')
    for (const z of zero) {
      if (!z.not_in_menu) bad.push(`fields.json: ноль поля 48 («${z.name}») предлагается в меню — решение 21.09.2026: только подпись`)
      if (z.map_label !== ZERO70) bad.push(`fields.json: ноль поля 48 подписан «${z.map_label ?? z.name}», а должен «${ZERO70}»`)
    }
    if (f70.values.some(v => /eBAMATIC/i.test(v.name))) bad.push('fields.json: у поля 48 снова есть eBAMATIC')
    if (!/Factory value: Eco ST1/.test(f70.help_text ?? '')) bad.push('fields.json: справка поля 48 не называет заводское значение (Factory value: Eco ST1)')
  }
  const list70 = join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.json')
  let dl70 = []
  try { dl70 = JSON.parse(readFileSync(list70, 'utf8')) } catch {}
  if (Array.isArray(dl70) && dl70.length) {
    seen70++
    oneDefault(dl70, 'advanced/cpu/json/cpu_vmin.json')
    const z = dl70.filter(v => num70(v.hex) === 0 || /eBAMATIC/i.test(v.name))
    if (z.length) bad.push(`advanced/cpu/json/cpu_vmin.json: ноль в списке выбора («${z.map(v => v.name).join('», «')}») — его выбирать нельзя`)
    if (num70(dl70[0].hex) !== 3) bad.push(`advanced/cpu/json/cpu_vmin.json: список открывается с «${dl70[0].name}», а не с заводского Eco ST1`)
  }
  let map70 = null
  try { map70 = JSON.parse(readFileSync(join(DIST, 'advanced', 'cpu', 'json', 'cpu_vmin.map.json'), 'utf8'))[0] } catch {}
  if (map70) {
    seen70++
    if (map70[WANT70] !== 'Eco ST1') bad.push(`cpu_vmin.map.json: заводское 030000 названо «${map70[WANT70]}», экран сброса покажет не Eco ST1`)
    if (map70['000000'] !== ZERO70) bad.push(`cpu_vmin.map.json: 000000 названо «${map70['000000']}», а должно «${ZERO70}» (Current, копии, сброс)`)
  }

  if (seen70 < 5)
    problems.push({ sev: 'CRITICAL', what: `проверка заводского CPU Min Voltage нашла ${seen70} из 5 мест (эталон, Default.ini, карта, список, словарь подписи) — она смотрит в пустоту, ничего не проверив` })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `CPU Min Voltage (48): заводское не Eco ST1 или ноль не там (${bad.length}):\n     ${bad.join('\n     ')}` })
  else ok.push('CPU Min Voltage resets to Eco ST1: baseline, Default.ini and reset agree, "Default" marks Eco ST1 alone, the list opens with it and does not offer zero, the label map names zero «0 - Unknown», the help names the factory value')
}

// ---------------- 71. the 4IFIR generation is detected on the way into every page that asks it
//
// DECISIONS 22.09.2026: where the E-state voltages go depends on the console's 4IFIR - `Houdini`
// in /switch/.overlays/4IFIR.ovl is 2.5, the file without it 2.6+, no file is not 4IFIR. The
// engine skips [boot] when the package's boot is off or quick launch is on (fork main.cpp,
// `useQuickLaunch`), so a flag written there could be stale after an update or missing. So the
// forwarder into each page that reads [Firmware] gen ends with the detection, writing the
// config.ini next to that page. The overlay is ~2 MB and a failed search is not cached (libultra
// `findHexDataOffsets`), so nothing else opens it. Four things, each a quiet way to break it:
//   1. the overlay is opened only by those detection tails - not a condition, not [boot];
//   2. every file that asks the flag is entered only through forwarders, and each of them carries
//      the detection into the config.ini next to that file;
//   3. the detection is the section's tail: `none`, then 2.5 on `Houdini`, then 2.6 on the bare
//      file, in the only two `try:` branches (the first successful one ends the section);
//   4. a reader compares the flag only with the three values the detection writes.
// The branches themselves are RUN on the engine model in check 68.
{
  const OVL71 = '/switch/.overlays/4IFIR.ovl'
  const bad = []
  const relOf = f => relative(DIST, f).split(String.fromCharCode(92)).join('/')
  const readsGen71 = t => t.split('\n').some(l => !l.startsWith('set-ini-val ') && !l.endsWith("Firmware gen ''") && /Firmware gen |\{ini_file\(Firmware,gen\)\}/.test(l))
  // Written out on purpose: an independent copy of the tail, not the generator's FW_DETECT.
  const Z71 = '00'.repeat(20)
  const detect71 = cfg => [
    `ini_file '${cfg}'`, `hex_file '${OVL71}'`,
    'try:', `!path_exists ${OVL71}`, `set-ini-val '${cfg}' Firmware gen 'none'`, `remove-ini-key '${cfg}' Firmware ovl_id`,
    'try:', `!matching_ini_val '${cfg}' Firmware gen ''`, `!matching_hex_val ${OVL71} 64 ${Z71}`, `matching_hex_val ${OVL71} 64 '{ini_file(Firmware,ovl_id)}'`,
    'try:', `set-ini-val '${cfg}' Firmware gen '2.6'`, `matching_hex_val_custom ${OVL71} ASET 24 3800000000000000`,
    `matching_hex_val_custom ${OVL71} ASET 56 344946495220486F7564696E69`, `set-ini-val '${cfg}' Firmware gen '2.5'`, 'force_failure',
    'try:', `!matching_hex_val_custom ${OVL71} ASET 24 3800000000000000`, `matching_hex_val_custom ${OVL71} Houdini 0 48`,
    `set-ini-val '${cfg}' Firmware gen '2.5'`, 'force_failure',
    'try:', `matching_hex_val ${OVL71} 16 4E524F30`, `!matching_hex_val ${OVL71} 64 ${Z71}`, `set-ini-val '${cfg}' Firmware ovl_id '{hex_file(NRO0,48,20)}'`,
    'try:', `remove-ini-key '${cfg}' Firmware ovl_id`,
  ]
  const tries71 = detect71('.').filter(l => l === 'try:').length
  const into = new Map()      // target file -> [{rel, title, ok}]
  const tails = new Set()     // "rel:line" of lines that are part of a proper detection tail
  let readers = 0
  for (const f of iniFiles) {
    const rel = relOf(f)
    const dir = posix.dirname(rel)
    let line = 0
    for (const sec of readFileSync(f, 'utf8').split(/\n(?=\[)/)) {
      const ls = sec.split('\n')
      const start = line
      line += ls.length
      if (!/^;mode=forwarder$/m.test(sec)) continue
      const src = sec.match(/^package_source '([^']+)'$/m)
      if (!src) continue
      const target = posix.join(dir, src[1])
      const title = (ls[0].match(/^\[\*?([^\]]+)]/) || [])[1]
      const tf = join(DIST, target)
      if (!existsSync(tf) || !readsGen71(readFileSync(tf, 'utf8'))) continue
      // 3. the detection is the tail, into the config.ini next to the target, and alone
      const cfg = './' + posix.relative(dir, posix.join(posix.dirname(target), 'config.ini'))
      const want = detect71(cfg)
      let end = ls.length
      while (end > 0 && !ls[end - 1].trim()) end--
      const tail = ls.slice(end - want.length, end).map(l => l.trim())
      const ok = tail.join('\n') === want.join('\n') && ls.filter(l => l.trim() === 'try:').length === tries71
      if (ok) for (let i = end - want.length; i < end; i++) tails.add(`${rel}:${start + i + 1}`)
      else bad.push(`${rel} «${title}» ведёт в ${target}, спрашивающий поколение, а не пересчитывает его в ${cfg} последними строками (нет файла → none; отпечаток build-id совпал → ничего; иначе имя NACP → 2.5/2.6 и новый отпечаток) — при быстром запуске флаг останется прежним или пустым`)
      into.set(target, [...(into.get(target) ?? []), { rel, title, ok }])
    }
  }
  // 1. the overlay is opened only by a proper detection tail
  for (const f of iniFiles) {
    const rel = relOf(f)
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/4IFIR\.ovl|Houdini|Nextgen/.test(l) && !tails.has(`${rel}:${i + 1}`))
        bad.push(`${rel}:${i + 1}: «${l.trim().slice(0, 90)}» читает 4IFIR.ovl сам — поколение спрашивается у [Firmware] gen, а оверлей (2 МБ, отрицательный поиск не кэшируется) читает только форвардер в страницу`)
    })
  }
  // 2 and 4. every reader is entered through forwarders that detect; it compares with three values
  for (const f of iniFiles) {
    const rel = relOf(f)
    const txt = readFileSync(f, 'utf8')
    if (!readsGen71(txt)) continue
    readers++
    const ins = into.get(rel) ?? []
    if (!ins.length) bad.push(`${rel} спрашивает поколение, а форвардера, пересчитывающего его при входе, нет — флаг держится только на [boot], который быстрый запуск пропускает`)
    for (const m of txt.matchAll(/Firmware gen (\S+)/g))
      if (!['2.5', '2.6', 'none', "'none'", "'2.5'", "'2.6'"].includes(m[1])) bad.push(`${rel}: поколение сравнивается с «${m[1]}» — пишутся только 2.5, 2.6 и none`)
  }
  if (!readers) bad.push('ни один файл не спрашивает поколение 4IFIR — проверка смотрит в пустоту')
  if (bad.length) problems.push({ sev: 'CRITICAL', what: `поколение 4IFIR определяется не так (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}` })
  else ok.push(`the 4IFIR generation is detected afresh by every forwarder into a page that asks it (${readers} pages, ${[...into.values()].flat().length} forwarders: kept while the NRO build-id matches ovl_id, else 2.5 on the NACP name, 2.6+ on any other file, none without it), and nothing else opens 4IFIR.ovl`)
}

// ---------------- 72. ширина записи равна ширине ячейки CUST, а знак не теряется
//
// БЕДА, КОТОРУЮ ЭТО ЛОВИТ (22.09.2026, консоли падали у людей). Ячейка блока `CUST` —
// четыре байта: шаг сетки смещений равен четырём везде, и живой kip держит в старших
// байтах нули. Прошивка читает её ЦЕЛИКОМ и СО ЗНАКОМ — `ldr w` + `scvtf`, без маски
// и без отсечки. Карта же объявляла у `12440`/`12448` `length: 1`, а плюсовая сторона
// их ряда кодируется отрицательным числом: байт `FC` ложился как `FC 00 00 00`, то есть
// 252 вместо −4, и строка таблицы GPU-DVFS уезжала на полтора вольта. Чёрный экран
// после лого. Разбор — `NOTES` №351, решение — `DECISIONS` 22.09.2026.
//
// ПОЧЕМУ СТОРОЖ НЕ ТРЕБУЕТ ЧЕТЫРЁХ БАЙТ ОТ ВСЕХ. Узкая запись безопасна ровно тогда,
// когда ненаписанные старшие байты и так должны остаться нулями: значение неотрицательно
// и влезает в свою ширину. Поэтому исключение здесь не «список имён, которым можно»,
// а УСЛОВИЕ, которое проверяется на каждом значении словаря. Перестанет выполняться —
// сторож покраснеет сам, без правки списка. Поимённых исключений два, и оба о том,
// что ячейка не скаляр: точки кривой Erista (24 байта записи DVFS шириной 56) и
// смещение 170, лежащее вне сетки (донорская ячейка копии, в чёрном списке).
//
// ЧЕТЫРЕ РАЗНЫХ ВОПРОСА, И НИ ОДИН НЕ ЗАМЕНЯЕТ ОСТАЛЬНЫЕ:
//   a) словарь поля — нет ли значения, у которого в пределах записываемой ширины
//      взведён старший бит (то есть оно «отрицательное», а старшие байты не пишутся);
//   b) поля-смещения (`units: mV_offset`) — пишутся целым словом, и отрицательные
//      значения расширены знаком `FF`, а не добиты нулями;
//   c) собранный пакет — ширина чтения `hex_file(CUST,N,W)` совпадает с картой;
//   d) поле, сменившее ширину (`legacy_length`), — каждое восстановление из копии
//      добивает старое узкое значение до ширины поля, иначе старый байт лёг бы
//      поверх наших старших `FF`.
//   e) импорт профиля старого инструмента — у полей-смещений двухбайтовый элемент
//      `pMEH(12-21)` расширяется ЗНАКОМ, а не нулями. Профиль, снятый с kip, куда
//      наша сборка уже записала `FCFFFFFF`, несёт `FCFF`: нули дали бы 65532.
{
  const bad = []
  const CELL = 4                              // ширина ячейки CUST: шаг сетки смещений
  const num = h => { const b = String(h).match(/../g) ?? []; let n = 0; for (let i = b.length - 1; i >= 0; i--) n = n * 256 + parseInt(b[i], 16); return n }
  const widthOf = new Map(fields.filter(f => f.length).map(f => [f.offset, f.length]))
  // Поимённые исключения: ячейка не скаляр. Причина обязательна — молчаливых нет.
  const NOT_A_CELL = f =>
    f.series === 'gpu_curve_erista' ? 'строка DVFS Erista: 56 байт записи, пишем первые 24'
    : f.offset === 170 ? 'донорская ячейка копии вне сетки шага 4, в чёрном списке'
    : null

  let narrow = 0, wide = 0
  for (const f of fields) {
    const len = f.length ?? 3
    const why = NOT_A_CELL(f)
    if (why) { wide++; continue }
    if (len > CELL) { bad.push(`поле ${f.offset} (${f.name}) пишет ${len} Б в четырёхбайтовую ячейку — заденет соседнее поле`); continue }
    // (a) и (b): смотрим сами значения, а не объявленную единицу измерения.
    const lim = Math.pow(2, 8 * len - 1)
    for (const v of f.values ?? []) {
      const h = padHexLocal(v.hex, len)
      if (!h) continue
      if (len < CELL && num(h) >= lim)
        bad.push(`поле ${f.offset} (${f.name}), «${v.name}» = ${h}: пишется ${len} Б, а число отрицательное — старшие байты останутся нулями, и прошивка прочитает ${num(h)}`)
      if (len === CELL && String(v.hex).length === CELL * 2) {
        const b = String(v.hex).toUpperCase().match(/../g)
        const wantTail = parseInt(b[0], 16) >= 0x80 && f.units === 'mV_offset' && !v.not_in_menu ? 'FF' : null
        if (wantTail && b.slice(1).some(x => x !== wantTail))
          bad.push(`поле ${f.offset} (${f.name}), «${v.name}» = ${v.hex}: отрицательное смещение не расширено знаком — в поле ляжет ${num(v.hex)}`)
      }
    }
    if (len < CELL) narrow++
  }

  // (c) чтение из пакета той же ширины, что объявлена в карте.
  let reads = 0
  for (const file of iniFiles) {
    for (const m of readFileSync(file, 'utf8').matchAll(/hex_file\(CUST,(\d+),(\d+)\)/g)) {
      const off = Number(m[1])
      if (!widthOf.has(off)) continue           // вне карты — чёрный список и служебные ячейки
      const f = fields.find(x => x.offset === off)
      if (NOT_A_CELL(f)) continue               // у кривой Erista показ читает первые 3 байта записи
      reads++
      if (Number(m[2]) !== widthOf.get(off))
        bad.push(`${relative(ROOT, file)}: ${off} читается ${m[2]} Б, а в карте ${widthOf.get(off)} Б — подпись разойдётся с записью`)
    }
  }

  // (d) старая узкая копия добивается до ширины поля перед записью в kip.
  let widened = 0
  const legacy = fields.filter(f => f.legacy_length && f.legacy_length !== (f.length ?? 3))
  for (const f of legacy) {
    const w = (f.length ?? 3) * 2
    const want = `{if_==({ini_file(Fields,${f.offset})},null,null,{slice({ini_file(Fields,${f.offset})}${'0'.repeat(w)},0,${w})})}`
    for (const file of iniFiles) {
      for (const m of readFileSync(file, 'utf8').matchAll(new RegExp(`CUST ${f.offset} (\\S+)`, 'g'))) {
        if (!m[1].includes('ini_file(Fields,')) continue
        widened++
        if (m[1] !== want)
          bad.push(`${relative(ROOT, file)}: восстановление ${f.offset} пишет «${m[1]}» без добивки до ${w} знаков — байт старой копии ляжет поверх старших байтов`)
      }
    }
  }
  if (legacy.length && !widened) bad.push('ни одна строка восстановления не найдена для полей со сменившейся шириной — проверка смотрит в пустоту')

  // (e) импорт чужого профиля расширяет узкий элемент ЗНАКОМ, а не нулями.
  let signed = 0
  const SIGNED = fields.filter(f => f.units === 'mV_offset' && (f.length ?? 3) === CELL)
  for (const f of SIGNED) {
    for (const file of iniFiles) {
      for (const m of readFileSync(file, 'utf8').matchAll(new RegExp(`Fields ${f.offset} '([^']+)'`, 'g'))) {
        if (!m[1].includes('json_file(')) continue      // не импорт, а восстановление копии
        signed++
        if (!/\{if_>\(\{hex_to_decimal\(/.test(m[1]))
          bad.push(`${relative(ROOT, file)}: импорт ${f.offset} добивает узкий элемент профиля нулями — снятое с нашего kip «FCFF» ляжет как 65532`)
      }
    }
  }
  if (SIGNED.length && !signed) bad.push('ни одной строки импорта для полей-смещений — проверка расширения знаком смотрит в пустоту')

  if (!reads || !fields.length)
    problems.push({ sev: 'CRITICAL', what: 'проверка ширины полей не нашла ни карты, ни чтений — она смотрит в пустоту' })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `ширина записи разошлась с ячейкой CUST (${bad.length}):\n     ${bad.slice(0, 8).join('\n     ')}` })
  else
    ok.push(`field writes match the 4-byte CUST cell: signed offsets go in whole and sign-extended, ${narrow} narrow writes carry only values that fit unsigned, ${wide} non-scalar cells excused by name, ${reads} reads agree with the map, ${widened} restore lines widen a legacy value, ${signed} import lines widen a foreign profile by sign`)
}

// ---------------- 61. guard numbers are unique, gapless-or-retired, and every doc reference lands
//
// A block number is the only address DECISIONS.md, NOTES.md and ANCHORS.md use to name a
// guard. Check 49 counts ok.push calls, not numbers, so a duplicate is invisible to it by
// construction - and two different guards sat under 53 until 08.09.2026, with seven doc
// references unable to say which. A gap invites the same collision: the next author takes
// the "free" number a document still points at. File order is NOT checked - blocks run in
// dependency order (51, 56, 7, 59, 49 sit last), only the set of numbers is guarded.
// NOTES №294.
//
// HOW A GUARD IS RETIRED WITHOUT BREAKING THE ADDRESSES THAT NAME IT (08.09.2026). The first
// edition left no way out: gaplessness meant a guard could only be removed by renumbering a
// neighbour - breaking the very references the rule exists to protect - or by leaving a dead
// numbered stub behind. Third way, taken here: A GAP IS LEGAL IF THE NUMBER IS DECLARED
// RETIRED BELOW. The registry is the address book, not a formality: a document may go on
// saying "проверка №53" and still be answered, and the range keeps counting a retired number
// so that retiring the last one cannot shrink 1…max quietly. Reuse is refused from both
// sides - a number cannot be live and retired at once.
//
// SECOND HALF: A REFERENCE POINTING AT NOTHING. The guard knew only its own file, so
// "проверка №62" in a document passed green - and precisely such references were what
// NOTES №294 was about. Measured before writing (08.09.2026): every reference of the form
// «проверка №N» in the tree landed on a live number, not one dangling. Cheap, so closed.
// The live count is printed by the green line, not frozen here.
const RETIRED61 = new Map([
  // [номер, 'дата — почему выведен и чем заменён']. Пустой реестр — это норма,
  // а не пробел: пока никого не выводили. Номер отсюда НЕ ПЕРЕИСПОЛЬЗУЕТСЯ.
])
{
  const selfPath = fileURLToPath(import.meta.url)
  let selfSrc = ''
  try { selfSrc = readFileSync(selfPath, 'utf8') } catch {}
  const heads = [...selfSrc.matchAll(/^\/\/ *-+ *(\d+)\./gm)].map(m => Number(m[1]))

  const seen = new Map()
  const dup = []
  for (const n of heads) {
    seen.set(n, (seen.get(n) ?? 0) + 1)
    if (seen.get(n) === 2) dup.push(n)
  }
  // Выведенный номер продолжает считаться в ряду: иначе снятие последнего сторожа
  // укоротило бы 1…max, и пропажа стала бы невидимой.
  const max = Math.max(0, ...heads, ...RETIRED61.keys())
  const gaps = []
  for (let n = 1; n <= max; n++) if (!seen.has(n) && !RETIRED61.has(n)) gaps.push(n)
  const zombie = [...RETIRED61.keys()].filter(n => seen.has(n))

  const bad = []
  for (const n of dup)
    bad.push(`номер ${n} носят ${seen.get(n)} разных блока — ссылка «проверка ${n}» в документах адресует неизвестно кого`)
  if (gaps.length)
    bad.push(`в ряду 1…${max} пропущены номера ${gaps.join(', ')} — следующий автор займёт дыру, на которую уже ссылается документ; если сторож снят намеренно, впишите номер в RETIRED61 с датой и причиной`)
  for (const n of zombie)
    bad.push(`номер ${n} объявлен выведенным в RETIRED61, но блок под ним живой — реестр снятых номеров врёт, и номер оказался переиспользован`)

  // ССЫЛКИ ИЗ ДОКУМЕНТОВ. Границы слова заданы просмотром назад, а не `\b`: `\b` в JS
  // считает по ASCII, и перед кириллицей не срабатывает вовсе — иначе «перепроверке №256»
  // (номер записи NOTES, не сторожа) попадала бы в улов.
  const REF61 = /(?<![A-Za-zА-Яа-яЁё])провер(?:ка|ки|ку|ке|кой|ок|ками|кам|ках)[^\S\r\n]*№[^\S\r\n]*(\d+)((?:[^\S\r\n]*(?:,|и|или)[^\S\r\n]*№[^\S\r\n]*\d+)*)/gi
  const refFiles = []
  const walk61 = d => {
    let entries = []
    try { entries = readdirSync(join(ROOT, d), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = d === '.' ? e.name : `${d}/${e.name}`
      // research/raw — дампы строк из чужого бинарника, номеров сторожей там нет по определению.
      if (e.isDirectory()) { if (d !== '.' && !/^(\.git|node_modules|research)$/i.test(e.name)) walk61(rel); continue }
      if (/\.(md|txt)$/i.test(e.name)) refFiles.push(rel)
    }
  }
  for (const d of ['docs', 'Guides', 'Make', '.']) walk61(d)
  const refs = new Map()
  let refCount = 0
  for (const rel of refFiles) {
    let t = ''
    try { t = readFileSync(join(ROOT, rel), 'utf8') } catch { continue }
    for (const m of t.matchAll(REF61)) {
      for (const n of [Number(m[1]), ...[...(m[2] ?? '').matchAll(/\d+/g)].map(x => Number(x[0]))]) {
        refCount++
        if (!refs.has(n)) refs.set(n, new Set())
        refs.get(n).add(rel)
      }
    }
  }
  const dangling = [...refs.keys()].filter(n => !seen.has(n) && !RETIRED61.has(n)).sort((a, b) => a - b)
  for (const n of dangling)
    bad.push(`документ ссылается на «проверку №${n}», которой в гейте нет: ${[...refs.get(n)].join(', ')}`)

  // ZERO IS RED: change the header style and this check would declare order over nothing.
  if (heads.length < 2)
    problems.push({ sev: 'CRITICAL', what: `в гейте найдено ${heads.length} нумерованных блоков — проверка нумерации смотрит в пустоту, оформление заголовков сменилось` })
  else if (!refCount)
    problems.push({ sev: 'CRITICAL', what: `в документах не нашлось ни одной ссылки «проверка №N» — сверка ссылок смотрит в пустоту, форма ссылки в проекте сменилась` })
  else if (bad.length)
    problems.push({ sev: 'CRITICAL', what: `нумерация сторожей разъехалась:\n     ${bad.join('\n     ')}` })
  else ok.push(`guard numbers are unique and gapless (${heads.length} blocks, 1…${max}, ${RETIRED61.size ? `${RETIRED61.size} retired` : 'none retired'}; ${refCount} doc references land)`)
}

// ---------------- 49. the gate does not quietly lose a check
//
// A check whose subject disappears can vanish from this file's own count without a word:
// on 05.09.2026 emptying one list in the dependency graph took the total from 49 to 48
// and printed nothing at all. The number is the only thing anyone reads, and it had
// already lied once — 75 printed against 43 real, because five ok.push calls sat inside
// loops. A hard-coded expectation is crude, but it is the one thing that notices a guard
// going missing. Raise it deliberately when you add a check; never to make a run green.
{
  // THIS COUNTS GREEN LINES, NOT CHECK NUMBERS. Three counts live in this file and no two of
  // them are equal: numbered blocks (check 61 prints it), ok.push call sites, and green lines
  // printed per run (this EXPECTED). Two of the three are printed by every run and so correct
  // themselves; the call-site count is printed by nothing, so it is deliberately NOT written
  // down here - the first edition of this comment froze it at 73 on a day it was 70, and no
  // guard noticed, because no guard watches it. Count it when you need it, never quote it:
  //   grep -ao "ok\.push(" scripts/check-generated.mjs | wc -l
  // Numbers are check 61's job. 08.09.2026: 62 -> 63 for the new check 61.
  // 13.09.2026: 63 -> 64 for check 62 (Magician page hides on the author's engine).
  // 13.09.2026: 64 -> 65 for check 63 (one-shot footers cleared on entry).
  // 13.09.2026: 65 -> 66 for check 64 (result footers shown at once, page rebuilt).
  // 14.09.2026: 66 -> 67 for check 65 (short RAM model, one rule on three screens).
  // 20.09.2026: 67 -> 68 for check 66 (Magician voltage items write what they name).
  // 21.09.2026: 68 -> 69 for check 67 (eBAMATIC first in every option list).
  // 21.09.2026: 69 -> 70 for check 68 (backup carries VDDQ/VDD2, restore writes them).
  // 21.09.2026: 70 -> 71 for check 69 (WL-Set/DBI never come from an old Wizard backup).
  // 21.09.2026: 71 -> 72 for check 70 (CPU Min Voltage factory value is Eco ST1).
  // 22.09.2026: 72 -> 73 for check 71 (the 4IFIR generation is read once, in [boot]).
  // 22.09.2026: 73 -> 74 for check 72 (write width equals the CUST cell, sign kept).
  const EXPECTED = 74
  // ОТКАЗ ТОЛЬКО ПРИ МОЛЧАНИИ. Проверка, которая нашла беду, зелёной строки не печатает —
  // значит счёт падает законно, и объявлять это исчезновением сторожа нельзя. 05.09.2026
  // прежняя редакция делала ровно это: строка в 906 байт, задуманная предупреждением,
  // роняла прогон, потому что 48-я не сделала ok.push. Градация серьёзности отменялась
  // для всего, что не заложено в число. Молчание — вот настоящий признак пропажи.
  //
  // МОЛЧАНИЕ СЧИТАЕТСЯ ПО НОВЫМ БЕДАМ, А НЕ ПО ПУСТОМУ СПИСКУ. Два известных предупреждения
  // горят постоянно, поэтому прежнее условие не было истинным НИКОГДА — единственный сторож
  // против тихой пропажи проверки был мёртв с рождения. Опыт 05.09.2026: выпотрошенная 45-я
  // дала «зелёных 50 против 51» предупреждением и код возврата 0.
  const found = problems.filter(x => !knownWarning(x))
  if (ok.length + 1 < EXPECTED && !found.length)
    problems.push({ sev: 'CRITICAL', what: `проверок стало меньше, чем заявлено: ${ok.length + 1} против ${EXPECTED}, и никто ничего не нашёл — сторож исчез молча, найдите какой` })
  else if (ok.length + 1 < EXPECTED)
    problems.push({ sev: 'IMPORTANT', what: `зелёных строк ${ok.length + 1} против заявленных ${EXPECTED} — столько проверок промолчало, потому что нашли беду выше; если беда одна, а недостача больше, значит сторож ещё и исчез` })
  else if (ok.length + 1 > EXPECTED)
    problems.push({ sev: 'IMPORTANT', what: `проверок стало больше заявленного: ${ok.length + 1} против ${EXPECTED} — поднимите EXPECTED в проверке 49, если это намеренно` })
  else ok.push(`the gate still carries all ${EXPECTED} checks`)
}

const crit = problems.filter(p => p.sev === 'CRITICAL')
const warn = problems.filter(p => p.sev === 'IMPORTANT')
const warnNew = warn.filter(p => !knownWarning(p))

console.log(`files in package  : ${iniFiles.length}`)
console.log(`offsets written   : ${writtenOffsets.size}`)
console.log(`checks passed     : ${ok.length}`)
console.log(`discrepancies     : ${crit.length} critical, ${warn.length} important (известных ${warn.length - warnNew.length}, новых ${warnNew.length})`)
// Команда отрицательного прогона печатается прямо в отчёте (плейбук §28.3): читатель
// должен иметь возможность проверить не дерево, а САМ ГЕЙТ, не заглядывая в исходник.
console.log('проверить сам гейт : node scripts/check-generated.mjs --проба-отказа')
console.log()

for (const p of [...crit, ...warn]) {
  const k = knownWarning(p)
  console.log(`${p.sev === 'CRITICAL' ? '❌' : '⚠ '} ${p.what}`)
  if (k) console.log(`     известное с ${k.since}: ${k.why} — ${k.where}`)
}
if (warnNew.length) console.log(`
❌ новых предупреждений ${warnNew.length} — их нет в списке известных, прогон отказан`)

// СПИСОК ПРОЙДЕННОГО ПЕЧАТАЕТСЯ ВСЕГДА, а не только при абсолютном нуле проблем.
// 05.09.2026: условие включало и предупреждения, а два из них у нас постоянные — значит
// все зелёные строки с числами поднадзорных объектов были скрыты навсегда. Ровно те
// числа, ради которых правило и заведено: молчание сторожа неотличимо от «предмета не
// нашлось». Чем ближе дерево к порядку, тем меньше было видно.
if (!crit.length && !warnNew.length) console.log('✅ what was generated matches what was intended')
for (const o of ok) console.log(`   ${o}`)

// НОВОЕ ПРЕДУПРЕЖДЕНИЕ РОНЯЕТ ПРОГОН НАРАВНЕ С КРИТИЧЕСКИМ. Предупреждение, о котором
// никто не выносил решения, — это ровно то, ради чего гейт и заведён; молчаливый код 0
// делал двадцать один приговор IMPORTANT украшением. Известные печатаются и не роняют.
process.exit(crit.length || warnNew.length ? 1 : 0)
