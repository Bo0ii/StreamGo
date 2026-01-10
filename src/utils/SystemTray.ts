import { Tray, Menu, nativeImage, app, BrowserWindow } from "electron";
import { join } from "path";
import { getLogger } from "./logger";
import StremioService from "./StremioService";

const logger = getLogger("SystemTray");

class SystemTray {
    private static tray: Tray | null = null;
    private static mainWindow: BrowserWindow | null = null;
    private static updateInterval: NodeJS.Timeout | null = null;

    /**
     * Initialize the system tray icon
     * @param mainWindow The main browser window reference
     */
    public static initialize(mainWindow: BrowserWindow): void {
        this.mainWindow = mainWindow;

        try {
            // Get the icon path - use different paths for packaged vs development
            const iconPath = app.isPackaged
                ? join(process.resourcesPath, "images", "icons", "main.png")
                : join(__dirname, "..", "..", "images", "icons", "main.png");

            logger.info(`Creating system tray with icon: ${iconPath}`);

            // Create a native image for the tray
            const icon = nativeImage.createFromPath(iconPath);

            // Resize for tray (16x16 or 32x32 is typical)
            const trayIcon = icon.resize({ width: 16, height: 16 });

            this.tray = new Tray(trayIcon);
            this.tray.setToolTip("StreamGo - Checking service status...");

            // Build and set the context menu
            this.updateContextMenu();

            // Handle tray click to show/hide window
            this.tray.on("click", () => {
                if (this.mainWindow) {
                    if (this.mainWindow.isVisible()) {
                        this.mainWindow.hide();
                    } else {
                        this.mainWindow.show();
                        this.mainWindow.focus();
                    }
                }
            });

            // Start periodic status updates
            this.startStatusUpdates();

            logger.info("System tray initialized successfully");
        } catch (error) {
            logger.error(`Failed to initialize system tray: ${(error as Error).message}`);
        }
    }

    /**
     * Update the context menu with current service status
     */
    private static async updateContextMenu(): Promise<void> {
        if (!this.tray) return;

        const isRunning = await StremioService.isProcessRunning();
        const isBundled = StremioService.isUsingBundledService();
        const appStarted = StremioService.didAppStartService();

        // Update tooltip
        let statusText = isRunning ? "Running" : "Stopped";
        if (isRunning && isBundled) {
            statusText += " (Bundled)";
        } else if (isRunning && appStarted) {
            statusText += " (Started by StreamGo)";
        } else if (isRunning) {
            statusText += " (External)";
        }

        this.tray.setToolTip(`StreamGo - Service: ${statusText}`);

        // Build context menu
        const contextMenu = Menu.buildFromTemplate([
            {
                label: "StreamGo",
                enabled: false,
                icon: this.getSmallIcon()
            },
            { type: "separator" },
            {
                label: `Service: ${statusText}`,
                enabled: false
            },
            {
                label: isRunning ? "Stop Service" : "Start Service",
                click: async () => {
                    if (isRunning) {
                        logger.info("User requested to stop service from tray");
                        StremioService.terminate();
                    } else {
                        logger.info("User requested to start service from tray");
                        try {
                            await StremioService.start();
                        } catch (error) {
                            logger.error(`Failed to start service: ${(error as Error).message}`);
                        }
                    }
                    // Update menu after action
                    setTimeout(() => this.updateContextMenu(), 1000);
                }
            },
            { type: "separator" },
            {
                label: "Show Window",
                click: () => {
                    if (this.mainWindow) {
                        this.mainWindow.show();
                        this.mainWindow.focus();
                    }
                }
            },
            {
                label: "Hide Window",
                click: () => {
                    if (this.mainWindow) {
                        this.mainWindow.hide();
                    }
                }
            },
            { type: "separator" },
            {
                label: "Quit StreamGo",
                click: () => {
                    logger.info("User requested quit from tray");
                    app.quit();
                }
            }
        ]);

        this.tray.setContextMenu(contextMenu);
    }

    /**
     * Get a small icon for menu items
     */
    private static getSmallIcon(): Electron.NativeImage | undefined {
        try {
            const iconPath = app.isPackaged
                ? join(process.resourcesPath, "images", "icons", "main.png")
                : join(__dirname, "..", "..", "images", "icons", "main.png");

            const icon = nativeImage.createFromPath(iconPath);
            return icon.resize({ width: 16, height: 16 });
        } catch {
            return undefined;
        }
    }

    /**
     * Start periodic status updates
     */
    private static startStatusUpdates(): void {
        // Update every 30 seconds (reduced from 5s for better performance)
        // Context menu only needs updating occasionally, not constantly
        this.updateInterval = setInterval(async () => {
            await this.updateContextMenu();
        }, 30000);

        // Initial update
        this.updateContextMenu();
    }

    /**
     * Stop the status update interval
     */
    private static stopStatusUpdates(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Destroy the system tray
     */
    public static destroy(): void {
        this.stopStatusUpdates();

        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }

        logger.info("System tray destroyed");
    }

    /**
     * Check if the tray is initialized
     */
    public static isInitialized(): boolean {
        return this.tray !== null;
    }

    /**
     * Force update the tray status
     */
    public static async refresh(): Promise<void> {
        await this.updateContextMenu();
    }
}

export default SystemTray;
