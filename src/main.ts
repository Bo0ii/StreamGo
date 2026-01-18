import { join, basename } from "path";
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { execSync } from "child_process";
import helpers from './utils/Helpers';
import Updater from "./core/Updater";
import Properties from "./core/Properties";
import logger from "./utils/logger";
import { IPC_CHANNELS, URLS } from "./constants";
import { Notification, nativeImage } from "electron";

// Fix GTK 2/3 and GTK 4 conflict on Linux
import { app } from 'electron';
if (process.platform === 'linux') app.commandLine.appendSwitch('gtk-version', '3');

import { BrowserWindow, shell, ipcMain, dialog } from "electron";
import Helpers from "./utils/Helpers";
import StremioService from "./utils/StremioService";
import ExternalPlayer from "./utils/ExternalPlayer";
import SystemTray from "./utils/SystemTray";
import StreamingConfig from "./core/StreamingConfig";

app.setName("streamgo");

// Register stremio:// protocol handler - MUST be called before app.ready
// This allows the app to handle stremio:// links from browsers
// On Windows, we need to set it even if already set to ensure proper registration
if (process.platform === 'win32') {
    // On Windows, always set to ensure proper registration
    app.setAsDefaultProtocolClient('stremio');
} else {
    // On macOS/Linux, only set if not already set
    if (!app.isDefaultProtocolClient('stremio')) {
        app.setAsDefaultProtocolClient('stremio');
    }
}

let mainWindow: BrowserWindow | null;
const transparencyFlagPath = join(app.getPath("userData"), "transparency");
const transparencyEnabled = existsSync(transparencyFlagPath);

// ============================================
// GPU & Rendering Performance Optimizations
// Optimized for smooth 144Hz+ scrolling/transitions
// ============================================

// Detect high refresh rate display
function getDisplayRefreshRate(): number {
    try {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        return primaryDisplay.displayFrequency || 60;
    } catch {
        return 60;
    }
}

// Detect if running on a laptop (has battery) vs desktop
function isLaptop(): boolean {
    try {
        if (process.platform === 'darwin') {
            // macOS: Check if battery exists using pmset
            const result = execSync('pmset -g batt 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
            // If "InternalBattery" is found, it's a laptop (MacBook)
            // Mac Mini, Mac Pro, iMac don't have internal batteries
            return result.includes('InternalBattery');
        } else if (process.platform === 'win32') {
            // Windows: Check for battery using WMIC
            const result = execSync('WMIC Path Win32_Battery Get BatteryStatus 2>nul', { encoding: 'utf8', timeout: 2000 });
            // If we get battery status data (not just headers), it's a laptop
            const lines = result.trim().split('\n').filter(line => line.trim());
            return lines.length > 1; // More than just header = has battery
        } else if (process.platform === 'linux') {
            // Linux: Check /sys/class/power_supply for battery
            const powerSupplyPath = '/sys/class/power_supply';
            if (existsSync(powerSupplyPath)) {
                const supplies = readdirSync(powerSupplyPath);
                return supplies.some(supply =>
                    supply.toLowerCase().includes('bat') ||
                    supply.toLowerCase().includes('battery')
                );
            }
        }
    } catch (err) {
        logger.warn(`[DeviceDetection] Could not determine device type: ${err}`);
    }
    // Default to desktop (use aggressive flags) if detection fails
    return false;
}

const isLaptopDevice = isLaptop();
logger.info(`[DeviceDetection] Device type: ${isLaptopDevice ? 'LAPTOP' : 'DESKTOP'}`);


// Platform-specific rendering backend
if (process.platform === "darwin") {
    logger.info("Running on macOS, using Metal for rendering");
    app.commandLine.appendSwitch('use-angle', 'metal');
    app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,MetalCompositor');
    app.commandLine.appendSwitch('enable-smooth-scrolling');
} else if (process.platform === "win32") {
    logger.info("Running on Windows, using D3D11 for rendering");
    app.commandLine.appendSwitch('use-angle', 'd3d11');
} else {
    logger.info(`Running on ${process.platform}, using OpenGL for rendering`);
    app.commandLine.appendSwitch('use-angle', 'gl');
}

// ============================================
// PERFORMANCE FLAGS - Adaptive based on device type
// Desktop: Aggressive flags for max performance
// Laptop: Conservative flags for battery/thermal efficiency
// ============================================

// Common GPU acceleration (both laptop and desktop)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-oop-rasterization');
app.commandLine.appendSwitch('canvas-oop-rasterization');
app.commandLine.appendSwitch('high-dpi-support', '1');

if (isLaptopDevice) {
    // ============================================
    // LAPTOP MODE: Conservative for battery & thermals
    // ============================================
    logger.info("[Performance] Using LAPTOP mode - VSync enabled, frame rate limited");

    // Let system manage GPU (don't force discrete)
    // VSync ON - limits to display refresh rate (60/120Hz)
    // Frame rate limiter ON - no wasted frames

    // Moderate rasterization
    app.commandLine.appendSwitch('num-raster-threads', '2');

    // Keep renderer active but allow some throttling
    app.commandLine.appendSwitch('disable-renderer-backgrounding');

} else {
    // ============================================
    // DESKTOP MODE: Aggressive for max performance
    // ============================================
    logger.info("[Performance] Using DESKTOP mode - VSync disabled, unlimited frame rate");

    // Force discrete GPU for max performance
    app.commandLine.appendSwitch('force-high-performance-gpu');

    // Unlock frame rate for smooth animations
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');

    // Aggressive rasterization
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('num-raster-threads', '4');

    // Hardware overlays and raw draw
    app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
    app.commandLine.appendSwitch('enable-raw-draw');

    // Quality settings
    app.commandLine.appendSwitch('disable-composited-antialiasing');
    app.commandLine.appendSwitch('gpu-rasterization-msaa-sample-count', '0');

    // High precision timing
    app.commandLine.appendSwitch('enable-highres-timer');

    // Keep renderer fully active
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    app.commandLine.appendSwitch('disable-hang-monitor');
}

// HEVC/H.265 hardware decoding support
if (process.platform === "win32") {
    app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport,MediaFoundationD3D11VideoCapture');
} else if (process.platform === "linux") {
    app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecoder,VaapiVideoEncoder,VaapiVideoDecodeLinuxGL');
} else {
    app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');
}

app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,UseChromeOSDirectVideoDecoder');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');

// ============================================
// Media Buffering & Network Optimizations
// Improves streaming performance for HD/4K content
// ============================================
app.commandLine.appendSwitch('media-cache-size', '268435456'); // 256MB - good balance for all platforms
app.commandLine.appendSwitch('enable-tcp-fast-open');
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-async-dns');

async function createWindow() {
    // Get the icon path - use different paths for packaged vs development
    // Windows needs .ico format, other platforms use .png
    const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
    const iconPath = app.isPackaged
        ? join(process.resourcesPath, "images", iconFile)
        : join(__dirname, "..", "images", iconFile);

    // Create native image from the icon path
    const appIcon = nativeImage.createFromPath(iconPath);

    // Set dock icon on macOS
    if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(appIcon);
    }

    mainWindow = new BrowserWindow({
        webPreferences: {
            preload: join(__dirname, "preload.js"),
            // Security Note: These settings are required for the plugin/theme system
            // to work properly. The app loads web.stremio.com and needs to:
            // 1. Make cross-origin requests to local streaming server (webSecurity: false)
            // 2. Access Node.js APIs for file operations (nodeIntegration: true)
            // 3. Share context between preload and renderer (contextIsolation: false)
            // TODO: Consider implementing a contextBridge-based architecture for better security
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
            // Enable webview tag for embedded content
            webviewTag: true,
            // Additional security hardening
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            // Performance optimizations
            backgroundThrottling: false,
            offscreen: false,
            spellcheck: false,
        },
        width: 1500,
        height: 850,
        resizable: true,
        maximizable: true,
        fullscreenable: true,
        useContentSize: false,
        paintWhenInitiallyHidden: true,
        show: false,
        icon: appIcon,
        frame: !transparencyEnabled,
        transparent: transparencyEnabled,
        hasShadow: !transparencyEnabled,
        visualEffectState: transparencyEnabled ? "active" : "followWindow",
        backgroundColor: transparencyEnabled ? "#00000000" : "#0a0a14",
    });

    mainWindow.setMenu(null);

    // Log GPU info and display refresh rate on startup
    mainWindow.webContents.on('did-finish-load', () => {
        // Log display info from main process
        const refreshRate = getDisplayRefreshRate();
        logger.info(`Display refresh rate: ${refreshRate}Hz`);

        mainWindow?.webContents.executeJavaScript(`
            (async () => {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        console.log('[GPU] Vendor:', gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
                        console.log('[GPU] Renderer:', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
                    }
                }
                console.log('[Display] Refresh rate: ${refreshRate}Hz');

                // Wait 3 seconds for page to fully load before measuring FPS
                setTimeout(() => {
                    console.log('[Performance] Measuring render FPS (vsync-paced)...');
                    let frames = 0;
                    const start = performance.now();
                    const countFrames = () => {
                        frames++;
                        if (performance.now() - start < 1000) {
                            requestAnimationFrame(countFrames);
                        } else {
                            console.log('[Performance] Measured FPS:', frames, '(should match display refresh rate)');
                            console.log('[Performance] If FPS is lower than display refresh, check for layout thrashing');
                        }
                    };
                    requestAnimationFrame(countFrames);
                }, 3000);
            })();
        `).catch(() => {});
    });

    mainWindow.loadURL(URLS.STREMIO_WEB);

    // Show window when ready to prevent white flash and ensure smooth first paint
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();

        // Initialize system tray
        if (mainWindow) {
            SystemTray.initialize(mainWindow);
        }
    });

    helpers.setMainWindow(mainWindow);

    if (transparencyEnabled) {
        mainWindow.on('enter-full-screen', () => {
            mainWindow?.webContents.send(IPC_CHANNELS.FULLSCREEN_CHANGED, true);
        });

        mainWindow.on('leave-full-screen', () => {
            mainWindow?.webContents.send(IPC_CHANNELS.FULLSCREEN_CHANGED, false);
        });
    }

    ipcMain.on(IPC_CHANNELS.MINIMIZE_WINDOW, () => {
        mainWindow?.minimize();
    });

    ipcMain.on(IPC_CHANNELS.MAXIMIZE_WINDOW, () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on(IPC_CHANNELS.CLOSE_WINDOW, () => {
        mainWindow?.close();
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_CHECK_STARTUP, async (_, checkForUpdatesOnStartup: string) => {
        logger.info(`Checking for updates on startup: ${checkForUpdatesOnStartup === "true" ? "enabled" : "disabled"}.`);
        if (checkForUpdatesOnStartup === "true") {
            await Updater.checkForUpdates(false);
        }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_CHECK_USER, async () => {
        logger.info("Checking for updates on user request.");
        await Updater.checkForUpdates(true);
    });

    // Update download and install IPC handlers
    ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD_START, async () => {
        try {
            logger.info("Starting update download...");
            const release = await Updater.getReleaseInfo();
            const platform = process.platform;
            const arch = process.arch;
            const installerUrl = Updater.getInstallerUrlForPlatform(release, platform, arch);
            
            if (!installerUrl) {
                throw new Error(`No installer found for platform ${platform} (${arch})`);
            }

            const tempDir = app.getPath("temp");
            const fileName = basename(installerUrl);
            const destPath = join(tempDir, fileName);

            logger.info(`Downloading installer from ${installerUrl} to ${destPath}`);

            // Download with progress tracking
            await Updater.downloadUpdate(installerUrl, destPath, (progress, bytesDownloaded, totalBytes) => {
                // Send progress updates to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, {
                        progress,
                        bytesDownloaded,
                        totalBytes
                    });
                }
            });

            logger.info("Download complete");
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_COMPLETE, { installerPath: destPath });
            }
            return { success: true, installerPath: destPath };
        } catch (error) {
            logger.error(`Failed to download update: ${(error as Error).message}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ERROR, {
                    stage: 'download',
                    message: (error as Error).message
                });
            }
            return { success: false, error: (error as Error).message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_START, async (_, installerPath: string) => {
        try {
            logger.info(`Starting update installation: ${installerPath}`);
            
            if (!existsSync(installerPath)) {
                throw new Error(`Installer not found: ${installerPath}`);
            }

            // Notify renderer that installation has started
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.UPDATE_INSTALL_START);
            }

            const platform = process.platform;
            await Updater.installUpdate(installerPath, platform);

            logger.info("Installation complete");
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.UPDATE_INSTALL_COMPLETE);
            }
            return { success: true };
        } catch (error) {
            logger.error(`Failed to install update: ${(error as Error).message}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ERROR, {
                    stage: 'install',
                    message: (error as Error).message
                });
            }
            return { success: false, error: (error as Error).message };
        }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_RESTART_APP, () => {
        logger.info("Restarting application after update...");
        try {
            Updater.restartApplication();
        } catch (error) {
            logger.error(`Failed to restart application: ${(error as Error).message}`);
        }
    });

    ipcMain.on(IPC_CHANNELS.SET_TRANSPARENCY, (_, enabled: boolean) => {
        if (enabled) {
            logger.info("Enabled window transparency");
            writeFileSync(transparencyFlagPath, "1");
        } else {
            logger.info("Disabled window transparency");
            try {
                unlinkSync(transparencyFlagPath);
            } catch {
                // File may not exist, ignore
            }
        }

        Helpers.showAlert("info", "Transparency setting changed", "Please restart the app to apply the changes.", ["OK"]);
    });

    ipcMain.handle(IPC_CHANNELS.GET_TRANSPARENCY_STATUS, () => {
        return existsSync(transparencyFlagPath);
    });

    // External player IPC handlers
    ipcMain.on(IPC_CHANNELS.LAUNCH_EXTERNAL_PLAYER, (event, data: { player: string; url: string; title?: string; customPath?: string }) => {
        logger.info(`Launching external player: ${data.player} with URL: ${data.url}`);
        const result = ExternalPlayer.launch(data.player, data.url, data.title, data.customPath);

        if (result.success) {
            event.sender.send(IPC_CHANNELS.EXTERNAL_PLAYER_LAUNCHED, { success: true });
        } else {
            event.sender.send(IPC_CHANNELS.EXTERNAL_PLAYER_ERROR, { error: result.error });
        }
    });

    ipcMain.handle(IPC_CHANNELS.DETECT_PLAYER, (_, player: string) => {
        return ExternalPlayer.detectPlayer(player);
    });

    ipcMain.handle(IPC_CHANNELS.BROWSE_PLAYER_PATH, async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
            title: 'Select Player Executable',
            filters: [
                { name: 'Executables', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
            ],
            properties: ['openFile']
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // Screenshot IPC handler
    ipcMain.on(IPC_CHANNELS.SAVE_SCREENSHOT, (_, data: { dataUrl: string; filename: string }) => {
        try {
            const picturesPath = app.getPath('pictures');
            const filePath = join(picturesPath, data.filename);

            // Convert data URL to buffer and save
            const base64Data = data.dataUrl.replace(/^data:image\/png;base64,/, '');
            writeFileSync(filePath, base64Data, 'base64');

            logger.info(`Screenshot saved: ${filePath}`);

            // Show notification
            if (Notification.isSupported()) {
                new Notification({
                    title: 'Screenshot Saved',
                    body: `Saved to ${data.filename}`,
                    silent: true
                }).show();
            }

            // Notify renderer of success
            mainWindow?.webContents.send(IPC_CHANNELS.SCREENSHOT_SAVED, filePath);
        } catch (err) {
            logger.error(`Failed to save screenshot: ${(err as Error).message}`);
        }
    });

    // Streaming performance configuration IPC handlers
    ipcMain.handle(IPC_CHANNELS.GET_STREAMING_CONFIG, () => {
        const currentSettings = StreamingConfig.readServerSettings();
        const currentProfile = StreamingConfig.detectCurrentProfile();
        const settingsPath = StreamingConfig.getServerSettingsPath();

        return {
            settings: currentSettings,
            profile: currentProfile,
            settingsPath: settingsPath,
        };
    });

    ipcMain.handle(IPC_CHANNELS.SET_STREAMING_PROFILE, async (_, profile: string) => {
        logger.info(`Setting streaming profile to: ${profile}`);
        const success = StreamingConfig.applyProfile(profile as Parameters<typeof StreamingConfig.applyProfile>[0]);
        return { success, profile };
    });

    ipcMain.handle(IPC_CHANNELS.RESTART_STREAMING_SERVICE, async () => {
        logger.info("Restarting streaming service to apply configuration changes...");
        const success = await StremioService.restartService();
        return { success };
    });

    // Opens links in external browser instead of opening them in the Electron app.
    mainWindow.webContents.setWindowOpenHandler((details: Electron.HandlerDetails) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });
    
    // Devtools flag
    if(process.argv.includes("--devtools")) { 
        logger.info("Developer tools flag detected. Opening DevTools in detached mode...");
        mainWindow.webContents.openDevTools({ mode: "detach" }); 
    }
}

// Use Stremio Service for streaming
// Handle stremio:// protocol URLs
function handleProtocolUrl(url: string): void {
    logger.info(`[Protocol] Received stremio:// URL: ${url}`);
    
    try {
        let manifestUrl: string | null = null;
        
        // Handle different stremio:// URL formats
        // Format 1: stremio://addon/install/<manifest-url>
        // Format 2: stremio://<hostname>/manifest.json (direct manifest URL)
        // Format 3: stremio://<encoded-manifest-url>
        
        if (url.includes('/addon/install/')) {
            // Format 1: stremio://addon/install/<manifest-url>
            const urlObj = new URL(url);
            const manifestPath = urlObj.pathname.replace('/addon/install/', '');
            manifestUrl = decodeURIComponent(manifestPath);
        } else {
            // Format 2 or 3: Try to extract manifest URL from the protocol URL
            // Remove the stremio:// prefix
            const withoutProtocol = url.replace(/^stremio:\/\//, '');
            
            // Check if it looks like a full URL (starts with http:// or https://)
            if (withoutProtocol.startsWith('http://') || withoutProtocol.startsWith('https://')) {
                manifestUrl = withoutProtocol;
            } else {
                // It's likely a hostname-based format like: stremio://hostname/manifest.json
                // Reconstruct as https:// URL
                // Handle cases like: stremio://2ecbbd610840-stremio-ar.baby-beamup.club/manifest.json
                if (withoutProtocol.includes('/')) {
                    const [hostname, ...pathParts] = withoutProtocol.split('/');
                    const path = pathParts.join('/');
                    manifestUrl = `https://${hostname}/${path}`;
                } else {
                    // Just hostname, assume manifest.json
                    manifestUrl = `https://${withoutProtocol}/manifest.json`;
                }
            }
        }
        
        if (!manifestUrl) {
            logger.warn(`[Protocol] Could not extract manifest URL from: ${url}`);
            return;
        }
        
        // Ensure manifestUrl is a valid URL
        try {
            new URL(manifestUrl);
        } catch {
            // If not a valid URL, try to fix it
            if (!manifestUrl.startsWith('http://') && !manifestUrl.startsWith('https://')) {
                manifestUrl = `https://${manifestUrl}`;
            }
        }
        
        logger.info(`[Protocol] Installing addon from manifest: ${manifestUrl}`);
        
        // Navigate to Stremio's addon installation page
        if (mainWindow && !mainWindow.isDestroyed()) {
            const baseUrl = URLS.STREMIO_WEB;
            // Navigate directly to addon installation URL
            // Stremio's web interface handles addon installation via URL parameters
            const addonUrl = `#/addons?addon=${encodeURIComponent(manifestUrl)}`;
            mainWindow.loadURL(`${baseUrl}${addonUrl}`);
            
            mainWindow.focus();
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
        } else {
            // Window not ready yet, store for later
            logger.warn("[Protocol] Main window not ready, addon URL will be handled when window loads");
            // Queue the URL for when window is ready
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    handleProtocolUrl(url);
                }
            }, 1000);
        }
    } catch (error) {
        logger.error(`[Protocol] Error parsing stremio:// URL: ${(error as Error).message}`);
        logger.error(`[Protocol] Full error stack: ${(error as Error).stack}`);
    }
}

// Handle single instance lock for Windows/Linux
// This prevents multiple instances and handles protocol URLs when app is already running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Another instance is already running, quit this one
    app.quit();
} else {
    // Handle second instance (when app is already running and protocol link is clicked)
    app.on('second-instance', (_event, commandLine) => {
        // Someone tried to run a second instance, focus our window instead
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
        // Handle protocol URL from command line
        const protocolUrl = commandLine.find(arg => arg.startsWith('stremio://'));
        if (protocolUrl) {
            handleProtocolUrl(protocolUrl);
        }
    });
}

app.on("ready", async () => {
    logger.info("Enhanced version: v" + Updater.getCurrentVersion());
    logger.info("Running on NodeJS version: " + process.version);
    logger.info("Running on Electron version: v" + process.versions.electron);
    logger.info("Running on Chromium version: v" + process.versions.chrome);

    logger.info("User data path: " + app.getPath("userData"));
    logger.info("Themes path: " + Properties.themesPath);
    logger.info("Plugins path: " + Properties.pluginsPath);

    // Handle protocol URLs when app is opened via stremio:// link
    if (process.platform === 'darwin') {
        // macOS: handle open-url event
        app.on('open-url', (event, url) => {
            event.preventDefault();
            handleProtocolUrl(url);
        });
    } else {
        // Windows/Linux: handle protocol URL from command line args
        // On Windows, protocol URLs are passed as command line arguments
        // Check all arguments for stremio:// URLs
        const protocolUrls = process.argv.filter(arg => arg.startsWith('stremio://'));
        if (protocolUrls.length > 0) {
            // Handle the first protocol URL found
            handleProtocolUrl(protocolUrls[0]);
        }
        
        // Also check for URLs that might have been passed differently
        // Sometimes Windows passes it as a single argument with quotes
        const allArgs = process.argv.join(' ');
        const urlMatch = allArgs.match(/stremio:\/\/[^\s"']+/);
        if (urlMatch && protocolUrls.length === 0) {
            handleProtocolUrl(urlMatch[0]);
        }
    }

    try {
        const basePath = Properties.enhancedPath;
    
        if (!existsSync(basePath)) {
            mkdirSync(basePath, { recursive: true });
        }
        if (!existsSync(Properties.themesPath)) {
            mkdirSync(Properties.themesPath, { recursive: true });
        }
        if (!existsSync(Properties.pluginsPath)) {
            mkdirSync(Properties.pluginsPath, { recursive: true });
        }
    } catch (err) {
        logger.error("Failed to create necessary directories: " + err);
    }
    
    if(!process.argv.includes("--no-stremio-server")) {
        if(!await StremioService.isProcessRunning()) {
            logger.info("Starting bundled Stremio Service...");
            try {
                await StremioService.start();
                logger.info("Stremio Service started successfully.");
            } catch (err) {
                logger.error(`Failed to start Stremio Service: ${(err as Error).message}`);
            }
        } else {
            logger.info("Stremio Service is already running.");
        }
    } else logger.info("Launching without Stremio streaming server.");
    
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Cleanup handler for when the app is about to quit
    app.on("before-quit", () => {
        logger.info("App is quitting, terminating all services...");

        // Destroy system tray
        SystemTray.destroy();

        // Always terminate Stremio Service when app quits (not just if we started it)
        if (!process.argv.includes("--no-stremio-service")) {
            StremioService.forceTerminate();
        }
    });

    // Fallback cleanup for crash scenarios
    app.on("will-quit", () => {
        logger.info("App will quit, ensuring service cleanup...");
        if (!process.argv.includes("--no-stremio-service")) {
            StremioService.forceTerminate();
        }
    });
});

app.on("window-all-closed", () => {
    logger.info("Closing app...");

    // Always terminate Stremio Service when all windows are closed
    if (!process.argv.includes("--no-stremio-service")) {
        StremioService.forceTerminate();
    }

    // Quit on all platforms (including macOS) when windows are closed
    app.quit();
});

app.on('browser-window-created', (_, window) => {
    window.webContents.on('before-input-event', (event: Electron.Event, input: Electron.Input) => {
        switch (true) {
            // Opens Devtools on Ctrl + Shift + I
            case input.control && input.shift && input.key === 'I':
                window.webContents.toggleDevTools();
                event.preventDefault();
                break;
    
            // Toggles fullscreen on F11
            case input.key === 'F11':
                window.setFullScreen(!window.isFullScreen());
                event.preventDefault();
                break;
    
            // Implements zooming in/out using shortcuts (Ctrl + =, Ctrl + -)
            case input.control && input.key === '=':
                if (mainWindow) mainWindow.webContents.zoomFactor += 0.1;
                event.preventDefault();
                break;
            case input.control && input.key === '-':
                if (mainWindow) mainWindow.webContents.zoomFactor -= 0.1;
                event.preventDefault();
                break;
    
            // Implements reload on Ctrl + R
            case input.control && input.key === 'r':
                mainWindow?.reload();
                event.preventDefault();
                break;
        }
    });
});