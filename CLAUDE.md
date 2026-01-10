# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StremGo is an Electron-based desktop client that wraps the Stremio web player (https://web.stremio.com/) and adds plugin/theme support, Discord Rich Presence, and other enhancements. It is NOT affiliated with official Stremio.

## Commands

```bash
npm run dist          # Compile TypeScript + copy HTML templates to dist/
npm run watch         # Watch mode for TypeScript compilation
npm run lint          # Run ESLint on TypeScript files
npm run dev           # Run app in development mode (electron ./dist/main.js)

# Platform-specific builds (output to release-builds/)
npm run build:win           # Windows x64 + arm64
npm run build:mac:x64       # macOS Intel
npm run build:mac:arm64     # macOS Apple Silicon
npm run build:linux:x64     # Linux x64
npm run build:linux:arm64   # Linux arm64
```

For development with devtools: `npm run dist && npx electron ./dist/main.js --devtools`

## Architecture

### Process Model
- **Main process** (`main.ts`): Creates Electron window, loads web.stremio.com, handles IPC, manages streaming server
- **Preload script** (`preload.ts`): Runs on DOM load, injects UI components, loads plugins/themes, initializes Discord RPC

### Key Directories
- `src/core/` - Core logic: ModManager (plugin/theme system), Settings (UI injection), Updater, Properties (paths)
- `src/utils/` - Utilities: DiscordPresence, StremioService, StreamingServer, logger
- `src/components/` - UI components as TypeScript + HTML template pairs
- `src/constants/` - Centralized constants including CSS selectors, IPC channels, URLs
- `src/interfaces/` - TypeScript interfaces

### Component Pattern
Components use a template system where TypeScript files load HTML templates and replace `{{placeholder}}` values:
```typescript
let template = TemplateCache.load(__dirname, 'component-name');
template = template.replace(/\{\{\s*name\s*\}\}/g, actualValue);
```
HTML templates are copied from `src/components/` to `dist/components/` via `copyComponents.js`.

### Plugin/Theme System
- **Plugins** (`.plugin.js`): JavaScript files injected as `<script>` tags, run in renderer context
- **Themes** (`.theme.css`): CSS files injected as `<link>` tags
- Both use JSDoc metadata: `@name`, `@description`, `@version`, `@author`, `@updateUrl`
- **User mods**: Stored in platform-specific config directory (see `Properties.ts`)
- **Bundled mods**: Shipped with app in `plugins/` and `themes/` root directories, copied to `dist/` at build time
- Community registry: https://github.com/Bo0ii/StremGo (registry.json)

### IPC Communication
Channels defined in `constants/index.ts`: window controls, transparency, update checks, fullscreen state. Main<->Renderer communication uses Electron IPC.

## Important Patterns

### DOM Manipulation
The app injects UI into Stremio's web interface using CSS selectors defined in `constants/index.ts`. These selectors are fragile and may break when Stremio updates their UI.

### Streaming Server
Three options (priority order): native server.js, Stremio Service (auto-detected/downloaded), fallback. FFmpeg is auto-downloaded per platform/architecture.

### Security Model
Uses relaxed Electron security (`nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`) for functionality. Plugins execute without isolation.

## Code Style
- Tab indentation with size of 4
- TypeScript strict mode enabled
- Use constants from `src/constants/index.ts` rather than hardcoded values
