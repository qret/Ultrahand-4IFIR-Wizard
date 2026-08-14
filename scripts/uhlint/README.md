# uhlint

Checks an Ultrahand/Uberhand package for compatibility with **Ultrahand 2.5.3** — before it
ever reaches the console.

## Why

Neither engine reports an error:

- Ultrahand silently ignores commands it does not know — the dispatcher is a
  `switch (commandName[0])` with no `default` branch (`utils.hpp:5648-5655`), and an unknown
  `;` directive is treated as a comment.
- Uberhand silently ignores **failed writes to the kip**: `hexEditCustOffset` never checks the
  result and always returns success (`hex_funcs.hpp:372`).

For an overlay that edits CPU voltages, "it silently did nothing" is not a cosmetic problem.
A half-applied overclock profile is more dangerous than one that was never applied.

## Running it

```bash
node scripts/uhlint <path to package>
```

| Flag | What it does |
|---|---|
| `--quiet` | summary only |
| `--json` | machine-readable output for further processing |
| `--no-refs` | do not check that referenced files exist |
| `--sd-root=<path>` | SD card root for absolute paths (otherwise detected automatically) |

Exit code: `0` — no errors, `1` — at least one ERROR, `2` — failed to start. Works as a CI gate.

## What it understands

**The dialect is detected automatically.** If Uberhand commands or directives turn up, the
package is checked as a migration candidate and the migration traps become errors. A native
Ultrahand package is checked more leniently: `[@Name]`, for instance, is a legitimate page name
there rather than a defect.

**Data files are told apart from executable ones.** A package directory holds both:
`fanconfig.ini`, presets and dictionaries consist of `key=value` pairs — there are no commands
in them and there should not be, so those files are skipped.

**Relative paths** are resolved from the package root (like `preprocessPath(path, packagePath)`
in the engine), not from the file's own directory.

## Checks

| Code | Level | What it catches |
|---|---|---|
| `UNKNOWN-CMD` | ERROR | the command exists in neither engine — a typo or a dead command |
| `UH-ONLY` | ERROR | Uberhand only; the message names the replacement |
| `RENAMED` | ERROR | renamed (`hex-by-cust-offset` → `hex-by-custom-offset` and so on) |
| `MISSING-ANCHOR` | ERROR | a number where `hex-by-custom-*` expects its anchor — an unconverted call |
| `ARITY` | ERROR | missing arguments where that silently breaks the write |
| `JSON-SOURCE-PATH` | ERROR | `json_source` with a path: Ultrahand expects a JSON literal, the list silently comes out empty |
| `SIGIL-AT/GT/DASH/SEMI` | ERROR¹ | Uberhand markup sigils: `[@…]` `[>…]` `[-…]` `Name ;; Header` |
| `GATE-COMMENT` | ERROR | `; Mariko` / `; Erista` — a platform filter, not a comment |
| `SEPARATOR` | ERROR | `-- heading` — in Ultrahand a heading is an empty section |
| `PLACEHOLDER` | ERROR | `{source}` → `{file_source}`, `{json_data}` → `{json_file}` and so on |
| `MISSING-FILE` | ERROR | reference to a package file that does not exist |
| `UH-DIRECTIVE` | ERROR | `;kipVer` `;github` `;enableConfigNav` `;showCurInMenu` |
| `BACK-NOT-LAST` | WARN | `back` is not the last line — the engines differ on what happens next |
| `HASH-COMMENT` | WARN | `#` starts a comment for the package body parser, unlike the ini reader |
| `DEAD-MODE` | WARN | `;mode=text` and `;mode=hold` are declared but never handled |
| `UNKNOWN-DIRECTIVE` | WARN | the directive will be read as a comment |
| `UNKNOWN-MODE` | ERROR | `;mode=` with a value the engine does not know |
| `MIRROR-DELETES` | WARN | any `mirror_*` that is not one of the four copy names performs a DELETE |
| `DATA-OUTSIDE-TABLE` | WARN | a data row outside `;mode=table` |
| `PKG-CACHE` | INFO | the package's `config.ini` is a UI cache created by the engine |
| `SIGIL-AT` | INFO¹ | in a native Ultrahand package this is a legitimate page name |
| `FOOTER-SLICE`, `SHORT-SELECTOR` | INFO | subtle parsing differences on migration |

¹ the level depends on the package dialect.

## Tested against

| Package | Dialect | Result |
|---|---|---|
| `Ebal Tuner` (a working Ultrahand package) | ultrahand | 31 ERROR — **all genuine**: broken references in the reference itself |
| `4ifir Wizard source code` | uberhand | 1318 ERROR — the size of the conversion job |

Running it against a package that is known to work is a mandatory part of trusting the tool: if
it screams at something that demonstrably works, the tool is wrong, not the package. The 31
defects it found in the reference matched a list compiled independently in `docs/research/03`,
and it also turned up things a human had missed: the wrong case in `EBal Tuner`, a doubled
`json/json/`, and **a tab character inside a file name**.

## Where the tables are

`tables.mjs` is the only place the lists of commands, directives, renames and replacements live.
Sources: `docs/research/04` (the canonical Ultrahand DSL, read out of the code) and
`docs/research/07` (the compatibility table for the two engines). Extend it as you find more.
