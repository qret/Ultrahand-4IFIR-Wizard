// DSL tables: what Ultrahand 2.5.3 understands, what stayed behind in Uberhand, what was renamed.
// Sources: docs/research/04 (the canonical DSL, read out of the code) and docs/research/07
// (the compatibility table). Extended as we find more — this is the only place the lists live.

/** Section body commands supported by Ultrahand 2.5.3 (source/utils.hpp, processCommand). */
export const ULT_COMMANDS = new Set([
  // files
  'mkdir', 'make', 'copy', 'cp', 'delete', 'del', 'rename', 'move', 'mv', 'touch',
  'mirror_copy', 'mirror-copy', 'mirror_cp', 'mirror-cp',
  'mirror_delete', 'mirror-delete', 'mirror_del', 'mirror-del',
  'dot-clean', 'unzip', 'download', 'download-no-retry',
  // ini / json
  'set-ini-val', 'set-ini-value', 'set-ini-key', 'set-ini-val-matching-key',
  'remove-ini-key', 'remove-ini-key-matching-key', 'remove-ini-section',
  'rename-ini-section', 'add-ini-section',
  'set-json-val', 'set-json-value', 'set-json-key',
  // hex
  'hex-by-offset', 'hex-by-swap', 'hex-by-string', 'hex-by-decimal', 'hex-by-rdecimal',
  'hex-by-custom-offset', 'hex-by-custom-decimal-offset', 'hex-by-custom-rdecimal-offset',
  // data sources inside the body
  'list', 'list_file', 'json', 'json_file', 'ini_file', 'hex_file',
  // control flow
  'try:', 'erista:', 'mariko:', 'on:', 'off:', 'back', 'exec', 'exit',
  'refresh', 'refresh-return', 'refresh-to', 'reboot', 'shutdown', 'force_failure',
  // system and UI
  'backlight', 'volume', 'notify', 'notify-now', 'notification', 'notification-now',
  'set-footer', 'set-region', 'logging', 'clear', 'flag', 'compare', 'ntp-sync',
  'open', 'module', 'ipc-exec', 'pchtxt2ips', 'pchtxt2cheat',
  // predicates
  'ipc_exists', 'path_exists', 'module_exists', 'module_is_active',
  'matching_txt_line', 'matching_hex_val', 'matching_hex_val_custom', 'matching_ini_val',
  '!ipc_exists', '!path_exists', '!module_exists', '!module_is_active',
  '!matching_txt_line', '!matching_hex_val', '!matching_hex_val_custom', '!matching_ini_val',
])

/** List-source directives (handled by the UI while the section is parsed). */
// Четыре имени, которые движок считает КОПИРОВАНИЕМ. Всё остальное, начинающееся
// с `mirror_` или `mirror-`, он выполняет как удаление (`utils.hpp:4234`, `4995`).
export const MIRROR_COPY = new Set(['mirror-copy', 'mirror-cp', 'mirror_copy', 'mirror_cp'])

export const ULT_SOURCES = new Set([
  'file_source', 'list_source', 'list_file_source', 'ini_file_source',
  'json_source', 'json_file_source', 'filter', 'package_source',
])

/** `;` directives Ultrahand knows about (main.cpp:99-150). */
export const ULT_DIRECTIVES = new Set([
  // package header
  'title', 'display_title', 'version', 'creator', 'about', 'credits', 'color',
  'show_version', 'show_widget',
  // menu item
  'mode', 'grouping', 'system', 'ram_size_gb', 'device_state', 'hos_version', 'ams_version',
  'visibility_condition', 'toggle_state_condition',
  'footer', 'footer_highlight', 'footer_color', 'text_color', 'hold', 'mini', 'selection_mini',
  'progress',
  // tables
  'polling', 'scrollable', 'top_pivot', 'bottom_pivot', 'background', 'bg_color', 'border',
  'header_indent', 'alignment', 'wrapping_mode', 'wrapping_indent', 'start_gap', 'end_gap',
  'gap', 'offset', 'spacing', 'info_text_color', 'section_text_color',
  // trackbars
  'min_value', 'max_value', 'steps', 'units', 'unlocked', 'on_every_tick',
])

/** `;mode=` values. The dead ones are listed separately — declared but never handled. */
export const ULT_MODES = new Set([
  'default', 'hold', 'slot', 'toggle', 'option', 'forwarder', 'text', 'table',
  'trackbar', 'step_trackbar', 'named_step_trackbar',
])
export const ULT_MODES_DEAD = new Set(['text', 'hold'])

/** Straight renames: Uberhand command → how to spell it in Ultrahand. */
export const RENAMES = new Map([
  ['hex-by-cust-offset',     { to: 'hex-by-custom-offset',           note: 'add the anchor: <file> CUST <offset> <hex>' }],
  ['hex-by-cust-offset-dec', { to: 'hex-by-custom-rdecimal-offset',  note: 'add the CUST anchor. NOT -decimal-, that reverses the byte order' }],
  ['source',                 { to: 'file_source',                    note: 'same arity' }],
  ['json_data',              { to: 'json_file',                      note: 'and the placeholder {json_data()} → {json_file()}' }],
  ['rename',                 { to: 'rename',                         note: null }], // exists in both
])

/**
 * Uberhand only — will break on migration.
 * `fix` is what to use instead, `hard` means a manual rewrite rather than a substitution.
 */
export const UBERHAND_ONLY = new Map([
  ['catch_errors',      { fix: 'a try: block', hard: true, note: 'different semantics: try: is a block, not a global flag' }],
  ['ignore_errors',     { fix: 'delete the line', hard: false, note: 'this is the default behaviour in Ultrahand' }],
  ['json_data',         { fix: 'json_file', hard: false, note: null }],
  ['remove-txt-str',    { fix: null, hard: true, note: 'no equivalent; only the matching_txt_line predicate exists' }],
  ['add-txt-str',       { fix: null, hard: true, note: 'no equivalent' }],
  ['backup',            { fix: 'copy + {timestamp}', hard: true, note: 'in Uberhand this is a hardcoded loader.kip backup' }],
  ['backup-kip2json',   { fix: null, hard: true, note: 'in neither Ultrahand nor the Uberhand sources' }],
  ['restore-json2kip',  { fix: null, hard: true, note: 'in neither Ultrahand nor the Uberhand sources' }],
  ['ram_info',          { fix: '{ram_vendor} / {ram_model} / {ram_size_gb}', hard: false, note: 'removed from Uberhand in 2024' }],
  ['4ekate-stage',      { fix: null, hard: true, note: 'EXISTS NOWHERE — a dead command even in Uberhand itself' }],
  ['kip_info',          { fix: ';mode=table with substitutions', hard: true, note: 'used to be a dedicated C++ screen' }],
  ['json_mark_cur_kip', { fix: 'set-footer + a line in [boot]', hard: true, note: 'the bulk of the migration work' }],
  ['json_mark_cur_ini', { fix: 'set-footer + a line in [boot]', hard: true, note: null }],
  ['slider_kip',        { fix: ';mode=step_trackbar + hex-by-custom-rdecimal-offset', hard: true, note: null }],
  ['slider_ini',        { fix: null, hard: true, note: 'used to be a dedicated C++ screen (FanSliderOverlay)' }],
  ['text_source',       { fix: ';mode=table', hard: true, note: ';mode=text is declared but does NOT work — a dead mode' }],
  ['source_on',         { fix: 'file_source inside an on: block', hard: true, note: 'the section needs restructuring' }],
  ['source_off',        { fix: 'file_source inside an off: block', hard: true, note: 'the section needs restructuring' }],
  ['filter_on',         { fix: 'filter inside an on: block', hard: true, note: null }],
  ['filter_off',        { fix: 'filter inside an off: block', hard: true, note: null }],
  ['toggle_state',      { fix: ';toggle_state_condition=', hard: true, note: null }],
  ['toggle_on',         { fix: 'an on: block', hard: true, note: null }],
  ['toggle_off',        { fix: 'an off: block', hard: true, note: null }],
  ['split',             { fix: ';grouping=split', hard: false, note: 'the command became a directive' }],
  ['separator',         { fix: 'an empty section [Name]', hard: false, note: null }],
  ['hex-by-swap-from-addr', { fix: null, hard: true, note: 'in neither Ultrahand nor the public Uberhand sources' }],
])

/** Header directives Ultrahand does not have. */
export const UBERHAND_DIRECTIVES = new Map([
  ['github',          'there is no update channel in this form'],
  ['kipVer',          'replace with ;visibility_condition=matching_hex_val_custom <kip> CUST 4 <hex>'],
  ['enableConfigNav', 'hierarchy is built differently: [*Name] + dropdown or ;mode=forwarder'],
  ['showCurInMenu',   'the current value is shown through ;footer= / set-footer'],
])

/** Minimum arity for commands where getting it wrong silently breaks the write. */
export const ARITY = new Map([
  ['hex-by-custom-offset',           4], // <file> CUST <offset> <hex>
  ['hex-by-custom-decimal-offset',   4],
  ['hex-by-custom-rdecimal-offset',  4],
  ['hex-by-offset',                  3],
  ['set-footer',                     1],
  ['matching_hex_val_custom',        4],
])

/** Commands whose argument N is a path to a package file (for the broken-link check). */
export const FILE_ARG = new Map([
  ['json_file_source', 0], ['list_file_source', 0], ['ini_file_source', 0],
  ['json_file', 0], ['ini_file', 0], ['list_file', 0], ['package_source', 0],
])

/** Uberhand placeholders that have to be replaced. */
export const PLACEHOLDER_RENAMES = new Map([
  ['source', 'file_source'],
  ['source_on', 'file_source inside on:'],
  ['source_off', 'file_source inside off:'],
  ['name', 'file_name (careful: with the extension in Uberhand, without it in Ultrahand)'],
  ['parent_name', 'folder_name'],
  ['json_data', 'json_file'],
  ['json_mark_cur_kip', 'no equivalent — set-footer + [boot]'],
  ['json_mark_cur_ini', 'no equivalent — set-footer + [boot]'],
])
