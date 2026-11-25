/**
 * Zero-dependency offline bundler for BD / Vencord Theme Loader (Revenge).
 * Compiles plugins/bd-vencord-themes/src/* into a single Hermes-compatible IIFE
 * at dist/bd-vencord-themes/index.js and generates dist/bd-vencord-themes/manifest.json
 * with a verified SHA-256 hash.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "plugins", "bd-vencord-themes");
const OUT_DIR = path.join(ROOT, "dist", "bd-vencord-themes");

/**
 * Strip parameter types inside a single function parameter list `( ... )`.
 */
function stripParamList(paramsStr) {
  const parts = [];
  let cur = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthAngle = 0;
  let depthBracket = 0;

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i];
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen--;
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace--;
    else if (ch === "<") depthAngle++;
    else if (ch === ">") {
      if (paramsStr[i - 1] !== "=") depthAngle = Math.max(0, depthAngle - 1);
    } else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;

    if (
      ch === "," &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthAngle === 0 &&
      depthBracket === 0
    ) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);

  return parts
    .map((param) => {
      const p = param.trim();
      if (!p) return "";
      let colonIdx = -1;
      let eqIdx = -1;
      let dp = 0, db = 0, da = 0, dk = 0;
      for (let i = 0; i < p.length; i++) {
        const ch = p[i];
        if (ch === "(") dp++;
        else if (ch === ")") dp--;
        else if (ch === "{") db++;
        else if (ch === "}") db--;
        else if (ch === "<") da++;
        else if (ch === ">") { if (p[i - 1] !== "=") da = Math.max(0, da - 1); }
        else if (ch === "[") dk++;
        else if (ch === "]") dk--;
        else if (ch === ":" && dp === 0 && db === 0 && da === 0 && dk === 0 && colonIdx === -1) {
          colonIdx = i;
        } else if (
          ch === "=" &&
          p[i + 1] !== ">" &&
          dp === 0 &&
          db === 0 &&
          da === 0 &&
          dk === 0 &&
          eqIdx === -1
        ) {
          eqIdx = i;
        }
      }
      if (colonIdx === -1) return p;
      const namePart = p.slice(0, colonIdx).replace(/\?$/, "").trim();
      if (eqIdx !== -1 && eqIdx > colonIdx) {
        return `${namePart} ${p.slice(eqIdx).trim()}`;
      }
      return namePart;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Balanced scanner that strips parameter types and return types from every
 * `function name(...) : ReturnType {` declaration (including nested `{}`/`<>` in return types).
 */
function stripFunctionSignatures(code) {
  let result = "";
  let i = 0;
  const fnRe = /(?:async\s+)?function\s+\w+\s*\(/g;

  while (i < code.length) {
    fnRe.lastIndex = i;
    const m = fnRe.exec(code);
    if (!m) {
      result += code.slice(i);
      break;
    }
    result += code.slice(i, m.index);
    const openParen = m.index + m[0].length - 1;

    // Find matching closing `)` for parameter list
    let pDepth = 1;
    let j = openParen + 1;
    while (j < code.length && pDepth > 0) {
      if (code[j] === "(") pDepth++;
      else if (code[j] === ")") pDepth--;
      j++;
    }
    const rawParams = code.slice(openParen + 1, j - 1);
    const cleanParams = stripParamList(rawParams);

    // After `)`, skip whitespace; if `:` follows, skip the entire return type until the function body `{`
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k++;
    if (code[k] === ":") {
      k++;
      let angleDepth = 0;
      let braceDepth = 0;
      let parenDepth = 0;
      let bracketDepth = 0;
      // Skip leading whitespace after `:`
      while (k < code.length && /\s/.test(code[k])) k++;
      // If return type starts directly with `{` (inline object type `{ a: string }`), skip that balanced `{...}` first
      if (code[k] === "{") {
        braceDepth = 1;
        k++;
        while (k < code.length && braceDepth > 0) {
          if (code[k] === "{") braceDepth++;
          else if (code[k] === "}") braceDepth--;
          k++;
        }
      }
      while (k < code.length) {
        const ch = code[k];
        if (ch === "<") angleDepth++;
        else if (ch === ">" && code[k - 1] !== "=") angleDepth = Math.max(0, angleDepth - 1);
        else if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") {
          if (angleDepth === 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            break; // Found the function body `{`
          }
          braceDepth++;
        } else if (ch === "}") {
          braceDepth = Math.max(0, braceDepth - 1);
        }
        k++;
      }
    }

    result += `${code.slice(m.index, openParen)}(${cleanParams}) `;
    i = k;
  }

  return result;
}

/**
 * Strip TypeScript-only syntax cleanly without touching JS object literals.
 */
function stripTypeScript(code) {
  let out = code;

  // 1. Remove `export interface ... { ... }` and `interface ... { ... }` blocks
  out = out.replace(/^(?:export\s+)?interface\s+\w+\s*\{[\s\S]*?^\}/gm, "");

  // 2. Remove import statements
  out = out.replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");

  // 3. Remove `export default ` and `export ` keywords
  out = out.replace(/^export\s+default\s+/gm, "const __defaultExport = ");
  out = out.replace(/^export\s+(?=(?:async\s+)?function|const|let|var)/gm, "");

  // 4. Remove `as unknown as Type` and `as Type` casts
  out = out.replace(/\s+as\s+unknown\s+as\s+[A-Za-z0-9_<>,\s\[\]|]+(?=[;,)\s])/g, "");
  out = out.replace(/\s+as\s+[A-Za-z0-9_<>\[\]]+(?=[;,)\s])/g, "");

  // 5. Remove `catch (err: any)` type annotations
  out = out.replace(/catch\s*\(\s*(\w+)\s*:\s*[^)]+\)/g, "catch ($1)");

  // 6. Remove `new Set<any>()` generic args
  out = out.replace(/new\s+Set<[^>]+>\(/g, "new Set(");

  // 7. Strip `function name(...) : ReturnType {` cleanly with balanced scanning
  out = stripFunctionSignatures(out);

  // 8. Strip arrow function parameter types `(a: Type, b: Type): Ret =>` and `(c): c is string =>`
  out = out.replace(/\(([^(){};]+?)\)\s*:\s*[A-Za-z0-9_<>\[\]| ]+?\s*=>/g, (_, params) => {
    return `(${stripParamList(params)}) =>`;
  });
  out = out.replace(/\(([^(){};]*?:\s*[^(){};]+?)\)\s*=>/g, (_, params) => {
    return `(${stripParamList(params)}) =>`;
  });

  // 9. Strip variable declarations with type annotations: `const/let/var x: Type = ...` or `let x: Type;`
  out = out.replace(/^(\s*(?:const|let|var)\s+\w+)\s*:\s*([^\n]+?)\s*=(?![=>])/gm, "$1 =");
  out = out.replace(/^(\s*(?:const|let|var)\s+\w+)\s*:\s*([^\n;=]+?);/gm, "$1;");

  // 10. Remove non-null assertions like `lightVal!` or `darkVal!`
  out = out.replace(/(\b\w+)!(?=[;,\s)\].])/g, "$1");

  return out.trim();
}

async function build() {
  const manifest = JSON.parse(await readFile(path.join(PLUGIN_DIR, "manifest.json"), "utf8"));

  const files = [
    "src/parser/colorUtils.ts",
    "src/parser/cssParser.ts",
    "src/mapper/themeMapper.ts",
    "src/engine/themeEngine.ts",
    "src/ui/Settings.tsx",
    "src/index.ts",
  ];

  const strippedParts = [];
  for (const rel of files) {
    const raw = await readFile(path.join(PLUGIN_DIR, rel), "utf8");
    let js = stripTypeScript(raw);
    if (rel.endsWith("Settings.tsx")) {
      js = js.replace("const __defaultExport = function Settings", "function Settings");
    } else if (rel.endsWith("index.ts")) {
      js = js.replace("const __defaultExport = ", "const pluginEntry = ");
    }
    try {
      new Function(js);
    } catch (e) {
      throw new Error(`Syntax error in stripped ${rel}: ${e.message}`);
    }
    strippedParts.push(`// --- ${rel} ---\n${js}`);
  }

  const bundleSource = `(function (vendetta) {
  "use strict";
  const logger = (vendetta && vendetta.logger) || console;
  const metro = (vendetta && vendetta.metro) || {};
  const findByProps = metro.findByProps || function () { return null; };
  const common = metro.common || {};
  const React = common.React || {};
  const ReactNative = common.ReactNative || {
    ScrollView: "ScrollView",
    View: "View",
    Text: "Text",
    TextInput: "TextInput",
    TouchableOpacity: "TouchableOpacity",
    Switch: "Switch",
    ActivityIndicator: "ActivityIndicator",
    StyleSheet: { create: function (s) { return s; } },
  };
  const clipboard = common.clipboard || {};
  const patcher = (vendetta && vendetta.patcher) || {};
  const after = patcher.after || function () { return function () {}; };
  const storage = (vendetta && vendetta.plugin && vendetta.plugin.storage) || {};
  const useProxy = (vendetta && vendetta.storage && vendetta.storage.useProxy) || function () {};
  const showToast = (vendetta && vendetta.ui && vendetta.ui.toasts && vendetta.ui.toasts.showToast) || function () {};

${strippedParts.join("\n\n")}

  return {
    default: pluginEntry,
    onLoad: pluginEntry.onLoad,
    onUnload: pluginEntry.onUnload,
    settings: pluginEntry.settings,
    __internals: {
      parseCssColor,
      rgbaToHex,
      normalizeToHex,
      parseBdVencordCss,
      mapCssThemeToRevenge,
      applyLiveTheme,
      clearLiveTheme,
      exportRevengeThemeJson,
    },
  };
})(typeof vendetta !== "undefined" ? vendetta : (typeof globalThis !== "undefined" ? (globalThis.vendetta || globalThis.bunny || {}) : {}))`;

  // Full bundle syntax verification
  new Function("vendetta", `return ${bundleSource}`);

  await mkdir(OUT_DIR, { recursive: true });
  const outJsPath = path.join(OUT_DIR, "index.js");
  await writeFile(outJsPath, bundleSource, "utf8");

  const hash = createHash("sha256").update(bundleSource).digest("hex");
  const distManifest = {
    ...manifest,
    main: "index.js",
    hash,
  };
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(distManifest, null, 2) + "\n",
    "utf8"
  );

  console.log(`Bundled ${manifest.name} -> ${OUT_DIR}`);
  console.log(`index.js size: ${Buffer.byteLength(bundleSource, "utf8")} bytes`);
  console.log(`manifest.json sha256: ${hash}`);
}

build().catch((err) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
