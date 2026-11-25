/**
 * Revenge Runtime Theme Engine
 * Applies converted BetterDiscord / Vencord themes in two complementary ways:
 *  1. Live Runtime Patching: Patches Discord Mobile's `meta.resolveSemanticColor`
 *     and `RawColor` tables in memory so changes take effect immediately without
 *     rebuilding the APK or breaking on Discord 345+ Visual Refresh token shifts.
 *  2. Native Revenge Theme Bridge: Generates a standard `spec: 2` Revenge JSON
 *     object that can be copied or installed into Revenge's native theme manager
 *     (which also enables chat background wallpapers).
 */

import { findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { logger } from "@vendetta";
import type { RevengeThemeJson } from "../mapper/themeMapper";

export interface SavedThemeEntry {
  id: string;
  sourceUrl?: string;
  rawCss: string;
  theme: RevengeThemeJson;
  stats: {
    cssVarsFound: number;
    importsResolved: number;
    semanticTokensMapped: number;
    rawTokensMapped: number;
    hasBackground: boolean;
    previewSwatches: string[];
  };
  warnings: string[];
  updatedAt: number;
}

export interface EngineState {
  activeThemeId: string | null;
  patchedSemantic: boolean;
  patchedRawCount: number;
}

let unpatchFns: Array<() => void> = [];
let savedRawColorOriginals: Array<{ target: Record<string, any>; key: string; value: any }> = [];
let activeTheme: RevengeThemeJson | null = null;
let activeThemeId: string | null = null;

function resolveThemeModeIndex(themeName: unknown): number {
  const s = String(themeName || "dark").toLowerCase();
  // Revenge spec:2 semanticColors array is [darkColor, lightColor]
  return s === "light" ? 1 : 0;
}

/**
 * Restore all live runtime patches and mutated RawColor entries.
 */
export function clearLiveTheme(): void {
  for (const unpatch of unpatchFns) {
    try {
      unpatch();
    } catch (e) {
      logger?.warn?.("[BD/Vencord Themes] Failed to unpatch:", e);
    }
  }
  unpatchFns = [];

  for (let i = savedRawColorOriginals.length - 1; i >= 0; i--) {
    const entry = savedRawColorOriginals[i];
    try {
      entry.target[entry.key] = entry.value;
    } catch {
      // Some frozen objects may reject mutation; ignore safely
    }
  }
  savedRawColorOriginals = [];
  activeTheme = null;
  activeThemeId = null;
}

/**
 * Apply a RevengeThemeJson live inside Discord Android via Metro + Patcher.
 */
export function applyLiveTheme(theme: RevengeThemeJson, id: string): EngineState {
  clearLiveTheme();
  activeTheme = theme;
  activeThemeId = id;

  let patchedSemantic = false;
  let patchedRawCount = 0;

  try {
    // 1. Patch Discord Mobile's semantic color resolver (meta.resolveSemanticColor)
    const colorModule =
      findByProps("meta", "colors") ||
      findByProps("resolveSemanticColor") ||
      findByProps("SemanticColor");

    const resolverHost = colorModule?.meta?.resolveSemanticColor
      ? colorModule.meta
      : colorModule?.resolveSemanticColor
      ? colorModule
      : null;

    if (resolverHost && typeof resolverHost.resolveSemanticColor === "function") {
      const unpatch = after("resolveSemanticColor", resolverHost, (args: any[], res: any) => {
        if (!activeTheme) return res;
        const themeName = args[0];
        const sym = args[1];
        const tokenName =
          typeof sym === "string"
            ? sym
            : sym?.name || sym?.description || (typeof sym === "symbol" ? sym.description : null);

        if (!tokenName) return res;

        const cleanKey = String(tokenName).replace(/^colors\./i, "").toUpperCase();
        const overrideArr =
          activeTheme.semanticColors[cleanKey] || activeTheme.semanticColors[tokenName];

        if (Array.isArray(overrideArr) && overrideArr.length > 0) {
          const idx = resolveThemeModeIndex(themeName);
          return overrideArr[idx] || overrideArr[0] || res;
        }
        return res;
      });
      unpatchFns.push(unpatch);
      patchedSemantic = true;
    }

    // 2. Patch RawColor tables in-place (saving originals for clean restore)
    const rawColorContainers: Array<Record<string, any>> = [];
    const rawMod = findByProps("PRIMARY_600", "BRAND_500") || findByProps("RawColor");
    if (rawMod) {
      if (rawMod.RawColor && typeof rawMod.RawColor === "object") {
        rawColorContainers.push(rawMod.RawColor);
      }
      if (typeof rawMod === "object") {
        rawColorContainers.push(rawMod);
      }
    }
    if (colorModule?.unsafe_rawColors && typeof colorModule.unsafe_rawColors === "object") {
      rawColorContainers.push(colorModule.unsafe_rawColors);
    }

    const seenContainers = new Set<any>();
    for (const container of rawColorContainers) {
      if (!container || seenContainers.has(container)) continue;
      seenContainers.add(container);

      for (const [token, hex] of Object.entries(theme.rawColors)) {
        if (!(token in container)) continue;
        try {
          const prev = container[token];
          if (typeof prev === "string") {
            savedRawColorOriginals.push({ target: container, key: token, value: prev });
            container[token] = hex;
            patchedRawCount++;
          }
        } catch {
          // Ignore non-writable/frozen properties
        }
      }
    }
  } catch (err) {
    logger?.error?.("[BD/Vencord Themes] Live apply error:", err);
  }

  return {
    activeThemeId,
    patchedSemantic,
    patchedRawCount,
  };
}

/**
 * Serialize a converted theme as formatted Revenge spec:2 JSON.
 */
export function exportRevengeThemeJson(theme: RevengeThemeJson): string {
  return JSON.stringify(theme, null, 2);
}

/**
 * Best-effort bridge to Revenge's native theme manager (if exposed on global vendetta/bunny).
 * Returns true if native theme selection succeeded, false if unsupported on the current build.
 */
export async function tryApplyNativeRevengeTheme(theme: RevengeThemeJson, id: string): Promise<boolean> {
  try {
    const g: any = typeof globalThis !== "undefined" ? globalThis : {};
    const themesApi = g?.vendetta?.themes || g?.bunny?.themes;
    if (!themesApi) return false;

    const themeKey = `bd-vencord://${id}`;
    if (themesApi.themes && typeof themesApi.themes === "object") {
      themesApi.themes[themeKey] = {
        id: themeKey,
        selected: true,
        data: theme,
      };
    }
    if (typeof themesApi.selectTheme === "function") {
      await themesApi.selectTheme(themeKey);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getActiveThemeId(): string | null {
  return activeThemeId;
}
