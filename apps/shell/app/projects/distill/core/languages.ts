import type { SymbolKind, Visibility } from "./model";

// `scoped` restricts a rule to firing only inside a class-like container body
// (used by the method rule so bare calls in method bodies can't masquerade as decls).
export interface DeclRule { kind: SymbolKind; re: RegExp; scoped?: boolean; }


export type ScopeMode = "brace" | "indent";

// Declarative comment/string spec consumed by the stripper. Adding a language =
// filling this in, not editing a state machine. (Heredoc/nowdoc is out of scope.)
export interface CommentSpec {
  line: string[];             // line-comment tokens, e.g. ["//"], ["#"], ["//", "#"]
  block?: [string, string];   // block-comment open/close
  strings: string[];          // string delimiter chars
  tripleQuotes?: boolean;     // python-style triple quotes
  backtick?: boolean;         // template / raw strings using `
}

export type VisibilityRule =
  | { style: "keyword"; default: Visibility } // scan decl line for pub/public/private/protected
  | { style: "case" }                         // Go: capitalised => public
  | { style: "underscore" };                  // Python: leading _ => private

export interface SupersRule {
  extends?: RegExp;    // capture group 1 = comma-separated supertype list
  implements?: RegExp;
}

// Every probe is a marker the behavioural analyzer tests against a symbol body.
export interface BehaviorSpec {
  async?: RegExp;
  branch?: RegExp;
  loop?: RegExp;
  throws?: RegExp;
  handles?: RegExp;
  returns?: RegExp;    // matches a *value*-returning statement
  selfMember?: RegExp; // matches instance-state mutation
}

export type SniffRule = RegExp | { re: RegExp; weight: number };

export interface LanguageDef {
  id: string;
  label: string;
  aliases: string[];
  scope: ScopeMode;
  comments: CommentSpec;
  decls: DeclRule[];    // ordered: specific → generic; first match wins per line
  imports: RegExp[];    // named groups: module, (optional) names
  sniff: SniffRule[];   // distinctive markers for auto-detection (optionally weighted)
  reserved?: Set<string>;
  visibility: VisibilityRule;
  supers: SupersRule;
  behavior: BehaviorSpec;
  confidence: "structural" | "heuristic";
}

/* ------------------------------- TypeScript ------------------------------- */

const TS_RESERVED = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "return",
  "typeof", "new", "await", "throw", "super", "case", "in", "of",
]);

export const TS: LanguageDef = {
  id: "typescript",
  label: "TypeScript / JavaScript",
  aliases: ["ts", "tsx", "js", "jsx", "javascript", "typescript"],
  scope: "brace",
  comments: { line: ["//"], block: ["/*", "*/"], strings: ['"', "'"], backtick: true },
  confidence: "heuristic",
  reserved: TS_RESERVED,
  decls: [
    { kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type",      re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: "enum",      re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { kind: "class",     re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function",  re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/ },
    // Arrow / function-expression consts are functions, not constants. Placed BEFORE
    // the constant rule so first-match-wins promotes them (fixes signature mangling +
    // enables behavior analysis).
    { kind: "function",  re: /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/ },
    { kind: "constant",  re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ },
    // Class/interface method decls: (modifiers)* identifier + `(` or generic `<`.
    // `scoped` keeps it out of module top-level and method bodies.
    { kind: "method", scoped: true, re: /^\s*(?:(?:public|private|protected|static|readonly|abstract|async|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/ },
  ],
  imports: [
    /^\s*import\s+(?<names>[\s\S]*?)\s+from\s+["'](?<module>[^"']+)["']/,
    /^\s*import\s+["'](?<module>[^"']+)["']/,
    /\brequire\(\s*["'](?<module>[^"']+)["']\s*\)/,
  ],
  sniff: [/\binterface\s+\w+/, /:\s*\w+(\[\])?\s*[=;)]/, /\bexport\s+(default\s+)?/, /=>/],
  visibility: { style: "keyword", default: "unknown" },
  supers: {
    extends: /\bextends\s+([A-Za-z_$][\w$., <>]*)/,
    implements: /\bimplements\s+([A-Za-z_$][\w$., <>]*)/,
  },
  behavior: {
    async: /\b(?:async|await)\b/,
    branch: /\b(?:if|else|switch|case)\b/,
    loop: /\b(?:for|while|do)\b|\.(?:map|forEach|reduce|filter|flatMap)\s*\(/,
    throws: /\bthrow\b/,
    handles: /\b(?:try|catch)\b/,
    returns: /\breturn\s+[^\s;]/,
    selfMember: /\bthis\.\w+\s*=(?!=)/,
  },
};

/* ---------------------------------- Python -------------------------------- */

const PY_RESERVED = new Set([
  "if", "for", "while", "with", "try", "except", "return", "print",
  "import", "from", "as", "in", "and", "or", "not", "is", "lambda",
]);

export const PY: LanguageDef = {
  id: "python",
  label: "Python",
  aliases: ["py", "python"],
  scope: "indent",
  comments: { line: ["#"], strings: ['"', "'"], tripleQuotes: true },
  confidence: "heuristic",
  reserved: PY_RESERVED,
  decls: [
    { kind: "class",    re: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: "function", re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  ],
  imports: [
    /^\s*from\s+(?<module>[\w.]+)\s+import\s+(?<names>[\s\S]*)$/,
    /^\s*import\s+(?<module>[\w.]+)/,
  ],
  sniff: [/^\s*def\s+\w+\s*\(/m, /^\s*class\s+\w+\s*[:(]/m, /:\s*$/m, /\bself\b/],
  visibility: { style: "underscore" },
  supers: { extends: /class\s+\w+\s*\(([^)]*)\)/ },
  behavior: {
    async: /\b(?:async|await)\b/,
    branch: /\b(?:if|elif|else)\b/,
    loop: /\b(?:for|while)\b/,
    throws: /\braise\b/,
    handles: /\b(?:try|except)\b/,
    returns: /\breturn\s+[^\s]/,
    selfMember: /\bself\.\w+\s*=(?!=)/,
  },
};

/* ----------------------------------- Go ----------------------------------- */

const GO_RESERVED = new Set([
  "if", "for", "switch", "return", "go", "defer", "range", "select",
  "package", "import", "func", "var", "const", "type",
]);

export const GO: LanguageDef = {
  id: "go",
  label: "Go",
  aliases: ["go", "golang"],
  scope: "brace",
  comments: { line: ["//"], block: ["/*", "*/"], strings: ['"'], backtick: true },
  confidence: "heuristic",
  reserved: GO_RESERVED,
  decls: [
    { kind: "method",   re: /^\s*func\s+\([^)]*\)\s+([A-Za-z_]\w*)/ },
    { kind: "function", re: /^\s*func\s+([A-Za-z_]\w*)/ },
    { kind: "struct",   re: /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/ },
    { kind: "interface",re: /^\s*type\s+([A-Za-z_]\w*)\s+interface\b/ },
    { kind: "type",     re: /^\s*type\s+([A-Za-z_]\w*)\b/ },
    { kind: "constant", re: /^\s*const\s+([A-Za-z_]\w*)\b/ },
  ],
  imports: [
    /^\s*import\s+"(?<module>[^"]+)"/,
    /^\s*"(?<module>[^"]+)"\s*$/, // inside import ( ... ) blocks
  ],
  sniff: [/^\s*package\s+\w+/m, /\bfunc\s+/, /:=/, /\bstruct\s*\{/],
  visibility: { style: "case" },
  supers: {},
  behavior: {
    async: /\bgo\s+\w/,
    branch: /\b(?:if|switch|select)\b/,
    loop: /\bfor\b/,
    throws: /\bpanic\s*\(/,
    handles: /\brecover\s*\(|if\s+err\s*!=\s*nil/,
    returns: /\breturn\s+[^\s]/,
    selfMember: /\b\w+\.\w+\s*=(?!=)/,
  },
};

/* ---------------------------------- Rust ---------------------------------- */

const RS_RESERVED = new Set([
  "if", "for", "while", "loop", "match", "return", "let", "mut",
  "fn", "impl", "use", "mod", "pub", "self", "Self",
]);

export const RS: LanguageDef = {
  id: "rust",
  label: "Rust",
  aliases: ["rs", "rust"],
  scope: "brace",
  comments: { line: ["//"], block: ["/*", "*/"], strings: ['"'] },
  confidence: "heuristic",
  reserved: RS_RESERVED,
  decls: [
    { kind: "function", re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { kind: "struct",   re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: "enum",     re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/ },
    { kind: "trait",    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/ },
    { kind: "type",     re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/ },
    { kind: "constant", re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)/ },
  ],
  imports: [/^\s*use\s+(?<module>[\w:]+(?:::\{[^}]*\})?)/],
  sniff: [/\bfn\s+\w+/, /\blet\s+mut\b/, /->\s*\w+/, /\bimpl\b/, /::/],
  visibility: { style: "keyword", default: "private" }, // Rust items are private by default
  supers: {},
  behavior: {
    async: /\b(?:async|await)\b|\.await\b/,
    branch: /\b(?:if|match)\b/,
    loop: /\b(?:for|while|loop)\b/,
    throws: /\bpanic!|\bErr\(/,
    handles: /\b(?:Result|Ok|Err)\b/,
    returns: /\breturn\s+[^\s;]/,
    selfMember: /\bself\.\w+\s*=(?!=)/,
  },
};

/* ----------------------------------- PHP ---------------------------------- */

const PHP_RESERVED = new Set([
  "if", "else", "elseif", "for", "foreach", "while", "do", "switch",
  "case", "match", "return", "echo", "print", "isset", "unset", "empty",
  "try", "catch", "finally", "throw", "new", "clone", "instanceof",
  "and", "or", "xor", "as", "use", "namespace", "function", "fn",
]);

export const PHP: LanguageDef = {
  id: "php",
  label: "PHP",
  aliases: ["php", "php7", "php8"],
  scope: "brace",
  // PHP accepts three comment styles; ordinary quotes only (heredoc/nowdoc out of scope).
  comments: { line: ["//", "#"], block: ["/*", "*/"], strings: ['"', "'"] },
  confidence: "heuristic",
  reserved: PHP_RESERVED,
  decls: [
    { kind: "interface", re: /^\s*interface\s+([A-Za-z_]\w*)/ },
    { kind: "trait",     re: /^\s*trait\s+([A-Za-z_]\w*)/ },
    { kind: "enum",      re: /^\s*enum\s+([A-Za-z_]\w*)/ },
    { kind: "class",     re: /^\s*(?:abstract\s+|final\s+)*class\s+([A-Za-z_]\w*)/ },
    // Methods carry any ordering of visibility/static/abstract/final modifiers.
    { kind: "function",  re: /^\s*(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z_]\w*)/ },
    { kind: "constant",  re: /^\s*(?:(?:public|protected|private)\s+)?const\s+([A-Za-z_]\w*)/ },
  ],
  imports: [
    /^\s*namespace\s+(?<module>[\w\\]+)/,
    /^\s*use\s+(?<module>[\w\\]+)(?:\s+as\s+\w+)?\s*;/,
    /\b(?:require|require_once|include|include_once)\s*\(?\s*["'](?<module>[^"']+)["']/,
  ],
  // <?php and $-sigils are near-unambiguous; weight them heavily so a Rust
  // snippet using -> T is never misclassified as PHP.
  sniff: [
    { re: /<\?php/, weight: 4 },
    { re: /\$[A-Za-z_]\w*/, weight: 2 },
    { re: /->\s*\w/, weight: 1 },
    { re: /\bfunction\s+\w+\s*\(/, weight: 1 },
    { re: /::/, weight: 1 },
  ],
  visibility: { style: "keyword", default: "public" }, // PHP members default to public
  supers: {
    extends: /\bextends\s+([A-Za-z_\\][\w\\]*)/,
    implements: /\bimplements\s+([A-Za-z_\\][\w\\,\s]*)/,
  },
  behavior: {
    branch: /\b(?:if|elseif|else|switch|match)\b/,
    loop: /\b(?:for|foreach|while|do)\b/,
    throws: /\bthrow\b/,
    handles: /\b(?:try|catch|finally)\b/,
    returns: /\breturn\s+[^\s;]/,
    selfMember: /\$this->\w+\s*=(?!=)/,
  },
};

/* --------------------------------- Bitrix --------------------------------- */

// Bitrix IS PHP (same lexer/comments/strings/class syntax), so BITRIX is derived
// from PHP by spread — every shared concern stays in lockstep, no duplication.
// Framework superglobals templates often only READ (never assign), captured by a
// curated alternation that stays fully declarative (a regex in the def, not engine logic).
const BITRIX_SUPERGLOBALS =
  "APPLICATION|USER|DB|USER_FIELD_MANAGER|component|GLOBALS|DBType|arLangMessage|MESS|CACHE_MANAGER";

const BITRIX_CALL_METHODS =
  "IncludeComponent|SetTitle|IncludeFile|IncludeComponentTemplate";

// A statement in a Bitrix template frequently opens the line with a PHP tag:
// `<?php $x = …`, echo-shorthand `<?= $x`, or the bare short tag `<? $x`. Defined
// once and shared by every variable rule below so the concept lives in one place.
const BITRIX_OPEN_TAG = "(?:<\\?(?:php\\b|=)?\\s*)?";

export const BITRIX: LanguageDef = {
  ...PHP,
  id: "bitrix",
  label: "Bitrix (PHP)",
  aliases: ["bitrix", "bx", "bitrix24", "1c-bitrix"],
  // PHP's decls PLUS procedural-template captures. First-match-wins is safe:
  // every PHP rule needs a leading keyword a bare `$var = …` line can never satisfy,
  // so appending here never disturbs real PHP constructs.
decls: [
  ...PHP.decls,

  // High-signal Bitrix orchestration calls. Keep these declarative and narrowly
  // scoped: capture framework entry points, not arbitrary method calls.
  { kind: "call", re: new RegExp(
      `^\\s*${BITRIX_OPEN_TAG}(\\$(?:${BITRIX_SUPERGLOBALS})->(?:${BITRIX_CALL_METHODS}))\\s*\\(`
    ) },

  // Component-class template orchestration:
  // `$this->IncludeComponentTemplate(...)`.
  { kind: "call", re: new RegExp(
      `^\\s*${BITRIX_OPEN_TAG}(\\$this->IncludeComponentTemplate)\\s*\\(`
    ) },

  // Module loading:
  // `CModule::IncludeModule(...)`
  // `\Bitrix\Main\Loader::includeModule(...)`
  { kind: "call", re: new RegExp(
      `^\\s*${BITRIX_OPEN_TAG}(\\\\Bitrix\\\\Main\\\\Loader::includeModule|CModule::IncludeModule)\\s*\\(`
    ) },

  // Bitrix prolog/epilog includes. Restrict this to the two framework bootstrap
  // families instead of treating every require/include as a Bitrix call.
  { kind: "call", re: new RegExp(
      `^\\s*${BITRIX_OPEN_TAG}((?:require|require_once|include|include_once))\\s*\\(?\\s*["'][^"']*(?:prolog_before|epilog_after)[^"']*["']\\s*\\)?`
    ) },

  // Top-level assignment: $var, optional chained [subscripts], a lone = (not == / =>).
  // Leading PHP open tag tolerated — real templates write `<?php $arResult[...] = …`.
  { kind: "variable", re: new RegExp(`^\\s*${BITRIX_OPEN_TAG}(\\$[A-Za-z_]\\w*)\\s*(?:\\[[^\\]]*\\])*\\s*=(?![=>])`) },

  // Explicit imports: `global $APPLICATION;` (also tolerant of a tag prefix).
  { kind: "variable", re: new RegExp(`^\\s*${BITRIX_OPEN_TAG}global\\s+(\\$[A-Za-z_]\\w*)`) },

  // Read-only framework superglobals at statement start, but NOT method calls.
  // Call rules above must win for `$APPLICATION->IncludeComponent(...)`.
  { kind: "call", re: new RegExp(
    `^\\s*${BITRIX_OPEN_TAG}(\\$(?:${BITRIX_SUPERGLOBALS})->(?:${BITRIX_CALL_METHODS}))\\s*\\(`
  ) },
],
  // Distinctive, heavily-weighted markers so auto-detect promotes genuine Bitrix
  // files ABOVE plain PHP, while a non-Bitrix PHP file scores 0 here and stays PHP.
  sniff: [
    { re: /B_PROLOG_INCLUDED/, weight: 6 },
    { re: /\$ar(?:Result|Params)\b/, weight: 4 },
    { re: /\/bitrix\/|bitrix[\\/]modules/, weight: 4 },
    { re: /\$APPLICATION\b/, weight: 3 },
    { re: /Bitrix\\Main/, weight: 3 },
    { re: /\bC(?:Main|Bitrix|IBlock|Module)\b/, weight: 2 },
  ],
};

/* --------------------------------- Generic -------------------------------- */

// Registered as a first-class citizen: it uses the same declarative machinery,
// so even an unidentified language yields relational + behavioural signal.
export const GENERIC: LanguageDef = {
  id: "generic",
  label: "Generic (textual fallback)",
  aliases: ["auto", "text", "plain"],
  scope: "brace",
  comments: { line: ["//", "#"], block: ["/*", "*/"], strings: ['"', "'"], backtick: true },
  confidence: "heuristic",
  decls: [
    { kind: "class",     re: /^\s*(?:export\s+|pub\s+|public\s+)?(?:class|struct)\s+([A-Za-z_]\w*)/ },
    { kind: "interface", re: /^\s*(?:export\s+|pub\s+)?interface\s+([A-Za-z_]\w*)/ },
    { kind: "function",  re: /^\s*(?:export\s+|pub\s+|public\s+|private\s+)?(?:async\s+)?(?:function|func|fn|def|sub)\s+([A-Za-z_]\w*)/ },
  ],
  imports: [
    /^\s*(?:import|use|require|include)\s+["'<]?(?<module>[\w./:\\-]+)/,
  ],
  sniff: [], // never auto-selected; only used as an explicit or last-resort choice
  visibility: { style: "keyword", default: "unknown" },
  supers: {
    extends: /\bextends\s+([A-Za-z_$][\w$., <>]*)/,
    implements: /\bimplements\s+([A-Za-z_$][\w$., <>]*)/,
  },
  behavior: {
    async: /\b(?:async|await)\b/,
    branch: /\b(?:if|else|switch|case|match)\b/,
    loop: /\b(?:for|foreach|while|loop|do)\b/,
    throws: /\b(?:throw|raise|panic)\b/,
    handles: /\b(?:try|catch|except|rescue)\b/,
    returns: /\breturn\s+[^\s;]/,
    selfMember: /\b(?:this|self)\.\w+\s*=(?!=)/,
  },
};

/* ------------------------------- registry --------------------------------- */

export const REGISTRY: LanguageDef[] = [TS, PY, GO, RS, PHP, BITRIX, GENERIC];

export function resolveLanguage(hint?: string): LanguageDef {
  if (hint && hint !== "auto") {
    const h = hint.toLowerCase();
    const found = REGISTRY.find((l) => l.id === h || l.aliases.includes(h));
    if (found) return found;
  }
  return GENERIC; // caller does sniffing separately when hint === "auto"
}

const sniffWeight = (r: SniffRule): { re: RegExp; weight: number } =>
  r instanceof RegExp ? { re: r, weight: 1 } : r;

/** Weighted signature-based detection when the user leaves it on "auto". */
export function sniffLanguage(src: string): LanguageDef {
  let best = GENERIC;
  let bestScore = 0;
  for (const lang of REGISTRY) {
    if (lang.id === "generic") continue;
    let score = 0;
    for (const rule of lang.sniff) {
      const { re, weight } = sniffWeight(rule);
      if (re.test(src)) score += weight;
    }
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  return bestScore > 0 ? best : GENERIC;
}