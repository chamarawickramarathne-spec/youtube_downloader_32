# YouTube Fetcher 32-bit - AGENTS.md

## App Info
- **Name:** YouTube Fetcher
- **Type:** Electron desktop app (32-bit / ia32)
- **Target:** Windows 7/8/8.1/10/11 (32-bit and 64-bit)
- **Electron:** 22.3.27 (last version with Win7/8 support)
- **Architecture:** ia32 (32-bit)

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
