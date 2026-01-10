import { join } from "path";
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "fs";
import helpers from './utils/Helpers';
import Updater from "./core/Updater";
import Properties from "./core/Properties";
import logger from "./utils/logger";
import { IPC_CHANNELS, URLS } from "./constants";
import { Notification } from "electron";

// Fix GTK 2/3 and GTK 4 conflict on Linux
import { app } from 'electron';
if (process.platform === 'linux') app.commandLine.appendSwitch('gtk-version', '3');

import { BrowserWindow, shell, ipcMain, dialog } from "electron";
import StreamingServer from "./utils/StreamingServer";
import Helpers from "./utils/Helpers";
import StremioService from "./utils/StremioService";
import ExternalPlayer from "./utils/ExternalPlayer";

app.setName("streamgo");

let mainWindow: BrowserWindow | null;
const transparencyFlagPath = join(app.getPath("userData"), "transparency");
const useStremioServiceFlagPath = join(app.getPath("userData"), "use_stremio_service_for_streaming");
const useServerJSFlagPath = join(app.getPath("userData"), "use_server_js_for_streaming");
const transparencyEnabled = existsSync(transparencyFlagPath);

// ============================================
// GPU & Rendering Performance Optimizations
// Optimized for smooth 144Hz+ scrolling/transitions
// ============================================

// Platform-specific rendering backend
if (process.platform === "darwin") {
    logger.info("Running on macOS, using Metal for rendering");
    app.commandLine.appendSwitch('use-angle', 'metal');
} else if (process.platform === "win32") {
    logger.info("Running on Windows, using D3D11 for rendering");
    app.commandLine.appendSwitch('use-angle', 'd3d11');
} else {
    logger.info(`Running on ${process.platform}, using OpenGL for rendering`);
    app.commandLine.appendSwitch('use-angle', 'gl');
}

// Force GPU acceleration - works on all GPUs
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('force-high-performance-gpu');

// Unlock frame rate for high refresh rate displays (144Hz+)
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// Rendering pipeline optimizations
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('enable-oop-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('canvas-oop-rasterization');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');

// Smooth scrolling and animation optimizations
app.commandLine.appendSwitch('enable-raw-draw');
app.commandLine.appendSwitch('disable-composited-antialiasing');
app.commandLine.appendSwitch('gpu-rasterization-msaa-sample-count', '0');
app.commandLine.appendSwitch('num-raster-threads', '4');

// Prevent throttling for consistent frame pacing
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-hang-monitor');
app.commandLine.appendSwitch('enable-highres-timer');
app.commandLine.appendSwitch('high-dpi-support', '1');

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

async function createWindow() {
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
        icon: "./images/mainnew.png",
        frame: !transparencyEnabled,
        transparent: transparencyEnabled,
        hasShadow: !transparencyEnabled,
        visualEffectState: transparencyEnabled ? "active" : "followWindow",
        backgroundColor: transparencyEnabled ? "#00000000" : "#0a0a14",
    });

    mainWindow.setMenu(null);
    mainWindow.loadURL(URLS.STREMIO_WEB);

    // Show window when ready to prevent white flash and ensure smooth first paint
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
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
    ipcMain.on(IPC_CHANNELS.LAUNCH_EXTERNAL_PLAYER, (_, data: { player: string; url: string; title?: string; customPath?: string }) => {
        logger.info(`Launching external player: ${data.player} with URL: ${data.url}`);
        ExternalPlayer.launch(data.player, data.url, data.title, data.customPath);
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

    // mainWindow.on('closed', () => {
    //     if(!process.argv.includes("--no-stremio-service") && StremioService.isProcessRunning()) StremioService.terminate();
    // });
}

// Use Stremio Service for streaming
async function useStremioService() {
    if(await StremioService.isServiceInstalled()) {
        logger.info("Found installation of Stremio Service.");
        await StremioService.start();
    } else {
        const result = await Helpers.showAlert(
            "warning",
            "Stremio Service not found",
            `Stremio Service is required for streaming features. Do you want to download it now? ${process.platform == "linux" ? "This will install the service via Flatpak (if available)." : ""}`,
            ["YES", "NO"]
        );
        if (result === 0) {
            await StremioService.downloadAndInstallService();
        } else {
            logger.info("User declined to download Stremio Service.");
        }
    }
}

app.on("ready", async () => {
    logger.info("Enhanced version: v" + Updater.getCurrentVersion());
    logger.info("Running on NodeJS version: " + process.version);
    logger.info("Running on Electron version: v" + process.versions.electron);
    logger.info("Running on Chromium version: v" + process.versions.chrome);

    logger.info("User data path: " + app.getPath("userData"));
    logger.info("Themes path: " + Properties.themesPath);
    logger.info("Plugins path: " + Properties.pluginsPath);

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
            let platform = process.platform;

            // If the user is on Windows, give the option to either use Stremio Service or server.js
            if(platform === "win32") {
                if(existsSync(useStremioServiceFlagPath)) {
                    await useStremioService();
                } else if(existsSync(useServerJSFlagPath)) {
                    await useServerJS();
                } else {
                    await chooseStreamingServer();
                }
            // For macOS and Linux, just give the instruction to use server.js
            } else if (platform === "darwin" || platform === "linux") {
                useServerJS();
            }
        } else logger.info("Stremio Service is already running.");
    } else logger.info("Launching without Stremio streaming server.");
    
    createWindow();
    
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Handle the choice of streaming server on Windows. This is only used for Windows. macOS and Linux will always use server.js to avoid problems.
async function chooseStreamingServer() {
    const result = await Helpers.showAlert(
        "info",
        "Stremio Streaming Server",
        "StreamGo requires a Stremio Streaming Server for playback to function properly. You can either use the Stremio Service or set up a local streaming server manually.\nThis is a one-time setup. The option you choose will be saved for future app launches.\n\n" +
        "Would you like to use the Stremio Service for streaming?\n\n" +
        "Click 'No' to attempt using server.js directly",
        ["Yes, use Stremio Service (recommended on Windows)", "No, use server.js directly (manual setup required)"]
    );

    if(result === 0) {
        logger.info("User chose to use Stremio Service for streaming. User's choice will be saved for future launches.");
        await useStremioService();
        writeFileSync(useStremioServiceFlagPath, "1");
    } else if(result === 1) {
        logger.info("User chose to use server.js for streaming. User's choice will be saved for future launches.");
        useServerJS();
        writeFileSync(useServerJSFlagPath, "1");
    } else {
        logger.info("User closed the streaming server choice dialog. Closing app...");
        app.quit();
    }
}

async function useServerJS() {
    // First, try to ensure streaming server files are available
    logger.info("Checking for streaming server files...");
    const filesStatus = await StreamingServer.ensureStreamingServerFiles();

    if(filesStatus === "ready") {
        logger.info("Launching local streaming server.");
        StreamingServer.start();
    } else if(filesStatus === "missing_server_js") {
        // server.js is missing - show instructions to the user in a loop
        logger.info("server.js not found. Showing download instructions to user...");
        const serverDir = StreamingServer.getStreamingServerDir();
        const downloadUrl = StreamingServer.getServerJsUrl();

        let serverJsFound = false;
        while (!serverJsFound) {
            const result = await Helpers.showAlert(
                "info",
                "Streaming Server Setup Required",
                `To enable video playback, you need to download the Stremio streaming server file (server.js).\n\n` +
                `1. Download server.js from:\n${downloadUrl}\n\n` +
                `2. Right click the page and select "Save As" and save it as "server.js".\n\n` +
                `3. Place it in:\n${serverDir}\n\n` +
                `Click "Open Folder" to open the destination folder, or "Download" to open the download link in your browser. Click "Close" when you have placed the file in the correct location and FFmpeg will be downloaded automatically if needed.`,
                ["Open Folder", "Download", "Close"]
            );

            if (result === 0) {
                // Open the folder
                StreamingServer.openStreamingServerDir();
            } else if (result === 1) {
                // Open the download URL in browser
                shell.openExternal(downloadUrl);
            } else {
                // User clicked Close - check if file exists now
                if (StreamingServer.serverJsExists()) {
                    serverJsFound = true;
                    logger.info("server.js found after user action. Proceeding with streaming server setup...");
                    // Re-run the setup to also check/download ffmpeg
                    const retryStatus = await StreamingServer.ensureStreamingServerFiles();
                    if (retryStatus === "ready") {
                        logger.info("Launching local streaming server.");
                        await Helpers.showAlert("info", "Streaming Server Setup Complete", "The streaming server has been set up successfully and will now start. You may need to reload the streaming server from the settings.", ["OK"]);
                        StreamingServer.start();
                    } else {
                        // FFmpeg issue - fall back to Stremio Service
                        logger.info("FFmpeg not available after server.js setup. Falling back to Stremio Service...");
                        await Helpers.showAlert("error", "Failed to download FFmpeg", "Failed to automatically download FFmpeg. FFmpeg is required for the streaming server to function properly. The app will now use Stremio Service for streaming instead for this instance.", ["OK"]);
                        await useStremioService();
                    }
                } else {
                    // File still not there - warn and show dialog again
                    await Helpers.showAlert(
                        "warning",
                        "File Not Found",
                        `server.js was not found in:\n${serverDir}\n\nPlease download the file and place it in the correct location.`,
                        ["OK"]
                    );
                }
            }
        }
    } else {
        // FFmpeg download failed - fall back to Stremio Service
        logger.info("FFmpeg not available. Falling back to Stremio Service...");
        await useStremioService();
    }
}

app.on("window-all-closed", () => {
    logger.info("Closing app...");

    if (process.platform !== "darwin") {
        app.quit();
    }
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