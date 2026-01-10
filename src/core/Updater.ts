import { readFileSync } from "fs";
import helpers from '../utils/Helpers';
import { getLogger } from "../utils/logger";
import { join } from "path";
import { getUpdateModalTemplate } from "../components/update-modal/updateModal";
import { URLS } from "../constants";

// Try to import app, but handle if we're in renderer process
let app: typeof import("electron").app | undefined;
try {
    app = require("electron").app;
} catch {
    // app is not available in renderer process
}

class Updater {
    private static logger = getLogger("Updater");
    private static versionCache: string | null = null;

    /**
     * Check for updates and show update modal if available
     * @param showNoUpdatePrompt - Whether to show a message if no update is available
     */
    public static async checkForUpdates(showNoUpdatePrompt: boolean): Promise<boolean> {
        try {
            const latestVersion = await this.getLatestVersion();
            const currentVersion = this.getCurrentVersion();
            
            if (helpers.isNewerVersion(latestVersion, currentVersion)) {
                this.logger.info(`Update available: v${latestVersion} (current: v${currentVersion})`);
                
                const modalsContainer = document.getElementsByClassName("modals-container")[0];
                if (modalsContainer) {
                    modalsContainer.innerHTML = await getUpdateModalTemplate();
                }
                return true;
            } else if (showNoUpdatePrompt) {
                await helpers.showAlert(
                    "info", 
                    "No update available!", 
                    `You're running the latest version (v${currentVersion}).`, 
                    ["OK"]
                );
            }
            return false;
        } catch (error) {
            this.logger.error(`Failed to check for updates: ${(error as Error).message}`);
            if (showNoUpdatePrompt) {
                await helpers.showAlert(
                    "error",
                    "Update check failed",
                    "Could not check for updates. Please check your internet connection.",
                    ["OK"]
                );
            }
            return false;
        }
    }

    /**
     * Fetch the latest version from GitHub releases
     */
    public static async getLatestVersion(): Promise<string> {
        const response = await fetch(URLS.RELEASES_API);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Extract version from tag_name (e.g., "v1.0.2" -> "1.0.2")
        let version = data.tag_name || data.name || '';
        if (version.startsWith('v')) {
            version = version.substring(1);
        }
        
        if (!version) {
            throw new Error('Could not extract version from GitHub release');
        }
        
        this.logger.info(`Latest version available from GitHub releases: v${version}`);
        return version.trim();
    }

    /**
     * Get the current installed version
     */
    public static getCurrentVersion(): string {
        if (this.versionCache) {
            return this.versionCache;
        }
        
        const isPackaged = app ? app.isPackaged : false;
        
        // Try multiple paths to find package.json or version file
        const pathsToTry: string[] = [];
        
        if (isPackaged && app) {
            // In packaged app, try different locations
            if (process.resourcesPath) {
                pathsToTry.push(join(process.resourcesPath, "app.asar", "package.json"));
                pathsToTry.push(join(process.resourcesPath, "package.json"));
            }
            if (app.getAppPath) {
                pathsToTry.push(join(app.getAppPath(), "package.json"));
            }
        } else {
            // In development, it's relative to __dirname
            pathsToTry.push(join(__dirname, "../", "../", "package.json"));
        }
        
        // Try to read from package.json first
        for (const packageJsonPath of pathsToTry) {
            try {
                const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
                if (packageJson.version) {
                    this.versionCache = packageJson.version;
                    this.logger.info(`Version read from package.json: v${this.versionCache}`);
                    return this.versionCache;
                }
            } catch (error) {
                // Try next path
                continue;
            }
        }
        
        // Fallback: try to read from version file
        const versionPathsToTry: string[] = [];
        
        if (isPackaged && app) {
            if (process.resourcesPath) {
                versionPathsToTry.push(join(process.resourcesPath, "app.asar", "dist", "version"));
                versionPathsToTry.push(join(process.resourcesPath, "version"));
            }
            if (app.getAppPath) {
                versionPathsToTry.push(join(app.getAppPath(), "dist", "version"));
                versionPathsToTry.push(join(app.getAppPath(), "version"));
            }
        } else {
            versionPathsToTry.push(join(__dirname, "../", "version"));
            versionPathsToTry.push(join(__dirname, "../", "../", "version"));
        }
        
        for (const versionFilePath of versionPathsToTry) {
            try {
                this.versionCache = readFileSync(versionFilePath, "utf-8").trim();
                this.logger.info(`Version read from version file: v${this.versionCache}`);
                return this.versionCache;
            } catch (error) {
                // Try next path
                continue;
            }
        }
        
        // Last resort: return 0.0.0
        this.logger.error("Failed to read version from any location. Using default: 0.0.0");
        this.versionCache = "0.0.0";
        return this.versionCache;
    }

    /**
     * Fetch release notes from GitHub API
     */
    public static async getReleaseNotes(): Promise<string> {
        try {
            const response = await fetch(URLS.RELEASES_API);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.body || "No release notes available.";
        } catch (error) {
            this.logger.error(`Failed to fetch release notes: ${(error as Error).message}`);
            return "Could not load release notes.";
        }
    }
}

export default Updater;
