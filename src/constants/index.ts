/**
 * Centralized constants for StreamGo
 * Using constants instead of magic strings improves maintainability
 */

// CSS Selectors used to interact with Stremio's UI
// WARNING: These selectors are FRAGILE and may break when Stremio updates their UI.
// The class names contain hashed suffixes (e.g., -GP0hI) that change with builds.
// When selectors break, inspect Stremio's UI to find the new class names.
export const SELECTORS = {
    // Settings page structure
    SECTIONS_CONTAINER: '[class^="sections-container-"]',  // Main settings sections wrapper
    SECTION: '[class^="section-"]',                        // Individual settings section
    CATEGORY: '.category-GP0hI',                           // Settings category (e.g., General, Player)
    CATEGORY_LABEL: '.label-N_O2v',                        // Category name label
    CATEGORY_ICON: '.icon-oZoyV',                          // Category icon
    CATEGORY_HEADING: '.heading-XePFl',                    // Category heading text
    LABEL: '[class^="label-wXG3e"]',                       // Generic label element
    NAV_MENU: '.menu-xeE06',                               // Navigation menu container
    SETTINGS_CONTENT: '.settings-content-co5eU',           // Settings content panel

    // Enhanced (StreamGo) section - these are stable IDs we control
    ENHANCED_SECTION: '#enhanced',
    THEMES_CATEGORY: '#enhanced > div:nth-child(2)',       // Our Themes category
    PLUGINS_CATEGORY: '#enhanced > div:nth-child(3)',      // Our Plugins category
    TWEAKS_CATEGORY: '#enhanced > div:nth-child(4)',       // Our Tweaks category
    ABOUT_CATEGORY: '#enhanced > div:nth-child(5)',        // Our About category

    // Page containers
    ROUTE_CONTAINER: '.route-container:last-child .route-content',  // Active route content

    // Meta details (movie/show info page)
    META_DETAILS_CONTAINER: '.metadetails-container-K_Dqa',  // Movie/show details page
    DESCRIPTION_CONTAINER: '.description-container-yi8iU',   // Description text container

    // Addons page
    ADDONS_LIST_CONTAINER: '.addons-list-container-Ovr2Z',   // Addons list wrapper
    ADDON_CONTAINER: '.addon-container-lC5KN',               // Individual addon card
    NAME_CONTAINER: '.name-container-qIAg8',                 // Addon name
    DESCRIPTION_ITEM: '.description-container-v7Jhe',        // Addon description
    TYPES_CONTAINER: '.types-container-DaOrg',               // Addon type badges
    SEARCH_INPUT: '.search-input-bAgAh',                     // Search input field

    // Navigation
    HORIZONTAL_NAV: '.horizontal-nav-bar-container-Y_zvK',   // Top navigation bar
} as const;

// CSS Classes used for styling
export const CLASSES = {
    OPTION: 'option-vFOAS',
    CONTENT: 'content-P2T0i',
    BUTTON: 'button-DNmYL',
    BUTTON_CONTAINER: 'button-container-zVLH6',
    SELECTED: 'selected-S7SeK',
    INSTALL_BUTTON: 'install-button-container-yfcq5',
    UNINSTALL_BUTTON: 'uninstall-button-container-oV4Yo',
    CHECKED: 'checked',
} as const;

// LocalStorage keys
export const STORAGE_KEYS = {
    ENABLED_PLUGINS: 'enabledPlugins',
    CURRENT_THEME: 'currentTheme',
    DISCORD_RPC: 'discordrichpresence',
    CHECK_UPDATES_ON_STARTUP: 'checkForUpdatesOnStartup',
    EXTERNAL_PLAYER: 'externalPlayer',
    EXTERNAL_PLAYER_PATH: 'externalPlayerPath',
    ACCENT_COLOR: 'accentColor',
    DARK_MODE: 'darkMode',
    FULL_HEIGHT_BACKGROUND: 'fullHeightBackground',
    HIDE_POSTER_HOVER: 'hidePosterHover',
    HIDE_CONTEXT_DOTS: 'hideContextDots',
    ROUNDED_POSTERS: 'roundedPosters',
    // Player enhancement settings
    PLAYBACK_SPEED: 'playbackSpeed',
    SKIP_INTRO_SECONDS: 'skipIntroSeconds',
    SUBTITLE_DELAY: 'subtitleDelay',
    SUBTITLE_FONT_SIZE: 'subtitleFontSize',
    SUBTITLE_COLOR: 'subtitleColor',
    SUBTITLE_BG_COLOR: 'subtitleBgColor',
    SECONDARY_SUBTITLE_ENABLED: 'secondarySubtitleEnabled',
    SAVED_POSITIONS: 'savedPositions',
    LAST_STREAMS: 'lastStreams',  // Stores last used stream for each content (for quick resume)
    AMBILIGHT_ENABLED: 'ambilightEnabled',
    PLAYER_OVERLAY_ENABLED: 'playerOverlayEnabled',
    // Video filter settings
    VIDEO_FILTER_SHARPNESS: 'videoFilterSharpness',
    VIDEO_FILTER_BRIGHTNESS: 'videoFilterBrightness',
    VIDEO_FILTER_CONTRAST: 'videoFilterContrast',
    VIDEO_FILTER_SATURATION: 'videoFilterSaturation',
    VIDEO_FILTER_TEMPERATURE: 'videoFilterTemperature',
    VIDEO_FILTER_ENABLED: 'videoFilterEnabled',
} as const;

// IPC Channel names for main <-> renderer communication
export const IPC_CHANNELS = {
    MINIMIZE_WINDOW: 'minimize-window',
    MAXIMIZE_WINDOW: 'maximize-window',
    CLOSE_WINDOW: 'close-window',
    SET_TRANSPARENCY: 'set-transparency',
    GET_TRANSPARENCY_STATUS: 'get-transparency-status',
    UPDATE_CHECK_STARTUP: 'update-check-on-startup',
    UPDATE_CHECK_USER: 'update-check-userrequest',
    UPDATE_DOWNLOAD_START: 'update-download-start',
    UPDATE_DOWNLOAD_PROGRESS: 'update-download-progress',
    UPDATE_DOWNLOAD_COMPLETE: 'update-download-complete',
    UPDATE_INSTALL_START: 'update-install-start',
    UPDATE_INSTALL_COMPLETE: 'update-install-complete',
    UPDATE_RESTART_APP: 'update-restart-app',
    UPDATE_ERROR: 'update-error',
    FULLSCREEN_CHANGED: 'fullscreen-changed',
    LAUNCH_EXTERNAL_PLAYER: 'launch-external-player',
    DETECT_PLAYER: 'detect-player',
    BROWSE_PLAYER_PATH: 'browse-player-path',
    // Player enhancement IPC channels
    SAVE_SCREENSHOT: 'save-screenshot',
    SCREENSHOT_SAVED: 'screenshot-saved',
} as const;

// External player options
export const EXTERNAL_PLAYERS = {
    BUILTIN: 'builtin',
    VLC: 'vlc',
    MPCHC: 'mpchc',
} as const;

// File extensions for mods
export const FILE_EXTENSIONS = {
    THEME: '.theme.css',
    PLUGIN: '.plugin.js',
} as const;

// URLs
export const URLS = {
    STREMIO_WEB: 'https://web.stremio.com/',
    REGISTRY: 'https://raw.githubusercontent.com/REVENGE977/stremio-enhanced-registry/main/registry.json',
    VERSION_CHECK: 'https://github.com/Bo0ii/StreamGo/raw/main/version',
    RELEASES_API: 'https://api.github.com/repos/Bo0ii/StreamGo/releases/latest',
    RELEASES_PAGE: 'https://github.com/Bo0ii/StreamGo/releases/latest',
} as const;

// server.js (Stremio streaming server) Download URL
export const SERVER_JS_URL = "https://dl.strem.io/server/v4.20.12/desktop/server.js";

// FFmpeg Download URLs
export const FFMPEG_URLS = {
    win32: {
        x64: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
        arm64: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip",
    },
    darwin: {
        x64: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1766437297_8.0.1/ffmpeg.zip",
        arm64: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1766430132_8.0.1/ffmpeg.zip",
    },
    linux: {
        x64: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
        arm64: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
    },
} as const;

// FFprobe Download URLs for macOS
export const MACOS_FFPROBE_URLS = {
    x64: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1766437297_8.0.1/ffprobe.zip",
    arm64: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1766430132_8.0.1/ffprobe.zip",
};

// Discord RPC
export const DISCORD = {
    CLIENT_ID: '1200186750727893164',
    RECONNECT_INTERVAL: 10000,
    DEFAULT_IMAGE: '1024stremio',
} as const;

// Timeouts
export const TIMEOUTS = {
    ELEMENT_WAIT: 10000,
    INSTALL_COMPLETION: 120000,
    SERVICE_CHECK_INTERVAL: 5000,
    SERVER_RELOAD_DELAY: 1500,
    DISCORDRPC_RETRY_INTERVAL: 1000,
    DISCORDRPC_MAX_RETRIES: 30,
    // Player overlay timeouts
    OVERLAY_HIDE_DELAY: 3000,
    POSITION_SAVE_INTERVAL: 30000,
    AMBILIGHT_SAMPLE_INTERVAL: 66, // ~15fps
    // UI polling intervals
    BUTTON_CHECK_INTERVAL: 300,
    BUTTON_CHECK_MAX_WAIT: 10000,
    NAVIGATION_DEBOUNCE: 100,
    ICON_RETRY_DELAY: 100,
    ICON_MUTATION_DEBOUNCE: 50,
    SCROLL_STATE_DELAY: 200,
} as const;

// Default values for player settings
export const PLAYER_DEFAULTS = {
    SKIP_INTRO_SECONDS: 85,
    PLAYBACK_SPEED: 1,
    SUBTITLE_FONT_SIZE: 24,
    SUBTITLE_COLOR: '#ffffff',
    SUBTITLE_BG_COLOR: 'rgba(0,0,0,0.8)',
    // Video filter defaults (0 = no effect, range varies per filter)
    VIDEO_FILTER_SHARPNESS: 0,      // Range: 0-100
    VIDEO_FILTER_BRIGHTNESS: 100,   // Range: 50-150 (100 = normal)
    VIDEO_FILTER_CONTRAST: 100,     // Range: 50-150 (100 = normal)
    VIDEO_FILTER_SATURATION: 100,   // Range: 0-200 (100 = normal)
    VIDEO_FILTER_TEMPERATURE: 0,    // Range: -100 to 100 (0 = neutral)
} as const;

// Playback speed options
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
