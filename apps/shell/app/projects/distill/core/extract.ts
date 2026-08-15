import type {
  CodeRegion,
  CodeSymbol,
  Dependency,
  SymbolKind,
  Visibility,
} from "./model";
import type { LanguageDef } from "./languages";
import { stripNoise } from "./strip";

function visibilityOf(
  line: string,
  name: string,
  lang: LanguageDef,
): Visibility {
  const rule = lang.visibility;

  switch (rule.style) {
    case "underscore":
      return /^_/.test(name) ? "private" : "public";

    case "case":
      return /^[A-Z]/.test(name) ? "public" : "private";

    case "keyword":
      if (/\bpublic\b/.test(line)) return "public";
      if (/\bprotected\b/.test(line)) return "protected";
      if (/\bprivate\b/.test(line)) return "private";
      if (/\b(?:pub|export)\b/.test(line)) return "public";
      return rule.default;
  }
}

function trimVarRhs(sig: string): string {
  const eq = sig.search(/=(?![=>])/);
  if (eq < 0) return sig;

  const name = sig.slice(0, eq).trim();
  let rhs = sig.slice(eq + 1).trim();

  if (!rhs) return name;

  const close: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };

  const trimmed = rhs.replace(/[-\s,.:;+*\/%&|^=<>?]+$/, "");

  const openRun = trimmed.match(/[([{]+$/);

  if (openRun) {
    const first = openRun[0][0];
    rhs =
      trimmed.slice(0, trimmed.length - openRun[0].length) +
      first +
      "…" +
      close[first];

    return `${name} = ${rhs}`;
  }

  if (trimmed !== rhs) {
    return `${name} = ${trimmed}…`;
  }

  return `${name} = ${trimmed}`;
}

function callEndLine(
  cleanLines: string[],
  startIdx: number,
  maxEndIdx: number,
  maxLines = 200,
): number {
  const closeFor: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };

  const stack: string[] = [];
  let sawOpener = false;

  const end = Math.min(
    cleanLines.length - 1,
    maxEndIdx,
    startIdx + maxLines - 1,
  );

  for (let i = startIdx; i <= end; i++) {
    for (const ch of cleanLines[i]) {
      if (closeFor[ch]) {
        stack.push(closeFor[ch]);
        sawOpener = true;
        continue;
      }

      if (ch === ")" || ch === "]" || ch === "}") {
        const expected = stack[stack.length - 1];

        if (expected === ch) {
          stack.pop();
        }
      }
    }

    if (sawOpener && stack.length === 0) {
      return i + 1;
    }
  }

  return Math.min(cleanLines.length, end + 1);
}

function renderSignature(
  rawLines: string[],
  startIdx: number,
  kind: SymbolKind,
  maxLen = 200,
): string {
  let sig = "";
  let depth = 0;
  let seenParen = false;

  for (
    let i = startIdx;
    i < rawLines.length && i < startIdx + 8;
    i++
  ) {
    const l = rawLines[i];

    sig += (sig ? " " : "") + l.trim();

    for (const ch of l) {
      if (ch === "(") {
        depth++;
        seenParen = true;
      } else if (ch === ")") {
        depth--;
      }
    }

    if (
      depth <= 0 &&
      (/[{:;]\s*$/.test(l) ||
        (seenParen && !/[,({]\s*$/.test(l)))
    ) {
      break;
    }

    if (
      (kind === "constant" || kind === "variable") &&
      /=/.test(l)
    ) {
      break;
    }
  }

  sig = sig
    .replace(/\s*\{[\s\S]*$/, "")
    .replace(/\s*;+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (kind === "variable") {
    sig = trimVarRhs(sig);
  } else if (kind === "call") {
    const head = rawLines
      .slice(startIdx, Math.min(rawLines.length, startIdx + 16))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const callee =
      head.match(
        /(\$[A-Za-z_]\w*->(?:[A-Za-z_]\w*)|\\\\?[A-Za-z_]\w*(?:\\\\[A-Za-z_]\w*)*::[A-Za-z_]\w*|(?:require|require_once|include|include_once))\s*\(/,
      )?.[1] ??
      sig.split(/\s*\(/, 1)[0];

    const firstString = head.match(
      /\(\s*["']([^"']+)["']/,
    )?.[1];

    sig = firstString
      ? `${callee}("${firstString}", …)`
      : `${callee}(…)`;
  }

  if (sig.length > maxLen) {
    sig =
      sig.slice(0, Math.max(1, maxLen - 1)) +
      "…";
  }

  return sig;
}

export function superTypesOf(
  sig: string,
  lang: LanguageDef,
): {
  extends: string[];
  implements: string[];
} {
  const out = {
    extends: [] as string[],
    implements: [] as string[],
  };

  const clean = (s: string) => {
    let depth = 0;
    let buf = "";
    const parts: string[] = [];

    for (const ch of s) {
      if (ch === "<") {
        depth++;
        continue;
      }

      if (ch === ">") {
        if (depth > 0) depth--;
        continue;
      }

      if (ch === "," && depth === 0) {
        parts.push(buf);
        buf = "";
        continue;
      }

      if (depth === 0) buf += ch;
    }

    parts.push(buf);

    return parts
      .map((x) => x.trim())
      .filter((x) => x && x !== "object");
  };

  if (lang.supers.extends) {
    const m = sig.match(lang.supers.extends);
    if (m) out.extends = clean(m[1]);
  }

  if (lang.supers.implements) {
    const m = sig.match(lang.supers.implements);
    if (m) out.implements = clean(m[1]);
  }

  return out;
}

export interface Extraction {
  symbols: CodeSymbol[];
  dependencies: Dependency[];
}

export interface ExtractOptions {
  region?: CodeRegion;
  idPrefix?: string;
}

export function extract(
  src: string,
  lang: LanguageDef,
  sigMaxLen = 200,
  options: ExtractOptions = {},
): Extraction {
  const rawLines = src.split("\n");
  const cleanLines = stripNoise(
    src,
    lang.comments,
  ).split("\n");

  const region = options.region;

  const startLine = region?.line ?? 1;
  const endLine = region?.endLine ?? rawLines.length;
  const startIdx = Math.max(0, startLine - 1);
  const endIdx = Math.min(rawLines.length - 1, endLine - 1);

  // Import view: comments blanked, strings retained.
  const importLines = stripNoise(
    src,
    lang.comments,
    { keepStrings: true },
  ).split("\n");

  const symbols: CodeSymbol[] = [];
  const dependencies: Dependency[] = [];
  const seenModules = new Set<string>();

  // --- imports ---
  for (let i = startIdx; i <= endIdx; i++) {
    const line = importLines[i];

    for (const re of lang.imports) {
      const m = line.match(re);

      if (m?.groups?.module) {
        const mod = m.groups.module.trim();

        if (mod && !seenModules.has(mod)) {
          seenModules.add(mod);

          const names = m.groups.names
            ? m.groups.names
                .replace(/[{}]/g, " ")
                .split(",")
                .map((s) =>
                  s
                    .trim()
                    .replace(/\s+as\s+.*/, "")
                    .replace(/^\*\s*/, ""),
                )
                .filter(
                  (s) =>
                    s &&
                    !/^from$/.test(s),
                )
            : undefined;

          dependencies.push({
            module: mod,
            names: names?.length ? names : undefined,
          });
        }

        break;
      }
    }
  }

  interface Scope {
    id: string;
    kind: SymbolKind;
    depthAt: number;
    indent: number;
    emitted: boolean;
  }

  const CONTAINER_KINDS = new Set<SymbolKind>([
    "class",
    "struct",
    "interface",
    "trait",
    "enum",
  ]);

  const CALLABLE_KINDS = new Set<SymbolKind>([
    "function",
    "method",
  ]);

  const scopes: Scope[] = [];
  const byId = new Map<string, CodeSymbol>();

  let braceDepth = 0;
  let counter = 0;

  const seenVars = new Set<string>();
  const isIndent = lang.scope === "indent";
  const indentOf = (s: string) =>
    s.match(/^[ \t]*/)?.[0].length ?? 0;

  const braceDelta = (s: string) => {
    let d = 0;

    for (const ch of s) {
      if (ch === "{") d++;
      else if (ch === "}") d--;
    }

    return d;
  };

  const closeScope = (
    sc: Scope,
    endLine: number,
  ) => {
    if (!sc.emitted) return;

    const owner = byId.get(sc.id);

    if (owner) {
      owner.endLine = endLine;
    }
  };

  const isAnonymousCallableOpen = (
    line: string,
  ): boolean => {
    if (lang.id !== "typescript") {
      return false;
    }

    if (!line.includes("{")) {
      return false;
    }

    const beforeBrace = line.slice(
      0,
      line.indexOf("{"),
    );

    // Named function declarations / function-expression assignments are
    // already handled by the normal declaration rules. This detector is only
    // for anonymous callbacks such as:
    //
    //   items.forEach(function (item) {
    //   items.map((item) => {
    //
    // Their bodies still need to establish callable scope so nested `let`,
    // `const`, and `var` declarations do not become document-level symbols.
    const anonymousFunction =
      /\bfunction\s*\*?\s*(?:\([^)]*\))?\s*$/.test(
        beforeBrace,
      );

    const arrowFunction =
      /(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*$/.test(
        beforeBrace,
      );

    return (
      anonymousFunction ||
      arrowFunction
    );
  };
  
  for (let i = startIdx; i <= endIdx; i++) {
    const cl = cleanLines[i];
    const indent = indentOf(cl);

    if (isIndent) {
      while (
        scopes.length &&
        cl.trim() &&
        indent <= scopes[scopes.length - 1].indent
      ) {
        closeScope(
          scopes.pop()!,
          i,
        );
      }
    } else {
      while (
        scopes.length &&
        braceDepth <=
          scopes[scopes.length - 1].depthAt
      ) {
        closeScope(
          scopes.pop()!,
          i,
        );
      }
    }

    const enclosing = scopes.length
      ? scopes[scopes.length - 1]
      : undefined;

    const inCallableBody =
    !!enclosing &&
    (
      CALLABLE_KINDS.has(enclosing.kind) ||
      !enclosing.emitted
    );

    const inContainer =
      !!enclosing &&
      CONTAINER_KINDS.has(enclosing.kind);

    if (!inCallableBody) {
      for (const rule of lang.decls) {
        if (
          rule.scoped &&
          !inContainer
        ) {
          continue;
        }

        const m = cl.match(rule.re);

        if (!m?.[1]) continue;

        const parentId = enclosing?.id;

        const kind: SymbolKind =
          rule.kind === "function" &&
          parentId
            ? "method"
            : rule.kind;

        if (kind === "variable") {
          if (seenVars.has(m[1])) break;
          seenVars.add(m[1]);
        }

        const id =
          `${options.idPrefix ?? ""}s${counter++}`;

        const signature = renderSignature(
          rawLines,
          i,
          kind,
          sigMaxLen,
        );

        const sym: CodeSymbol = {
          id,
          kind,
          name: m[1],
          signature,
          visibility: visibilityOf(
            cl,
            m[1],
            lang,
          ),
          line: i + 1,
          endLine:
            kind === "call"
              ? callEndLine(
                  cleanLines,
                  i,
                  endIdx,
                )
              : i + 1,
          language: lang.id,
          regionId: region?.id,
          parentId,
        };

        symbols.push(sym);
        byId.set(id, sym);

        if (
          CONTAINER_KINDS.has(kind) ||
          CALLABLE_KINDS.has(kind)
        ) {
          scopes.push({
            id,
            kind,
            depthAt: braceDepth,
            indent,
            emitted: true,
          });
        }

        break;
      }
    }

    // Anonymous TS/JS callbacks are callable scopes but intentionally do not
    // become symbols. Their local declarations must remain implementation
    // detail rather than leaking into ## api / ## state.
    if (
      !isIndent &&
      isAnonymousCallableOpen(cl) &&
      !(
        enclosing &&
        CALLABLE_KINDS.has(enclosing.kind)
      )
    ) {
      scopes.push({
        id: `__anonymous_${counter++}`,
        kind: "function",
        depthAt: braceDepth,
        indent,
        emitted: false,
      });
    }


    if (!isIndent) {
      braceDepth += braceDelta(cl);
    }
  }

  for (const sc of scopes) {
    closeScope(sc, endLine);
  }

  return {
    symbols,
    dependencies,
  };
}