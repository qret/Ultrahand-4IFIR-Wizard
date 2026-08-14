#!/usr/bin/env node
// uhlint — checks an Ultrahand/Uberhand package for compatibility with Ultrahand 2.5.3.
//
// Why: the engine silently ignores commands it does not know (utils.hpp:5648-5655, no default
// branch), and Uberhand just as silently ignores FAILED writes to the kip (hex_funcs.hpp:372).
// Neither engine ever reports an error — so we check before the package reaches the console.
//
// Usage:
//   node scripts/uhlint <package-path> [--json] [--quiet] [--no-refs] [--sd-root=<path>]
// Exit code: 0 — no errors, 1 — at least one ERROR, 2 — failed to start.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, resolve, sep } from 'node:path'
import {
  ULT_COMMANDS, ULT_SOURCES, ULT_DIRECTIVES, ULT_MODES, ULT_MODES_DEAD,
  RENAMES, UBERHAND_ONLY, UBERHAND_DIRECTIVES, ARITY, FILE_ARG, PLACEHOLDER_RENAMES,
  MIRROR_COPY,
} from './tables.mjs'

const SEV = { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO' }

/** Modes in which the section body is DATA to display, not commands. */
const DATA_MODES = new Set(['table', 'text'])

// ---------------------------------------------------------------- parser

/** Split a command line into tokens, honouring '…' and "…". */
export function tokenize(line) {
  const out = []
  let cur = ''
  let quote = null
  let quoted = false
  for (const ch of line) {
    if (quote) {
      if (ch === quote) { quote = null } else { cur += ch }
    } else if (ch === "'" || ch === '"') {
      quote = ch; quoted = true
    } else if (/\s/.test(ch)) {
      if (cur || quoted) { out.push(cur); cur = ''; quoted = false }
    } else {
      cur += ch
    }
  }
  if (cur || quoted) out.push(cur)
  return out
}

/**
 * Does this look like a data row: `'key'='value'` or `key=value`?
 * The key is either quoted (spaces inside are then fine) or contains no spaces at all.
 */
function looksLikeTableRow(line) {
  const t = line.trim()
  const eq = t.indexOf('=')
  if (eq < 0) return false
  const key = t.slice(0, eq).trim()
  return /^(['"]).*\1$/.test(key) || !/\s/.test(key)
}

export function parseIni(text) {
  const rows = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const at = i + 1
    if (!line) { rows.push({ at, type: 'blank', raw }); continue }
    if (line.startsWith('[') && line.includes(']')) {
      rows.push({ at, type: 'section', raw, name: line.slice(1, line.lastIndexOf(']')) })
      continue
    }
    if (line.startsWith(';')) {
      const body = line.slice(1)
      const eq = body.indexOf('=')
      if (eq > 0 && /^[A-Za-z_][\w]*$/.test(body.slice(0, eq).trim())) {
        rows.push({ at, type: 'directive', raw, key: body.slice(0, eq).trim(), value: body.slice(eq + 1).trim() })
      } else if (/^\s*(Mariko|Erista)\s*$/i.test(body)) {
        rows.push({ at, type: 'gate', raw, gate: body.trim() })
      } else if (/^[A-Za-z_][\w]*$/.test(body.trim())) {
        // bare directive with no value: ;enableConfigNav, ;showCurInMenu
        rows.push({ at, type: 'directive', raw, key: body.trim(), value: null })
      } else {
        rows.push({ at, type: 'comment', raw, style: ';' })
      }
      continue
    }
    if (line.startsWith('#')) { rows.push({ at, type: 'comment', raw, style: '#' }); continue }
    if (line.startsWith('--')) { rows.push({ at, type: 'separator', raw }); continue }
    const tokens = tokenize(line)
    rows.push({ at, type: 'command', raw, cmd: tokens[0], args: tokens.slice(1), isTableRow: looksLikeTableRow(line) })
  }
  return rows
}

/** Group the rows by section, attaching each section's directives to it. */
function groupSections(rows) {
  const sections = []
  let cur = { name: null, at: 0, rows: [], commands: [], directives: new Map() }
  const header = cur
  for (const row of rows) {
    if (row.type === 'section') {
      cur = { name: row.name, at: row.at, rows: [], commands: [], directives: new Map(), row }
      sections.push(cur)
      continue
    }
    cur.rows.push(row)
    if (row.type === 'directive') cur.directives.set(row.key, row.value)
    if (row.type === 'command') cur.commands.push(row)
  }
  return { header, sections }
}

// ---------------------------------------------------------------- helpers

function looksLikePath(s) {
  return /[\\/]/.test(s) || /\.(json|ini|txt|kip|zip|bin|ovl|nro)$/i.test(s)
}

/**
 * Tell an executable package file from a DATA file.
 * A package directory holds both: `fanconfig.ini`, presets and dictionaries are read through
 * ini_file_source and consist of key=value pairs — there are no commands in them, and there
 * should not be. A file counts as executable if it has at least one known command or a ;mode=
 * directive.
 */
export function isPackageFile(rows) {
  for (const r of rows) {
    if (r.type === 'directive' && r.key === 'mode') return true
    // Заголовок пакета — тоже пакетный файл, даже если команд в нём нет ни одной.
    // Прежняя версия требовала `;mode=` или известную команду, и корневой `config.ini`
    // пакета 4IFIR Wizard выбрасывался как «данные»: в нём только директивы шапки
    // и пустые секции-подменю. Из-за этого правило UH-DIRECTIVE, написанное ровно
    // ради этих четырёх директив, не срабатывало НИ РАЗУ за весь прогон.
    if (r.type === 'directive' && UBERHAND_DIRECTIVES.has(r.key)) return true
    // `[>Name]` — подменю Uberhand. Файл, состоящий из шапки и таких секций,
    // это корень пакета, а не словарь значений.
    if (r.type === 'section' && r.name.startsWith('>')) return true
    if (r.type === 'gate' || r.type === 'separator') return true
    if (r.type === 'command' && r.cmd) {
      if (ULT_COMMANDS.has(r.cmd) || ULT_SOURCES.has(r.cmd) ||
          UBERHAND_ONLY.has(r.cmd) || RENAMES.has(r.cmd)) return true
    }
  }
  return false
}

/** Find the SD card root: a directory above us that contains a `switch` subdirectory. */
export function findSdRoot(from) {
  let dir = resolve(from)
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'switch')) && existsSync(join(dir, 'atmosphere'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** Is the package written in the Uberhand dialect? Look for unambiguous markers. */
export function detectDialect(files) {
  for (const f of files) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const cmd of UBERHAND_ONLY.keys()) {
      if (new RegExp(`^\\s*${cmd.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&')}\\b`, 'm').test(text)) return 'uberhand'
    }
    for (const d of UBERHAND_DIRECTIVES.keys()) {
      if (new RegExp(`^\\s*;${d}\\b`, 'm').test(text)) return 'uberhand'
    }
  }
  return 'ultrahand'
}

// ---------------------------------------------------------------- rules

export function lintFile(rows, filePath, ctx) {
  const { pkgRoot, sdRoot, dialect, checkRefs } = ctx
  const found = []
  const add = (row, sev, code, msg) =>
    found.push({ file: filePath, at: row.at, sev, code, msg, raw: (row.raw ?? '').trim() })

  // when migrating from Uberhand the trap constructs are errors; in a native Ultrahand
  // package they are only notes
  const migrating = dialect === 'uberhand'
  const sevMigr = migrating ? SEV.ERROR : SEV.INFO

  const { header, sections } = groupSections(rows)

  // ---- package header directives
  for (const row of header.rows) {
    if (row.type !== 'directive') continue
    if (UBERHAND_DIRECTIVES.has(row.key)) {
      add(row, SEV.ERROR, 'UH-DIRECTIVE', `;${row.key} — Uberhand only. ${UBERHAND_DIRECTIVES.get(row.key)}`)
    } else if (!ULT_DIRECTIVES.has(row.key)) {
      add(row, SEV.WARN, 'UNKNOWN-DIRECTIVE',
        `;${row.key} — Ultrahand does not know this directive, the line will be read as a comment (main.cpp:5354)`)
    }
  }
  for (const row of header.rows) {
    if (row.type === 'comment' && row.style === '#') {
      add(row, SEV.WARN, 'HASH-COMMENT', `'#' — a comment marker in Uberhand only; in Ultrahand a comment is ';'`)
    }
  }

  for (const s of sections) {
    const mode = s.directives.get('mode')
    const isData = DATA_MODES.has(mode)

    // ---- markup sigils
    const n = s.name
    if (n.startsWith('@')) {
      add(s.row, sevMigr, 'SIGIL-AT', migrating
        ? `[@${n.slice(1)}] — a kip info screen in Uberhand, a PAGE NAME in Ultrahand (main.cpp:4883). Rename it: do not use the @ sigil`
        : `[@${n.slice(1)}] — in Ultrahand this is a page name (left/right paging). Make sure that is intended`)
    }
    if (n.startsWith('>')) {
      add(s.row, SEV.ERROR, 'SIGIL-GT',
        `[>${n.slice(1)}] — an Uberhand submenu; Ultrahand has none. Replace with [*Name] + dropdown or ;mode=forwarder + package_source`)
    }
    if (n.startsWith('-')) {
      add(s.row, SEV.ERROR, 'SIGIL-DASH', `[-${n.slice(1)}] — an Uberhand slider (FanSliderOverlay); Ultrahand has none`)
    }
    if (n.includes(';;')) {
      add(s.row, SEV.ERROR, 'SIGIL-SEMI',
        `'Name ;; Header' — Uberhand only. Closest match is the ?Tag suffix, but that HIDES the text while ;; shows it`)
    }
    if (migrating && / - /.test(n)) {
      add(s.row, SEV.INFO, 'FOOTER-SLICE',
        `'Name - Footer': Uberhand cuts at pos+2 (footer keeps a leading space), Ultrahand at pos+3`)
    }

    // ---- section directives
    for (const row of s.rows) {
      if (row.type === 'directive') {
        if (UBERHAND_DIRECTIVES.has(row.key)) {
          add(row, SEV.ERROR, 'UH-DIRECTIVE', `;${row.key} — Uberhand only. ${UBERHAND_DIRECTIVES.get(row.key)}`)
        } else if (!ULT_DIRECTIVES.has(row.key)) {
          add(row, SEV.WARN, 'UNKNOWN-DIRECTIVE',
            `;${row.key} — Ultrahand does not know this directive, the line will be read as a comment (main.cpp:5354)`)
        }
        if (row.key === 'mode' && row.value) {
          if (!ULT_MODES.has(row.value)) {
            add(row, SEV.ERROR, 'UNKNOWN-MODE', `;mode=${row.value} — no such mode`)
          } else if (ULT_MODES_DEAD.has(row.value)) {
            add(row, SEV.WARN, 'DEAD-MODE',
              `;mode=${row.value} is declared (main.cpp:99) but NOT handled — behaves like an ordinary item. Use ;mode=table`)
          }
        }
      }
      if (row.type === 'gate') {
        add(row, SEV.ERROR, 'GATE-COMMENT',
          `'; ${row.gate}' — not a comment but an Uberhand platform filter. Replace with ;system=${row.gate.toLowerCase()} or the prefix ${row.gate.toLowerCase()}:`)
      }
      if (row.type === 'comment' && row.style === '#') {
        add(row, SEV.WARN, 'HASH-COMMENT', `'#' — a comment marker in Uberhand only; in Ultrahand a comment is ';'`)
      }
      if (row.type === 'separator') {
        add(row, SEV.ERROR, 'SEPARATOR', `'-- heading' — Uberhand only. In Ultrahand a heading is an empty section [Name]`)
      }
    }

    // ---- commands (in data modes the section body is data, not commands)
    for (const row of s.commands) {
      if (!row.cmd) continue
      // in ;mode=table / ;mode=text the whole section body is data to display
      if (isData) continue
      const c = row.cmd
      const isSource = ULT_SOURCES.has(c)

      if (UBERHAND_ONLY.has(c)) {
        const r = UBERHAND_ONLY.get(c)
        add(row, SEV.ERROR, 'UH-ONLY',
          `${c} — Uberhand only.` + (r.fix ? ` Replace with: ${r.fix}.` : ' No direct replacement.') +
          (r.hard ? ' Needs a manual rewrite.' : '') + (r.note ? ` (${r.note})` : ''))
      } else if (RENAMES.has(c) && RENAMES.get(c).to !== c) {
        const r = RENAMES.get(c)
        add(row, SEV.ERROR, 'RENAMED', `${c} → ${r.to}${r.note ? `. ${r.note}` : ''}`)
      } else if (/^mirror[_-]/.test(c) && !MIRROR_COPY.has(c)) {
        // ЛОВУШКА ДВИЖКА. `mirror_*` диспетчеризуется ПО ПРЕФИКСУ (`utils.hpp:4995`),
        // а операция выбирается так: копирование, если имя одно из четырёх известных,
        // ИНАЧЕ УДАЛЕНИЕ (`utils.hpp:4234`). То есть `mirror_delete` работает — но и
        // опечатка `mirror_cpy` тоже «работает», молча удаляя вместо копирования.
        // Неизвестного имени тут не бывает, бывает неожиданное поведение.
        add(row, SEV.WARN, 'MIRROR-DELETES',
          `${c}: the engine dispatches any mirror_* by prefix and treats everything that is `
          + `not mirror-copy / mirror-cp / mirror_copy / mirror_cp as a DELETE`)
      } else if (!ULT_COMMANDS.has(c) && !isSource) {
        if (row.isTableRow) {
          add(row, SEV.WARN, 'DATA-OUTSIDE-TABLE',
            `looks like a table data row, but the section is not ;mode=table — Ultrahand will take it for a command and silently skip it`)
        } else {
          add(row, SEV.ERROR, 'UNKNOWN-CMD',
            `${c} — Ultrahand does not know this command. The dispatcher will silently skip it (utils.hpp:5648-5655, no default branch)`)
        }
      }

      if (c === 'json_source' && row.args[0] && looksLikePath(row.args[0])) {
        add(row, SEV.ERROR, 'JSON-SOURCE-PATH',
          `json_source in Ultrahand expects a JSON LITERAL, not a path (main.cpp:3714). Use json_file_source for a file — otherwise the list silently comes out empty`)
      }

      if (ARITY.has(c) && row.args.length < ARITY.get(c)) {
        add(row, SEV.ERROR, 'ARITY', `${c}: ${row.args.length} arguments, at least ${ARITY.get(c)} required`)
      }
      if (c.startsWith('hex-by-custom-') && row.args.length >= 2 && /^\d+$/.test(row.args[1])) {
        add(row, SEV.ERROR, 'MISSING-ANCHOR',
          `${c}: the second argument must be the anchor (CUST) but is a number — looks like an unconverted hex-by-cust-offset`)
      }

      // file references
      if (checkRefs && FILE_ARG.has(c)) {
        const p = row.args[FILE_ARG.get(c)]
        if (p && !p.includes('{')) {
          const clean = p.replace(/^sdmc:/i, '')
          let target = null
          if (clean.startsWith('/')) {
            if (sdRoot) target = resolve(sdRoot, clean.slice(1))
          } else {
            // Ultrahand resolves relative paths from the PACKAGE ROOT (preprocessPath(path, packagePath)),
            // not from the file's own directory. For nested packages we also try the local variant.
            const rel = clean.replace(/^\.\//, '')
            const fromPkg = resolve(pkgRoot, rel)
            target = existsSync(fromPkg) ? fromPkg : resolve(dirname(filePath), rel)
          }
          if (target && !existsSync(target)) {
            // the package's own config.ini is a UI cache the engine creates on first open
            const isPkgCache = /(^|[\\/])config\.ini$/i.test(target) && resolve(target).startsWith(pkgRoot)
            if (isPkgCache) {
              add(row, SEV.INFO, 'PKG-CACHE',
                `${c}: ${p} — package UI cache, created by the engine on first open; it should not be in the sources`)
            } else {
              add(row, SEV.ERROR, 'MISSING-FILE', `${c}: file not found — ${p}`)
            }
          }
        }
      }

      // Скобка НЕ обязательна. Половина переименованных плейсхолдеров пишется без неё
      // (`{source}`, `{name}`, `{parent_name}`), и прежняя регулярка их не видела вовсе:
      // в донорском пакете четыре `{source}` и ни одного `{source(`.
      for (const m of row.raw.matchAll(/\{([A-Za-z_][\w]*)\s*(\(?)/g)) {
        if (!PLACEHOLDER_RENAMES.has(m[1])) continue
        const shown = m[2] ? `{${m[1]}(…)}` : `{${m[1]}}`
        add(row, SEV.ERROR, 'PLACEHOLDER', `${shown} → ${PLACEHOLDER_RENAMES.get(m[1])}`)
      }
    }

    // ---- section-level rules
    const backIdx = s.commands.findIndex(r => r.cmd === 'back')
    if (backIdx >= 0 && backIdx !== s.commands.length - 1) {
      add(s.commands[backIdx], SEV.WARN, 'BACK-NOT-LAST',
        `'back' is not the last command of section [${s.name}]. In Uberhand it ABORTED the rest, in Ultrahand the rest WILL RUN (utils.hpp:4705)`)
    }
    if (migrating && s.name.startsWith('*') && s.commands.length > 0 && s.commands.length <= 2) {
      add(s.row, SEV.INFO, 'SHORT-SELECTOR',
        `[${s.name}] with ${s.commands.length} commands: Ultrahand runs the section through parseCommandSettings (main.cpp:4862) — ;mini / ;mode=slot may change`)
    }
  }

  return found
}

// ---------------------------------------------------------------- traversal

function walkIni(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkIni(p, acc)
    else if (/\.ini$/i.test(name)) acc.push(p)
  }
  return acc
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const flags = argv.filter(a => a.startsWith('--'))
  const args = argv.filter(a => !a.startsWith('--'))
  const has = f => flags.includes(f)
  const target = args[0]

  if (!target) {
    console.error('usage: node scripts/uhlint <package-path> [--json] [--quiet] [--no-refs] [--sd-root=<path>]')
    return 2
  }
  if (!existsSync(target)) { console.error(`not found: ${target}`); return 2 }

  const st = statSync(target)
  const pkgRoot = st.isDirectory() ? resolve(target) : resolve(dirname(target))
  const files = st.isDirectory() ? walkIni(pkgRoot) : [resolve(target)]
  if (!files.length) { console.error(`no .ini files in ${pkgRoot}`); return 2 }

  const sdFlag = flags.find(f => f.startsWith('--sd-root='))
  const sdRoot = sdFlag ? resolve(sdFlag.slice('--sd-root='.length)) : findSdRoot(pkgRoot)
  const dialect = detectDialect(files)

  const ctx = { pkgRoot, sdRoot, dialect, checkRefs: !has('--no-refs') }
  const all = []
  let dataFiles = 0
  for (const f of files) {
    let text
    try { text = readFileSync(f, 'utf8') } catch (e) { console.error(`cannot read ${f}: ${e.message}`); continue }
    const rows = parseIni(text)
    if (!isPackageFile(rows)) { dataFiles++; continue }   // data file, not an executable one
    all.push(...lintFile(rows, f, ctx))
  }

  const errors = all.filter(f => f.sev === SEV.ERROR)
  const warns = all.filter(f => f.sev === SEV.WARN)
  const infos = all.filter(f => f.sev === SEV.INFO)

  if (has('--json')) {
    console.log(JSON.stringify({ root: pkgRoot, sdRoot, dialect, files: files.length, findings: all }, null, 2))
    return errors.length ? 1 : 0
  }

  if (!has('--quiet')) {
    for (const f of all) {
      const rel = relative(pkgRoot, f.file) || f.file.split(sep).pop()
      console.log(`${f.sev.padEnd(5)} ${rel}:${f.at}  [${f.code}]  ${f.msg}`)
      if (f.raw) console.log(`      │ ${f.raw}`)
    }
  }

  const byCode = new Map()
  for (const f of all) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1)
  console.log('\n' + '─'.repeat(70))
  console.log(`package: ${pkgRoot}`)
  console.log(`dialect: ${dialect}${dialect === 'uberhand' ? '  (checked as a migration to Ultrahand)' : ''}`)
  console.log(`SD root: ${sdRoot ?? 'not found — absolute paths were not checked'}`)
  console.log(`files:   ${files.length} total, ${files.length - dataFiles} executable, ${dataFiles} data (skipped)`)
  console.log(`ERROR: ${errors.length}   WARN: ${warns.length}   INFO: ${infos.length}`)
  if (byCode.size) {
    console.log('\nby code:')
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${code}`)
    }
  }

  return errors.length ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
