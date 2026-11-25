/**
 * BD / Vencord Theme Loader for Revenge (Discord Android)
 * Entrypoint exporting onLoad, onUnload, and settings.
 */

import { logger } from "@vendetta";
import { applyLiveTheme, clearLiveTheme } from "./engine/themeEngine";
import Settings, { initDefaultStorage } from "./ui/Settings";

export default {
  onLoad: () => {
    const store = initDefaultStorage();
    if (store.activeThemeId && store.livePatch) {
      const active = store.themes.find((t) => t.id === store.activeThemeId);
      if (active) {
        const res = applyLiveTheme(active.theme, active.id);
        logger?.log?.(
          `[BD/Vencord Themes] Restored "${active.theme.name}" (semantic=${res.patchedSemantic}, raw=${res.patchedRawCount})`
        );
      }
    }
    logger?.log?.("[BD/Vencord Themes] Plugin loaded.");
  },

  onUnload: () => {
    clearLiveTheme();
    logger?.log?.("[BD/Vencord Themes] Plugin unloaded and theme patches restored.");
  },

  settings: Settings,
};
