import { readFileSync } from "fs";
import helpers from '../utils/Helpers';
import { getLogger } from "../utils/logger";
import { join, basename } from "path";
import { getUpdateModalTemplate } from "../components/update-modal/updateModal";
import { URLS } from "../constants";
import https from "https";
import { createWriteStream, unlinkSync, existsSync, writeFileSync, statSync } from "fs";
import { promisify } from "util";
import { execFile, spawn } from "child_process";

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
     * Download the installer file with progress tracking and integrity verification
     */
    public static async downloadUpdate(
        installerUrl: string,
        destPath: string,
        onProgress: (progress: number, bytesDownloaded: number, totalBytes: number) => void,
        retryCount: number = 0
    ): Promise<void> {
        const MAX_RETRIES = 3;

        return new Promise((resolve, reject) => {
            const file = createWriteStream(destPath);
            let resolved = false;
            let expectedBytes = 0;

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

            https.get(installerUrl, {
                headers: {
                    "User-Agent": "StreamGo-Updater",
                    "Accept": "*/*"
                },
                timeout: 30000 // 30 second timeout
            }, (res) => {
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
                        Updater.downloadUpdate(redirectLocation, destPath, onProgress, retryCount)
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

                expectedBytes = parseInt(res.headers['content-length'] || '0', 10);
                let bytesDownloaded = 0;

                this.logger.info(`Starting download: expecting ${expectedBytes} bytes`);

                res.on('data', (chunk: Buffer) => {
                    bytesDownloaded += chunk.length;
                    const progress = expectedBytes > 0 ? (bytesDownloaded / expectedBytes) * 100 : 0;
                    onProgress(progress, bytesDownloaded, expectedBytes);
                });

                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        if (!resolved) {
                            // Verify download integrity
                            try {
                                const actualSize = statSync(destPath).size;
                                this.logger.info(`Download finished: ${actualSize} bytes written, expected ${expectedBytes} bytes`);

                                if (expectedBytes > 0 && actualSize !== expectedBytes) {
                                    // File size mismatch - corrupted download
                                    this.logger.error(`File size mismatch: got ${actualSize}, expected ${expectedBytes}`);

                                    if (retryCount < MAX_RETRIES) {
                                        this.logger.info(`Retrying download (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                                        // Clean up partial file
                                        try {
                                            unlinkSync(destPath);
                                        } catch (err) {
                                            // Ignore
                                        }
                                        // Retry download
                                        Updater.downloadUpdate(installerUrl, destPath, onProgress, retryCount + 1)
                                            .then(() => {
                                                resolved = true;
                                                resolve();
                                            })
                                            .catch((error) => {
                                                resolved = true;
                                                reject(error);
                                            });
                                        return;
                                    } else {
                                        resolved = true;
                                        reject(new Error(`Download corrupted: file size is ${actualSize} bytes but expected ${expectedBytes} bytes. Please check your internet connection and try again.`));
                                        return;
                                    }
                                }

                                // Verify minimum file size (at least 1MB for installers)
                                if (actualSize < 1024 * 1024) {
                                    this.logger.error(`Downloaded file is suspiciously small: ${actualSize} bytes`);

                                    if (retryCount < MAX_RETRIES) {
                                        this.logger.info(`Retrying download (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                                        try {
                                            unlinkSync(destPath);
                                        } catch (err) {
                                            // Ignore
                                        }
                                        Updater.downloadUpdate(installerUrl, destPath, onProgress, retryCount + 1)
                                            .then(() => {
                                                resolved = true;
                                                resolve();
                                            })
                                            .catch((error) => {
                                                resolved = true;
                                                reject(error);
                                            });
                                        return;
                                    } else {
                                        resolved = true;
                                        reject(new Error(`Downloaded file is too small (${actualSize} bytes). Download may have failed.`));
                                        return;
                                    }
                                }

                                resolved = true;
                                this.logger.info('Download verified successfully');
                                resolve();
                            } catch (error) {
                                resolved = true;
                                reject(new Error(`Failed to verify downloaded file: ${(error as Error).message}`));
                            }
                        }
                    });
                });

                res.on('error', (error: Error) => {
                    cleanup(error);
                });
            }).on('error', (error: Error) => {
                if (retryCount < MAX_RETRIES) {
                    this.logger.info(`Network error, retrying download (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                    cleanup();
                    setTimeout(() => {
                        Updater.downloadUpdate(installerUrl, destPath, onProgress, retryCount + 1)
                            .then(() => {
                                if (!resolved) {
                                    resolved = true;
                                    resolve();
                                }
                            })
                            .catch((err) => {
                                if (!resolved) {
                                    resolved = true;
                                    reject(err);
                                }
                            });
                    }, 2000); // Wait 2 seconds before retry
                } else {
                    cleanup(error);
                }
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
                // NSIS installer - silent installation with auto-restart
                this.logger.info(`Installing update on Windows: ${installerPath}`);

                try {
                    if (!app) {
                        throw new Error("App not available - cannot create update script");
                    }

                    // Create a batch file that will:
                    // 1. Wait for this process to exit (using process ID)
                    // 2. Launch the installer
                    // 3. Delete itself
                    const currentPid = process.pid;
                    const batchContent = `@echo off
REM StreamGo Update Helper
echo Waiting for StreamGo to exit...
:WAIT
tasklist /FI "PID eq ${currentPid}" 2>NUL | find "${currentPid}" >NUL
if %ERRORLEVEL% == 0 (
    timeout /t 1 /nobreak >NUL
    goto WAIT
)

echo Launching installer...
start "" "${installerPath}" /S --force-run

echo Cleaning up...
del "%~f0"
exit
`;

                    const batchPath = join(app.getPath("temp"), "streamgo-update.bat");
                    writeFileSync(batchPath, batchContent, { encoding: 'utf8' });
                    this.logger.info(`Created update batch file: ${batchPath}`);

                    // Launch the batch file in a detached, hidden window
                    const batchProcess = spawn("cmd.exe", ["/c", batchPath], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true,
                    });

                    // Unref so the child can continue after parent exits
                    batchProcess.unref();

                    this.logger.info("Update batch script launched, app will now exit");

                    // Give batch file time to start
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Quit the app so installer can replace files
                    if (app) {
                        app.quit();
                    }
                } catch (error) {
                    this.logger.error(`Failed to launch Windows installer: ${(error as Error).message}`);
                    throw new Error(`Failed to launch installer. Please try running it manually from: ${installerPath}\n\nError: ${(error as Error).message}`);
                }
                return; // Skip cleanup since we're exiting
            }
            case "darwin": {
                // Mount DMG, install, and restart on macOS
                this.logger.info(`Installing update on macOS: ${installerPath}`);

                try {
                    if (!app) {
                        throw new Error("App not available - cannot create update script");
                    }

                    // Verify DMG file exists and is valid
                    if (!existsSync(installerPath)) {
                        throw new Error(`Installer file not found: ${installerPath}`);
                    }

                    const fileStats = statSync(installerPath);
                    if (fileStats.size < 1024 * 1024) {
                        throw new Error(`Installer file is too small (${fileStats.size} bytes), likely corrupted`);
                    }

                    this.logger.info(`Installer file verified: ${fileStats.size} bytes`);

                    // Create a shell script that will:
                    // 1. Wait for this process to exit
                    // 2. Mount the DMG
                    // 3. Copy to Applications
                    // 4. Unmount the DMG
                    // 5. Launch the new version
                    // 6. Delete the DMG and itself
                    const currentPid = process.pid;
                    const volume = "/Volumes/StreamGo";
                    const installPath = "/Applications/StreamGo.app";
                    const appPath = `${volume}/StreamGo.app`;

                    const shellScript = `#!/bin/bash
# StreamGo Update Helper for macOS

echo "Waiting for StreamGo to exit (PID ${currentPid})..."
while kill -0 ${currentPid} 2>/dev/null; do
    sleep 1
done

echo "Unmounting any existing volume..."
hdiutil detach "${volume}" -force 2>/dev/null || true

echo "Mounting DMG..."
if ! hdiutil attach "${installerPath}" -mountpoint "${volume}" -nobrowse -noautoopen; then
    echo "Error: Failed to mount DMG"
    exit 1
fi

echo "Waiting for mount to complete..."
sleep 2

if [ ! -d "${appPath}" ]; then
    echo "Error: StreamGo.app not found in DMG"
    hdiutil detach "${volume}" -force 2>/dev/null || true
    exit 1
fi

echo "Removing old version..."
rm -rf "${installPath}" 2>/dev/null || true

echo "Copying new version to Applications..."
if ! ditto "${appPath}" "${installPath}"; then
    echo "Error: Failed to copy app"
    hdiutil detach "${volume}" -force 2>/dev/null || true
    exit 1
fi

echo "Unmounting DMG..."
hdiutil detach "${volume}" -force 2>/dev/null || true

echo "Cleaning up installer..."
rm -f "${installerPath}"

echo "Launching new version..."
open -n "${installPath}"

echo "Cleaning up script..."
rm -f "$0"

echo "Update complete!"
exit 0
`;

                    const scriptPath = join(app.getPath("temp"), "streamgo-update.sh");
                    writeFileSync(scriptPath, shellScript, { encoding: 'utf8', mode: 0o755 });
                    this.logger.info(`Created update shell script: ${scriptPath}`);

                    // Launch the shell script in the background
                    const shellProcess = spawn("/bin/bash", [scriptPath], {
                        detached: true,
                        stdio: 'ignore',
                    });

                    // Unref so the child can continue after parent exits
                    shellProcess.unref();

                    this.logger.info("Update shell script launched, app will now exit");

                    // Give script time to start
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Quit the app so the script can do its work
                    if (app) {
                        app.quit();
                    }

                    return;
                } catch (error) {
                    this.logger.error(`macOS installation failed: ${(error as Error).message}`);
                    throw error;
                }
            }
            case "linux": {
                // Replace existing AppImage using atomic move operation
                this.logger.info(`Installing update on Linux: ${installerPath}`);
                const appImagePath = process.execPath; // Current AppImage path

                if (appImagePath.endsWith(".AppImage") || appImagePath.endsWith(".appimage")) {
                    try {
                        // Make new AppImage executable
                        await execFileAsync("chmod", ["+x", installerPath]);

                        // Create backup of current AppImage
                        const backupPath = `${appImagePath}.backup`;
                        try {
                            await execFileAsync("cp", [appImagePath, backupPath]);
                            this.logger.info(`Created backup at: ${backupPath}`);
                        } catch (error) {
                            this.logger.warn(`Failed to create backup: ${(error as Error).message}`);
                        }

                        // Use a helper script to replace the AppImage after this process exits
                        // This is necessary because we can't replace a running executable
                        const helperScript = `#!/bin/bash
# StreamGo Update Helper Script
# This script replaces the old AppImage with the new one and restarts the app

set -e  # Exit on error

# Wait for the app to fully exit
echo "Waiting for app to exit..."
sleep 2

# Check if new AppImage exists
if [ ! -f "${installerPath}" ]; then
    echo "Error: New AppImage not found at ${installerPath}"
    exit 1
fi

# Check if old AppImage exists
if [ ! -f "${appImagePath}" ]; then
    echo "Error: Old AppImage not found at ${appImagePath}"
    exit 1
fi

# Replace old AppImage with new one
echo "Replacing old AppImage..."
if ! mv -f "${installerPath}" "${appImagePath}"; then
    echo "Error: Failed to replace AppImage. You may need to manually copy the new version."
    echo "New version is located at: ${installerPath}"
    exit 1
fi

# Make sure it's executable
echo "Setting executable permissions..."
chmod +x "${appImagePath}"

# Launch the new version
echo "Launching updated app..."
"${appImagePath}" &

# Clean up this script
rm -f "$0"

echo "Update complete!"
`;
                        if (!app) {
                            throw new Error("App not available - cannot create update script");
                        }
                        const scriptPath = join(app.getPath("temp"), "streamgo-update.sh");
                        writeFileSync(scriptPath, helperScript, { mode: 0o755 });

                        this.logger.info(`Created update helper script at: ${scriptPath}`);

                        // Launch the helper script in the background
                        execFileAsync("bash", [scriptPath]).catch((error) => {
                            this.logger.error(`Helper script failed: ${(error as Error).message}`);
                        });

                        // Quit the app immediately so the helper can replace the file
                        this.logger.info("App will now exit for update to complete");
                        await new Promise(resolve => setTimeout(resolve, 500));

                        if (app) {
                            app.exit(0);
                        }

                    } catch (error) {
                        this.logger.error(`Failed to install update on Linux: ${(error as Error).message}`);
                        throw new Error(`Failed to install update. Please manually replace your AppImage with the downloaded file at: ${installerPath}\n\nError: ${(error as Error).message}`);
                    }
                } else {
                    // If not running from AppImage, copy to a standard location
                    const targetPath = join(process.env.HOME || "/home", "Applications", basename(installerPath));
                    await execFileAsync("mkdir", ["-p", join(process.env.HOME || "/home", "Applications")]);
                    await execFileAsync("cp", [installerPath, targetPath]);
                    await execFileAsync("chmod", ["+x", targetPath]);

                    throw new Error(`Update downloaded to: ${targetPath}\n\nPlease manually launch the new version.`);
                }
                return; // Skip cleanup since we're exiting or script will handle it
            }
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        // Clean up installer file after successful installation (macOS only reaches here)
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
