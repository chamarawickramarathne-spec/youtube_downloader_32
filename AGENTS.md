# YouTube Fetcher - AGENTS.md

## App Info
- **Name:** YouTube Fetcher
- **Type:** Python desktop app (pywebview + HTML/CSS/JS)
- **Target:** Windows 7/8/8.1/10/11 (32-bit and 64-bit)
- **Python:** 3.10+
- **pywebview:** 6.x (Edge WebView2 on Windows)
- **Packaging:** PyInstaller (single .exe)

## Modification Log

### Mod 1 - 2026-08-04: Convert 64-bit to 32-bit (ia32)
- Downgraded Electron from ^35.0.0 to 22.3.27 (Win7/8 support)
- Downgraded electron-vite from ^3.0.0 to ^2.3.0
- Downgraded vite from ^6.0.0 to ^5.0.0
- Downgraded electron-builder from ^26.0.0 to ^25.1.8
- Added @types/node ^18.0.0 (Vite 5 peer dep)
- Changed electron-builder.yml arch from x64 to ia32
- Updated download script: yt-dlp_x86.exe (32-bit) + sudo-nautilus ffmpeg win32 static
- Added esbuild target `node16` in electron.vite.config.ts for Electron 22 compat
- Version bumped to 1.1.0
- Build output: release/youtube-fetcher-1.1.0-setup.exe (32-bit NSIS installer)

### Mod 2 - 2026-08-17: Migrate from Electron to Python + pywebview
- **Reason:** Electron installer was 390MB (blank screen issue, too large for simple app)
- **New stack:** Python + pywebview 6.x + vanilla HTML/CSS/JS
- **Files created:**
  - `main.py` — pywebview window entry point
  - `api.py` — Python API class exposed to JS via pywebview bridge
  - `ytdlp_manager.py` — yt-dlp subprocess management + progress parsing
  - `history.py` — Download history persistence (JSON)
  - `settings.py` — App settings persistence (JSON)
  - `utils.py` — Filename sanitization, path utilities
  - `web/index.html` — HTML layout (same dark UI)
  - `web/styles.css` — Dark theme CSS (converted from Tailwind)
  - `web/app.js` — Full application logic (vanilla JS)
  - `requirements.txt` — Python dependencies
  - `build.bat` — PyInstaller build script
- **Size reduction:** 390MB (Electron) → ~40MB (Python + pywebview)
- **Key changes:**
  - Replaced Electron IPC with pywebview `window.pywebview.api.*` bridge
  - Replaced React with vanilla JS (no build step needed)
  - Replaced Tailwind CSS with plain CSS (same dark theme)
  - Replaced localStorage with JSON files via Python backend
  - Progress updates via `window.evaluate_js()` from Python threads
  - History/settings stored in `%APPDATA%/YouTube Fetcher/`
- **Old Electron files:** `src/`, `electron/`, `node_modules/`, `package.json`, etc. removed

### Mod 3 - 2026-08-17: Add version display and auto-update feature
- **New file:** `version.py` — APP_VERSION = '1.2.0', GITHUB_REPO constant
- **Backend:** `api.py` — Added `get_version()`, `check_update()`, `download_update()` methods
  - Checks GitHub releases API for newer version
  - Downloads new exe from release assets
  - Replaces current exe via batch script and restarts
- **Frontend:** Version badge next to title, blue "Update" button when update available
  - `web/index.html` — Added `#header-left` with version badge and update button
  - `web/styles.css` — Added `.version-badge`, `.btn-update`, `.update-progress` styles
  - `web/app.js` — Added `checkForUpdate()`, update button click handler, `_onUpdateProgress` callback
- **Build:** `build.bat` updated with correct Python 3.12-32 path and all hidden imports

### Mod 4 - 2026-08-17: Robust auto-update (force-kill + wait loop)
- **File changed:** `api.py` — `download_update()` method
- **Improvement:** Batch script now force-kills old process, waits in a loop until file deleted, then copies new exe
- **Old behavior:** `timeout /t 2` then `del /f` (unreliable if process didn't exit in time)
- **New behavior:** `taskkill /f /im` → wait loop polling `if exist` → `copy /y` new exe
- **Installer:** Created Inno Setup installer (`installer.iss`), output: `release/youtube-fetcher-1.2.0-setup.exe` (93MB)
- **Update feature updated:** Now downloads and runs the installer silently (`/SILENT /DIR=... /RESTARTAPPLICATIONS`) instead of replacing exe directly
