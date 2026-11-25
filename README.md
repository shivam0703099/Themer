# BD / Vencord Theme Loader for Revenge (Discord Android)

A plugin for [Revenge](https://github.com/revenge-mod/revenge-bundle) (Vendetta/Bunny-compatible) that lets you import, convert, and apply **Vencord** and **BetterDiscord** (`.theme.css`) themes directly on Discord Android.

---

## How It Works (and Important Platform Limits)

Desktop Discord runs on Electron (Chromium + HTML/CSS), whereas **Discord Android runs on React Native** (no HTML DOM or CSS engine). Because raw CSS cannot execute directly on Android, this plugin bridges the two systems:

1. **Fetches & Parses `.theme.css`**: Reads Vencord/BetterDiscord JSDoc metadata (`@name`, `@author`, `@description`, `@version`), recursively resolves `@import url(...)` base themes (up to 3 levels deep), extracts `:root`, `.theme-dark`, `.theme-light`, and `.visual-refresh` CSS custom properties, and resolves nested `var(...)` references, `#hex`, `rgb/rgba`, `hsl/hsla`, bare RGB triplets, and named colors.
2. **Maps to Revenge Theme Tokens (`spec: 2`)**: Translates 100+ Classic Discord, 2025/2026 Visual Refresh (`--bg-base-primary`, `--background-base-low`, `--text-default`), and popular theme-framework variables (Midnight `--bg-1..4`/`--accent-1..5`, ClearVision `--main-color`/`--background-image`, Material Discord, Catppuccin, etc.) into Revenge `semanticColors`, `rawColors`, and `background` (`url`, `blur`, `alpha`). Missing surface/text shades are auto-derived via HSL lightness adjustments.
3. **Dual Application Engine**:
   - **Live Runtime Patcher**: Patches Discord Mobile's `meta.resolveSemanticColor` and `RawColor` tables in memory via `@vendetta/patcher` + `@vendetta/metro`, cleanly restoring Discord's original colors when disabled or unloaded.
   - **Revenge JSON Export**: Generates a standard Revenge `spec: 2` `.json` theme you can copy to clipboard or apply natively (required for chat background wallpapers).

### What Works vs. What Cannot Work on Android
- **Supported**: Color palettes (dark & light mode), surface layers, accent/brand colors, text/icon colors, `@import`-based themes (Midnight, Catppuccin, ClearVision, Material Discord, Dracula, Nord, Gruvbox, etc.), and chat background wallpaper URLs (`background-image` / `--background-image`).
- **Not Supported by React Native**: Desktop DOM layout selectors (moving sidebars, hiding specific web classes, custom CSS grid/flexbox, `@keyframes` animations, `backdrop-filter: blur()` glassmorphism on individual panels).

---

## Quick Install on Android (Prebuilt `dist/` Included)

You do **not** need to compile anything to try the plugin — `dist/bd-vencord-themes/index.js` and `dist/bd-vencord-themes/manifest.json` (with verified SHA-256 hash) are already built.

### Option A: Host Locally on Android with Termux (Fastest)
1. Unzip this archive on your phone (e.g., into `~/revenge-bd-vencord-themes`).
2. In **Termux**, serve the `dist/` folder:
   ```bash
   cd ~/revenge-bd-vencord-themes/dist
   python3 -m http.server 8080
   ```
3. Open **Discord (Revenge)** → **Settings → Revenge → Plugins → `+`**.
4. Paste:
   ```
   http://127.0.0.1:8080/bd-vencord-themes/
   ```
5. Tap **Install**, enable the plugin, and open its **Settings (⚙️)** icon.

### Option B: Host Permanently on GitHub Pages
1. Create a public GitHub repo and push this entire folder to `main`.
2. In your repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` builds, tests, and publishes `dist/`.
4. In **Revenge → Settings → Plugins → `+`**, paste:
   ```
   https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/bd-vencord-themes/
   ```

---

## Using the Plugin

1. Open **Revenge → Settings → Plugins → BD / Vencord Theme Loader → ⚙️**.
2. Paste any raw `.theme.css` URL (for example, a raw GitHub link to a Vencord Online Theme or BetterDiscord theme) **or** paste raw CSS directly into the text box.
3. Tap **Fetch, Convert & Apply**.
4. Use **Copy JSON** if you want to save the converted `spec: 2` theme as a standalone Revenge theme (for example, to host it as a native Revenge theme with chat wallpaper support).

---

## Development & Building

```bash
# Offline zero-dependency build (used to generate dist/)
npm run build:offline

# Run automated test suite against compiled dist/ bundle
npm test

# Standard Rollup + esbuild build (requires pnpm/npm install)
npm install
npm run build
```
