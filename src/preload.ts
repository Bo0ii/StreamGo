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
import { applyUserAppearance } from "./components/appearance-category/appearanceCategory";
import { applyTweaks, initPerformanceMode } from "./components/tweaks-category/tweaksCategory";
import { handlePlusRoute, injectPlusNavButton, resetPlusButtonInjection } from "./components/plus-page/plusPage";
import { injectPartyButton, handlePartyRoute, resetPartyButtonInjection, initPartySystem } from "./components/party-button/partyButton";
import partyService from "./utils/PartyService";
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
const OBSERVER_DEBOUNCE_MS = 200; // Increased from 100ms to reduce CPU usage

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
// NAVIGATION STATE MANAGER
// Coordinates all navigation-related DOM manipulation to prevent flickering
// ============================================
interface NavigationState {
    isTransitioning: boolean;
    lastHash: string;
    transitionStartTime: number;
    pendingCallbacks: (() => void)[];
    transitionTimeout: ReturnType<typeof setTimeout> | null;
}

const navState: NavigationState = {
    isTransitioning: false,
    lastHash: '',
    transitionStartTime: 0,
    pendingCallbacks: [],
    transitionTimeout: null
};

function startNavTransition(): void {
    // Clear any existing transition timeout
    if (navState.transitionTimeout) {
        clearTimeout(navState.transitionTimeout);
    }

    navState.isTransitioning = true;
    navState.transitionStartTime = Date.now();
    navState.lastHash = location.hash;

    // Signal to CSS/plugins that we're transitioning
    document.body.classList.add('streamgo-nav-transitioning');

    // Auto-end transition after duration (safety fallback)
    navState.transitionTimeout = setTimeout(() => {
        endNavTransition();
    }, TIMEOUTS.NAV_TRANSITION_DURATION + 100);
}

function endNavTransition(): void {
    if (!navState.isTransitioning) return;

    navState.isTransitioning = false;
    document.body.classList.remove('streamgo-nav-transitioning');

    // Clear timeout if still active
    if (navState.transitionTimeout) {
        clearTimeout(navState.transitionTimeout);
        navState.transitionTimeout = null;
    }

    // Execute all pending callbacks
    const callbacks = navState.pendingCallbacks;
    navState.pendingCallbacks = [];
    callbacks.forEach(cb => {
        try {
            cb();
        } catch (e) {
            logger.error(`Error executing nav transition callback: ${e}`);
        }
    });
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

    // Initialize party system (WebSocket sync for watch parties)
    initPartySystem();
    setupPartyListeners();

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

    // Check and install bundled addons on first login (silently)
    checkAndInstallBundledAddons();

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

    // Initialize nav bar fixes (rename Board to Home, ensure elements visible)
    initNavBarFixes();

    // Inject Plus nav button in top bar
    injectPlusNavButton();

    // Inject Watch Party button on detail pages
    injectPartyButton();

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
        // Start coordinated navigation transition to prevent flickering
        startNavTransition();

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

            // Sync stream to party if user is party owner
            syncStreamToParty();

            // Initialize party video sync (play/pause/seek)
            initPartyVideoSync();
        } else {
            // Cleanup player overlay and video filter when leaving player page
            cleanupPlayerOverlay();
            cleanupVideoFilter();

            // Cleanup party video sync
            cleanupPartyVideoSync();

            // Reset external player flag if stuck (safety mechanism)
            if (isHandlingExternalPlayer) {
                logger.warn("[ExternalPlayer] Resetting stuck flag on navigation away from player");
                isHandlingExternalPlayer = false;
                document.body.classList.remove('external-player-active');
            }
        }

        // Icon injection is now handled by initNavBarFixes() handleNavFixes callback
        // which runs after NAV_TRANSITION_DURATION to ensure DOM has settled
        // Only inject intro logo here (separate concern from nav bar icons)
        setTimeout(() => {
            injectIntroLogo();
        }, TIMEOUTS.NAVIGATION_DEBOUNCE);

        // Handle Plus page route - dedicated page for StreamGo settings
        if (handlePlusRoute()) {
            logger.info("[Navigation] Plus page route handled");
            return;
        }

        // Handle party button - inject on detail pages
        handlePartyRoute();
        resetPartyButtonInjection();
        injectPartyButton();

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
            logger.info("Adding 'Plus' section...");
            Settings.addSection("enhanced", "Plus");
            Settings.addCategory("About", "enhanced", getAboutIcon());

            writeAbout();
        }

        // ALWAYS inject styles and setup handlers on every settings visit
        // These functions are idempotent (check for existing styles/handlers internally)
        // This ensures handlers are re-attached when DOM is recreated after navigation
        injectAboutSectionStyles();

        // Setup collapsible handlers - ALWAYS called to re-attach handlers after navigation
        // The handler functions check for data-*-handler attributes to avoid duplicates
        setupCollapsibleHandlers();

        // Browse plugins/themes from StreamGo registry (Community Marketplace)
        setupBrowseModsButton();

        // Check for updates button
        setupCheckUpdatesButton();

        // CheckForUpdatesOnStartup toggle
        setupCheckUpdatesOnStartupToggle();

        // Discord Rich Presence toggle
        setupDiscordRpcToggle();

        // Enable transparency toggle
        setupTransparencyToggle();

        // Inject external player options into Stremio's native Player settings
        injectExternalPlayerOptions();

        // Setup custom player path in About section
        setupCustomPlayerPath();

        // ModManager listeners - safe to call multiple times
        ModManager.togglePluginListener();
        ModManager.scrollListener();
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
    // appendChild on existing element moves it to end (no remove/recreate needed)
    document.head.appendChild(themeElement);
    logger.info("Theme position refreshed - moved to end of head for CSS priority");
}

// Bundled Stremio addons to auto-install on first login
const BUNDLED_ADDONS = [
    'https://torrentio.strem.fun/manifest.json'
];

/**
 * Silently install bundled Stremio addons on first login
 * Only runs once when user logs in for the first time
 */
async function installBundledAddons(): Promise<void> {
    try {
        // Check if already installed
        const alreadyInstalled = localStorage.getItem(STORAGE_KEYS.BUNDLED_ADDONS_INSTALLED) === 'true';
        if (alreadyInstalled) {
            logger.info('Bundled addons already marked as installed');
            return;
        }

        // Get auth key from profile (user must be logged in)
        const profileStr = localStorage.getItem('profile');
        if (!profileStr) {
            logger.info('User not logged in yet, skipping addon installation');
            return;
        }

        let profile;
        try {
            profile = JSON.parse(profileStr);
        } catch (error) {
            logger.warn('Invalid profile data:', error);
            return;
        }

        const authKey = profile?.auth?.key;
        if (!authKey) {
            logger.warn('No auth key found in profile');
            return;
        }

        logger.info('Starting bundled addon installation process...');

        // Get current addons from Stremio API
        logger.info('Fetching current addons from Stremio API...');
        const getResponse = await fetch('https://api.strem.io/api/addonCollectionGet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'AddonCollectionGet', authKey })
        });

        if (!getResponse.ok) {
            logger.error(`Failed to fetch current addons: HTTP ${getResponse.status}`);
            return;
        }

        const getData = await getResponse.json();
        if (!getData.result || !Array.isArray(getData.result.addons)) {
            logger.error('Invalid response from addonCollectionGet:', getData);
            return;
        }

        const existingAddons = getData.result.addons || [];
        logger.info(`Found ${existingAddons.length} existing addon(s)`);

        const existingUrls = new Set(
            existingAddons.map((addon: any) => addon.transportUrl || addon.manifestUrl)
        );

        // Filter out addons that are already installed
        const addonsToInstall = BUNDLED_ADDONS.filter(url => !existingUrls.has(url));

        logger.info(`Addons to install: ${addonsToInstall.length} of ${BUNDLED_ADDONS.length}`);

        if (addonsToInstall.length === 0) {
            // All addons already installed, verify they're actually there
            const allPresent = BUNDLED_ADDONS.every(url => existingUrls.has(url));
            if (allPresent) {
                localStorage.setItem(STORAGE_KEYS.BUNDLED_ADDONS_INSTALLED, 'true');
                logger.info('All bundled addons verified as installed');
                return;
            } else {
                logger.warn('Bundled addons missing despite check - continuing installation');
            }
        }

        // Fetch manifests for new addons
        logger.info('Fetching manifests for new addons...');
        const newAddons = [];
        const failedAddons = [];

        for (const addonUrl of addonsToInstall) {
            try {
                logger.info(`Fetching manifest from: ${addonUrl}`);
                const manifestResponse = await fetch(addonUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });

                if (!manifestResponse.ok) {
                    logger.error(`Failed to fetch manifest for ${addonUrl}: HTTP ${manifestResponse.status}`);
                    failedAddons.push(addonUrl);
                    continue;
                }

                const manifest = await manifestResponse.json();

                if (!manifest || !manifest.id || !manifest.name) {
                    logger.error(`Invalid manifest from ${addonUrl}:`, manifest);
                    failedAddons.push(addonUrl);
                    continue;
                }

                newAddons.push({
                    transportUrl: addonUrl,
                    manifestUrl: addonUrl,
                    manifest: manifest
                });
                logger.info(`✓ Successfully fetched manifest for "${manifest.name}" (${manifest.id})`);
            } catch (error) {
                logger.error(`Error fetching manifest for ${addonUrl}:`, error);
                failedAddons.push(addonUrl);
            }
        }

        if (newAddons.length === 0) {
            logger.error('Failed to fetch any addon manifests. Failed URLs:', failedAddons);
            return;
        }

        if (failedAddons.length > 0) {
            logger.warn(`Failed to fetch ${failedAddons.length} addon manifest(s):`, failedAddons);
        }

        // Combine existing addons with new ones
        const updatedAddons = [...existingAddons, ...newAddons];
        logger.info(`Preparing to install ${newAddons.length} new addon(s)...`);

        // Install via Stremio API
        const setResponse = await fetch('https://api.strem.io/api/addonCollectionSet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'AddonCollectionSet',
                authKey: authKey,
                addons: updatedAddons
            })
        });

        if (!setResponse.ok) {
            logger.error(`Failed to install addons: HTTP ${setResponse.status}`);
            return;
        }

        const setData = await setResponse.json();

        if (setData.result?.success) {
            // Verify installation by checking the collection again
            logger.info('Installation API call succeeded, verifying...');

            const verifyResponse = await fetch('https://api.strem.io/api/addonCollectionGet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'AddonCollectionGet', authKey })
            });

            if (verifyResponse.ok) {
                const verifyData = await verifyResponse.json();
                if (verifyData.result?.addons) {
                    const verifyUrls = new Set(
                        verifyData.result.addons.map((addon: any) => addon.transportUrl || addon.manifestUrl)
                    );
                    const allInstalled = BUNDLED_ADDONS.every(url => verifyUrls.has(url));

                    if (allInstalled) {
                        localStorage.setItem(STORAGE_KEYS.BUNDLED_ADDONS_INSTALLED, 'true');
                        logger.info(`✓ Successfully installed and verified ${newAddons.length} bundled addon(s)`);
                        logger.info('Installed addons:', newAddons.map(a => a.manifest.name).join(', '));

                        // Reload to update UI with new addons
                        setTimeout(() => {
                            logger.info('Reloading to show bundled addons...');
                            window.location.reload();
                        }, 1000);
                    } else {
                        logger.error('Installation reported success but verification failed - addons not found in collection');
                        logger.error('Expected URLs:', BUNDLED_ADDONS);
                        logger.error('Found URLs:', Array.from(verifyUrls));
                    }
                }
            } else {
                logger.warn('Verification request failed but installation succeeded - marking as installed');
                localStorage.setItem(STORAGE_KEYS.BUNDLED_ADDONS_INSTALLED, 'true');

                // Reload to update UI
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        } else {
            logger.error('Failed to install bundled addons. API response:', setData);
        }
    } catch (error) {
        logger.error('Critical error installing bundled addons:', error);
    }
}

/**
 * Check for user login and install bundled addons on first login
 * Polls until user logs in, then installs once
 */
function checkAndInstallBundledAddons(): void {
    const alreadyInstalled = localStorage.getItem(STORAGE_KEYS.BUNDLED_ADDONS_INSTALLED) === 'true';
    if (alreadyInstalled) {
        return;
    }

    // Check immediately first
    installBundledAddons().catch(err => {
        logger.error('Error in initial bundled addon check:', err);
    });

    // If user not logged in yet, poll every 2 seconds (max 60 seconds = 30 checks)
    let checkCount = 0;
    const maxChecks = 30;
    
    const checkInterval = setInterval(async () => {
        checkCount++;
        
        const profileStr = localStorage.getItem('profile');
        if (profileStr) {
            try {
                const profile = JSON.parse(profileStr);
                if (profile?.auth?.key) {
                    // User is logged in, install addons
                    clearInterval(checkInterval);
                    await installBundledAddons();
                }
            } catch {
                // Invalid profile, continue checking
            }
        }

        // Stop checking after max attempts
        if (checkCount >= maxChecks) {
            clearInterval(checkInterval);
        }
    }, 2000);
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
        // Check if icon already exists in this nav bar AND is still in the document
        const existingIcon = navBar.querySelector('.app-icon-glass-theme');
        if (existingIcon && document.body.contains(existingIcon)) {
            return; // Icon exists and is in DOM, no need to re-inject
        }

        // Clean up any orphaned icons that might be in document but not in the main nav bar
        const orphanedIcons = document.querySelectorAll('.app-icon-glass-theme');
        orphanedIcons.forEach(icon => {
            // Only remove if not inside main-nav-bars-container
            if (!icon.closest('[class*="main-nav-bars-container"]')) {
                icon.remove();
            }
        });

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

    // Function to find and inject icon into the VISIBLE navigation bar only
    const tryInjectIcon = (): void => {
        // Find all horizontal nav bars inside main-nav-bars-container
        const allNavBars = document.querySelectorAll('[class*="main-nav-bars-container"] [class*="horizontal-nav-bar-container"]');

        // Find the VISIBLE nav bar (width > 0)
        let visibleNavBar: HTMLElement | undefined;
        for (let i = 0; i < allNavBars.length; i++) {
            const navBar = allNavBars[i] as HTMLElement;
            const rect = navBar.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                visibleNavBar = navBar;
                break;
            }
        }

        if (visibleNavBar) {
            injectIconIntoNavBar(visibleNavBar);
            return; // Successfully injected, exit
        }

        // If no visible nav bar found, schedule a retry
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

// Rename "Board" to "Home" and ensure nav elements stay visible on all pages
let navFixObserverActive = false;

function initNavBarFixes(): void {
    // Function to rename "Board" to "Home" in navigation
    const renameBoardToHome = (): void => {
        // Find all navigation links with "Board" text
        const navSelectors = [
            '[class*="nav-tab-button"] [class*="label"]',
            '[class*="nav-tab-button"]',
            'a[title="Board"]',
            'a[href="#/"]',
            '.nav-label'
        ];

        for (const selector of navSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                // Check if element contains "Board" text
                if (el.textContent?.trim() === 'Board') {
                    el.textContent = 'Home';
                }
                // Also update title attribute if present
                if (el.getAttribute('title') === 'Board') {
                    el.setAttribute('title', 'Home');
                }
            });
        }

        // Also check for nested text nodes using TreeWalker (more efficient than querySelectorAll('*'))
        const allNavLinks = document.querySelectorAll('[class*="vertical-nav-bar"] a, [class*="horizontal-nav-bar"] a');
        allNavLinks.forEach(link => {
            const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
                if (node.textContent?.trim() === 'Board') {
                    node.textContent = 'Home';
                }
            }
        });
    };

    // Store buttons-container HTML for recreation when Stremio doesn't create it
    let storedButtonsContainerHTML: string | null = null;
    let storedButtonsContainerClasses: string | null = null;

    // Function to ensure buttons-container (profile/fullscreen) is visible
    const ensureNavElementsVisible = (): void => {
        // Find ALL buttons-containers in the document (main nav or route-specific)
        const allButtonsContainers = document.querySelectorAll('[class*="buttons-container"]');

        // Store the first valid buttons-container we find (for recreation on other pages)
        if (!storedButtonsContainerHTML) {
            allButtonsContainers.forEach(container => {
                if (container.innerHTML && container.innerHTML.trim().length > 0) {
                    storedButtonsContainerHTML = container.innerHTML;
                    storedButtonsContainerClasses = container.className;
                    logger.info("Stored buttons-container HTML for recreation on other pages");
                }
            });
        }

        // Find the VISIBLE horizontal nav bar (width > 0)
        const allNavBars = document.querySelectorAll('[class*="main-nav-bars-container"] [class*="horizontal-nav-bar"]');
        let mainHorizontalNav: HTMLElement | undefined;

        for (let i = 0; i < allNavBars.length; i++) {
            const navBar = allNavBars[i] as HTMLElement;
            const rect = navBar.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                mainHorizontalNav = navBar;
                break;
            }
        }

        if (!mainHorizontalNav) return;

        // Find buttons-container in main nav bar
        let buttonsContainer = mainHorizontalNav.querySelector('[class*="buttons-container"]');

        // Remove any old cloned containers before potentially adding a new one
        const oldClones = mainHorizontalNav.querySelectorAll('.streamgo-buttons-clone');
        oldClones.forEach((clone: Element) => clone.remove());

        // If buttons-container doesn't exist in main nav, try to find one elsewhere or recreate
        if (!buttonsContainer) {
            // First, check if there's one in route content to clone
            const routeButtonsContainer = document.querySelector(
                '[class*="route-content"] [class*="horizontal-nav-bar"] [class*="buttons-container"]'
            );

            if (routeButtonsContainer && routeButtonsContainer.innerHTML.trim().length > 0) {
                // Clone from route content
                const clonedContainer = routeButtonsContainer.cloneNode(true) as HTMLElement;
                clonedContainer.classList.add('streamgo-buttons-clone');
                mainHorizontalNav.appendChild(clonedContainer);
                buttonsContainer = clonedContainer;
                logger.info("Cloned buttons-container from route-content to main nav bar");
            } else if (storedButtonsContainerHTML) {
                // Recreate from stored HTML
                const recreatedContainer = document.createElement('div');
                recreatedContainer.className = storedButtonsContainerClasses || 'buttons-container';
                recreatedContainer.classList.add('streamgo-buttons-clone');
                recreatedContainer.innerHTML = storedButtonsContainerHTML;
                mainHorizontalNav.appendChild(recreatedContainer);
                buttonsContainer = recreatedContainer;
                logger.info("Recreated buttons-container from stored HTML in main nav bar");
            }
        }

        // Ensure buttons-container visibility in main nav with aggressive inline styles
        if (buttonsContainer) {
            const el = buttonsContainer as HTMLElement;
            el.style.cssText = `
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: absolute !important;
                right: 16px !important;
                top: 50% !important;
                transform: translateY(-50%) !important;
                z-index: 100 !important;
                align-items: center !important;
                gap: 10px !important;
                margin-left: 20px !important;
            `;

            // Ensure search bar doesn't overlap with buttons
            const searchBar = mainHorizontalNav.querySelector('[class*="search-bar"]') as HTMLElement;
            if (searchBar) {
                searchBar.style.marginRight = '80px';
            }

            // Inject party button into horizontal nav buttons-container (after fullscreen)
            if (!buttonsContainer.querySelector('#nav-party-btn')) {
                const fullscreenBtn = buttonsContainer.querySelector('[title*="fullscreen"]');
                if (fullscreenBtn) {
                    const partyBtn = document.createElement('div');
                    partyBtn.id = 'nav-party-btn';
                    partyBtn.setAttribute('tabindex', '-1');
                    partyBtn.setAttribute('title', 'Watch Party');
                    partyBtn.className = fullscreenBtn.className;
                    partyBtn.innerHTML = `
                        <svg class="icon-T8MU6" viewBox="0 0 24 24" style="width: 22px; height: 22px;">
                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" style="fill: currentcolor;"></path>
                        </svg>
                        <span id="nav-party-indicator" style="display: none; position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; border: 2px solid rgba(0,0,0,0.3);"></span>
                    `;
                    partyBtn.style.position = 'relative';
                    partyBtn.style.cursor = 'pointer';

                    // Insert after fullscreen button
                    if (fullscreenBtn.nextSibling) {
                        fullscreenBtn.parentElement?.insertBefore(partyBtn, fullscreenBtn.nextSibling);
                    } else {
                        fullscreenBtn.parentElement?.appendChild(partyBtn);
                    }

                    // Add click handler
                    partyBtn.addEventListener('click', () => {
                        import("./components/party-popover/partyPopover").then(({ openPartyPopover }) => {
                            openPartyPopover();
                        });
                    });

                    // Add hover effect
                    partyBtn.addEventListener('mouseenter', () => {
                        partyBtn.style.color = '#10b981';
                    });
                    partyBtn.addEventListener('mouseleave', () => {
                        if (!partyService.connected) {
                            partyBtn.style.color = '';
                        }
                    });

                    logger.info('Injected party button into horizontal nav bar');
                }
            }

            // Update party button state
            updateNavPartyButtonState();
        }

        // Also ensure any buttons-containers in other nav bars are visible
        allButtonsContainers.forEach(container => {
            const el = container as HTMLElement;
            if (el.style.display === 'none' || el.style.visibility === 'hidden') {
                el.style.display = '';
                el.style.visibility = '';
            }
            if (!el.style.zIndex || parseInt(el.style.zIndex) < 100) {
                el.style.zIndex = '100';
            }
        });

        // Ensure app icon is visible
        const appIcons = document.querySelectorAll('.app-icon-glass-theme');
        appIcons.forEach(icon => {
            const el = icon as HTMLElement;
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '0.7';
        });
    };

    // Run fixes immediately
    renameBoardToHome();
    ensureNavElementsVisible();

    // Set up observer to keep fixing on DOM changes
    if (!navFixObserverActive) {
        registerObserverHandler('nav-fixes', () => {
            renameBoardToHome();
            ensureNavElementsVisible();
            // Also check Plus button on DOM changes
            if (!document.getElementById('plus-nav-button')) {
                injectPlusNavButton();
            }
        });
        navFixObserverActive = true;
    }

    // Set up observer for party button on detail pages
    registerObserverHandler('party-button', () => {
        // Only inject on detail pages
        if (location.hash.includes('#/detail/')) {
            if (!document.getElementById('party-watch-button')) {
                injectPartyButton();
            }
        }
    });

    // Main navigation routes that should show blur loading
    const mainNavRoutes = ['#/', '#/discover', '#/library', '#/calendar', '#/addons', '#/settings'];

    // Check if current route is a main nav page
    const isMainNavRoute = (hash: string): boolean => {
        return mainNavRoutes.some(route => hash === route || hash.startsWith(route + '/') || hash.startsWith(route + '?'));
    };

    // Create page loading blur overlay (for Glass theme)
    const createLoadingOverlay = (): HTMLElement => {
        let overlay = document.getElementById('streamgo-page-loader');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'streamgo-page-loader';
            document.body.appendChild(overlay);
        }
        return overlay;
    };

    // Show loading blur overlay
    const showLoadingOverlay = (): void => {
        const overlay = createLoadingOverlay();
        // Force reflow for smooth animation
        overlay.offsetHeight;
        overlay.classList.remove('fade-out');
        overlay.classList.add('active');
    };

    // Hide loading blur overlay with fade
    const hideLoadingOverlay = (): void => {
        const overlay = document.getElementById('streamgo-page-loader');
        if (overlay && overlay.classList.contains('active')) {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.classList.remove('active', 'fade-out');
            }, 350);
        }
    };

    // Also run on hashchange to catch navigation - INSTANT rebuild with animation
    const handleNavFixes = (): void => {
        // Reset Plus button injection attempts at start of each navigation
        resetPlusButtonInjection();

        // Only show blur loading for main nav routes (Home, Discover, Library, Calendar, Addons, Settings)
        const currentHash = location.hash || '#/';
        if (isMainNavRoute(currentHash)) {
            showLoadingOverlay();
        }

        // Add loading class for fade-in animation
        const mainNav = document.querySelector('[class*="main-nav-bars-container"]');
        if (mainNav) {
            mainNav.classList.add('streamgo-nav-loading');
        }

        // Run ALL fixes as fast as possible to rebuild nav bar instantly
        const runAllFixes = (): void => {
            renameBoardToHome();
            ensureNavElementsVisible();
            injectAppIconInGlassTheme();
            injectPlusNavButton();
        };

        // Run fixes with strategic timing (reduced from 11 calls to 3 for performance)
        runAllFixes();
        requestAnimationFrame(runAllFixes);
        setTimeout(runAllFixes, 100);

        // Remove loading states after fixes complete
        setTimeout(() => {
            if (mainNav) {
                mainNav.classList.remove('streamgo-nav-loading');
            }
            runAllFixes();
        }, 150);

        // Hide blur overlay after extra 500ms delay (total ~650ms)
        setTimeout(() => {
            hideLoadingOverlay();
        }, 650);
    };

    // Remove any existing listener before adding (prevent duplicates)
    window.removeEventListener('hashchange', handleNavFixes);
    window.addEventListener('hashchange', handleNavFixes);
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

    // Party button
    const partyBtn = titleBar.querySelector("#titlebar-party-btn");
    if (partyBtn) {
        partyBtn.addEventListener("click", () => {
            // Import dynamically to avoid circular dependency
            import("./components/party-popover/partyPopover").then(({ openPartyPopover }) => {
                openPartyPopover();
            });
        });

        // Update party button state
        updateTitleBarPartyState();
    }
}

/**
 * Update title bar party button state
 */
function updateTitleBarPartyState(): void {
    const partyBtn = document.querySelector("#titlebar-party-btn");
    if (!partyBtn) return;

    if (partyService.connected && partyService.room) {
        partyBtn.classList.add("party-active");
        partyBtn.setAttribute("title", `Watch Party: ${partyService.room.name} (${partyService.room.members.length} members)`);
    } else {
        partyBtn.classList.remove("party-active");
        partyBtn.setAttribute("title", "Watch Party");
    }
}

// Update nav bar party button state (horizontal nav)
function updateNavPartyButtonState(): void {
    const partyBtn = document.querySelector("#nav-party-btn") as HTMLElement;
    const indicator = document.querySelector("#nav-party-indicator") as HTMLElement;
    if (!partyBtn) return;

    if (partyService.connected && partyService.room) {
        partyBtn.style.color = '#10b981';
        partyBtn.setAttribute("title", `Watch Party: ${partyService.room.name} (${partyService.room.members.length} members)`);
        if (indicator) {
            indicator.style.display = 'block';
        }
    } else {
        partyBtn.style.color = '';
        partyBtn.setAttribute("title", "Watch Party");
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
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
                
                // Check if container is visible (not hidden by display:none or visibility:hidden)
                const style = window.getComputedStyle(container);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    continue;
                }

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
                
                // Check if VLC/MPC-HC options already exist in THIS container (not globally)
                // Only skip if they exist in the current visible container
                const existingVlc = container.querySelector('[data-enhanced-option="vlc"]');
                const existingMpchc = container.querySelector('[data-enhanced-option="mpchc"]');
                if (existingVlc && existingMpchc) {
                    // Options already exist, but ensure they're properly set up and visible
                    // Also update selected state based on current selection
                    updateSelectedState(container, existingItems);
                    continue;
                }

                // Remove any old injected options from this container first (cleanup)
                const oldVlc = container.querySelector('[data-enhanced-option="vlc"]');
                const oldMpchc = container.querySelector('[data-enhanced-option="mpchc"]');
                if (oldVlc) oldVlc.remove();
                if (oldMpchc) oldMpchc.remove();

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

                // Create MPV option
                const mpvOption = itemTemplate.cloneNode(true) as HTMLElement;
                mpvOption.dataset.enhancedOption = 'mpv';
                mpvOption.className = mpvOption.className.replace(/selected[^\s]*/gi, '').replace(/checked[^\s]*/gi, '');
                setOptionText(mpvOption, 'MPV');

                // Style options to be visually consistent
                vlcOption.style.cursor = 'pointer';
                mpchcOption.style.cursor = 'pointer';
                mpvOption.style.cursor = 'pointer';

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
                const mpvClickHandler = (e: Event) => handlePlayerSelect('mpv', 'MPV', e);
                vlcOption.addEventListener('click', vlcClickHandler);
                mpchcOption.addEventListener('click', mpchcClickHandler);
                mpvOption.addEventListener('click', mpvClickHandler);
                registerEventCleanup('external-player-menu', () => {
                    vlcOption.removeEventListener('click', vlcClickHandler);
                    mpchcOption.removeEventListener('click', mpchcClickHandler);
                    mpvOption.removeEventListener('click', mpvClickHandler);
                });

                // Add hover effect with cleanup registration
                [vlcOption, mpchcOption, mpvOption].forEach(opt => {
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
                itemsParent.appendChild(mpvOption);

                // Also track when native options are clicked with cleanup
                existingItems.forEach(item => {
                    const clickHandler = () => {
                        const text = (item.textContent || '').toLowerCase().trim();
                        let displayName = text;
                        if (text === 'disabled') {
                            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, EXTERNAL_PLAYERS.BUILTIN);
                            displayName = 'Disabled';
                        } else if (text.includes('m3u')) {
                            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, 'm3u');
                            displayName = 'M3U';
                        }
                        logger.info(`External player set to: ${text}`);
                        updateButtonText(displayName);
                        updatePlayerPathDisplay();
                    };
                    item.addEventListener('click', clickHandler);
                    registerEventCleanup('external-player-menu', () => {
                        item.removeEventListener('click', clickHandler);
                    });
                });

                // Ensure all menu items are visible (Stremio might hide some)
                existingItems.forEach(item => {
                    const el = item as HTMLElement;
                    const itemStyle = window.getComputedStyle(el);
                    if (itemStyle.display === 'none') {
                        el.style.display = '';
                    }
                    if (itemStyle.visibility === 'hidden') {
                        el.style.visibility = 'visible';
                    }
                    if (itemStyle.opacity === '0') {
                        el.style.opacity = '1';
                    }
                });

                // Update selected state after injection
                updateSelectedState(container, existingItems);

                logger.info("VLC, MPC-HC, and MPV options injected successfully");
                return true;
            }
        }
        return false;
    };

    // Helper function to update selected state in the menu
    const updateSelectedState = (container: HTMLElement, existingItems: NodeListOf<Element>) => {
        const currentPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER) || EXTERNAL_PLAYERS.BUILTIN;
        
        // Clear all selected states first
        const allItems = container.querySelectorAll('div[class*="option"], div[class*="menu-item"], div[class*="item"]');
        allItems.forEach(item => {
            const el = item as HTMLElement;
            el.className = el.className.replace(/selected[^\s]*/gi, '').replace(/checked[^\s]*/gi, '');
        });

        // Set selected state based on current player
        let targetItem: HTMLElement | null = null;
        
        if (currentPlayer === 'vlc') {
            targetItem = container.querySelector('[data-enhanced-option="vlc"]') as HTMLElement;
        } else if (currentPlayer === 'mpchc') {
            targetItem = container.querySelector('[data-enhanced-option="mpchc"]') as HTMLElement;
        } else if (currentPlayer === 'm3u' || currentPlayer === EXTERNAL_PLAYERS.BUILTIN) {
            // Find the matching native option
            existingItems.forEach(item => {
                const text = (item.textContent || '').toLowerCase().trim();
                if ((currentPlayer === 'm3u' && text.includes('m3u')) ||
                    (currentPlayer === EXTERNAL_PLAYERS.BUILTIN && text === 'disabled')) {
                    targetItem = item as HTMLElement;
                }
            });
        }

        // Apply selected state
        if (targetItem) {
            // Try to add selected/checked class (Stremio might use various class names)
            const hasSelected = targetItem.className.match(/selected|checked/i);
            if (!hasSelected) {
                // Try common patterns
                const classes = targetItem.className.split(/\s+/);
                for (const cls of classes) {
                    if (cls.includes('option') || cls.includes('item')) {
                        // Try to find a selected variant
                        const selectedClass = cls.replace(/(option|item)/i, '$1-selected') || 
                                             cls.replace(/(option|item)/i, '$1-checked') ||
                                             cls + '-selected';
                        targetItem.className += ' ' + selectedClass;
                        break;
                    }
                }
            }
        }
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
                    logger.info(`[ExternalPlayer] Updated button text to: ${text}`);
                } else {
                    // Try to find any text-containing element
                    const textContainers = button.querySelectorAll('*');
                    let updated = false;
                    textContainers.forEach(container => {
                        if (container.children.length === 0 && container.textContent) {
                            container.textContent = text;
                            updated = true;
                        }
                    });
                    if (updated) {
                        logger.info(`[ExternalPlayer] Updated button text to: ${text} (fallback method)`);
                    }
                }
            } else {
                logger.warn('[ExternalPlayer] Could not find multiselect button');
            }
        } else {
            logger.warn('[ExternalPlayer] Could not find option container');
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

        // Only show for VLC, MPC-HC, or MPV
        if (externalPlayer !== 'vlc' && externalPlayer !== 'mpchc' && externalPlayer !== 'mpv') return;

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
        // Process if nodes were added or attributes changed (menu visibility)
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // Small delay to ensure menu is fully rendered
                setTimeout(() => {
                    injectOptionsIntoMenu();
                }, 50);
                break;
            }
            // Also check for attribute changes that might indicate menu visibility
            if (mutation.type === 'attributes' && 
                (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                setTimeout(() => {
                    injectOptionsIntoMenu();
                }, 50);
            }
        }
    });

    // Also listen for clicks on the external player button to ensure injection
    const setupButtonClickListener = () => {
        const optionContainer = document.querySelector(OPTION_CONTAINER_SELECTOR);
        if (optionContainer) {
            const button = optionContainer.querySelector('div[class*="multiselect-button"]');
            if (button && !button.hasAttribute('data-click-listener-attached')) {
                button.setAttribute('data-click-listener-attached', 'true');
                button.addEventListener('click', () => {
                    // Small delay to let the menu appear
                    setTimeout(() => {
                        injectOptionsIntoMenu();
                    }, 100);
                });
            }
        }
    };

    // Set up button click listener when settings page loads
    if (location.href.includes('#/settings')) {
        waitForElementWithBackoff(OPTION_CONTAINER_SELECTOR).then(() => {
            setupButtonClickListener();
        });
    }

    // Update button text and path display on load based on saved setting
    // Use exponential backoff instead of fixed interval (95% fewer DOM queries)
    const savedPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER) || EXTERNAL_PLAYERS.BUILTIN;
    waitForElementWithBackoff(OPTION_CONTAINER_SELECTOR).then((optionContainer) => {
        if (optionContainer) {
            let displayName = 'Disabled';
            if (savedPlayer === 'vlc') {
                displayName = 'VLC';
            } else if (savedPlayer === 'mpchc') {
                displayName = 'MPC-HC';
            } else if (savedPlayer === 'mpv') {
                displayName = 'MPV';
            } else if (savedPlayer === 'm3u') {
                displayName = 'M3U';
            }

            // Retry mechanism to handle race conditions with Stremio's initialization
            // Try multiple times with delays to ensure our update persists
            const retryUpdate = (attempts: number = 0) => {
                updateButtonText(displayName);
                if (attempts < 3) {
                    setTimeout(() => retryUpdate(attempts + 1), 200);
                }
            };
            retryUpdate();

            if (savedPlayer === 'vlc' || savedPlayer === 'mpchc' || savedPlayer === 'mpv') {
                updatePlayerPathDisplay();
            }
        }
    });

    // Cleanup on navigation away from settings
    const cleanup = () => {
        if (!location.href.includes('#/settings')) {
            unregisterObserverHandler('external-player-menu');
            runEventCleanups('external-player-menu');
            window.removeEventListener('hashchange', cleanup);
            // Reset the initialization flag so it can be set up again when returning to settings
            externalPlayerOptionsInitialized = false;
        } else {
            // Re-setup button click listener and restore button text when returning to settings
            waitForElementWithBackoff(OPTION_CONTAINER_SELECTOR).then((optionContainer) => {
                setupButtonClickListener();

                // Restore button text from saved setting
                if (optionContainer) {
                    const currentPlayer = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER) || EXTERNAL_PLAYERS.BUILTIN;
                    let displayName = 'Disabled';
                    if (currentPlayer === 'vlc') {
                        displayName = 'VLC';
                    } else if (currentPlayer === 'mpchc') {
                        displayName = 'MPC-HC';
                    } else if (currentPlayer === 'mpv') {
                        displayName = 'MPV';
                    } else if (currentPlayer === 'm3u') {
                        displayName = 'M3U';
                    }

                    // Retry mechanism to handle race conditions with Stremio's initialization
                    const retryUpdate = (attempts: number = 0) => {
                        updateButtonText(displayName);
                        if (attempts < 3) {
                            setTimeout(() => retryUpdate(attempts + 1), 200);
                        }
                    };
                    retryUpdate();

                    if (currentPlayer === 'vlc' || currentPlayer === 'mpchc' || currentPlayer === 'mpv') {
                        updatePlayerPathDisplay();
                    }
                }
            });
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

    // Only handle VLC, MPC-HC, and MPV
    if (externalPlayer !== 'vlc' && externalPlayer !== 'mpchc' && externalPlayer !== 'mpv') {
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
                if (elapsed > 0 && elapsed % 5000 < 500) {
                    logger.info(`[ExternalPlayer] Still waiting... readyState: ${video.readyState}, currentTime: ${video.currentTime}, elapsed: ${(elapsed/1000).toFixed(0)}s`);
                }
            }
        }, 500); // Increased from 100ms to reduce CPU usage
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

function getAboutIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
        <g><path fill="none" d="M0 0h24v24H0z"></path>
        <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" style="fill:currentcolor"></path></g></svg>`;
}

function injectPerformanceCSS(): void {
    // Minimal - just disable smooth scroll behavior
    const style = document.createElement('style');
    style.id = 'enhanced-scroll-state-css';
    style.textContent = `
        html { scroll-behavior: auto !important; }
    `;
    document.head.appendChild(style);
    logger.info("Minimal performance CSS injected");
}

// Detect active scrolling to apply performance optimizations
// @ts-ignore: Intentionally unused, kept for future use
function _setupScrollStateDetection(): void {
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
    let isScrolling = false;

    // Short debounce for responsive feel (100ms)
    const SCROLL_END_DELAY = 100;

    // Pre-cache classList references for micro-optimization
    const bodyClassList = document.body.classList;
    const htmlClassList = document.documentElement.classList;

    // Throttled scroll handler - fires at most once per frame
    let ticking = false;
    const handleScroll = () => {
        // Throttle to one update per animation frame
        if (ticking) return;
        ticking = true;

        requestAnimationFrame(() => {
            ticking = false;

            // Add scrolling class on first scroll event
            if (!isScrolling) {
                isScrolling = true;
                bodyClassList.add('scrolling-active');
                htmlClassList.add('performance-mode');
            }

            // Clear previous timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Set timeout to detect scroll end
            scrollTimeout = setTimeout(() => {
                isScrolling = false;
                bodyClassList.remove('scrolling-active');
                htmlClassList.remove('performance-mode');
            }, SCROLL_END_DELAY);
        });
    };

    // Use capture phase and passive for best performance
    // Passive means we can't call preventDefault, but we don't need to
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    // Handle wheel events for immediate response (before actual scroll)
    document.addEventListener('wheel', handleScroll, { passive: true });

    // Handle touch scrolling
    document.addEventListener('touchmove', handleScroll, { passive: true });

    logger.info("Scroll state detection initialized (100ms debounce, RAF-throttled)");
}

// ============================================
// HOVER INTENT SYSTEM
// Delays expensive hover operations until user actually intends to hover
// Cancels immediately on mouse leave to prevent wasted work
// NOTE: Currently disabled, kept for future use
// ============================================
// @ts-ignore: Intentionally unused, kept for future implementation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _setupHoverIntent(): void {
    const HOVER_INTENT_DELAY = 200; // ms before triggering expensive hover effects
    const hoverTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
    const hoveredElements = new WeakSet<Element>();

    // Delegate hover detection to document for efficiency
    document.addEventListener('mouseover', (e) => {
        const target = e.target as Element;
        if (!target) return;

        // Find the closest meta-item-container (poster card)
        const posterCard = target.closest('[class*="meta-item-container"]');
        if (!posterCard) return;

        // Don't process if already hovered
        if (hoveredElements.has(posterCard)) return;

        // Cancel any existing timer for this element
        const existingTimer = hoverTimers.get(posterCard);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set a delayed timer for hover intent
        const timer = setTimeout(() => {
            // Only apply hover effect if mouse is still over the element
            if (posterCard.matches(':hover')) {
                hoveredElements.add(posterCard);
                posterCard.classList.add('hover-intent-active');
            }
        }, HOVER_INTENT_DELAY);

        hoverTimers.set(posterCard, timer);
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        const target = e.target as Element;
        if (!target) return;

        const posterCard = target.closest('[class*="meta-item-container"]');
        if (!posterCard) return;

        // Immediately cancel the hover intent timer
        const timer = hoverTimers.get(posterCard);
        if (timer) {
            clearTimeout(timer);
            hoverTimers.delete(posterCard);
        }

        // Remove hover state immediately (no delay on leave)
        hoveredElements.delete(posterCard);
        posterCard.classList.remove('hover-intent-active');
    }, { passive: true });

    // Add CSS for hover-intent-active state
    const hoverIntentStyle = document.createElement('style');
    hoverIntentStyle.id = 'hover-intent-css';
    hoverIntentStyle.textContent = `
        /* Only apply expensive effects after hover intent confirmed */
        [class*="meta-item-container"].hover-intent-active [class*="poster-container"] {
            transform: translateZ(0) scale(1.03) !important;
            transition-delay: 0ms !important;
        }

        /* Trailer/preview loading only starts after hover intent */
        [class*="meta-item-container"]:not(.hover-intent-active) [class*="preview"],
        [class*="meta-item-container"]:not(.hover-intent-active) [class*="trailer"] {
            display: none !important;
        }
    `;
    document.head.appendChild(hoverIntentStyle);

    logger.info("Hover intent system initialized (200ms delay, instant cancel)");
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

/**
 * Party Video Sync System
 * Handles real-time video synchronization between party members
 */
let lastSyncedStreamUrl: string | null = null;
let partyVideoListenersActive = false;
let partyVideoElement: HTMLVideoElement | null = null;
let isRemoteAction = false; // Flag to prevent feedback loops

// Video event handlers for party sync
// All party members can control playback (bidirectional sync)
function onPartyVideoPlay(): void {
    if (isRemoteAction || !partyService.connected) return;
    logger.info('[Party] Video played - broadcasting');
    partyService.broadcastMemberStateChange(partyVideoElement!, true);
}

function onPartyVideoPause(): void {
    if (isRemoteAction || !partyService.connected) return;
    logger.info('[Party] Video paused - broadcasting');
    partyService.broadcastMemberStateChange(partyVideoElement!, true);
}

function onPartyVideoSeeked(): void {
    if (isRemoteAction || !partyService.connected) return;
    logger.info('[Party] Video seeked - broadcasting');
    partyService.broadcastMemberStateChange(partyVideoElement!, true);
}

function onPartyVideoRateChange(): void {
    if (isRemoteAction || !partyService.connected) return;
    logger.info('[Party] Playback rate changed - broadcasting');
    partyService.broadcastMemberStateChange(partyVideoElement!, false);
}

/**
 * Initialize party video sync when entering player
 */
function initPartyVideoSync(): void {
    if (!partyService.connected || !partyService.room) {
        logger.info('[Party] Not in party, skipping video sync init');
        removeFloatingPartyChatIcon();
        return;
    }

    // Show floating chat icon for all party members
    createFloatingPartyChatIcon();

    // Wait for video element
    const checkForVideo = setInterval(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video) {
            clearInterval(checkForVideo);
            setupPartyVideoListeners(video);
        }
    }, 500); // Increased from 200ms to reduce CPU usage

    // Stop checking after 10 seconds
    setTimeout(() => clearInterval(checkForVideo), 10000);
}

/**
 * Setup video event listeners for party sync
 */
function setupPartyVideoListeners(video: HTMLVideoElement): void {
    if (partyVideoListenersActive) return;

    partyVideoElement = video;
    partyVideoListenersActive = true;

    // Ensure isRemoteAction starts as false when setting up new video
    isRemoteAction = false;

    logger.info('[Party] Setting up video sync listeners, isHost:', partyService.isHost);
    console.log('[Party] isRemoteAction reset to false, ready for new video');

    // Add event listeners for host to broadcast changes
    video.addEventListener('play', onPartyVideoPlay);
    video.addEventListener('pause', onPartyVideoPause);
    video.addEventListener('seeked', onPartyVideoSeeked);
    video.addEventListener('ratechange', onPartyVideoRateChange);

    // Start periodic sync if host
    if (partyService.isHost) {
        partyService.startSync(() => partyVideoElement);
        logger.info('[Party] Started periodic sync as host');
    }

    logger.info('[Party] Video sync listeners active');
}

/**
 * Cleanup party video sync when leaving player
 */
function cleanupPartyVideoSync(): void {
    if (!partyVideoListenersActive || !partyVideoElement) return;

    logger.info('[Party] Cleaning up video sync listeners');

    partyVideoElement.removeEventListener('play', onPartyVideoPlay);
    partyVideoElement.removeEventListener('pause', onPartyVideoPause);
    partyVideoElement.removeEventListener('seeked', onPartyVideoSeeked);
    partyVideoElement.removeEventListener('ratechange', onPartyVideoRateChange);

    partyService.stopSync();
    partyVideoElement = null;
    partyVideoListenersActive = false;

    // CRITICAL: Reset the remote action flag to prevent it from staying true
    // when switching to a new video. If this flag stays true, the host won't
    // be able to broadcast events, causing sync to break on subsequent videos.
    isRemoteAction = false;
    logger.info('[Party] Reset isRemoteAction flag');

    // Reset stream sync state to allow syncing to new videos
    // Don't clear lastSyncedStreamUrl here - keep it for comparison
    logger.info('[Party] Video sync cleanup complete');

    // Remove floating chat icon when leaving player
    removeFloatingPartyChatIcon();
}

/**
 * Setup party event listeners (called once on startup)
 */
function setupPartyListeners(): void {
    // Listen for commands from host
    partyService.on('command', ({ latency, command, data }: { latency: number; command: string; data: any }) => {
        logger.info('[Party] Received command:', command);

        // Handle stream update commands (navigate to same video)
        if (command === 'updateStream') {
            const streamUrl = data?.url;

            // Always sync to host's stream unless we're already there
            if (streamUrl && streamUrl !== location.hash) {
                logger.info('[Party] Host changed stream - syncing to:', streamUrl);
                console.log('[Party] Previous stream:', lastSyncedStreamUrl);
                console.log('[Party] New stream:', streamUrl);
                console.log('[Party] Current location:', location.hash);

                lastSyncedStreamUrl = streamUrl;
                location.hash = streamUrl;
            } else if (streamUrl === location.hash) {
                logger.info('[Party] Already at host stream:', streamUrl);
            }
            return;
        }

        // Handle video state sync commands (play/pause/seek)
        if (command === 'state') {
            const video = document.querySelector('video') as HTMLVideoElement;
            if (!video || !partyService.autoSync) return;

            // Set flag to prevent feedback loop
            // NOTE: We process commands regardless of host status. The server ensures
            // only hosts can send commands, so we trust all incoming commands.
            isRemoteAction = true;

            try {
                const stateData = data as { time: number; paused: boolean; playbackSpeed?: number; force?: boolean };

                // Calculate latency compensation
                const latencySeconds = (latency + partyService.latency) / 1000;
                const targetTime = stateData.time + latencySeconds;
                const timeDiff = Math.abs(video.currentTime - targetTime);

                // Sync time if difference is significant or forced
                // Use 2.5 second tolerance to reduce buffering on different connection speeds
                const maxDelay = 2.5 * (stateData.playbackSpeed || 1);
                if (timeDiff > maxDelay || stateData.force) {
                    logger.info('[Party] Syncing time:', targetTime, 'diff:', timeDiff);
                    video.currentTime = targetTime;
                }

                // Sync play/pause state
                if (stateData.paused !== video.paused) {
                    if (stateData.paused) {
                        logger.info('[Party] Syncing: pause');
                        video.pause();
                    } else {
                        logger.info('[Party] Syncing: play');
                        video.play().catch(() => {});
                    }
                }

                // Sync playback speed
                if (stateData.playbackSpeed && video.playbackRate !== stateData.playbackSpeed) {
                    video.playbackRate = stateData.playbackSpeed;
                }
            } finally {
                // Reset flag after a short delay to allow events to fire
                setTimeout(() => { isRemoteAction = false; }, 100);
            }
        }
    });

    // Listen for chat messages to show overlay in player
    partyService.on('message', (msg: { senderId: string; senderName: string; text: string }) => {
        if (msg.senderId === 'system') return;

        // Show chat overlay if in player
        if (location.hash.includes('#/player')) {
            showPartyChatOverlay(msg.senderName, msg.text);
        }
    });

    // Update title bar when room state changes
    partyService.on('room', () => {
        updateTitleBarPartyState();
        updateNavPartyButtonState();
        updateFloatingChatIconCount();
        // Also try to show floating icon if we're in player (for late room updates)
        if (location.hash.includes('#/player')) {
            createFloatingPartyChatIcon();
        }
    });

    partyService.on('disconnected', () => {
        updateTitleBarPartyState();
        updateNavPartyButtonState();
        removeFloatingPartyChatIcon();
        // Reset stream sync state so next party session works correctly
        lastSyncedStreamUrl = null;
        logger.info('[Party] Reset lastSyncedStreamUrl on disconnect');
    });

    // When joining a new party, reset sync state
    partyService.on('connected', () => {
        lastSyncedStreamUrl = null;
        logger.info('[Party] Reset lastSyncedStreamUrl on new connection');
        // If already in player, initialize video sync for new party
        if (location.hash.includes('#/player')) {
            initPartyVideoSync();
        }
    });

    // Expose partyService to window for plugins
    (window as any).partyService = partyService;

    // Expose openPartyPopover to window for plugins
    (window as any).openPartyPopover = () => {
        import("./components/party-popover/partyPopover").then(({ openPartyPopover }) => {
            openPartyPopover();
        });
    };

    // Listen for custom event from plugins
    window.addEventListener('streamgo:openPartyPopover', () => {
        import("./components/party-popover/partyPopover").then(({ openPartyPopover }) => {
            openPartyPopover();
        });
    });

    logger.info('[Party] Party listeners initialized');
}

/**
 * Show chat message overlay in player
 */
function showPartyChatOverlay(senderName: string, text: string): void {
    // Create or reuse container
    let container = document.getElementById('party-chat-overlay-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'party-chat-overlay-container';
        container.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 300px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    // Create message element
    const msgEl = document.createElement('div');
    msgEl.className = 'party-chat-overlay-msg';
    msgEl.style.cssText = `
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(10px);
        padding: 8px 12px;
        border-radius: 8px;
        color: rgba(255, 255, 255, 0.9);
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: partyChatFadeIn 0.3s ease-out;
        opacity: 0.85;
    `;
    msgEl.innerHTML = `<strong style="color: #10b981;">${escapeHtml(senderName)}:</strong> ${escapeHtml(text)}`;

    // Add animation styles if not present
    if (!document.getElementById('party-chat-overlay-styles')) {
        const style = document.createElement('style');
        style.id = 'party-chat-overlay-styles';
        style.textContent = `
            @keyframes partyChatFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 0.85; transform: translateY(0); }
            }
            @keyframes partyChatFadeOut {
                from { opacity: 0.85; transform: translateY(0); }
                to { opacity: 0; transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(msgEl);

    // Remove after 5 seconds
    setTimeout(() => {
        msgEl.style.animation = 'partyChatFadeOut 0.3s ease-out forwards';
        setTimeout(() => {
            msgEl.remove();
            // Clean up container if empty to avoid ghost element
            const containerEl = document.getElementById('party-chat-overlay-container');
            if (containerEl && containerEl.children.length === 0) {
                containerEl.remove();
            }
        }, 300);
    }, 5000);

    // Keep only last 3 messages
    while (container.children.length > 3) {
        container.firstChild?.remove();
    }
}

/**
 * Helper to escape HTML
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Track mouse activity for floating icon visibility
let partyIconMouseTimeout: ReturnType<typeof setTimeout> | null = null;

function setPartyIconActive(active: boolean): void {
    const wrapper = document.getElementById('party-floating-chat-icon');
    if (wrapper) {
        if (active) {
            wrapper.classList.add('mouse-active');
        } else {
            wrapper.classList.remove('mouse-active');
        }
    }
}

function handlePartyIconMouseMove(): void {
    if (!document.getElementById('party-floating-chat-icon')) return;

    setPartyIconActive(true);

    if (partyIconMouseTimeout) {
        clearTimeout(partyIconMouseTimeout);
    }

    // Hide after 3 seconds of no mouse movement (matches video controls)
    partyIconMouseTimeout = setTimeout(() => {
        setPartyIconActive(false);
    }, 3000);
}

/**
 * Create floating party chat icon for player view
 * Shows for ALL party members, not just host
 * Visible when mouse active, fades when inactive
 */
function createFloatingPartyChatIcon(): void {
    // Only show in player and when in party
    if (!location.hash.includes('#/player') || !partyService.connected || !partyService.room) {
        removeFloatingPartyChatIcon();
        return;
    }

    // Already exists
    if (document.getElementById('party-floating-chat-icon')) return;

    // Create wrapper for proper badge positioning
    const wrapper = document.createElement('div');
    wrapper.id = 'party-floating-chat-icon';
    wrapper.className = 'mouse-active'; // Start visible
    wrapper.title = 'Party Chat (Press C)';
    wrapper.style.cssText = `
        position: fixed;
        bottom: 100px;
        right: 20px;
        z-index: 999998;
        cursor: pointer;
    `;

    // Create the icon container
    const icon = document.createElement('div');
    icon.className = 'party-float-icon-inner';
    icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
    `;

    // Create the badge (outside the icon container)
    const badge = document.createElement('span');
    badge.className = 'party-chat-member-count';
    badge.textContent = partyService.room.members.length.toString();

    wrapper.appendChild(icon);
    wrapper.appendChild(badge);

    // Add styles
    if (!document.getElementById('party-floating-icon-styles')) {
        const style = document.createElement('style');
        style.id = 'party-floating-icon-styles';
        style.textContent = `
            /* Inactive state (mouse not moving) - very subtle */
            #party-floating-chat-icon .party-float-icon-inner {
                width: 40px;
                height: 40px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: rgba(255, 255, 255, 0.15);
                transition: all 0.4s ease;
            }
            #party-floating-chat-icon .party-chat-member-count {
                position: absolute;
                top: -2px;
                right: -2px;
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.3);
                font-size: 9px;
                font-weight: 600;
                min-width: 16px;
                height: 16px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 3px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: all 0.4s ease;
            }

            /* Active state (mouse moving) - fully visible */
            #party-floating-chat-icon.mouse-active .party-float-icon-inner {
                background: rgba(255, 255, 255, 0.12);
                color: rgba(255, 255, 255, 0.9);
            }
            #party-floating-chat-icon.mouse-active .party-chat-member-count {
                background: rgba(255, 255, 255, 0.25);
                color: rgba(255, 255, 255, 0.9);
            }

            /* Hover state - highlighted */
            #party-floating-chat-icon:hover .party-float-icon-inner {
                background: rgba(255, 255, 255, 0.2);
                color: white;
                transform: scale(1.05);
            }
            #party-floating-chat-icon:hover .party-chat-member-count {
                background: rgba(255, 255, 255, 0.35);
                color: rgba(255, 255, 255, 0.9);
            }
        `;
        document.head.appendChild(style);
    }

    wrapper.addEventListener('click', toggleQuickChat);
    document.body.appendChild(wrapper);

    // Add mouse move listener for visibility
    document.addEventListener('mousemove', handlePartyIconMouseMove);

    // Start the timeout to fade out after 3 seconds
    partyIconMouseTimeout = setTimeout(() => {
        setPartyIconActive(false);
    }, 3000);

    logger.info('[Party] Created floating chat icon');
}

/**
 * Remove floating party chat icon
 */
function removeFloatingPartyChatIcon(): void {
    const icon = document.getElementById('party-floating-chat-icon');
    if (icon) {
        icon.remove();
        // Clean up mouse listener
        document.removeEventListener('mousemove', handlePartyIconMouseMove);
        if (partyIconMouseTimeout) {
            clearTimeout(partyIconMouseTimeout);
            partyIconMouseTimeout = null;
        }
        logger.info('[Party] Removed floating chat icon');
    }
}

/**
 * Update floating chat icon member count
 */
function updateFloatingChatIconCount(): void {
    const countEl = document.querySelector('#party-floating-chat-icon .party-chat-member-count');
    if (countEl && partyService.room) {
        countEl.textContent = partyService.room.members.length.toString();
    }
}

/**
 * Quick chat panel - press C key in player to toggle
 */
let quickChatOpen = false;

function toggleQuickChat(): void {
    if (!partyService.connected || !partyService.room) return;
    quickChatOpen ? closeQuickChat() : openQuickChat();
}

function openQuickChat(): void {
    if (document.getElementById('party-quick-chat')) return;
    quickChatOpen = true;

    const panel = document.createElement('div');
    panel.id = 'party-quick-chat';
    panel.style.cssText = `position: fixed; bottom: 80px; right: 20px; width: 320px; max-height: 300px; background: rgba(15, 15, 17, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; z-index: 999999; display: flex; flex-direction: column; animation: quickChatSlideIn 0.2s ease-out; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);`;
    panel.innerHTML = `<div style="padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;"><span style="color: #10b981; font-weight: 600; font-size: 13px;">Party Chat (${partyService.room?.members.length || 0})</span><span style="color: rgba(255,255,255,0.4); font-size: 11px;">C or Esc to close</span></div><div id="party-quick-chat-messages" style="flex: 1; overflow-y: auto; padding: 10px 14px; max-height: 180px; display: flex; flex-direction: column; gap: 6px; scrollbar-width: none;"></div><div style="padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.1);"><input type="text" id="party-quick-chat-input" placeholder="Type a message..." maxlength="500" style="width: 100%; padding: 10px 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; font-size: 13px; outline: none; box-sizing: border-box;" /></div>`;

    if (!document.getElementById('party-quick-chat-styles')) {
        const style = document.createElement('style');
        style.id = 'party-quick-chat-styles';
        style.textContent = `@keyframes quickChatSlideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } } @keyframes quickChatSlideOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(20px); } } #party-quick-chat-messages::-webkit-scrollbar { display: none; } #party-quick-chat-input:focus { border-color: #10b981; background: rgba(255,255,255,0.1); }`;
        document.head.appendChild(style);
    }
    document.body.appendChild(panel);

    const messagesContainer = document.getElementById('party-quick-chat-messages');
    if (messagesContainer) {
        partyService.messages.slice(-10).forEach(msg => {
            const msgEl = document.createElement('div');
            msgEl.style.cssText = 'font-size: 12px; color: rgba(255,255,255,0.9);';
            if (msg.senderId === 'system') { msgEl.style.cssText += 'color: rgba(255,255,255,0.5); font-style: italic; text-align: center;'; msgEl.textContent = msg.text; }
            else { msgEl.innerHTML = `<strong style="color: ${msg.isHost ? '#fbbf24' : '#10b981'};">${escapeHtml(msg.senderName)}:</strong> ${escapeHtml(msg.text)}`; }
            messagesContainer.appendChild(msgEl);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    const input = document.getElementById('party-quick-chat-input') as HTMLInputElement;
    if (input) {
        setTimeout(() => input.focus(), 50);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { partyService.sendChatMessage(input.value.trim()); input.value = ''; } else if (e.key === 'Escape') { closeQuickChat(); } e.stopPropagation(); });
    }

    const messageHandler = (msg: { senderName: string; text: string; senderId: string; isHost: boolean }) => {
        const container = document.getElementById('party-quick-chat-messages');
        if (container) {
            const msgEl = document.createElement('div');
            msgEl.style.cssText = 'font-size: 12px; color: rgba(255,255,255,0.9);';
            if (msg.senderId === 'system') { msgEl.style.cssText += 'color: rgba(255,255,255,0.5); font-style: italic; text-align: center;'; msgEl.textContent = msg.text; }
            else { msgEl.innerHTML = `<strong style="color: ${msg.isHost ? '#fbbf24' : '#10b981'};">${escapeHtml(msg.senderName)}:</strong> ${escapeHtml(msg.text)}`; }
            container.appendChild(msgEl);
            container.scrollTop = container.scrollHeight;
        }
    };
    partyService.on('message', messageHandler);
    (panel as any)._messageHandler = messageHandler;
}

function closeQuickChat(): void {
    const panel = document.getElementById('party-quick-chat');
    if (panel) {
        if ((panel as any)._messageHandler) partyService.off('message', (panel as any)._messageHandler);
        panel.style.animation = 'quickChatSlideOut 0.2s ease-out forwards';
        setTimeout(() => panel.remove(), 200);
    }
    quickChatOpen = false;
}

// C key shortcut for quick chat
document.addEventListener('keydown', (e) => {
    if (!location.hash.includes('#/player')) return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) return;
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); toggleQuickChat(); }
    if (e.key === 'Escape' && quickChatOpen) closeQuickChat();
});

/**
 * Sync current stream to party members
 * Only the party owner can trigger stream sync
 */
function syncStreamToParty(): void {
    try {
        if (!partyService.connected || !partyService.room) {
            logger.info('[Party] Not syncing stream - not in party');
            return;
        }

        if (!partyService.isHost) {
            logger.info('[Party] Not syncing stream - not a host');
            return;
        }

        logger.info('[Party] Host navigated to player - syncing stream...');
        console.log('[Party] Broadcasting stream to', partyService.room.members.length, 'members');

        const hash = location.hash;
        const playerMatch = hash.match(/#\/player\/([^/]+)\/([^/]+)(?:\/(.+))?/);

        if (!playerMatch) {
            logger.warn('[Party] Could not parse player URL for sync:', hash);
            return;
        }

        const [, videoId, streamHash, episodeId] = playerMatch;

        partyService.broadcastCommand('updateStream', {
            url: hash,
            videoId,
            streamHash,
            episodeId: episodeId || null
        });

        logger.info('[Party] Stream update broadcast to party:', hash);
        console.log('[Party] Broadcast complete - participants should navigate to:', hash);
    } catch (error) {
        logger.error('[Party] Error syncing stream:', error);
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
function injectAboutSectionStyles(): void {
    const existingStyle = document.getElementById('enhanced-about-css');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'enhanced-about-css';
    style.textContent = `
        .about-link {
            color: #10b981 !important;
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
