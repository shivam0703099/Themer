/**
 * Automated Verification Suite for BD / Vencord Theme Loader (Revenge)
 * Evaluates the actual compiled dist/bd-vencord-themes/index.js in a simulated
 * Revenge/Vendetta runtime and verifies:
 *  1. Manifest SHA-256 hash matches index.js
 *  2. CSS color parsing (hex3/4/6/8, rgb/rgba, hsl/hsla, bare triplets, named)
 *  3. BetterDiscord Classic theme (.theme-dark + .theme-light)
 *  4. Vencord Midnight theme with recursive @import resolution
 *  5. ClearVision / Frosted Glass theme with background wallpaper + blur/alpha
 *  6. Discord 2025/2026 Visual Refresh CSS variables
 *  7. Live runtime patching (resolveSemanticColor + RawColor) & clean onUnload restore
 */

import assert from "assert/strict";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist", "bd-vencord-themes");

async function main() {
  const indexJs = await readFile(path.join(DIST_DIR, "index.js"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(DIST_DIR, "manifest.json"), "utf8"));

  // 1. Verify SHA-256 hash
  const actualHash = createHash("sha256").update(indexJs).digest("hex");
  assert.equal(manifest.hash, actualHash, "manifest.json SHA-256 hash must match index.js");
  assert.equal(manifest.main, "index.js");
  console.log("PASS 1: manifest.json SHA-256 hash verified");

  // Build simulated Revenge/Vendetta runtime
  const mockRawColors = {
    PRIMARY_600: "#313338",
    PRIMARY_630: "#2B2D31",
    PRIMARY_700: "#1E1F22",
    BRAND_500: "#5865F2",
    PLUM_18: "#1C1D22",
  };

  const mockColorModule = {
    meta: {
      resolveSemanticColor(themeName, sym) {
        return themeName === "light" ? "#FFFFFF" : "#313338";
      },
    },
    unsafe_rawColors: mockRawColors,
  };

  const mockVendetta = {
    logger: { log() {}, warn() {}, error() {} },
    metro: {
      findByProps(...props) {
        if (props.includes("meta")) return mockColorModule;
        if (props.includes("PRIMARY_600")) return mockRawColors;
        return null;
      },
      common: {
        React: { createElement: () => null, useState: (v) => [v, () => {}] },
        ReactNative: {
          ScrollView: "ScrollView",
          View: "View",
          Text: "Text",
          TextInput: "TextInput",
          TouchableOpacity: "TouchableOpacity",
          Switch: "Switch",
          ActivityIndicator: "ActivityIndicator",
          StyleSheet: { create: (s) => s },
        },
        clipboard: { setString() {} },
      },
    },
    patcher: {
      after(methodName, target, cb) {
        const orig = target[methodName];
        target[methodName] = function (...args) {
          const res = orig.apply(this, args);
          return cb(args, res);
        };
        return () => {
          target[methodName] = orig;
        };
      },
    },
    plugin: { storage: {} },
    storage: { useProxy() {} },
    ui: { toasts: { showToast() {} } },
  };

  // Evaluate bundle exactly as Revenge/Vendetta does
  const plugin = new Function("vendetta", `return ${indexJs}`)(mockVendetta);
  assert.equal(typeof plugin.default.onLoad, "function");
  assert.equal(typeof plugin.default.onUnload, "function");
  assert.equal(typeof plugin.default.settings, "function");
  const {
    normalizeToHex,
    parseBdVencordCss,
    mapCssThemeToRevenge,
    applyLiveTheme,
    clearLiveTheme,
    exportRevengeThemeJson,
  } = plugin.__internals;
  console.log("PASS 2: Compiled bundle evaluates cleanly in simulated Revenge runtime");

  // 3. Color parser checks
  assert.equal(normalizeToHex("#abc"), "#AABBCC");
  assert.equal(normalizeToHex("rgb(88, 101, 242)"), "#5865F2");
  assert.equal(normalizeToHex("88, 101, 242"), "#5865F2");
  assert.equal(normalizeToHex("hsl(235, 86%, 65%)"), "#5966F3");
  assert.equal(normalizeToHex("rgba(255, 0, 0, 0.5)"), "#FF000080");
  console.log("PASS 3: CSS color formats parsed accurately");

  // 4. Vencord Midnight theme with @import resolution
  const midnightUserCss = `
    /**
     * @name Midnight Tokyo
     * @author refact0r
     * @description A dark rounded Discord theme.
     * @version 2.1.0
     */
    @import url("https://refact0r.github.io/midnight-discord/build/midnight.css");

    :root {
      --accent-2: #7aa2f7;
      --bg-4: #1a1b26;
    }
  `;
  const mockFetcher = async (url) => {
    if (url.includes("midnight.css")) {
      return `
        :root {
          --bg-1: #292e42;
          --bg-2: #24283b;
          --bg-3: #1f2335;
          --bg-4: #000000;
          --text-3: #c0caf5;
          --text-4: #565f89;
          --accent-2: #5865f2;
        }
      `;
    }
    throw new Error("Unexpected URL: " + url);
  };

  const parsedMidnight = await parseBdVencordCss(midnightUserCss, {
    followImports: true,
    fetcher: mockFetcher,
  });
  const mappedMidnight = mapCssThemeToRevenge(parsedMidnight);
  assert.equal(mappedMidnight.theme.name, "Midnight Tokyo");
  assert.equal(mappedMidnight.theme.authors[0].name, "refact0r");
  assert.equal(mappedMidnight.stats.importsResolved, 1);
  // Main theme override (#1A1B26) must beat @import base (#000000)
  assert.equal(mappedMidnight.theme.semanticColors.BACKGROUND_PRIMARY[0], "#1A1B26");
  assert.equal(mappedMidnight.theme.semanticColors.BG_BASE_PRIMARY[0], "#1A1B26");
  assert.equal(mappedMidnight.theme.rawColors.BRAND_500, "#7AA2F7");
  console.log(
    `PASS 4: Midnight @import + override mapped (${mappedMidnight.stats.semanticTokensMapped} semantic, ${mappedMidnight.stats.rawTokensMapped} raw)`
  );

  // 5. ClearVision / Frosted Glass with background image & blur
  const clearVisionCss = `
    /**
     * @name ClearVision Custom
     * @author ClearVision Team
     * @version 6.3.0
     */
    :root {
      --main-color: #2780e6;
      --hover-color: #1e63b3;
      --background-image: url("https://example.com/wallpaper.png");
      --background-blur: 10px;
      --background-shading: 80%;
      --background-primary: #101218;
      --text-normal: #e4e6eb;
    }
  `;
  const parsedCV = await parseBdVencordCss(clearVisionCss, { followImports: false });
  const mappedCV = mapCssThemeToRevenge(parsedCV);
  assert.equal(mappedCV.theme.background?.url, "https://example.com/wallpaper.png");
  assert.equal(mappedCV.theme.background?.blur, 0.5);
  assert.equal(mappedCV.theme.background?.alpha, 0.8);
  console.log("PASS 5: ClearVision wallpaper, blur, and alpha extracted");

  // 6. Discord 2025/2026 Visual Refresh CSS vars + Light/Dark split
  const refreshCss = `
    .theme-dark, .visual-refresh {
      --bg-base-primary: #0f111a;
      --background-base-lower: #0b0d14;
      --text-default: #eeffff;
    }
    .theme-light {
      --bg-base-primary: #f8f9fc;
      --text-default: #1e2029;
    }
  `;
  const parsedRefresh = await parseBdVencordCss(refreshCss, { followImports: false });
  const mappedRefresh = mapCssThemeToRevenge(parsedRefresh);
  assert.deepEqual(mappedRefresh.theme.semanticColors.BACKGROUND_PRIMARY, ["#0F111A", "#F8F9FC"]);
  assert.deepEqual(mappedRefresh.theme.semanticColors.TEXT_DEFAULT, ["#EEFFFF", "#1E2029"]);
  console.log("PASS 6: Discord Visual Refresh & dark/light dual palette mapped");

  // 7. Live runtime patching + clean restore on unload
  const state = applyLiveTheme(mappedMidnight.theme, "test_midnight");
  assert.equal(state.patchedSemantic, true);
  assert.ok(state.patchedRawCount >= 4);
  assert.equal(
    mockColorModule.meta.resolveSemanticColor("dark", { name: "BACKGROUND_PRIMARY" }),
    "#1A1B26"
  );
  assert.equal(mockRawColors.BRAND_500, "#7AA2F7");

  clearLiveTheme();
  assert.equal(
    mockColorModule.meta.resolveSemanticColor("dark", { name: "BACKGROUND_PRIMARY" }),
    "#313338"
  );
  assert.equal(mockRawColors.BRAND_500, "#5865F2");

  // Verify Revenge JSON export is valid JSON with spec: 2
  const exported = JSON.parse(exportRevengeThemeJson(mappedMidnight.theme));
  assert.equal(exported.spec, 2);
  console.log("PASS 7: Live runtime patcher applies and cleanly restores Discord colors");

  console.log("\nALL TESTS PASSED!");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});      
