import type { CommentSpec } from "./languages";

// Escapes regex metacharacters so an identifier (which may legally contain `$`
// in TS/JS, per the language identifier charset) can be safely interpolated
// into a dynamically-built RegExp without producing stray anchors/operators.
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Blanks out comments and (by default) string interiors, preserving newlines &
// brace layout so brace-counting and identifier scanning don't trip over noise.
// Pass { keepStrings: true } to blank ONLY comments — used by the import pass,
// whose module paths ARE string literals and must survive.
// Heredoc/nowdoc is intentionally out of scope (rare in pasted layout snippets).
export function stripNoise(
  src: string,
  spec: CommentSpec,
  opts: { keepStrings?: boolean } = {},
): string {
  const keepStrings = !!opts.keepStrings;
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const emitStr = (ch: string) => out.push(ch === "\n" ? "\n" : keepStrings ? ch : " ");
  const openStr = (tok: string) => out.push(keepStrings ? tok : " ".repeat(tok.length));

  const lineTokens = spec.line ?? [];
  const [blkOpen, blkClose] = spec.block ?? ["", ""];
  const hasBlock = !!spec.block;
  const strings = new Set(spec.strings ?? []);
  const triple = !!spec.tripleQuotes;
  const backtick = !!spec.backtick;

  const startsWith = (i: number, tok: string) => tok && src.startsWith(tok, i);
  const matchLineTok = (i: number) => lineTokens.find((t) => startsWith(i, t));

  type State = "code" | "line" | "block" | "str" | "triple";
  let state: State = "code";
  let quote = "";       // active string delimiter
  let tripleTok = "";   // active triple-quote token

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    switch (state) {
      case "code": {
        if (c === "\n") { out.push("\n"); break; }

        const lt = matchLineTok(i);
        if (lt) { state = "line"; for (let k = 0; k < lt.length; k++) out.push(" "); i += lt.length - 1; break; }

        if (hasBlock && startsWith(i, blkOpen)) {
          state = "block";
          for (let k = 0; k < blkOpen.length; k++) out.push(" ");
          i += blkOpen.length - 1;
          break;
        }

        // triple-quoted strings (python)
        if (triple && (c === '"' || c === "'") && src[i + 1] === c && src[i + 2] === c) {
          state = "triple"; tripleTok = c + c + c; openStr(tripleTok); i += 2; break;
        }

        if (strings.has(c)) { state = "str"; quote = c; openStr(c); break; }
        if (backtick && c === "`") { state = "str"; quote = "`"; openStr("`"); break; }

        out.push(c);
        break;
      }
      case "line":
        if (c === "\n") { state = "code"; out.push("\n"); } else out.push(" ");
        break;
      case "block":
        if (hasBlock && startsWith(i, blkClose)) {
          state = "code";
          for (let k = 0; k < blkClose.length; k++) out.push(" ");
          i += blkClose.length - 1;
        } else blank(c);
        break;
      case "str":
        if (c === "\\") {
          // Never swallow a newline after a backslash: a string line-continuation
          // must keep its newline, or every later symbol's line/endLine drifts.
          if (src[i + 1] === "\n") { emitStr("\\"); break; }
          if (keepStrings) {
            emitStr("\\");
            if (i + 1 < src.length) { emitStr(src[i + 1]); i++; }
          } else {
            out.push("  "); i++;
          }
          break;
        }
        if (c === quote) { state = "code"; emitStr(quote); break; }
        emitStr(c);
        break;
      case "triple":
        if (src.startsWith(tripleTok, i)) { state = "code"; openStr(tripleTok); i += 2; break; }
        emitStr(c);
        break;
    }
  }
  return out.join("");
}
