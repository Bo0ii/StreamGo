import { readFileSync } from "fs";
import helpers from '../utils/Helpers';
import { getLogger } from "../utils/logger";
import { join, basename } from "path";
import { getUpdateModalTemplate } from "../components/update-modal/updateModal";
import { URLS } from "../constants";
import https from "https";
import { createWriteStream, unlinkSync, existsSync } from "fs";
import { promisify } from "util";
import { execFile } from "child_process";

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
                if (packageJson.version && typeof packageJson.version === 'string') {
                    const version = packageJson.version as string;
                    this.versionCache = version;
                    this.logger.info(`Version read from package.json: v${version}`);
                    return version;
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
                const version = readFileSync(versionFilePath, "utf-8").trim();
                this.versionCache = version;
                this.logger.info(`Version read from version file: v${version}`);
                return version;
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

    /**
     * Get the full release information from GitHub
     */
    public static async getReleaseInfo(): Promise<any> {
        try {
            const response = await fetch(URLS.RELEASES_API);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            this.logger.error(`Failed to fetch release info: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get the installer URL for the current platform and architecture
     */
    public static getInstallerUrlForPlatform(release: any, platform: string, arch: string): string | null {
        if (!release.assets || !Array.isArray(release.assets)) {
            return null;
        }

        const matchers: Record<string, RegExp> = {
            win32: /\.exe$/i,
            darwin: /\.dmg$/i,
            linux: /\.AppImage$/i,
        };

        const pattern = matchers[platform];
        if (!pattern) {
            return null;
        }

        // Find installer file matching platform and architecture
        const asset = release.assets.find((a: any) => {
            if (!pattern.test(a.name)) return false;
            const name = a.name.toLowerCase();

            // For Windows, prefer the main installer (not portable)
            // Release naming: StreamGo-{version}-Windows.exe or StreamGo-{version}-Windows-Portable.exe
            if (platform === "win32") {
                return name.includes("windows") && !name.includes("portable") && !name.endsWith(".blockmap");
            }

            // For macOS, check architecture
            // Release naming: StreamGo-{version}-Mac-Intel.dmg or StreamGo-{version}-Mac-Apple-Silicon.dmg
            if (platform === "darwin") {
                if (arch === "arm64") {
                    // Apple Silicon: match "silicon" or "arm64" or "apple"
                    return name.includes("silicon") || name.includes("arm64") || name.includes("apple");
                } else {
                    // Intel/x64: match .dmg that contains "intel" or does NOT contain arm64/silicon/apple
                    return name.includes("intel") || (!name.includes("arm64") && !name.includes("silicon") && !name.includes("apple"));
                }
            }

            // For Linux, check architecture
            // Release naming: StreamGo-{version}-Linux.AppImage or StreamGo-{version}-Linux-ARM.AppImage
            if (platform === "linux") {
                if (arch === "arm64") {
                    // ARM: match "arm64" or "-arm" in the name
                    return name.includes("arm64") || name.includes("-arm.");
                } else {
                    // x64: match .AppImage that does NOT contain arm
                    return !name.includes("arm");
                }
            }

            return true;
        });

        return asset ? asset.browser_download_url : null;
    }

    /**
     * Download the installer file with progress tracking
     */
    public static async downloadUpdate(
        installerUrl: string,
        destPath: string,
        onProgress: (progress: number, bytesDownloaded: number, totalBytes: number) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = createWriteStream(destPath);
            let resolved = false;
            
            const cleanup = (error?: Error) => {
                if (resolved) return;
                file.close(() => {
                    if (existsSync(destPath)) {
                        try {
                            unlinkSync(destPath);
                        } catch (err) {
                            // Ignore cleanup errors
                        }
                    }
                    if (error && !resolved) {
                        resolved = true;
                        reject(error);
                    }
                });
            };

            file.on('error', (error: Error) => {
                cleanup(error);
            });

            https.get(installerUrl, { headers: { "User-Agent": "StreamGo-Updater" } }, (res) => {
                // Handle redirects
                const redirectLocation = res.headers.location;
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirectLocation) {
                    file.close(() => {
                        if (existsSync(destPath)) {
                            try {
                                unlinkSync(destPath);
                            } catch (err) {
                                // Ignore cleanup errors
                            }
                        }
                        // Recursively follow redirect
                        Updater.downloadUpdate(redirectLocation, destPath, onProgress)
                            .then(() => {
                                if (!resolved) {
                                    resolved = true;
                                    resolve();
                                }
                            })
                            .catch((error) => {
                                if (!resolved) {
                                    resolved = true;
                                    reject(error);
                                }
                            });
                    });
                    return;
                }

                if (res.statusCode && res.statusCode !== 200) {
                    cleanup(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let bytesDownloaded = 0;

                res.on('data', (chunk: Buffer) => {
                    bytesDownloaded += chunk.length;
                    const progress = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0;
                    onProgress(progress, bytesDownloaded, totalBytes);
                });

                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        if (!resolved) {
                            resolved = true;
                            this.logger.info(`Download complete: ${bytesDownloaded} bytes downloaded`);
                            resolve();
                        }
                    });
                });

                res.on('error', (error: Error) => {
                    cleanup(error);
                });
            }).on('error', (error: Error) => {
                cleanup(error);
            });
        });
    }

    /**
     * Install the update based on platform
     */
    public static async installUpdate(installerPath: string, platform: string): Promise<void> {
        const execFileAsync = promisify(execFile);

        switch (platform) {
            case "win32": {
                // NSIS installer silent mode with admin privileges
                this.logger.info(`Installing update on Windows: ${installerPath}`);
                // Use Start-Process with -Wait to ensure installation completes
                const ps = `$process = Start-Process -FilePath "${installerPath}" -ArgumentList '/S' -Verb RunAs -Wait -PassThru; if ($process.ExitCode -ne 0) { throw "Installation failed with exit code $($process.ExitCode)" }`;
                await execFileAsync("powershell.exe", [
                    "-ExecutionPolicy", "Bypass",
                    "-NoProfile",
                    "-Command", ps
                ], {
                    windowsHide: true,
                });
                this.logger.info("Windows installation completed successfully");
                break;
            }
            case "darwin": {
                // Mount DMG and copy app
                this.logger.info(`Installing update on macOS: ${installerPath}`);
                const volume = "/Volumes/StreamGo";
                try {
                    await execFileAsync("hdiutil", ["attach", installerPath, "-mountpoint", volume]);
                    // Find the .app bundle in the mounted volume
                    const appPath = `${volume}/StreamGo.app`;
                    if (existsSync(appPath)) {
                        await execFileAsync("cp", ["-R", appPath, "/Applications/"]);
                    } else {
                        throw new Error("StreamGo.app not found in DMG");
                    }
                } finally {
                    await execFileAsync("hdiutil", ["detach", volume]).catch(() => {
                        // Ignore errors when detaching
                    });
                }
                break;
            }
            case "linux": {
                // Replace existing AppImage
                this.logger.info(`Installing update on Linux: ${installerPath}`);
                const appImagePath = process.execPath; // Current AppImage path
                if (appImagePath.endsWith(".AppImage") || appImagePath.endsWith(".appimage")) {
                    await execFileAsync("cp", [installerPath, appImagePath]);
                    await execFileAsync("chmod", ["+x", appImagePath]);
                } else {
                    // If not running from AppImage, copy to a standard location
                    const targetPath = join(process.env.HOME || "/home", "Applications", basename(installerPath));
                    await execFileAsync("mkdir", ["-p", join(process.env.HOME || "/home", "Applications")]);
                    await execFileAsync("cp", [installerPath, targetPath]);
                    await execFileAsync("chmod", ["+x", targetPath]);
                }
                break;
            }
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        // Clean up installer file after successful installation
        try {
            if (existsSync(installerPath)) {
                unlinkSync(installerPath);
                this.logger.info(`Cleaned up installer file: ${installerPath}`);
            }
        } catch (error) {
            this.logger.warn(`Failed to delete installer file: ${(error as Error).message}`);
        }
    }

    /**
     * Restart the application
     */
    public static restartApplication(): void {
        if (!app) {
            throw new Error("App not available - cannot restart");
        }
        
        this.logger.info("Restarting application...");
        app.relaunch();
        app.exit(0);
    }
}

export default Updater;
