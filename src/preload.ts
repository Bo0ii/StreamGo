import { ipcRenderer } from "electron";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import Settings from "./core/Settings";
import properties from "./core/Properties";
import ModManager from "./core/ModManager";
import Helpers from "./utils/Helpers";
import Updater from "./core/Updater";
import DiscordPresence from "./utils/DiscordPresence";
import { getModsTabTemplate } from "./components/mods-tab/modsTab";
import { getModItemTemplate } from "./components/mods-item/modsItem";
import { getAboutCategoryTemplate } from "./components/about-category/aboutCategory";
import { applyUserAppearance, writeAppearance, setupAppearanceControls } from "./components/appearance-category/appearanceCategory";
import { getTweaksIcon, writeTweaks, setupTweaksControls, applyTweaks, initPerformanceMode } from "./components/tweaks-category/tweaksCategory";
import { writeStreamingPerformance, setupStreamingPerformanceControls } from "./components/streaming-performance/streamingPerformance";
// NOTE: Theme UI removed - liquid-glass is locked
// import { getDefaultThemeTemplate } from "./components/default-theme/defaultTheme";
import { getBackButton } from "./components/back-btn/backBtn";
import { getTitleBarTemplate } from "./components/title-bar/titleBar";
import { initPlayerOverlay, cleanupPlayerOverlay } from "./components/player-overlay/playerOverlay";
import { initVideoFilter, cleanupVideoFilter } from "./components/video-filter/videoFilter";
import logger from "./utils/logger";
import { join, dirname } from "path";
import { pathToFileURL } from "url";
import {
    STORAGE_KEYS,
    SELECTORS,
    CLASSES,
    IPC_CHANNELS,
    FILE_EXTENSIONS,
    TIMEOUTS,
    EXTERNAL_PLAYERS,
    PLAYER_DEFAULTS
} from "./constants";

// ============================================
// UNIFIED MUTATION OBSERVER SYSTEM
// Consolidates multiple observers into one for better performance
// ============================================
interface ObserverHandler {
    id: string;
    callback: (mutations: MutationRecord[]) => void;
    active: boolean;
    filter?: (mutation: MutationRecord) => boolean; // Optional filter to reduce callback frequency
}

const observerHandlers: Map<string, ObserverHandler> = new Map();
let unifiedObserver: MutationObserver | null = null;
let observerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMutations: MutationRecord[] = [];

// Initialization state flags to prevent duplicate initialization
let settingsInitialized = false;
let pluginsLoaded = false;

// Debounce interval for mutation observer (ms) - reduces CPU by batching rapid mutations
const OBSERVER_DEBOUNCE_MS = 100;

// Check if performance mode is enabled (skip observer processing)
function isPerformanceModeActive(): boolean {
    return document.body.classList.contains('performance-mode-enabled');
}

// Filter out mutations that are unlikely to be relevant to any handler
function isRelevantMutation(mutation: MutationRecord): boolean {
    // Skip text node changes
    if (mutation.type === 'characterData') return false;

    // Skip mutations inside video/canvas elements (player internals)
    const target = mutation.target as Element;
    if (target.tagName === 'VIDEO' || target.tagName === 'CANVAS') return false;
    if (target.closest?.('video, canvas, .video-player')) return false;

    // Skip style-only mutations (already handled by CSS)
    if (mutation.type === 'attributes' && mutation.attributeName === 'style') return false;

    // For childList mutations, check if anything meaningful was added
    if (mutation.type === 'childList') {
        // Skip if only text nodes were added/removed
        const hasElementNodes = Array.from(mutation.addedNodes).some(
            node => node.nodeType === Node.ELEMENT_NODE
        ) || Array.from(mutation.removedNodes).some(
            node => node.nodeType === Node.ELEMENT_NODE
        );
        if (!hasElementNodes) return false;
    }

    return true;
}

function initUnifiedObserver(): void {
    if (unifiedObserver) return;

    unifiedObserver = new MutationObserver((mutations) => {
        // Skip processing entirely in performance mode
        if (isPerformanceModeActive()) return;

        // Filter to only relevant mutations
        const relevantMutations = mutations.filter(isRelevantMutation);
        if (relevantMutations.length === 0) return;

        // Accumulate mutations for debouncing
        pendingMutations.push(...relevantMutations);

        // Debounce: wait for mutations to settle before processing
        if (observerDebounceTimer) clearTimeout(observerDebounceTimer);

        observerDebounceTimer = setTimeout(() => {
            const mutationsToProcess = pendingMutations;
            pendingMutations = [];
            observerDebounceTimer = null;

            // Skip if no active handlers
            if (observerHandlers.size === 0) return;

            // Process on next animation frame for smoothness
            requestAnimationFrame(() => {
                observerHandlers.forEach(handler => {
                    if (!handler.active) return;

                    try {
                        // If handler has a filter, only pass matching mutations
                        const filteredMutations = handler.filter
                            ? mutationsToProcess.filter(handler.filter)
                            : mutationsToProcess;

                        if (filteredMutations.length > 0) {
                            handler.callback(filteredMutations);
                        }
                    } catch (e) {
                        logger.error(`Observer handler ${handler.id} error: ${e}`);
                    }
                });
            });
        }, OBSERVER_DEBOUNCE_MS);
    });

    unifiedObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
    });

    logger.info("Unified MutationObserver initialized with debouncing");
}

function registerObserverHandler(
    id: string,
    callback: (mutations: MutationRecord[]) => void,
    filter?: (mutation: MutationRecord) => boolean
): void {
    initUnifiedObserver();
    observerHandlers.set(id, { id, callback, active: true, filter });
    logger.info(`Observer handler registered: ${id}`);
}

function unregisterObserverHandler(id: string): void {
    observerHandlers.delete(id);
    logger.info(`Observer handler unregistered: ${id}`);

    if (observerHandlers.size === 0 && unifiedObserver) {
        unifiedObserver.disconnect();
        unifiedObserver = null;
        logger.info("Unified MutationObserver disconnected (no handlers)");
    }
}

function setObserverHandlerActive(id: string, active: boolean): void {
    const handler = observerHandlers.get(id);
    if (handler) {
        handler.active = active;
    }
}


// ============================================
// ASYNC FILE SYSTEM UTILITIES WITH CACHING
// ============================================
interface ModListCache {
    themes: string[] | null;
    plugins: string[] | null;
    lastUpdate: number;
}

const modCache: ModListCache = {
    themes: null,
    plugins: null,
    lastUpdate: 0
};

const CACHE_TTL = 5000; // 5 seconds cache

async function getModListsAsync(): Promise<{ themes: string[], plugins: string[] }> {
    const now = Date.now();
    if (modCache.themes && modCache.plugins && (now - modCache.lastUpdate) < CACHE_TTL) {
        return { themes: modCache.themes, plugins: modCache.plugins };
    }

    const [userThemes, bundledThemes, userPlugins, bundledPlugins] = await Promise.all([
        existsSync(properties.themesPath)
            ? readdir(properties.themesPath).then(files => files.filter(f => f.endsWith(FILE_EXTENSIONS.THEME)))
            : Promise.resolve([]),
        existsSync(properties.bundledThemesPath)
            ? readdir(properties.bundledThemesPath).then(files => files.filter(f => f.endsWith(FILE_EXTENSIONS.THEME)))
            : Promise.resolve([]),
        existsSync(properties.pluginsPath)
            ? readdir(properties.pluginsPath).then(files => files.filter(f => f.endsWith(FILE_EXTENSIONS.PLUGIN)))
            : Promise.resolve([]),
        existsSync(properties.bundledPluginsPath)
            ? readdir(properties.bundledPluginsPath).then(files => files.filter(f => f.endsWith(FILE_EXTENSIONS.PLUGIN)))
            : Promise.resolve([])
    ]);

    modCache.themes = [...new Set([...userThemes, ...bundledThemes])];
    modCache.plugins = [...new Set([...userPlugins, ...bundledPlugins])];
    modCache.lastUpdate = now;

    return { themes: modCache.themes, plugins: modCache.plugins };
}


// ============================================
// EVENT LISTENER CLEANUP REGISTRY
// Prevents accumulation of duplicate event listeners
// ============================================
const eventCleanupRegistry = new Map<string, Array<() => void>>();

function registerEventCleanup(context: string, cleanup: () => void): void {
    if (!eventCleanupRegistry.has(context)) {
        eventCleanupRegistry.set(context, []);
    }
    eventCleanupRegistry.get(context)!.push(cleanup);
}

function runEventCleanups(context: string): void {
    const cleanups = eventCleanupRegistry.get(context);
    if (cleanups) {
        cleanups.forEach(fn => {
            try {
                fn();
            } catch (e) {
                logger.error(`Event cleanup error in ${context}: ${e}`);
            }
        });
        eventCleanupRegistry.delete(context);
    }
}

// ============================================
// ELEMENT WAIT UTILITY WITH EXPONENTIAL BACKOFF
// More efficient than setInterval polling
// ============================================
function waitForElementWithBackoff(selector: string, maxAttempts = 5): Promise<Element | null> {
    return new Promise((resolve) => {
        let attempts = 0;
        const delays = [50, 100, 200, 400, 800]; // Exponential backoff

        const check = () => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(check, delays[Math.min(attempts, delays.length - 1)]);
                attempts++;
            } else {
                resolve(null);
            }
        };

        check();
    });
}

// Cache transparency status to avoid repeated IPC calls
let transparencyStatusCache: boolean | null = null;

async function getTransparencyStatus(): Promise<boolean> {
    if (transparencyStatusCache === null) {
        transparencyStatusCache = await ipcRenderer.invoke(IPC_CHANNELS.GET_TRANSPARENCY_STATUS) as boolean;
    }
    return transparencyStatusCache ?? false;
}

// Apply theme immediately when DOM is ready (prevents FOUC)
function applyThemeEarly(): void {
    // Initialize settings first to ensure default theme is set
    initializeUserSettings();
    
    // Function to inject theme with retry mechanism
    let retryCount = 0;
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 50; // 50ms between retries
    
    const injectThemeNow = (): boolean => {
        if (!document.head) {
            return false; // Head not available yet
        }
        
        try {
            applyUserTheme();
            // Verify theme was actually applied
            const themeElement = document.getElementById("activeTheme");
            if (themeElement) {
                logger.info("Theme applied early successfully");
                return true; // Successfully applied
            }
            return false; // Theme element not found, need to retry
        } catch (error) {
            logger.error(`Failed to apply theme early (attempt ${retryCount + 1}): ${error}`);
            return false;
        }
    };
    
    // Function to retry theme injection with exponential backoff
    const retryThemeInjection = (): void => {
        if (retryCount >= MAX_RETRIES) {
            logger.warn("Max retries reached for early theme application, will retry on DOMContentLoaded");
            return;
        }
        
        retryCount++;
        if (!injectThemeNow()) {
            setTimeout(retryThemeInjection, RETRY_DELAY * retryCount);
        }
    };
    
    // Strategy 1: If document is already ready, inject immediately
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        if (!injectThemeNow()) {
            // If head doesn't exist yet, use requestAnimationFrame as fallback
            requestAnimationFrame(() => {
                if (!injectThemeNow()) {
                    setTimeout(retryThemeInjection, 0);
                }
            });
        }
        return;
    }
    
    // Strategy 2: Wait for DOMContentLoaded (fires before 'load' event)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!injectThemeNow()) {
                // Retry with exponential backoff
                setTimeout(retryThemeInjection, 0);
            }
        }, { once: true });
        return;
    }
    
    // Strategy 3: Last resort - try immediately and retry if needed
    if (!injectThemeNow()) {
        requestAnimationFrame(() => {
            if (!injectThemeNow()) {
                setTimeout(retryThemeInjection, 0);
            }
        });
    }
}

// Apply theme as early as possible to prevent FOUC
// Run immediately when preload script executes (runs before page loads)
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    applyThemeEarly();
} else {
    // If document/window not available, wait for it
    if (typeof window !== 'undefined') {
        window.addEventListener('load', () => {
            applyThemeEarly();
        }, { once: true });
    }
}

// Initialize core functionality as soon as DOM is ready (faster than window.load)
function initializeCoreFeatures(): void {
    // Initialize user settings first (needed for theme and plugins) - only once
    if (!settingsInitialized) {
        initializeUserSettings();
        settingsInitialized = true;
    }

    // Apply theme immediately if not already applied
    if (!document.getElementById("activeTheme")) {
        applyUserTheme();
    } else {
        // Ensure theme position is correct even if already applied
        refreshThemePosition();
    }

    // Apply user appearance settings (accent color, dark mode) - synchronous
    applyUserAppearance();

    // Apply UI tweaks - synchronous
    applyTweaks();

    // Initialize performance mode (applies body class based on saved preference)
    initPerformanceMode();

    // Load enabled plugins asynchronously (non-blocking) - only once
    if (!pluginsLoaded) {
        pluginsLoaded = true;
        loadEnabledPlugins().catch(err => {
            logger.error(`Failed to load plugins during core initialization: ${err}`);
            pluginsLoaded = false; // Allow retry on failure
        });
    }
}

// Use DOMContentLoaded for faster initialization (fires before window.load)
// This ensures themes and plugins load as soon as DOM is ready, not waiting for all resources
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCoreFeatures, { once: true });
} else {
    // DOM is already ready, initialize immediately
    initializeCoreFeatures();
}

window.addEventListener("load", async () => {
    // Inject performance CSS to force GPU acceleration on transitions
    injectPerformanceCSS();

    // Setup global video interception for external player (must be early!)
    setupGlobalVideoInterception();

    // Setup quick resume for Continue Watching
    setupQuickResume();

    // Reload server configuration
    reloadServer();

    const checkUpdates = localStorage.getItem(STORAGE_KEYS.CHECK_UPDATES_ON_STARTUP);
    if (checkUpdates === "true") {
        await Updater.checkForUpdates(false);
    }
    
    // Initialize Discord Rich Presence if enabled
    const discordRpcEnabled = localStorage.getItem(STORAGE_KEYS.DISCORD_RPC);
    if (discordRpcEnabled === "true") {
        DiscordPresence.start();
        await DiscordPresence.discordRPCHandler();
    }

    // Ensure theme is still applied (backup check) - retry if not found
    if (!document.getElementById("activeTheme")) {
        logger.warn("Theme not found on window.load, retrying application...");
        applyUserTheme();
    }

    // Move theme to end of head to ensure it overrides Stremio's CSS (fixes CSS priority)
    refreshThemePosition();

    // Retry applying appearance and tweaks as fallback (in case Stremio's DOM changed)
    applyUserAppearance();
    applyTweaks();
    initPerformanceMode();

    // Verify plugins were loaded, retry if not (fallback for early load failures)
    const enabledPlugins = JSON.parse(localStorage.getItem(STORAGE_KEYS.ENABLED_PLUGINS) || "[]");
    const loadedPlugins = enabledPlugins.filter((plugin: string) => document.getElementById(plugin) !== null);
    if (loadedPlugins.length < enabledPlugins.length) {
        logger.warn(`Only ${loadedPlugins.length}/${enabledPlugins.length} plugins loaded, retrying...`);
        loadEnabledPlugins().catch(err => {
            logger.error(`Failed to load plugins on window.load fallback: ${err}`);
        });
    }

    // Inject app icon in glass theme
    injectAppIconInGlassTheme();

    // Inject custom logo on intro/login pages
    injectIntroLogo();

    // Get transparency status once and reuse
    const isTransparencyEnabled = await getTransparencyStatus();

    // Handle fullscreen changes for title bar
    ipcRenderer.on(IPC_CHANNELS.FULLSCREEN_CHANGED, (_, isFullscreen: boolean) => {
        const titleBar = document.querySelector('.title-bar') as HTMLElement;
        if (titleBar) {
            titleBar.style.display = isFullscreen ? 'none' : 'flex';
        }
    });

    // Set up title bar observer for transparent themes using unified observer
    if (isTransparencyEnabled) {
        registerObserverHandler('title-bar', () => {
            addTitleBar();
        });
        addTitleBar();
    }

    // Handle navigation changes
    window.addEventListener("hashchange", async () => {
        if (isTransparencyEnabled) {
            addTitleBar();
        }

        // Handle external player interception when navigating to player
        if (location.href.includes('#/player')) {
            logger.info("[Navigation] Detected player route - checking external player setting...");
            const savedPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);
            logger.info(`[Navigation] External player setting: "${savedPlayer}"`);
            await handleExternalPlayerInterception();

            // Initialize player overlay (only if using built-in player)
            if (!savedPlayer || savedPlayer === EXTERNAL_PLAYERS.BUILTIN || savedPlayer === 'm3u') {
                initPlayerOverlay();
                initVideoFilter();
            }

            // Save stream info for Quick Resume (Continue Watching)
            saveCurrentStreamInfo();
        } else {
            // Cleanup player overlay and video filter when leaving player page
            cleanupPlayerOverlay();
            cleanupVideoFilter();

            // Reset external player flag if stuck (safety mechanism)
            if (isHandlingExternalPlayer) {
                logger.warn("[ExternalPlayer] Resetting stuck flag on navigation away from player");
                isHandlingExternalPlayer = false;
                document.body.classList.remove('external-player-active');
            }
        }

        // Reinject icon on navigation (in case theme is active)
        // Use setTimeout to ensure DOM has updated after navigation
        setTimeout(() => {
            injectAppIconInGlassTheme();
            injectIntroLogo();
        }, TIMEOUTS.NAVIGATION_DEBOUNCE);

        // Clean up event listeners when leaving settings
        if (!location.href.includes("#/settings")) {
            runEventCleanups('external-player-menu');
            return;
        }

        // Check if settings sections already exist (prevents duplicate creation)
        // NOTE: This only guards section creation - handlers are ALWAYS re-attached
        // because DOM elements may be recreated when navigating back to settings
        const sectionsAlreadyExist = !!document.querySelector(`a[href="#settings-enhanced"]`);

        // Always ensure applyTheme is available (safe to call multiple times)
        ModManager.addApplyThemeFunction();

        // Only create sections if they don't exist yet
        if (!sectionsAlreadyExist) {
            // Get plugins asynchronously (non-blocking)
            const modLists = await getModListsAsync();
            const themesList = modLists.themes;
            const pluginsList = modLists.plugins;

            logger.info("Adding 'Plus' sections...");
            Settings.addSection("enhanced", "Plus");
            Settings.addCategory("Themes", "enhanced", getThemeIcon());
            Settings.addCategory("Plugins", "enhanced", getPluginIcon());
            Settings.addCategory("Tweaks", "enhanced", getTweaksIcon());
            Settings.addCategory("About", "enhanced", getAboutIcon());

            Settings.addButton("Open Themes Folder", "openthemesfolderBtn", SELECTORS.THEMES_CATEGORY);
            Settings.addButton("Open Plugins Folder", "openpluginsfolderBtn", SELECTORS.PLUGINS_CATEGORY);

            writeAbout();
            writeAppearance();
            writeTweaks();
            writeStreamingPerformance();

            // Add themes to settings (liquid-glass is locked and can't be removed)
            const LOCKED_THEME = "liquid-glass.theme.css";
            themesList.forEach(theme => {
                // Check user path first, then bundled path
                const userPath = join(properties.themesPath, theme);
                const bundledPath = join(properties.bundledThemesPath, theme);
                const themePath = existsSync(userPath) ? userPath : bundledPath;

                const metaData = Helpers.extractMetadataFromFile(themePath);
                if (metaData && metaData.name && metaData.description && metaData.author && metaData.version) {
                    // Add locked flag for the glass theme
                    const isLocked = theme === LOCKED_THEME;
                    Settings.addItem("theme", theme, {
                        name: metaData.name,
                        description: metaData.description,
                        author: metaData.author,
                        version: metaData.version,
                        updateUrl: metaData.updateUrl,
                        locked: isLocked
                    });
                }
            });

            // Add plugins to settings grouped by author
            interface PluginData {
                fileName: string;
                metaData: {
                    name: string;
                    description: string;
                    author: string;
                    version: string;
                    updateUrl?: string;
                    source?: string;
                };
            }

            // Group plugins by author category (Bo0ii vs Revenge977/others)
            const bo0iiPlugins: PluginData[] = [];
            const revenge977Plugins: PluginData[] = [];

            pluginsList.forEach(plugin => {
                // Check user path first, then bundled path
                const userPath = join(properties.pluginsPath, plugin);
                const bundledPath = join(properties.bundledPluginsPath, plugin);
                const pluginPath = existsSync(userPath) ? userPath : bundledPath;

                const metaData = Helpers.extractMetadataFromFile(pluginPath);
                if (metaData && metaData.name && metaData.description && metaData.author && metaData.version) {
                    const pluginData: PluginData = {
                        fileName: plugin,
                        metaData: {
                            name: metaData.name,
                            description: metaData.description,
                            author: metaData.author,
                            version: metaData.version,
                            updateUrl: metaData.updateUrl,
                            source: metaData.source
                        }
                    };

                    // Categorize: Bo0ii's plugins vs everyone else (Revenge977's category)
                    const authorLower = metaData.author.toLowerCase();
                    if (authorLower === 'bo0ii') {
                        bo0iiPlugins.push(pluginData);
                    } else {
                        revenge977Plugins.push(pluginData);
                    }
                }
            });

            // Create plugin category sections
            Helpers.waitForElm(SELECTORS.PLUGINS_CATEGORY).then(() => {
                const pluginsCategory = document.querySelector(SELECTORS.PLUGINS_CATEGORY);
                if (!pluginsCategory) return;

                // Create Bo0ii (Exclusive) section
                if (bo0iiPlugins.length > 0) {
                    const bo0iiSection = createPluginGroupSection('Bo0ii (Exclusive)', 'Exclusive plugins by Bo0ii', 'bo0ii-plugins');
                    pluginsCategory.appendChild(bo0iiSection);
                    bo0iiPlugins.forEach(plugin => {
                        Settings.addPluginToGroup(plugin.fileName, plugin.metaData, 'bo0ii-plugins');
                    });
                }

                // Create Revenge977 section (includes all non-Bo0ii plugins)
                if (revenge977Plugins.length > 0) {
                    const revenge977Section = createPluginGroupSection('Revenge 9.7.7 and Community', 'Plugins by Revenge 9.7.7 and Community', 'revenge977-plugins');
                    pluginsCategory.appendChild(revenge977Section);
                    revenge977Plugins.forEach(plugin => {
                        Settings.addPluginToGroup(plugin.fileName, plugin.metaData, 'revenge977-plugins');
                    });
                }

                // Setup collapsible handlers for plugin groups (called here for initial setup)
                setupPluginGroupHandlers();
            }).catch(err => logger.error("Failed to setup plugins: " + err));
        }

        // ALWAYS inject styles and setup handlers on every settings visit
        // These functions are idempotent (check for existing styles/handlers internally)
        // This ensures handlers are re-attached when DOM is recreated after navigation
        injectCollapsibleStyles();
        injectAboutSectionStyles();
        injectPluginGroupStyles();

        // Setup collapsible handlers - ALWAYS called to re-attach handlers after navigation
        // The handler functions check for data-*-handler attributes to avoid duplicates
        setupCollapsibleHandlers();
        setupPluginGroupHandlers();

        // Browse plugins/themes from StreamGo registry
        setupBrowseModsButton();

        // Check for updates button
        setupCheckUpdatesButton();

        // CheckForUpdatesOnStartup toggle
        setupCheckUpdatesOnStartupToggle();

        // Discord Rich Presence toggle
        setupDiscordRpcToggle();

        // Enable transparency toggle
        setupTransparencyToggle();

        // Appearance customization controls
        setupAppearanceControls();

        // Tweaks controls (includes player settings)
        setupTweaksControls();

        // Streaming performance controls
        setupStreamingPerformanceControls();

        // Inject external player options into Stremio's native Player settings
        injectExternalPlayerOptions();

        // Setup custom player path in About section
        setupCustomPlayerPath();

        // ModManager listeners - safe to call multiple times
        ModManager.togglePluginListener();
        ModManager.scrollListener();
        ModManager.openThemesFolder();
        ModManager.openPluginsFolder();
    });
});

function reloadServer(): void {
    setTimeout(() => {
        Helpers._eval(`core.transport.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } });`);
        logger.info("Stremio streaming server reloaded.");
    }, TIMEOUTS.SERVER_RELOAD_DELAY);
}

function initializeUserSettings(): void {
    // Note: ENABLED_PLUGINS is intentionally NOT set here.
    // loadEnabledPlugins() handles first-run detection and enables bundled plugins.
    // Setting it here would interfere with proper first-run detection.
    const defaults: Record<string, string> = {
        [STORAGE_KEYS.CHECK_UPDATES_ON_STARTUP]: "true",
        [STORAGE_KEYS.DISCORD_RPC]: "false",
        [STORAGE_KEYS.EXTERNAL_PLAYER]: EXTERNAL_PLAYERS.BUILTIN,
        [STORAGE_KEYS.EXTERNAL_PLAYER_PATH]: "",
        [STORAGE_KEYS.ACCENT_COLOR]: "",
        [STORAGE_KEYS.DARK_MODE]: "false",
        [STORAGE_KEYS.FULL_HEIGHT_BACKGROUND]: "true",
        [STORAGE_KEYS.HIDE_POSTER_HOVER]: "true",
        [STORAGE_KEYS.HIDE_CONTEXT_DOTS]: "true",
        [STORAGE_KEYS.ROUNDED_POSTERS]: "true",
        // Player enhancement defaults
        [STORAGE_KEYS.PLAYBACK_SPEED]: PLAYER_DEFAULTS.PLAYBACK_SPEED.toString(),
        [STORAGE_KEYS.SKIP_INTRO_SECONDS]: PLAYER_DEFAULTS.SKIP_INTRO_SECONDS.toString(),
        [STORAGE_KEYS.SUBTITLE_DELAY]: "0",
        [STORAGE_KEYS.SUBTITLE_FONT_SIZE]: PLAYER_DEFAULTS.SUBTITLE_FONT_SIZE.toString(),
        [STORAGE_KEYS.SUBTITLE_COLOR]: PLAYER_DEFAULTS.SUBTITLE_COLOR,
        [STORAGE_KEYS.SUBTITLE_BG_COLOR]: PLAYER_DEFAULTS.SUBTITLE_BG_COLOR,
        [STORAGE_KEYS.SAVED_POSITIONS]: "{}",
        [STORAGE_KEYS.AMBILIGHT_ENABLED]: "false",
        [STORAGE_KEYS.PLAYER_OVERLAY_ENABLED]: "true",
        // Video filter defaults
        [STORAGE_KEYS.VIDEO_FILTER_SHARPNESS]: PLAYER_DEFAULTS.VIDEO_FILTER_SHARPNESS.toString(),
        [STORAGE_KEYS.VIDEO_FILTER_BRIGHTNESS]: PLAYER_DEFAULTS.VIDEO_FILTER_BRIGHTNESS.toString(),
        [STORAGE_KEYS.VIDEO_FILTER_CONTRAST]: PLAYER_DEFAULTS.VIDEO_FILTER_CONTRAST.toString(),
        [STORAGE_KEYS.VIDEO_FILTER_SATURATION]: PLAYER_DEFAULTS.VIDEO_FILTER_SATURATION.toString(),
        [STORAGE_KEYS.VIDEO_FILTER_TEMPERATURE]: PLAYER_DEFAULTS.VIDEO_FILTER_TEMPERATURE.toString(),
        [STORAGE_KEYS.VIDEO_FILTER_ENABLED]: "true",
    };

    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (!localStorage.getItem(key)) {
            localStorage.setItem(key, defaultValue);
        }
    }
}

function applyUserTheme(): void {
    // Ensure document.head exists before proceeding
    if (!document.head) {
        // If head doesn't exist yet, wait for it
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyUserTheme);
        } else {
            // Use requestAnimationFrame as fallback
            requestAnimationFrame(applyUserTheme);
        }
        return;
    }

    // LOCKED: Always use liquid-glass theme - it's the core StreamGo experience
    const LOCKED_THEME = "liquid-glass.theme.css";
    const currentTheme = LOCKED_THEME;

    // Ensure localStorage reflects the locked theme
    localStorage.setItem(STORAGE_KEYS.CURRENT_THEME, LOCKED_THEME);

    // Check user path first, then bundled path
    const userThemePath = join(properties.themesPath, currentTheme);
    const bundledThemePath = join(properties.bundledThemesPath, currentTheme);
    const themePath = existsSync(userThemePath) ? userThemePath : bundledThemePath;

    if (!existsSync(themePath)) {
        logger.warn(`Theme file not found: ${currentTheme} (checked: ${userThemePath} and ${bundledThemePath})`);
        localStorage.setItem(STORAGE_KEYS.CURRENT_THEME, "Default");
        return;
    }

    // Check if theme is already applied to avoid duplicate injection
    const existingTheme = document.getElementById("activeTheme") as HTMLLinkElement;
    if (existingTheme && existingTheme.href === pathToFileURL(themePath).toString()) {
        return; // Theme is already applied
    }

    // Remove existing theme if present
    existingTheme?.remove();

    // Create and inject theme link immediately
    const themeElement = document.createElement('link');
    themeElement.setAttribute("id", "activeTheme");
    themeElement.setAttribute("rel", "stylesheet");
    themeElement.setAttribute("href", pathToFileURL(themePath).toString());
    
    // Make the theme load as early as possible by inserting it at the beginning of head
    // This ensures it loads before other stylesheets and before page render
    const firstChild = document.head.firstChild;
    if (firstChild) {
        document.head.insertBefore(themeElement, firstChild);
    } else {
        document.head.appendChild(themeElement);
    }
    
    // Accessing href triggers immediate loading of the stylesheet
    void themeElement.href;
    
    logger.info(`Theme applied early: ${currentTheme} from ${themePath}`);
}

/**
 * Move the theme stylesheet to the end of <head> to ensure it overrides Stremio's CSS.
 * This fixes the issue where Stremio's styles load after the theme on cold start.
 */
function refreshThemePosition(): void {
    const themeElement = document.getElementById("activeTheme") as HTMLLinkElement;
    if (!themeElement) return;

    // Store the href before removing
    const href = themeElement.href;

    // Remove from current position
    themeElement.remove();

    // Create a fresh link element and append to end of head
    const newThemeElement = document.createElement('link');
    newThemeElement.id = "activeTheme";
    newThemeElement.rel = "stylesheet";
    newThemeElement.href = href;

    // Append to end of head (highest CSS priority)
    document.head.appendChild(newThemeElement);

    logger.info("Theme position refreshed - moved to end of head for CSS priority");
}

async function loadEnabledPlugins(): Promise<void> {
    try {
        // Get plugins asynchronously (non-blocking)
        const modLists = await getModListsAsync();
        const pluginsToLoad = modLists.plugins;

        // Get bundled plugins for first run detection
        const bundledPlugins = existsSync(properties.bundledPluginsPath)
            ? await readdir(properties.bundledPluginsPath).then(files => files.filter(f => f.endsWith(FILE_EXTENSIONS.PLUGIN)))
            : [];

        logger.info(`Found ${bundledPlugins.length} bundled plugins, ${pluginsToLoad.length} total plugins available`);

        // Check if this is first run (no plugins configured yet)
        // Parse stored plugins robustly - handle null, empty string, empty array, or malformed JSON
        const storedPlugins = localStorage.getItem(STORAGE_KEYS.ENABLED_PLUGINS);
        let enabledPlugins: string[];
        let isFirstRun = false;

        try {
            enabledPlugins = storedPlugins ? JSON.parse(storedPlugins) : [];
            // Consider it first run if the stored value was null/undefined or an empty array
            isFirstRun = !storedPlugins || (Array.isArray(enabledPlugins) && enabledPlugins.length === 0);
        } catch {
            // Malformed JSON - treat as first run
            enabledPlugins = [];
            isFirstRun = true;
            logger.warn("Malformed ENABLED_PLUGINS in localStorage, resetting to defaults");
        }

        if (isFirstRun && bundledPlugins.length > 0) {
            // First run - enable all bundled plugins by default
            enabledPlugins = [...bundledPlugins];
            localStorage.setItem(STORAGE_KEYS.ENABLED_PLUGINS, JSON.stringify(enabledPlugins));
            logger.info(`First run: enabling ${enabledPlugins.length} bundled plugins by default`);
        } else if (isFirstRun) {
            logger.warn("First run but no bundled plugins found - plugins may not load correctly");
        }

        // Always ensure card-hover-info.plugin.js is enabled
        const cardHoverPlugin = "card-hover-info.plugin.js";
        if (pluginsToLoad.includes(cardHoverPlugin) && !enabledPlugins.includes(cardHoverPlugin)) {
            enabledPlugins.push(cardHoverPlugin);
            localStorage.setItem(STORAGE_KEYS.ENABLED_PLUGINS, JSON.stringify(enabledPlugins));
            logger.info("Auto-enabled card-hover-info.plugin.js as default");
        }

        // Load plugins asynchronously without blocking - use Promise.allSettled to handle errors gracefully
        const loadPromises = pluginsToLoad
            .filter(plugin => enabledPlugins.includes(plugin))
            .map(plugin => 
                ModManager.loadPlugin(plugin).catch(err => {
                    logger.error(`Failed to load plugin ${plugin}: ${err}`);
                    return null; // Continue loading other plugins even if one fails
                })
            );

        // Wait for all plugins to load (or fail gracefully)
        await Promise.allSettled(loadPromises);
        logger.info(`Plugin loading completed. Attempted to load ${loadPromises.length} plugins.`);
    } catch (error) {
        logger.error(`Failed to load enabled plugins: ${error}`);
        // Don't throw - allow the app to continue even if plugin loading fails
    }
}

async function browseMods(): Promise<void> {
    const settingsContent = document.querySelector(SELECTORS.SETTINGS_CONTENT);
    if (!settingsContent) return;

    settingsContent.innerHTML = getModsTabTemplate();

    const mods = await ModManager.fetchMods();
    const modsList = document.getElementById("mods-list");
    if (!modsList) return;

    interface RegistryMod {
        name: string;
        description: string;
        author: string;
        version: string;
        preview?: string;
        download: string;
        repo: string;
    }

    // Use DocumentFragment for efficient batch DOM insertion (90%+ faster than innerHTML +=)
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');

    // Add plugins
    (mods.plugins as RegistryMod[]).forEach((plugin) => {
        const installed = ModManager.isPluginInstalled(Helpers.getFileNameFromUrl(plugin.download));
        tempDiv.innerHTML = getModItemTemplate(plugin, "Plugin", installed);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }
    });

    // Add themes
    (mods.themes as RegistryMod[]).forEach((theme) => {
        const installed = ModManager.isThemeInstalled(Helpers.getFileNameFromUrl(theme.download));
        tempDiv.innerHTML = getModItemTemplate(theme, "Theme", installed);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }
    });

    // Single DOM insertion - much faster than N separate innerHTML += operations
    modsList.appendChild(fragment);

    // Set up action buttons
    const actionBtns = document.querySelectorAll(".modActionBtn");
    actionBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const link = btn.getAttribute("data-link");
            const type = btn.getAttribute("data-type")?.toLowerCase() as "plugin" | "theme";

            if (!link || !type) return;

            if (btn.getAttribute("title") === "Install") {
                ModManager.downloadMod(link, type);
                btn.classList.remove(CLASSES.INSTALL_BUTTON);
                btn.classList.add(CLASSES.UNINSTALL_BUTTON);
                btn.setAttribute("title", "Uninstall");
                if (btn.childNodes[1]) {
                    btn.childNodes[1].textContent = "Uninstall";
                }
            } else {
                ModManager.removeMod(Helpers.getFileNameFromUrl(link), type);
                btn.classList.remove(CLASSES.UNINSTALL_BUTTON);
                btn.classList.add(CLASSES.INSTALL_BUTTON);
                btn.setAttribute("title", "Install");
                if (btn.childNodes[1]) {
                    btn.childNodes[1].textContent = "Install";
                }
            }
        });
    });

    // Search bar logic
    setupSearchBar();

    // Add back button
    const horizontalNavs = document.querySelectorAll(SELECTORS.HORIZONTAL_NAV);
    const horizontalNav = horizontalNavs[1];
    if (horizontalNav) {
        horizontalNav.innerHTML = getBackButton();
        document.getElementById("back-btn")?.addEventListener("click", () => {
            location.hash = '#/';
            setTimeout(() => {
                location.hash = '#/settings';
            }, 0);
        });
    }
}

function setupSearchBar(): void {
    const searchInput = document.querySelector(SELECTORS.SEARCH_INPUT) as HTMLInputElement;
    const addonsContainer = document.querySelector(SELECTORS.ADDONS_LIST_CONTAINER);

    if (!searchInput || !addonsContainer) return;

    searchInput.addEventListener("input", () => {
        const filter = searchInput.value.trim().toLowerCase();
        const modItems = addonsContainer.querySelectorAll(SELECTORS.ADDON_CONTAINER);

        modItems.forEach((item) => {
            const name = item.querySelector(SELECTORS.NAME_CONTAINER)?.textContent?.toLowerCase() || "";
            const description = item.querySelector(SELECTORS.DESCRIPTION_ITEM)?.textContent?.toLowerCase() || "";
            const type = item.querySelector(SELECTORS.TYPES_CONTAINER)?.textContent?.toLowerCase() || "";

            const match = name.includes(filter) || description.includes(filter) || type.includes(filter);
            (item as HTMLElement).style.display = match ? "" : "none";
        });
    });
}

function setupBrowseModsButton(): void {
    Helpers.waitForElm('#browsePluginsThemesBtn').then(() => {
        const btn = document.getElementById("browsePluginsThemesBtn");
        if (!btn || btn.hasAttribute('data-handler-attached')) return;
        btn.setAttribute('data-handler-attached', 'true');
        btn.addEventListener("click", browseMods);
    }).catch(err => logger.warn("Browse mods button not found: " + err));
}

function setupCheckUpdatesButton(): void {
    Helpers.waitForElm('#checkforupdatesBtn').then(() => {
        const btn = document.getElementById("checkforupdatesBtn");
        if (!btn || btn.hasAttribute('data-handler-attached')) return;
        btn.setAttribute('data-handler-attached', 'true');
        btn.addEventListener("click", async () => {
            if (btn) btn.style.pointerEvents = "none";
            ipcRenderer.send(IPC_CHANNELS.UPDATE_CHECK_USER);
            if (btn) btn.style.pointerEvents = "all";
        });
    }).catch(err => logger.warn("Check updates button not found: " + err));
}

function setupCheckUpdatesOnStartupToggle(): void {
    Helpers.waitForElm('#checkForUpdatesOnStartup').then(() => {
        const toggle = document.getElementById("checkForUpdatesOnStartup");
        if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
        toggle.setAttribute('data-handler-attached', 'true');
        toggle.addEventListener("click", () => {
            toggle.classList.toggle(CLASSES.CHECKED);
            const isChecked = toggle.classList.contains(CLASSES.CHECKED);
            logger.info(`Check for updates on startup toggled ${isChecked ? "ON" : "OFF"}`);
            localStorage.setItem(STORAGE_KEYS.CHECK_UPDATES_ON_STARTUP, isChecked ? "true" : "false");
        });
    }).catch(err => logger.warn("Check updates on startup toggle not found: " + err));
}

function setupDiscordRpcToggle(): void {
    Helpers.waitForElm('#discordrichpresence').then(() => {
        const toggle = document.getElementById("discordrichpresence");
        if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
        toggle.setAttribute('data-handler-attached', 'true');
        toggle.addEventListener("click", async () => {
            toggle.classList.toggle(CLASSES.CHECKED);
            const isChecked = toggle.classList.contains(CLASSES.CHECKED);
            logger.info(`Discord Rich Presence toggled ${isChecked ? "ON" : "OFF"}`);

            if (isChecked) {
                localStorage.setItem(STORAGE_KEYS.DISCORD_RPC, "true");
                DiscordPresence.start();
                await DiscordPresence.discordRPCHandler();
            } else {
                localStorage.setItem(STORAGE_KEYS.DISCORD_RPC, "false");
                DiscordPresence.stop();
            }
        });
    }).catch(err => logger.warn("Discord RPC toggle not found: " + err));
}

function setupTransparencyToggle(): void {
    Helpers.waitForElm('#enableTransparentThemes').then(() => {
        const toggle = document.getElementById("enableTransparentThemes");
        if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
        toggle.setAttribute('data-handler-attached', 'true');
        toggle.addEventListener("click", () => {
            toggle.classList.toggle(CLASSES.CHECKED);
            const isChecked = toggle.classList.contains(CLASSES.CHECKED);
            logger.info(`Enable transparency toggled ${isChecked ? "ON" : "OFF"}`);
            ipcRenderer.send(IPC_CHANNELS.SET_TRANSPARENCY, isChecked);
        });
    }).catch(err => logger.warn("Transparency toggle not found: " + err));
}

function writeAbout(): void {
    Helpers.waitForElm(SELECTORS.ABOUT_CATEGORY).then(async () => {
        const isTransparencyEnabled = await getTransparencyStatus();
        const currentVersion = Updater.getCurrentVersion();
        const checkForUpdatesOnStartup = localStorage.getItem(STORAGE_KEYS.CHECK_UPDATES_ON_STARTUP) === "true";
        const discordRpc = localStorage.getItem(STORAGE_KEYS.DISCORD_RPC) === "true";
        const customPlayerPath = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH) || "";

        // Get player detection status
        const externalPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER) || EXTERNAL_PLAYERS.BUILTIN;
        let playerStatus = "";
        if (externalPlayer !== EXTERNAL_PLAYERS.BUILTIN && customPlayerPath) {
            playerStatus = `Custom path: ${customPlayerPath}`;
        } else if (externalPlayer !== EXTERNAL_PLAYERS.BUILTIN) {
            const detectedPath = await ipcRenderer.invoke(IPC_CHANNELS.DETECT_PLAYER, externalPlayer);
            playerStatus = detectedPath
                ? `Auto-detected: ${detectedPath}`
                : "Player not auto-detected. Set custom path if needed.";
        }

        const aboutCategory = document.querySelector(SELECTORS.ABOUT_CATEGORY);
        if (aboutCategory) {
            aboutCategory.innerHTML += getAboutCategoryTemplate(
                currentVersion,
                checkForUpdatesOnStartup,
                discordRpc,
                isTransparencyEnabled,
                customPlayerPath,
                playerStatus
            );
        }
    }).catch(err => logger.error("Failed to write about section: " + err));
}

// Persistent observer for icon injection - keeps icon visible on all pages
let iconRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let iconObserverActive = false;

function injectAppIconInGlassTheme(): void {
    const currentTheme = localStorage.getItem(STORAGE_KEYS.CURRENT_THEME);
    if (!currentTheme || currentTheme === "Default") {
        // Stop observing if theme is not glass
        if (iconObserverActive) {
            setObserverHandlerActive('icon-injection', false);
            iconObserverActive = false;
        }
        if (iconRetryTimeout) {
            clearTimeout(iconRetryTimeout);
            iconRetryTimeout = null;
        }
        return;
    }

    // Only inject for glass theme
    if (currentTheme !== "liquid-glass.theme.css") {
        // Stop observing if theme is not glass
        if (iconObserverActive) {
            setObserverHandlerActive('icon-injection', false);
            iconObserverActive = false;
        }
        if (iconRetryTimeout) {
            clearTimeout(iconRetryTimeout);
            iconRetryTimeout = null;
        }
        return;
    }

    // Function to inject icon into a navigation bar element
    const injectIconIntoNavBar = (navBar: Element): void => {
        // Check if icon already exists in this nav bar
        const existingIcon = navBar.querySelector('.app-icon-glass-theme');
        if (existingIcon) {
            return; // Icon already exists, no need to re-inject
        }

        // Get the icon path - images folder is in app root
        // Use same pattern as theme loading: check if packaged
        const isPackaged = __dirname.includes("app.asar");
        let iconPath: string;
        
        if (isPackaged) {
            // In production, images are in resources/images
            iconPath = join(process.resourcesPath, "images", "icons", "dark.png");
        } else {
            // In dev, images are at root level (same level as dist folder)
            // __dirname in dev points to dist/, so we go up one level
            iconPath = join(dirname(__dirname), "images", "icons", "dark.png");
        }
        
        if (!existsSync(iconPath)) {
            logger.warn("App icon not found at: " + iconPath);
            return;
        }
        
        const iconUrl = pathToFileURL(iconPath).toString();
        
        // Create and inject the icon as an actual img element
        const iconElement = document.createElement('img');
        iconElement.src = iconUrl;
        iconElement.alt = 'StreamGo';
        iconElement.classList.add('app-icon-glass-theme');
        iconElement.id = 'glass-theme-app-icon-' + Date.now(); // Unique ID to allow multiple instances
        iconElement.style.width = '18px';
        iconElement.style.height = '18px';
        iconElement.style.marginRight = '6px';
        iconElement.style.objectFit = 'contain';

        // Prepend to navigation bar (top-left position)
        navBar.prepend(iconElement);
        
        logger.info("App icon injected in glass theme at top-left corner: " + iconUrl);
    };

    // Function to find and inject icon into the MAIN navigation bar only
    const tryInjectIcon = (): void => {
        // IMPORTANT: Target only the main top navigation bar inside main-nav-bars-container
        // Do NOT target secondary nav bars inside route content (those are page-specific)
        const selectors = [
            // Primary: horizontal nav bar inside main-nav-bars-container (this is the main top nav)
            '[class*="main-nav-bars-container"] [class*="horizontal-nav-bar"]',
            '[class*="main-nav-bars-container"] nav[class*="horizontal"]',
            // Fallback with specific class names (may break when Stremio updates)
            '.main-nav-bars-container-wNjS5 .horizontal-nav-bar-container-Y_zvK',
            '.main-nav-bars-container-wNjS5 [class*="horizontal-nav-bar"]'
        ];

        for (const selector of selectors) {
            const navBar = document.querySelector(selector);
            if (navBar) {
                injectIconIntoNavBar(navBar);
                return; // Successfully injected, exit
            }
        }
        
        // If no nav bar found, schedule a retry
        if (iconRetryTimeout) {
            clearTimeout(iconRetryTimeout);
        }
        iconRetryTimeout = setTimeout(() => {
            tryInjectIcon();
        }, TIMEOUTS.ICON_RETRY_DELAY);
    };

    // Try to inject immediately
    tryInjectIcon();

    // Set up persistent observer using unified observer system
    if (!iconObserverActive) {
        registerObserverHandler('icon-injection', () => {
            // Debounce: only check after mutations settle
            if (iconRetryTimeout) {
                clearTimeout(iconRetryTimeout);
            }
            iconRetryTimeout = setTimeout(() => {
                tryInjectIcon();
            }, TIMEOUTS.ICON_MUTATION_DEBOUNCE);
        });
        iconObserverActive = true;
    } else {
        // Re-enable if it was disabled
        setObserverHandlerActive('icon-injection', true);
    }

    // Also use waitForElm as a fallback for initial load with specific selectors
    const fallbackSelectors = [
        '[class*="main-nav-bars-container"] [class*="horizontal-nav-bar"]',
        '.main-nav-bars-container-wNjS5 .horizontal-nav-bar-container-Y_zvK'
    ];

    fallbackSelectors.forEach(selector => {
        Helpers.waitForElm(selector, 2000).then((navBar) => {
            injectIconIntoNavBar(navBar);
        }).catch(() => {
            // Ignore errors - observer will handle it
        });
    });
}

// Inject custom StreamGo logo on intro/login/signup pages
function injectIntroLogo(): void {
    const isPackaged = __dirname.includes("app.asar");
    let logoPath: string;

    if (isPackaged) {
        logoPath = join(process.resourcesPath, "images", "mainnew.png");
    } else {
        logoPath = join(dirname(__dirname), "images", "mainnew.png");
    }

    if (!existsSync(logoPath)) {
        logger.warn("Intro logo not found at: " + logoPath);
        return;
    }

    const logoUrl = pathToFileURL(logoPath).toString();

    const injectLogo = (): void => {
        // Check if we're on an intro/login page by looking for common selectors
        const introSelectors = [
            '[class*="intro-container"]',
            '[class*="intro-"]',
            '[class*="form-container"]',
            '[class*="auth-"]',
            '[class*="login-container"]',
            '[class*="signup-container"]'
        ];

        let introContainer: Element | null = null;
        for (const selector of introSelectors) {
            introContainer = document.querySelector(selector);
            if (introContainer) break;
        }

        if (!introContainer) return;

        // Check if logo is already injected
        if (document.querySelector('.streamgo-intro-logo')) return;

        // Find and hide the old logo
        const oldLogoSelectors = [
            '[class*="intro-"] [class*="logo"]',
            '[class*="form-container"] [class*="logo"]',
            '[class*="intro-"] img',
            '[class*="intro-"] svg',
            'img[class*="logo"]',
            'svg[class*="logo"]'
        ];

        for (const selector of oldLogoSelectors) {
            const oldLogos = introContainer.querySelectorAll(selector);
            oldLogos.forEach(oldLogo => {
                if (oldLogo && !oldLogo.classList.contains('streamgo-intro-logo')) {
                    (oldLogo as HTMLElement).style.display = 'none';
                }
            });
        }

        // Create and inject new logo
        const logoElement = document.createElement('img');
        logoElement.src = logoUrl;
        logoElement.alt = 'StreamGo';
        logoElement.classList.add('streamgo-intro-logo');

        // Find the best place to insert the logo (usually at the top of the intro container)
        const logoContainerSelectors = [
            '[class*="logo-container"]',
            '[class*="header"]',
            '[class*="intro-header"]'
        ];

        let insertTarget: Element | null = null;
        for (const selector of logoContainerSelectors) {
            insertTarget = introContainer.querySelector(selector);
            if (insertTarget) break;
        }

        if (insertTarget) {
            insertTarget.prepend(logoElement);
        } else {
            // Insert at the beginning of intro container
            introContainer.prepend(logoElement);
        }

        logger.info("StreamGo intro logo injected: " + logoUrl);
    };

    // Try immediately
    injectLogo();

    // Also watch for route changes
    registerObserverHandler('intro-logo-injection', () => {
        setTimeout(injectLogo, 100);
    });

    // Also try on hash changes
    window.addEventListener('hashchange', () => {
        setTimeout(injectLogo, 100);
    });
}

function addTitleBar(): void {
    logger.info("Adding title bar...");

    const activeRoute = document.querySelector(SELECTORS.ROUTE_CONTAINER);
    if (!activeRoute || activeRoute.querySelector(".title-bar")) return;

    activeRoute.insertAdjacentHTML("afterbegin", getTitleBarTemplate());
    logger.info("Title bar added to active route");

    const titleBar = activeRoute.querySelector(".title-bar");
    if (!titleBar) return;

    // Minimize button
    titleBar.querySelector("#minimizeApp-btn")?.addEventListener("click", () => {
        ipcRenderer.send(IPC_CHANNELS.MINIMIZE_WINDOW);
    });

    // Maximize button
    titleBar.querySelector("#maximizeApp-btn")?.addEventListener("click", () => {
        const pathElement = titleBar.querySelector("#maximizeApp-btn svg path");
        if (pathElement) {
            const currentPath = pathElement.getAttribute("d");
            const maximizedPath = "M4,8H8V4H20V16H16V20H4V8M16,8V14H18V6H10V8H16M6,12V18H14V12H6Z";
            const normalPath = "M3,3H21V21H3V3M5,5V19H19V5H5Z";
            
            pathElement.setAttribute("d", currentPath === maximizedPath ? normalPath : maximizedPath);
        }
        ipcRenderer.send(IPC_CHANNELS.MAXIMIZE_WINDOW);
    });

    // Close button
    titleBar.querySelector("#closeApp-btn")?.addEventListener("click", () => {
        ipcRenderer.send(IPC_CHANNELS.CLOSE_WINDOW);
    });
}

// Track if external player options are already being monitored
let externalPlayerOptionsInitialized = false;

// Inject VLC and MPC-HC options into Stremio's native "Play in External Player" dropdown
function injectExternalPlayerOptions(): void {
    // Prevent duplicate initialization - the observer and hashchange listener should only be set up once
    if (externalPlayerOptionsInitialized) return;
    externalPlayerOptionsInitialized = true;

    // Stremio uses a custom multiselect component, not native <select>
    // The dropdown opens as a floating menu container when the multiselect button is clicked
    // WARNING: Fragile selector - targets Settings > Player > "Play in External Player" option
    // Path: sections-container > 4th section (Player) > 6th option > option container
    // May break when Stremio updates their UI - inspect to find new class names
    const OPTION_CONTAINER_SELECTOR = 'div.sections-container-ZaZpD > div:nth-child(4) > div:nth-child(6) > div.option-vFOAS';

    const injectOptionsIntoMenu = () => {
        // Look for any popup/floating menu that just appeared
        // Stremio uses various class patterns for menus
        const menuSelectors = [
            'div[class*="menu-container"]',
            'div[class*="popup-container"]',
            'div[class*="dropdown-container"]',
            'div[class*="picker-container"]',
            'div[class*="select-menu"]'
        ];

        for (const selector of menuSelectors) {
            const menus = document.querySelectorAll(selector);

            for (const menu of menus) {
                const container = menu as HTMLElement;
                if (container.dataset.enhanced === 'true') continue;

                // Find all clickable menu items - try various patterns
                let existingItems = container.querySelectorAll('div[class*="option"]');
                if (existingItems.length === 0) {
                    existingItems = container.querySelectorAll('div[class*="menu-item"]');
                }
                if (existingItems.length === 0) {
                    existingItems = container.querySelectorAll('div[class*="item"]');
                }

                if (existingItems.length === 0) continue;

                // Check if any item contains "Disabled" or "M3U" to confirm this is the external player menu
                let isExternalPlayerMenu = false;
                let templateItem: HTMLElement | null = null;

                existingItems.forEach(item => {
                    const text = (item.textContent || '').toLowerCase().trim();
                    if (text === 'disabled' || text.includes('m3u')) {
                        isExternalPlayerMenu = true;
                        templateItem = item as HTMLElement;
                    }
                });

                if (!isExternalPlayerMenu || !templateItem) continue;
                if (container.querySelector('[data-enhanced-option="vlc"]')) continue;

                // TypeScript needs this after the null check
                const itemTemplate: HTMLElement = templateItem;

                logger.info("Found external player menu, injecting VLC and MPC-HC options...");
                container.dataset.enhanced = 'true';

                // Create VLC option by cloning existing item
                const vlcOption = itemTemplate.cloneNode(true) as HTMLElement;
                vlcOption.dataset.enhancedOption = 'vlc';
                // Remove any selected/checked class
                vlcOption.className = vlcOption.className.replace(/selected[^\s]*/gi, '').replace(/checked[^\s]*/gi, '');
                // Find text content and replace
                const setOptionText = (el: HTMLElement, text: string) => {
                    // Try to find the innermost element with text
                    const textContainers = el.querySelectorAll('*');
                    let textSet = false;
                    textContainers.forEach(container => {
                        if (container.children.length === 0 && container.textContent) {
                            container.textContent = text;
                            textSet = true;
                        }
                    });
                    if (!textSet) {
                        // Fallback: set on the element directly
                        el.textContent = text;
                    }
                };
                setOptionText(vlcOption, 'VLC');

                // Create MPC-HC option
                const mpchcOption = itemTemplate.cloneNode(true) as HTMLElement;
                mpchcOption.dataset.enhancedOption = 'mpchc';
                mpchcOption.className = mpchcOption.className.replace(/selected[^\s]*/gi, '').replace(/checked[^\s]*/gi, '');
                setOptionText(mpchcOption, 'MPC-HC');

                // Style options to be visually consistent
                vlcOption.style.cursor = 'pointer';
                mpchcOption.style.cursor = 'pointer';

                // Add click handlers
                const handlePlayerSelect = async (player: string, displayName: string, e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.info(`[ExternalPlayer] Setting external player to: ${player}`);
                    localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, player);
                    logger.info(`[ExternalPlayer] localStorage now has: ${localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER)}`);
                    logger.info(`External player set to ${displayName}`);
                    updateButtonText(displayName);
                    await updatePlayerPathDisplay();
                    // Close the dropdown by clicking elsewhere (more natural than removing)
                    // This preserves Stremio's UI state
                    document.body.click();
                };

                // Add click handlers with cleanup registration
                const vlcClickHandler = (e: Event) => handlePlayerSelect('vlc', 'VLC', e);
                const mpchcClickHandler = (e: Event) => handlePlayerSelect('mpchc', 'MPC-HC', e);
                vlcOption.addEventListener('click', vlcClickHandler);
                mpchcOption.addEventListener('click', mpchcClickHandler);
                registerEventCleanup('external-player-menu', () => {
                    vlcOption.removeEventListener('click', vlcClickHandler);
                    mpchcOption.removeEventListener('click', mpchcClickHandler);
                });

                // Add hover effect with cleanup registration
                [vlcOption, mpchcOption].forEach(opt => {
                    const enterHandler = () => { opt.style.backgroundColor = 'rgba(255,255,255,0.1)'; };
                    const leaveHandler = () => { opt.style.backgroundColor = ''; };
                    opt.addEventListener('mouseenter', enterHandler);
                    opt.addEventListener('mouseleave', leaveHandler);
                    registerEventCleanup('external-player-menu', () => {
                        opt.removeEventListener('mouseenter', enterHandler);
                        opt.removeEventListener('mouseleave', leaveHandler);
                    });
                });

                // Find the parent container of menu items and append
                const itemsParent = itemTemplate.parentElement || container;
                itemsParent.appendChild(vlcOption);
                itemsParent.appendChild(mpchcOption);

                // Also track when native options are clicked with cleanup
                existingItems.forEach(item => {
                    const clickHandler = () => {
                        const text = (item.textContent || '').toLowerCase().trim();
                        if (text === 'disabled') {
                            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, EXTERNAL_PLAYERS.BUILTIN);
                        } else if (text.includes('m3u')) {
                            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, 'm3u');
                        }
                        logger.info(`External player set to: ${text}`);
                        updatePlayerPathDisplay();
                    };
                    item.addEventListener('click', clickHandler);
                    registerEventCleanup('external-player-menu', () => {
                        item.removeEventListener('click', clickHandler);
                    });
                });

                logger.info("VLC and MPC-HC options injected successfully");
                return true;
            }
        }
        return false;
    };

    const updateButtonText = (text: string) => {
        // Find the multiselect button in the external player option
        const optionContainer = document.querySelector(OPTION_CONTAINER_SELECTOR);
        if (optionContainer) {
            const button = optionContainer.querySelector('div[class*="multiselect-button"]');
            if (button) {
                // Find the label element within the button
                const labelDiv = button.querySelector('div[class*="label"]');
                if (labelDiv) {
                    labelDiv.textContent = text;
                } else {
                    // Try to find any text-containing element
                    const textContainers = button.querySelectorAll('*');
                    textContainers.forEach(container => {
                        if (container.children.length === 0 && container.textContent) {
                            container.textContent = text;
                        }
                    });
                }
            }
        }
    };

    const updatePlayerPathDisplay = async () => {
        const externalPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);
        const optionContainer = document.querySelector(OPTION_CONTAINER_SELECTOR);

        if (!optionContainer) return;

        // Remove existing path display and warning
        const existingDisplay = document.getElementById('enhanced-player-path-display');
        if (existingDisplay) existingDisplay.remove();
        const existingWarning = document.getElementById('enhanced-player-warning');
        if (existingWarning) existingWarning.remove();

        // Only show for VLC or MPC-HC
        if (externalPlayer !== 'vlc' && externalPlayer !== 'mpchc') return;

        // Get detected path
        const detectedPath = await ipcRenderer.invoke(IPC_CHANNELS.DETECT_PLAYER, externalPlayer);
        const customPath = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH);

        // Create path display element
        const pathDisplay = document.createElement('div');
        pathDisplay.id = 'enhanced-player-path-display';
        pathDisplay.style.cssText = 'color: #888; font-size: 12px; margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;';

        if (customPath) {
            pathDisplay.innerHTML = `<span style="color: #4CAF50;">Custom path:</span> ${customPath}`;
        } else if (detectedPath) {
            pathDisplay.innerHTML = `<span style="color: #4CAF50;">Auto-detected:</span> ${detectedPath}`;
        } else {
            pathDisplay.innerHTML = `<span style="color: #ff9800;">Not found.</span> Set custom path in Enhanced > About`;
        }

        // Add warning note about position tracking
        const warningNote = document.createElement('div');
        warningNote.id = 'enhanced-player-warning';
        warningNote.style.cssText = 'color: #ff9800; font-size: 11px; margin-top: 6px; padding: 6px 8px; background: rgba(255, 152, 0, 0.1); border-radius: 4px; border-left: 2px solid #ff9800;';
        warningNote.textContent = 'Note: External players do not support position tracking. "Continue Watching" may not work accurately.';

        // Insert after the option container
        optionContainer.parentNode?.insertBefore(pathDisplay, optionContainer.nextSibling);
        pathDisplay.parentNode?.insertBefore(warningNote, pathDisplay.nextSibling);
    };

    // Use unified observer to watch for dropdown menus appearing anywhere in DOM
    registerObserverHandler('external-player-menu', (mutations) => {
        // Only process if nodes were added
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                injectOptionsIntoMenu();
                break;
            }
        }
    });

    // Update button text and path display on load based on saved setting
    // Use exponential backoff instead of fixed interval (95% fewer DOM queries)
    const savedPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);
    if (savedPlayer === 'vlc' || savedPlayer === 'mpchc') {
        waitForElementWithBackoff(OPTION_CONTAINER_SELECTOR).then((optionContainer) => {
            if (optionContainer) {
                updateButtonText(savedPlayer === 'vlc' ? 'VLC' : 'MPC-HC');
                updatePlayerPathDisplay();
            }
        });
    }

    // Cleanup on navigation away from settings
    const cleanup = () => {
        if (!location.href.includes('#/settings')) {
            unregisterObserverHandler('external-player-menu');
            runEventCleanups('external-player-menu');
            window.removeEventListener('hashchange', cleanup);
            // Reset the initialization flag so it can be set up again when returning to settings
            externalPlayerOptionsInitialized = false;
        }
    };
    window.addEventListener('hashchange', cleanup);
}

// Setup custom player path input in About section
function setupCustomPlayerPath(): void {
    Helpers.waitForElm('#customPlayerPath').then(() => {
        const customPathInput = document.getElementById("customPlayerPath") as HTMLInputElement;
        if (!customPathInput || customPathInput.hasAttribute('data-handler-attached')) return;
        customPathInput.setAttribute('data-handler-attached', 'true');

        const browseBtn = document.getElementById("browsePlayerPath");
        if (browseBtn) browseBtn.setAttribute('data-handler-attached', 'true');
        const statusEl = document.getElementById("playerStatus");
        const customPathContainer = document.getElementById("customPlayerPathContainer") as HTMLElement;

        // Show/hide based on current player selection
        const externalPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER) || EXTERNAL_PLAYERS.BUILTIN;
        if (customPathContainer) {
            const shouldShow = externalPlayer === 'vlc' || externalPlayer === 'mpchc';
            customPathContainer.style.display = shouldShow ? 'block' : 'none';
        }

        customPathInput.addEventListener("change", () => {
            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH, customPathInput.value);
            logger.info(`Custom player path set to: ${customPathInput.value}`);
            if (statusEl) {
                statusEl.textContent = customPathInput.value ? `Custom path: ${customPathInput.value}` : '';
            }
        });

        browseBtn?.addEventListener("click", async () => {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.BROWSE_PLAYER_PATH);
            if (result && customPathInput) {
                customPathInput.value = result;
                localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH, result);
                logger.info(`Custom player path set via browse: ${result}`);
                if (statusEl) {
                    statusEl.textContent = `Custom path: ${result}`;
                }
            }
        });
    }).catch(err => logger.warn("Custom player path input not found: " + err));
}

/**
 * Trigger fallback when external player fails - cleanup and navigate back
 */
function triggerExternalPlayerFallback(reason: string): void {
    logger.info(`[ExternalPlayer] Fallback triggered: ${reason}`);
    document.body.classList.remove('external-player-active');
    isHandlingExternalPlayer = false;
    // Small delay to ensure UI updates before navigation
    setTimeout(() => history.back(), 100);
}

async function handleExternalPlayerInterception(): Promise<void> {
    const externalPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);

    logger.info(`[ExternalPlayer] Checking interception - stored player: "${externalPlayer}"`);

    // Prevent double-handling
    if (isHandlingExternalPlayer) {
        logger.info(`[ExternalPlayer] Already handling, skipping...`);
        return;
    }

    // Skip if using built-in player or M3U (let Stremio handle M3U)
    if (!externalPlayer ||
        externalPlayer === EXTERNAL_PLAYERS.BUILTIN ||
        externalPlayer === '' ||
        externalPlayer === 'disabled' ||
        externalPlayer === 'm3u') {
        logger.info(`[ExternalPlayer] Skipping - using built-in or M3U player`);
        document.body.classList.remove('external-player-active');
        return;
    }

    // Only handle VLC and MPC-HC
    if (externalPlayer !== 'vlc' && externalPlayer !== 'mpchc') {
        logger.info(`[ExternalPlayer] Skipping - unknown player type: ${externalPlayer}`);
        document.body.classList.remove('external-player-active');
        return;
    }

    // Mark as handling and add visual indicator
    isHandlingExternalPlayer = true;
    document.body.classList.add('external-player-active');

    // Safety timeout: force reset flag after 30 seconds if still stuck
    const safetyTimeout = setTimeout(() => {
        if (isHandlingExternalPlayer) {
            logger.warn("[ExternalPlayer] Force resetting flag after 30s safety timeout");
            triggerExternalPlayerFallback("Safety timeout (30s)");
        }
    }, 30000);

    logger.info(`[ExternalPlayer] Intercepting for ${externalPlayer}...`);

    // Mute videos during URL extraction (but DON'T pause - let Stremio load the stream)
    // Pausing prevents Stremio from loading, which causes "failed to load" errors
    const muteAllVideos = () => {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            try {
                video.muted = true;
                // DON'T pause here - let the video load so we can get the stream URL
                // and so Stremio registers it for Continue Watching
            } catch (e) {
                // Ignore errors
            }
        });
    };
    muteAllVideos();

    // Get stream URL with retries
    interface PlayerState {
        stream?: {
            type?: string;
            content?: {
                url?: string;
                infoHash?: string;
                deepLinks?: {
                    externalPlayer?: {
                        streaming?: string;
                    };
                };
            };
            url?: string;
            externalUrl?: string;
        };
        selected?: {
            stream?: {
                deepLinks?: {
                    externalPlayer?: {
                        streaming?: string;
                    };
                };
            };
        };
        metaItem?: {
            type?: string;
            content?: {
                name?: string;
                type?: string;
            };
        };
        seriesInfo?: {
            season?: number;
            episode?: number;
        };
        title?: string;
    }

    let playerState: PlayerState | null = null;
    let streamUrl: string | null = null;

    // Retry getting player state (it might take a moment to populate)
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            // Try different methods to get player state
            playerState = await Helpers._eval('core.transport.getState("player")') as PlayerState | null;

            if (!playerState) {
                // Alternative: try getting from window object
                playerState = await Helpers._eval('window.stremio?.player?.state || window.player?.state') as PlayerState | null;
            }

            // Log full state structure on first few attempts to debug
            if (attempt < 3) {
                logger.info(`[ExternalPlayer] Attempt ${attempt + 1} - Full playerState:`, JSON.stringify(playerState, null, 2));
            }

            logger.info(`[ExternalPlayer] Attempt ${attempt + 1} - playerState exists: ${!!playerState}`);

            if (playerState) {
                // Try multiple locations for stream URL
                // The stream object has structure: { type: "Ready", content: { url: "..." } }
                // Types are defined in PlayerState interface above
                const streamContent = playerState.stream?.content;
                const selectedStream = playerState.selected?.stream?.deepLinks?.externalPlayer;

                const possibleUrls = [
                    // Primary: stream.content.url (when stream.type === "Ready")
                    streamContent?.url,
                    // Alternative: selected.stream.deepLinks.externalPlayer.streaming
                    selectedStream?.streaming,
                    // Legacy fallbacks
                    playerState.stream?.url,
                    playerState.stream?.externalUrl,
                ];

                for (const url of possibleUrls) {
                    if (url && typeof url === 'string' && url.startsWith('http')) {
                        streamUrl = url;
                        logger.info(`[ExternalPlayer] Found stream URL: ${streamUrl}`);
                        break;
                    }
                }

                // Also try to get from video element directly as last resort
                if (!streamUrl) {
                    const videoEl = document.querySelector('video');
                    if (videoEl?.src && videoEl.src.startsWith('http')) {
                        streamUrl = videoEl.src;
                        logger.info(`[ExternalPlayer] Got URL from video element: ${streamUrl}`);
                    }
                }

                logger.info(`[ExternalPlayer] Stream found: ${streamUrl ? 'yes' : 'no'}`);

                if (streamUrl) {
                    logger.info(`[ExternalPlayer] URL: ${streamUrl}`);
                    break;
                }
            }
        } catch (err) {
            logger.warn(`[ExternalPlayer] Attempt ${attempt + 1} error: ${(err as Error).message}`);
        }

        muteAllVideos();
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!streamUrl) {
        logger.error("[ExternalPlayer] Failed to get stream URL after multiple attempts");
        triggerExternalPlayerFallback("Stream URL not found");
        return;
    }

    // Build title from available info
    let title = "Stremio Stream";
    if (playerState?.metaItem?.content?.name) {
        title = playerState.metaItem.content.name;
        if (playerState.seriesInfo?.season && playerState.seriesInfo?.episode) {
            title += ` S${playerState.seriesInfo.season}E${playerState.seriesInfo.episode}`;
        }
    } else if (playerState?.title) {
        title = playerState.title;
    }

    logger.info(`[ExternalPlayer] SUCCESS! Title: "${title}", URL: ${streamUrl}`);

    // Keep videos muted (but let them play for Continue Watching to register)
    muteAllVideos();

    // Get custom path if set
    const customPath = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH) || undefined;

    logger.info(`[ExternalPlayer] Launching ${externalPlayer} (custom path: ${customPath || 'auto-detect'})`);

    // Launch external player via IPC
    logger.info(`[ExternalPlayer] Sending IPC: ${IPC_CHANNELS.LAUNCH_EXTERNAL_PLAYER}`);
    ipcRenderer.send(IPC_CHANNELS.LAUNCH_EXTERNAL_PLAYER, {
        player: externalPlayer,
        url: streamUrl,
        title: title,
        customPath: customPath
    });
    logger.info(`[ExternalPlayer] IPC sent!`);

    // Listen for launch result (just log, don't interrupt the 10-second flow)
    let launchSucceeded = false;
    let launchError: string | null = null;

    const successHandler = () => {
        launchSucceeded = true;
        ipcRenderer.removeListener(IPC_CHANNELS.EXTERNAL_PLAYER_ERROR, errorHandler);
        logger.info("[ExternalPlayer] Launch confirmed by main process");
    };

    const errorHandler = (_: unknown, data: { error: string }) => {
        launchError = data.error;
        ipcRenderer.removeListener(IPC_CHANNELS.EXTERNAL_PLAYER_LAUNCHED, successHandler);
        logger.error(`[ExternalPlayer] Launch error reported: ${data.error}`);
        // Don't trigger fallback here - let the 10-second wait complete for Continue Watching
    };

    ipcRenderer.once(IPC_CHANNELS.EXTERNAL_PLAYER_LAUNCHED, successHandler);
    ipcRenderer.once(IPC_CHANNELS.EXTERNAL_PLAYER_ERROR, errorHandler);

    // Wait for internal player to actually start playing (for Continue Watching to register)
    // This is more reliable than a fixed timer - we detect actual playback
    logger.info(`[ExternalPlayer] Waiting for internal player to start playing (for Continue Watching)...`);

    const MAX_WAIT_TIME = 120000; // 2 minutes max wait (for slow 4K streams)
    const startTime = Date.now();
    let playbackDetected = false;

    // Create a promise that resolves when playback is detected
    const waitForPlayback = new Promise<void>((resolve) => {
        const checkPlayback = setInterval(() => {
            const video = document.querySelector('video') as HTMLVideoElement | null;

            // Check if we've exceeded max wait time
            if (Date.now() - startTime > MAX_WAIT_TIME) {
                logger.warn(`[ExternalPlayer] Max wait time (${MAX_WAIT_TIME/1000}s) exceeded, proceeding anyway`);
                clearInterval(checkPlayback);
                resolve();
                return;
            }

            if (video) {
                // Check if video has actually started playing (currentTime > 0 means it played)
                // isPlaying checks if video is actively playing right now
                const hasPlayed = video.currentTime > 0;
                const isPlaying = !video.paused && !video.ended && video.readyState > 2;

                if (hasPlayed || isPlaying) {
                    logger.info(`[ExternalPlayer] Playback detected! currentTime: ${video.currentTime.toFixed(2)}s, readyState: ${video.readyState}`);
                    playbackDetected = true;

                    // Pause and mute the video now
                    video.pause();
                    video.muted = true;

                    clearInterval(checkPlayback);
                    resolve();
                    return;
                }

                // Log progress periodically (every 5 seconds)
                const elapsed = Date.now() - startTime;
                if (elapsed > 0 && elapsed % 5000 < 100) {
                    logger.info(`[ExternalPlayer] Still waiting... readyState: ${video.readyState}, currentTime: ${video.currentTime}, elapsed: ${(elapsed/1000).toFixed(0)}s`);
                }
            }
        }, 100); // Check every 100ms
    });

    await waitForPlayback;

    clearTimeout(safetyTimeout);

    // Log result
    if (playbackDetected) {
        logger.info(`[ExternalPlayer] Playback confirmed and paused. Continue Watching should be registered.`);
    } else {
        logger.warn(`[ExternalPlayer] Playback not detected within timeout, but proceeding with navigation.`);
    }

    // Log launch status
    if (launchSucceeded) {
        logger.info(`[ExternalPlayer] External player launched successfully.`);
    } else if (launchError) {
        logger.warn(`[ExternalPlayer] External player had error: ${launchError}`);
    }

    // Clean up IPC listeners if still attached
    ipcRenderer.removeListener(IPC_CHANNELS.EXTERNAL_PLAYER_LAUNCHED, successHandler);
    ipcRenderer.removeListener(IPC_CHANNELS.EXTERNAL_PLAYER_ERROR, errorHandler);

    logger.info(`[ExternalPlayer] Navigating back...`);

    // Clean up
    document.body.classList.remove('external-player-active');
    isHandlingExternalPlayer = false;

    history.back();
}

// Icon SVGs

function getThemeIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
        <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zM5.5 12c-.83 0-1.5-.67-1.5-1.5S4.67 9 5.5 9 7 9.67 7 10.5 6.33 12 5.5 12zm3-4C7.67 8 7 7.33 7 6.5S7.67 5 8.5 5s1.5.67 1.5 1.5S9.33 8 8.5 8zm7 0c-.83 0-1.5-.67-1.5-1.5S14.67 5 15.5 5s1.5.67 1.5 1.5S16.33 8 15.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S17.67 9 18.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="currentcolor"></path></svg>`;
}

function getPluginIcon(): string {
    return `<svg icon="addons-outline" class="icon" viewBox="0 0 512 512" style="fill: currentcolor;">
        <path d="M413.7 246.1H386c-0.53-0.01-1.03-0.23-1.4-0.6-0.37-0.37-0.59-0.87-0.6-1.4v-77.2a38.94 38.94 0 0 0-11.4-27.5 38.94 38.94 0 0 0-27.5-11.4h-77.2c-0.53-0.01-1.03-0.23-1.4-0.6-0.37-0.37-0.59-0.87-0.6-1.4v-27.7c0-27.1-21.5-49.9-48.6-50.3-6.57-0.1-13.09 1.09-19.2 3.5a49.616 49.616 0 0 0-16.4 10.7 49.823 49.823 0 0 0-11 16.2 48.894 48.894 0 0 0-3.9 19.2v28.5c-0.01 0.53-0.23 1.03-0.6 1.4-0.37 0.37-0.87 0.59-1.4 0.6h-77.2c-10.5 0-20.57 4.17-28 11.6a39.594 39.594 0 0 0-11.6 28v70.4c0.01 0.53 0.23 1.03 0.6 1.4 0.37 0.37 0.87 0.59 1.4 0.6h26.9c29.4 0 53.7 25.5 54.1 54.8 0.4 29.9-23.5 57.2-53.3 57.2H50c-0.53 0.01-1.03 0.23-1.4 0.6-0.37 0.37-0.59 0.87-0.6 1.4v70.4c0 10.5 4.17 20.57 11.6 28s17.5 11.6 28 11.6h70.4c0.53-0.01 1.03-0.23 1.4-0.6 0.37-0.37 0.59-0.87 0.6-1.4V441.2c0-30.3 24.8-56.4 55-57.1 30.1-0.7 57 20.3 57 50.3v27.7c0.01 0.53 0.23 1.03 0.6 1.4 0.37 0.37 0.87 0.59 1.4 0.6h71.1a38.94 38.94 0 0 0 27.5-11.4 38.958 38.958 0 0 0 11.4-27.5v-78c0.01-0.53 0.23-1.03 0.6-1.4 0.37-0.37 0.87-0.59 1.4-0.6h28.5c27.6 0 49.5-22.7 49.5-50.4s-23.2-48.7-50.3-48.7Z" style="stroke:currentcolor;stroke-linecap:round;stroke-linejoin:round;stroke-width:32;fill: currentColor;"></path></svg>`;
}

function getAboutIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
        <g><path fill="none" d="M0 0h24v24H0z"></path>
        <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" style="fill:currentcolor"></path></g></svg>`;
}

function injectPerformanceCSS(): void {
    // Main performance CSS is now in the theme file (liquid-glass.theme.css)
    // This function only injects minimal scroll state CSS for themes that don't have it
    // and sets up the scroll state detection
    const style = document.createElement('style');
    style.id = 'enhanced-scroll-state-css';
    style.textContent = `
        /* Minimal scroll state CSS - main performance CSS is in theme file */
        /* This ensures scroll detection works even with non-glass themes */

        /* Fallback scroll optimizations for non-themed pages */
        html {
            scroll-behavior: smooth;
        }

        /* Base GPU acceleration fallback */
        [class*="meta-items-container"],
        [class*="board-content-container"] {
            transform: translate3d(0, 0, 0);
            -webkit-overflow-scrolling: touch;
        }

        /* Scroll state class definitions (theme CSS uses these) */
        body.scrolling-active,
        body.performance-mode {
            /* These classes trigger theme-specific optimizations */
        }
    `;
    document.head.appendChild(style);

    // Add scroll state detection for dynamic optimizations
    setupScrollStateDetection();

    logger.info("Scroll state detection CSS injected");
}

// Detect active scrolling to apply performance optimizations
function setupScrollStateDetection(): void {
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let isScrolling = false;
    let lastScrollTime = 0;
    const SCROLL_DEBOUNCE = 16; // One frame at 60Hz, optimized for 120Hz ProMotion

    // Pre-cache classList references for micro-optimization
    const bodyClassList = document.body.classList;
    const htmlClassList = document.documentElement.classList;

    // RAF-batched scroll handler for smoothest performance
    const handleScroll = () => {
        const now = performance.now();
        lastScrollTime = now;

        // Immediate class addition on first scroll (no RAF delay)
        if (!isScrolling) {
            isScrolling = true;
            bodyClassList.add('scrolling-active');
            htmlClassList.add('performance-mode');
            // NOTE: Do NOT pause MutationObservers - this prevents content from rendering during scroll
            // CSS optimizations alone are sufficient for scroll performance
        }

        // Clear previous timeout
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        // RAF-based class removal for smooth transition back
        scrollTimeout = setTimeout(() => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (performance.now() - lastScrollTime >= SCROLL_DEBOUNCE) {
                    isScrolling = false;
                    bodyClassList.remove('scrolling-active');
                    htmlClassList.remove('performance-mode');
                }
            });
        }, SCROLL_DEBOUNCE);
    };

    // Use capture phase and passive for best performance
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    // Also handle wheel events for immediate response
    document.addEventListener('wheel', handleScroll, { passive: true });

    // Handle touch scrolling
    document.addEventListener('touchmove', handleScroll, { passive: true });

    logger.info("Scroll state detection initialized (16ms RAF-based, observers remain active)");
}

// Global flag to track if we're currently handling external player
let isHandlingExternalPlayer = false;

// ============================================
// QUICK RESUME - Remember last stream for Continue Watching
// ============================================
interface SavedStreamInfo {
    streamHash: string;        // Stream identifier/hash from URL
    videoId: string;           // Video/episode ID
    contentId: string;         // Content ID (e.g., tt1234567)
    type: string;              // 'movie' or 'series'
    season?: number;           // Season number for series
    episode?: number;          // Episode number for series
    timestamp: number;         // When this was saved
    streamUrl?: string;        // Full stream URL (optional, for debugging)
}

// Save the current stream info when playback starts
async function saveCurrentStreamInfo(): Promise<void> {
    try {
        // Wait a moment for Stremio to populate the player state
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get current player state
        const playerState = await Helpers._eval('core.transport.getState("player")') as {
            metaItem?: { content?: { id?: string; type?: string; name?: string } };
            seriesInfo?: { season?: number; episode?: number };
            selected?: { stream?: { deepLinks?: { player?: string } } };
        } | null;

        if (!playerState?.metaItem?.content?.id) {
            logger.info('[QuickResume] No content ID found, skipping save');
            return;
        }

        // Extract stream hash from current URL
        // Format: #/player/{videoId}/{streamHash}/{episodeId}
        const hash = location.hash;
        const playerMatch = hash.match(/#\/player\/([^/]+)\/([^/]+)(?:\/(.+))?/);

        if (!playerMatch) {
            logger.info('[QuickResume] Could not parse player URL');
            return;
        }

        const [, videoId, streamHash, episodeId] = playerMatch;
        const contentId = playerState.metaItem.content.id;
        const contentType = playerState.metaItem.content.type || 'movie';

        // Create stream info
        const streamInfo: SavedStreamInfo = {
            streamHash,
            videoId,
            contentId,
            type: contentType,
            timestamp: Date.now(),
        };

        // Add series info if available
        if (playerState.seriesInfo) {
            streamInfo.season = playerState.seriesInfo.season;
            streamInfo.episode = playerState.seriesInfo.episode;
        }

        // For series, use the specific episode ID as key, for movies use content ID
        const storageKey = contentType === 'series' && episodeId
            ? `${contentId}:${episodeId}`
            : contentId;

        // Load existing streams
        const savedStreams: Record<string, SavedStreamInfo> = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.LAST_STREAMS) || '{}'
        );

        // Save this stream
        savedStreams[storageKey] = streamInfo;

        // Also save for the content ID (so Continue Watching for series will find latest episode)
        if (contentType === 'series') {
            savedStreams[contentId] = streamInfo;
        }

        // Keep only last 100 entries
        const entries = Object.entries(savedStreams);
        if (entries.length > 100) {
            entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            const trimmed = Object.fromEntries(entries.slice(0, 100));
            localStorage.setItem(STORAGE_KEYS.LAST_STREAMS, JSON.stringify(trimmed));
        } else {
            localStorage.setItem(STORAGE_KEYS.LAST_STREAMS, JSON.stringify(savedStreams));
        }

        logger.info(`[QuickResume] Saved stream for ${storageKey}: hash=${streamHash}`);
    } catch (err) {
        logger.warn(`[QuickResume] Error saving stream info: ${err}`);
    }
}

// Get saved stream info for a content ID
function getSavedStreamInfo(contentId: string): SavedStreamInfo | null {
    try {
        const savedStreams: Record<string, SavedStreamInfo> = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.LAST_STREAMS) || '{}'
        );
        return savedStreams[contentId] || null;
    } catch {
        return null;
    }
}

// Handle Continue Watching click to use saved stream
function handleContinueWatchingClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target) return;

    // Find the clicked meta-item (Continue Watching card)
    const metaItem = target.closest('[class*="meta-item"]');
    if (!metaItem) return;

    // Check if this is in a Continue Watching row
    const boardRow = metaItem.closest('[class*="board-row"]');
    const rowTitle = boardRow?.querySelector('[class*="title"]')?.textContent?.toLowerCase() || '';

    // Only intercept Continue Watching clicks
    if (!rowTitle.includes('continue') && !rowTitle.includes('watching')) {
        return;
    }

    // Try to find the content ID from the anchor link
    const anchor = metaItem.querySelector('a[href*="/detail/"]') as HTMLAnchorElement;
    if (!anchor) return;

    // Parse href: #/detail/{type}/{id}
    const hrefMatch = anchor.href.match(/#\/detail\/([^/]+)\/([^/]+)/);
    if (!hrefMatch) return;

    const [, , contentId] = hrefMatch;

    // Check if we have a saved stream for this content
    const savedStream = getSavedStreamInfo(contentId);

    if (!savedStream) {
        logger.info(`[QuickResume] No saved stream for ${contentId}, using normal flow`);
        return;
    }

    // Check if the saved stream is recent (within 30 days)
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - savedStream.timestamp > thirtyDaysMs) {
        logger.info(`[QuickResume] Saved stream for ${contentId} is too old, using normal flow`);
        return;
    }

    // Construct the player URL
    let playerUrl = `#/player/${savedStream.videoId}/${savedStream.streamHash}`;

    // Add episode ID if it's a series
    if (savedStream.type === 'series' && savedStream.season && savedStream.episode) {
        playerUrl += `/${savedStream.season}:${savedStream.episode}`;
    }

    logger.info(`[QuickResume] Intercepting Continue Watching click, navigating to: ${playerUrl}`);

    // Prevent default navigation
    e.preventDefault();
    e.stopPropagation();

    // Navigate directly to player
    location.hash = playerUrl;
}

// Setup Continue Watching quick resume
function setupQuickResume(): void {
    // Listen for Continue Watching clicks (capture phase to intercept before Stremio)
    document.addEventListener('click', handleContinueWatchingClick, true);
    logger.info('[QuickResume] Quick resume click handler setup');
}

function setupGlobalVideoInterception(): void {
    // NOTE: We no longer block video.play() when external player is enabled.
    // The video MUST actually play for Stremio to register it in Continue Watching.
    // Our detection system in handleExternalPlayerInterception will detect when
    // playback starts, then pause the video and navigate back.

    // Inject CSS to show loading indicator while external player is being set up
    const style = document.createElement('style');
    style.id = 'enhanced-external-player-css';
    style.textContent = `
        /* Don't dim video - let user see any error messages from Stremio */

        /* Show loading indicator at BOTTOM of screen (not blocking video/errors) */
        body.external-player-active::after {
            content: 'External player mode active';
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-size: 13px;
            z-index: 99999;
            background: rgba(0,0,0,0.75);
            padding: 10px 20px;
            border-radius: 20px;
            pointer-events: none;
            border: 1px solid rgba(255,255,255,0.2);
        }
    `;
    document.head.appendChild(style);

    // Watch for clicks on play buttons (including homepage Continue button)
    document.addEventListener('click', handlePlayButtonClick, true);

    logger.info('[ExternalPlayer] Global video interception setup complete');
}

// Inject CSS styles for collapsible sections
function injectCollapsibleStyles(): void {
    const existingStyle = document.getElementById('enhanced-collapsible-css');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'enhanced-collapsible-css';
    style.textContent = `
        .enhanced-collapsible {
            margin: 1rem 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.02);
        }

        .enhanced-collapsible-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.05);
            transition: background-color 0.2s ease;
            user-select: none;
        }

        .enhanced-collapsible-header:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .enhanced-collapsible-title {
            font-size: 14px;
            font-weight: 500;
            color: white;
        }

        .enhanced-collapsible-icon {
            transition: transform 0.3s ease;
            color: rgba(255, 255, 255, 0.6);
        }

        .enhanced-collapsible.collapsed .enhanced-collapsible-icon {
            transform: rotate(-90deg);
        }

        .enhanced-collapsible-content {
            padding: 16px;
            max-height: 2000px;
            overflow: hidden;
            transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.3s ease;
            opacity: 1;
        }

        .enhanced-collapsible.collapsed .enhanced-collapsible-content {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            opacity: 0;
        }

        /* Style adjustments for nested options */
        .enhanced-collapsible .option-vFOAS {
            margin-bottom: 0.5rem;
        }

        .enhanced-collapsible .option-vFOAS:last-of-type {
            margin-bottom: 0;
        }
    `;
    document.head.appendChild(style);
    logger.info("Collapsible section styles injected");
}

function injectAboutSectionStyles(): void {
    const existingStyle = document.getElementById('enhanced-about-css');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'enhanced-about-css';
    style.textContent = `
        .about-link {
            color: #7b5bf5 !important;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s ease;
        }
        
        .about-link:hover {
            color: #9b7bf5 !important;
            text-decoration: underline;
        }
    `;
    document.head.appendChild(style);
    logger.info("About section styles injected");
}

// Flag to track if delegated handler is already set up for general collapsibles
let collapsibleDelegatedHandlerSetup = false;

// Setup delegated click handlers for collapsible sections (excludes plugin groups which have their own handler)
function setupCollapsibleHandlers(): void {
    // Set up delegated event handler once
    if (!collapsibleDelegatedHandlerSetup) {
        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            // Check if clicked element is within a collapsible header
            const header = target.closest('.enhanced-collapsible-header');
            if (!header) return;

            // Skip if this is a plugin group header (handled by setupPluginGroupHandlers)
            if (header.closest('.plugin-group')) return;

            const collapsible = header.closest('.enhanced-collapsible');
            if (collapsible) {
                collapsible.classList.toggle('collapsed');

                // Save state to localStorage
                const section = header.getAttribute('data-section');
                if (section) {
                    const isCollapsed = collapsible.classList.contains('collapsed');
                    localStorage.setItem(`enhanced-collapsible-${section}`, isCollapsed ? 'collapsed' : 'expanded');
                }
            }
        });
        collapsibleDelegatedHandlerSetup = true;
        logger.info('Collapsible delegated click handler initialized');
    }

    // Restore saved states for any collapsible headers currently in DOM
    setTimeout(() => {
        const headers = document.querySelectorAll('.enhanced-collapsible-header');

        headers.forEach(header => {
            // Skip plugin group headers (handled separately)
            if (header.closest('.plugin-group')) return;

            // Skip if state already restored for this element
            if (header.hasAttribute('data-collapsible-state-restored')) return;
            header.setAttribute('data-collapsible-state-restored', 'true');

            // Restore saved state (default to collapsed)
            const section = header.getAttribute('data-section');
            if (section) {
                const savedState = localStorage.getItem(`enhanced-collapsible-${section}`);
                const collapsible = header.closest('.enhanced-collapsible');
                if (collapsible) {
                    // Default to collapsed, only expand if explicitly saved as expanded
                    if (savedState !== 'expanded') {
                        collapsible.classList.add('collapsed');
                    }
                }
            }
        });

        logger.info(`Collapsible state restored for ${headers.length} sections`);
    }, TIMEOUTS.NAVIGATION_DEBOUNCE);
}

// Handle clicks on play buttons before navigation
function handlePlayButtonClick(e: MouseEvent): void {
    const externalPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);

    // Only handle if external player is set
    if (!externalPlayer ||
        externalPlayer === EXTERNAL_PLAYERS.BUILTIN ||
        externalPlayer === '' ||
        externalPlayer === 'disabled' ||
        externalPlayer === 'm3u') {
        return;
    }

    const target = e.target as HTMLElement;
    if (!target) return;

    // Check if clicked element is a play button (various selectors)
    const playButton = target.closest('[class*="play-icon"], [class*="play-btn"], [class*="action-play"], [class*="PlayIcon"], .play-button, .continue-watching-item');

    if (playButton) {
        logger.info('[ExternalPlayer] Play button clicked - preparing for external player');
        // DON'T set isHandlingExternalPlayer here - that flag is used to prevent
        // re-entry in handleExternalPlayerInterception. Setting it here would
        // cause the actual handler to return early without doing anything!
        // Just add the visual class to show loading indicator.
        document.body.classList.add('external-player-active');
    }
}

// Create a collapsible plugin group section
function createPluginGroupSection(title: string, description: string, groupId: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'enhanced-collapsible plugin-group';
    section.id = groupId;

    section.innerHTML = `
        <div class="enhanced-collapsible-header" data-section="${groupId}">
            <div class="enhanced-collapsible-title-container">
                <span class="enhanced-collapsible-title">${title}</span>
                <span class="enhanced-collapsible-subtitle">${description}</span>
            </div>
            <svg class="enhanced-collapsible-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>
        <div class="enhanced-collapsible-content" id="${groupId}-content">
        </div>
    `;

    return section;
}

// Flag to track if delegated handler is already set up
let pluginGroupDelegatedHandlerSetup = false;

// Setup delegated click handler for plugin group sections
// Uses event delegation for reliable click handling regardless of when elements are added
function setupPluginGroupHandlers(): void {
    // Set up delegated event handler once (handles all current and future plugin group headers)
    if (!pluginGroupDelegatedHandlerSetup) {
        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            // Check if clicked element is within a plugin group header
            const header = target.closest('.plugin-group .enhanced-collapsible-header');
            if (!header) return;

            const collapsible = header.closest('.enhanced-collapsible');
            if (collapsible) {
                collapsible.classList.toggle('collapsed');

                const section = header.getAttribute('data-section');
                if (section) {
                    const isCollapsed = collapsible.classList.contains('collapsed');
                    localStorage.setItem(`plugin-group-${section}`, isCollapsed ? 'collapsed' : 'expanded');
                }
            }
        });
        pluginGroupDelegatedHandlerSetup = true;
        logger.info('Plugin group delegated click handler initialized');
    }

    // Restore saved states for any plugin group headers currently in DOM
    setTimeout(() => {
        const headers = document.querySelectorAll('.plugin-group .enhanced-collapsible-header');

        headers.forEach(header => {
            // Skip if state already restored for this element
            if (header.hasAttribute('data-plugin-group-state-restored')) return;
            header.setAttribute('data-plugin-group-state-restored', 'true');

            // Restore saved state (default to collapsed)
            const section = header.getAttribute('data-section');
            if (section) {
                const savedState = localStorage.getItem(`plugin-group-${section}`);
                const collapsible = header.closest('.enhanced-collapsible');
                if (collapsible) {
                    // Default to collapsed, only expand if explicitly saved as expanded
                    if (savedState !== 'expanded') {
                        collapsible.classList.add('collapsed');
                    }
                }
            }
        });

        logger.info(`Plugin group state restored for ${headers.length} groups`);
    }, TIMEOUTS.NAVIGATION_DEBOUNCE);
}

// Inject styles for plugin groups
function injectPluginGroupStyles(): void {
    const existingStyle = document.getElementById('enhanced-plugin-group-css');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'enhanced-plugin-group-css';
    style.textContent = `
        .plugin-group {
            margin: 1rem 0;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.03);
        }

        .plugin-group .enhanced-collapsible-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.06);
            transition: background-color 0.2s ease;
            user-select: none;
        }

        .plugin-group .enhanced-collapsible-header:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .enhanced-collapsible-title-container {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .plugin-group .enhanced-collapsible-title {
            font-size: 15px;
            font-weight: 600;
            color: white;
        }

        .enhanced-collapsible-subtitle {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            font-weight: 400;
        }

        .plugin-group .enhanced-collapsible-icon {
            transition: transform 0.3s ease;
            color: rgba(255, 255, 255, 0.6);
            flex-shrink: 0;
        }

        .plugin-group.collapsed .enhanced-collapsible-icon {
            transform: rotate(-90deg);
        }

        .plugin-group .enhanced-collapsible-content {
            padding: 12px 16px;
            max-height: 2000px;
            overflow: hidden;
            transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.3s ease;
            opacity: 1;
        }

        .plugin-group.collapsed .enhanced-collapsible-content {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            opacity: 0;
        }

        .plugin-group .addon-whmdO {
            margin-bottom: 0.75rem;
        }

        .plugin-group .addon-whmdO:last-child {
            margin-bottom: 0;
        }
    `;
    document.head.appendChild(style);
    logger.info("Plugin group styles injected");
}
