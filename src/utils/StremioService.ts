import { getLogger } from "./logger";
import { basename, dirname, join, resolve } from "path";
import { existsSync, createWriteStream, unlinkSync, readFileSync, chmodSync } from "fs";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as process from 'process';
import { homedir } from 'os';
import { app } from "electron";
import https from "https";
import { TIMEOUTS } from "../constants/index";

// GitHub Release API response types
interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubReleaseAsset[];
}

class StremioService {
    private static API_URL = "https://api.github.com/repos/Stremio/stremio-service/releases/latest";
    private static logger = getLogger("StremioService");
    private static execFileAsync = promisify(execFile);

    // Track whether this app instance started the service
    private static appStartedService: boolean = false;
    private static servicePid: number | null = null;
    private static usingBundledService: boolean = false;

    /**
     * Ensures bundled binaries have executable permissions on Unix systems.
     * This is necessary because Git may not preserve execute bits on macOS/Linux.
     */
    private static ensureExecutablePermissions(executablePath: string): void {
        if (process.platform === "win32") return; // Windows doesn't need chmod

        try {
            const dir = dirname(executablePath);
            // Make main executable runnable
            chmodSync(executablePath, 0o755);
            this.logger.info(`Set execute permission on: ${executablePath}`);

            // Also chmod companion binaries in same directory
            const companions = ["ffmpeg", "ffprobe", "stremio-runtime"];
            for (const binary of companions) {
                const binaryPath = join(dir, binary);
                if (existsSync(binaryPath)) {
                    chmodSync(binaryPath, 0o755);
                    this.logger.info(`Set execute permission on: ${binaryPath}`);
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to set executable permissions: ${(error as Error).message}`);
        }
    }

    /**
     * Gets the path to the bundled Stremio Service in app resources
     * @returns The path to bundled service executable, or null if not found
     */
    public static getBundledServicePath(): string | null {
        try {
            // In production, resources are in process.resourcesPath
            // In development, they're in the project root
            const resourcesPath = app.isPackaged
                ? process.resourcesPath
                : join(__dirname, '..', '..');

            const servicePath = join(resourcesPath, 'stremio-service');

            // Platform-specific subdirectories (used in development)
            const platformDirs: Record<string, string> = {
                'win32': 'stremio-service-windows',
                'darwin': 'stremio-service-macos',
                'linux': 'stremio-service-linux'
            };

            const platformDir = platformDirs[process.platform];
            const exeName = process.platform === 'win32' ? 'stremio-service.exe' : 'stremio-service';

            // Check production path first (flattened by electron-builder)
            const productionPath = join(servicePath, exeName);
            if (existsSync(productionPath)) {
                this.logger.info(`Found bundled Stremio Service at: ${productionPath}`);
                return productionPath;
            }

            // Check development path (with platform subdirectory)
            if (platformDir) {
                const devPath = join(servicePath, platformDir, exeName);
                if (existsSync(devPath)) {
                    this.logger.info(`Found bundled Stremio Service at: ${devPath}`);
                    return devPath;
                }
            }

            this.logger.info('Bundled Stremio Service not found, will use external installation');
            return null;
        } catch (error) {
            this.logger.warn(`Error checking for bundled service: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Checks if the bundled service is available
     */
    public static hasBundledService(): boolean {
        return this.getBundledServicePath() !== null;
    }

    /**
     * Returns whether the currently running service is the bundled one
     */
    public static isUsingBundledService(): boolean {
        return this.usingBundledService;
    }

    /**
     * Returns whether this app instance started the service
     */
    public static didAppStartService(): boolean {
        return this.appStartedService;
    }

    public static async start(): Promise<void> {
        // Check if service is already running
        const alreadyRunning = await this.isProcessRunning();
        if (alreadyRunning) {
            this.logger.info("Stremio Service is already running (started externally).");
            this.appStartedService = false;
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                this.logger.info("Starting Stremio Service...");

                let child;
                let executablePath: string | null = null;
                let workingDir: string | undefined = undefined;

                // First, try to use the bundled service
                const bundledPath = this.getBundledServicePath();
                if (bundledPath) {
                    this.logger.info(`Using bundled Stremio Service: ${bundledPath}`);
                    executablePath = bundledPath;
                    // Set working directory to the service directory (needed for finding server.js, ffmpeg, etc.)
                    workingDir = dirname(bundledPath);
                    this.logger.info(`Service working directory: ${workingDir}`);
                    this.usingBundledService = true;
                    // Ensure bundled binaries have execute permission on Unix systems
                    this.ensureExecutablePermissions(bundledPath);
                }

                switch (process.platform) {
                    case "win32":
                        if (!executablePath) {
                            executablePath = this.findExecutable();
                            if (executablePath) {
                                workingDir = dirname(executablePath);
                            }
                        }
                        if (!executablePath) {
                            return reject(new Error("Could not find Stremio Service executable"));
                        }
                        child = spawn(executablePath, [], {
                            detached: true,
                            stdio: "ignore",
                            cwd: workingDir
                        });
                        break;
                    case "darwin":
                        if (executablePath) {
                            // Use bundled service directly
                            child = spawn(executablePath, [], {
                                detached: true,
                                stdio: "ignore",
                                cwd: workingDir
                            });
                        } else {
                            // Fall back to installed app
                            child = spawn("open", ["/Applications/StremioService.app"], { detached: true, stdio: "ignore" });
                        }
                        break;
                    case "linux":
                        if (executablePath) {
                            // Use bundled service
                            child = spawn(executablePath, [], {
                                detached: true,
                                stdio: "ignore",
                                cwd: workingDir
                            });
                        } else {
                            // Try to start from system installation first, then Flatpak
                            const systemPaths = [
                                "/usr/bin/stremio-service",
                                "/usr/local/bin/stremio-service",
                                "/opt/stremio-service/stremio-service",
                                "/usr/lib/stremio-service/stremio-service"
                            ];

                            let servicePath: string | null = null;
                            for (const path of systemPaths) {
                                if (existsSync(path)) {
                                    servicePath = path;
                                    break;
                                }
                            }

                            if (servicePath) {
                                // Start from system installation
                                this.logger.info(`Starting Stremio Service from system path: ${servicePath}`);
                                child = spawn(servicePath, [], { detached: true, stdio: "ignore" });
                            } else {
                                // Fallback to Flatpak
                                this.logger.info("Starting Stremio Service via Flatpak");
                                child = spawn("flatpak", ["run", "com.stremio.Service"], { detached: true, stdio: "ignore" });
                            }
                        }
                        break;
                    default:
                        return reject(new Error("Unsupported platform"));
                }

                // Handle spawn errors
                child.on('error', (err) => {
                    this.logger.error(`Failed to spawn Stremio Service: ${err.message}`);
                    reject(err);
                });

                // Store the PID for later termination and mark that we started it
                if (child.pid) {
                    this.servicePid = child.pid;
                    this.appStartedService = true;
                    this.logger.info(`Stremio Service started with PID: ${child.pid}`);
                } else {
                    this.logger.warn("Stremio Service spawned but no PID returned");
                }

                child.unref();

                this.logger.info("Stremio Service started by this app.");
                resolve();

            } catch (err) {
                this.logger.error(`Error in start(): ${(err as Error).message}`);
                reject(err);
            }
        });
    }
        
    public static async downloadAndInstallService(): Promise<boolean> {
        const platform = process.platform;
        
        try {
            this.logger.info("Fetching latest Stremio Service release information...");
            const release = await this.fetchLatestRelease();
            if (!release) {
                this.logger.error("Failed to fetch latest release info from GitHub");
                return false;
            }

            this.logger.info(`Found release: ${release.tag_name}`);
            
            // Extract version from tag_name (e.g., "v0.1.15" -> "v0.1.15")
            const version = release.tag_name;
            
            const assetUrl = await this.getDirectDownloadUrl(version, platform);
            if (!assetUrl) {
                this.logger.error(`No suitable download URL found for platform: ${platform}`);
                return false;
            }
            
            const tempDir = app.getPath("temp");
            const fileName = basename(assetUrl);
            const destPath = join(tempDir, fileName);

            this.logger.info(`Downloading latest Stremio Service (${release.tag_name}) to ${destPath}`);
            try {
                await this.downloadFile(assetUrl, destPath);
                this.logger.info("Download complete. Starting installation...");
            } catch (error) {
                this.logger.error(`Failed to download Stremio Service: ${(error as Error).message}`);
                return false;
            }

            try {
                switch (platform) {
                    case "win32":
                        this.logger.info("Installing Stremio Service on Windows...");
                        await this.installWindows(destPath);
                        break;
                    case "darwin":
                        this.logger.info("Installing Stremio Service on macOS...");
                        await this.installMac(destPath);
                        break;
                    case "linux":
                        this.logger.info("Installing Stremio Service on Linux...");
                        await this.installLinux(destPath);
                        break;
                    default:
                        this.logger.error(`No install routine defined for platform: ${platform}`);
                        return false;
                }
            } catch (error) {
                this.logger.error(`Failed to install Stremio Service: ${(error as Error).message}`);
                return false;
            }
            
            // Verify installation was successful
            this.logger.info("Verifying installation...");
            const installed = await this.isServiceInstalled();
            if (installed) {
                this.logger.info("Stremio Service installed successfully. Starting service...");
                try {
                    await this.start();
                    return true;
                } catch (error) {
                    this.logger.error(`Installation successful but failed to start service: ${(error as Error).message}`);
                    // Still return true since installation succeeded, service might need manual start
                    return true;
                }
            } else {
                this.logger.warn("Installation process completed but service not detected as installed. You may need to install manually.");
                return false;
            }
        } catch (error) {
            this.logger.error(`Unexpected error during Stremio Service installation: ${(error as Error).message}`);
            return false;
        }
    }
    
    // grabs the latest version of Stremio Service from the official GitHub repository
    private static fetchLatestRelease(): Promise<GitHubRelease | null> {
        return new Promise<GitHubRelease>((resolve, reject) => {
            const req = https.request(this.API_URL, {
                headers: { "User-Agent": "Electron-AutoInstaller" },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        const parsed = JSON.parse(data) as GitHubRelease;
                        resolve(parsed);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
            req.on("error", reject);
            req.end();
        }).catch((err: Error): null => {
            this.logger.error("Error fetching release: " + err.message);
            return null;
        });
    }
    
    /**
     * Get direct download URL from dl.strem.io based on platform and version
     */
    private static async getDirectDownloadUrl(version: string, platform: string): Promise<string | null> {
        const baseUrl = `https://dl.strem.io/stremio-service/${version}`;
        
        switch (platform) {
            case "win32":
                // Windows: StremioServiceSetup.exe
                return `${baseUrl}/StremioServiceSetup.exe`;
                
            case "darwin":
                // macOS: StremioService.dmg
                return `${baseUrl}/StremioService.dmg`;
                
            case "linux":
                // Linux: Try to detect distribution, prefer Debian (.deb), then RedHat (.rpm)
                const distro = await this.detectLinuxDistribution();
                
                if (distro === "debian" || distro === "ubuntu" || distro === "unknown") {
                    // Try Debian package first (most common)
                    this.logger.info("Detected Debian-based Linux distribution, using .deb package");
                    return `${baseUrl}/stremio-service_amd64.deb`;
                } else if (distro === "redhat" || distro === "fedora" || distro === "centos") {
                    // Use RedHat package
                    this.logger.info("Detected RedHat-based Linux distribution, using .rpm package");
                    return `${baseUrl}/stremio-service_x86_64.rpm`;
                } else {
                    // Fallback to Debian package
                    this.logger.info("Unknown Linux distribution, defaulting to .deb package");
                    return `${baseUrl}/stremio-service_amd64.deb`;
                }
                
            default:
                this.logger.error(`Unsupported platform: ${platform}`);
                return null;
        }
    }
    
    /**
     * Detect Linux distribution type
     */
    private static async detectLinuxDistribution(): Promise<string> {
        if (process.platform !== "linux") return "unknown";
        
        try {
            // Try to read /etc/os-release (standard on modern Linux systems)
            if (existsSync("/etc/os-release")) {
                const osRelease = readFileSync("/etc/os-release", "utf-8");
                const idMatch = osRelease.match(/^ID=(.+)$/m);
                const idLikeMatch = osRelease.match(/^ID_LIKE=(.+)$/m);
                
                if (idMatch) {
                    const id = idMatch[1].trim().replace(/"/g, "").toLowerCase();
                    
                    // Debian-based distributions
                    if (id === "debian" || id === "ubuntu" || id === "linuxmint" || id === "pop" || id === "elementary") {
                        return "debian";
                    }
                    
                    // RedHat-based distributions
                    if (id === "fedora" || id === "rhel" || id === "centos" || id === "rocky" || id === "almalinux" || id === "opensuse") {
                        return "redhat";
                    }
                }
                
                if (idLikeMatch) {
                    const idLike = idLikeMatch[1].trim().replace(/"/g, "").toLowerCase();
                    
                    if (idLike.includes("debian") || idLike.includes("ubuntu")) {
                        return "debian";
                    }
                    if (idLike.includes("fedora") || idLike.includes("rhel") || idLike.includes("suse")) {
                        return "redhat";
                    }
                }
            }
            
            // Fallback: Check if package managers exist
            // Check if dpkg exists (Debian-based)
            try {
                await this.execFileAsync("dpkg", ["--version"]);
                return "debian";
            } catch {
                // Check if rpm exists (RedHat-based)
                try {
                    await this.execFileAsync("rpm", ["--version"]);
                    return "redhat";
                } catch {
                    // Check if pacman exists (Arch-based, but we'll default to Debian)
                    try {
                        await this.execFileAsync("pacman", ["--version"]);
                        return "debian"; // Arch can use .deb with dpkg tools
                    } catch {
                        return "unknown";
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to detect Linux distribution: ${(error as Error).message}`);
            // Default to Debian as it's more common
            return "unknown";
        }
    }
    
    private static async downloadFile(url: string, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = createWriteStream(dest);
            const req = https.get(
                url,
                { headers: { "User-Agent": "Electron-AutoInstaller" } },
                (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        https.get(res.headers.location, (r2) => r2.pipe(file));
                    } else {
                        res.pipe(file);
                    }
                    file.on("finish", () => file.close(() => resolve()));
                    res.on("error", reject);
                }
            );
            req.on("error", reject);
        });
    }
    
    private static async waitForInstallCompletion(timeoutMs = TIMEOUTS.INSTALL_COMPLETION, installerPath?: string): Promise<boolean> {
        const start = Date.now();
        
        while (Date.now() - start < timeoutMs) {
            const running = await this.isServiceRunning();
            if (running) return true;
            
            const installed = await this.isServiceInstalled();
            if (installed) {
                this.start();
                if(installerPath && existsSync(installerPath)) {
                    try {
                        unlinkSync(installerPath); // delete installer file after successful install
                    } catch (err) {
                        this.logger.warn("Failed to delete installer file: " + (err as Error).message);
                    }
                }
                return true;
            }
            
            await new Promise(r => setTimeout(r, TIMEOUTS.SERVICE_CHECK_INTERVAL));
        }
        
        return false;
    }
    
    private static async isServiceRunning(): Promise<boolean> {
        const platform = process.platform;

        if (platform === "win32") {
            return new Promise(resolve => {
                execFile("tasklist", ["/FI", 'IMAGENAME eq stremio-service.exe'], (_err, stdout) => {
                    resolve(Boolean(stdout && stdout.includes("stremio-service.exe")));
                });
            });
        }

        if (platform === "darwin") {
            return new Promise(resolve => {
                execFile("pgrep", ["-f", "StremioService"], (err) => {
                    resolve(!err);
                });
            });
        }

        if (platform === "linux") {
            return new Promise(resolve => {
                // Check if running via system installation (process name)
                execFile("pgrep", ["-f", "stremio-service"], (err) => {
                    if (!err) {
                        return resolve(true);
                    }
                    
                    // Check if running via Flatpak
                    execFile("flatpak", ["ps"], (err2, stdout) => {
                        if (!err2 && stdout && stdout.includes("com.stremio.Service")) {
                            return resolve(true);
                        }
                        resolve(false);
                    });
                });
            });
        }

        return false;
    }
    
    public static async isServiceInstalled(): Promise<boolean> {
        // Note: This checks for EXTERNAL installations only (not bundled service)
        // Use hasBundledService() to check for bundled service
        const platform = process.platform;

        switch(platform) {
            case "win32":
                return this.isServiceInstalledWindows();
            case "darwin":
                return existsSync("/Applications/StremioService.app/Contents/MacOS/stremio-service");
            case "linux":
                // Check if installed via Flatpak
                try {
                    const { stdout } = await this.execFileAsync("flatpak", ["info", "com.stremio.Service"]);
                    if (stdout.includes("com.stremio.Service")) {
                        return true;
                    }
                } catch {
                    // Not installed via Flatpak, continue checking other methods
                }
                
                // Check if installed via .deb/.rpm (system installation)
                // Stremio Service might be installed in common locations
                const commonPaths = [
                    "/usr/bin/stremio-service",
                    "/usr/local/bin/stremio-service",
                    "/opt/stremio-service/stremio-service",
                    "/usr/lib/stremio-service/stremio-service"
                ];
                
                for (const path of commonPaths) {
                    if (existsSync(path)) {
                        return true;
                    }
                }
                
                // Check if installed via dpkg (Debian-based)
                try {
                    const { stdout } = await this.execFileAsync("dpkg", ["-l", "stremio-service"]);
                    if (stdout.includes("stremio-service")) {
                        return true;
                    }
                } catch {
                    // Not installed via dpkg
                }
                
                // Check if installed via rpm (RedHat-based)
                try {
                    const { stdout } = await this.execFileAsync("rpm", ["-q", "stremio-service"]);
                    if (stdout.includes("stremio-service")) {
                        return true;
                    }
                } catch {
                    // Not installed via rpm
                }
                
                return false;
            default:
                return false;
        }
    }

    private static async isServiceInstalledWindows(): Promise<boolean> {
        const pathsToCheck: string[] = [];

        // Check LOCALAPPDATA\Programs\StremioService
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            pathsToCheck.push(join(localAppData, "Programs", "StremioService", "stremio-service.exe"));
        }

        // Check Program Files
        const programFiles = process.env.ProgramFiles;
        if (programFiles) {
            pathsToCheck.push(join(programFiles, "StremioService", "stremio-service.exe"));
        }

        // Check Program Files (x86)
        const programFilesX86 = process.env['ProgramFiles(x86)'];
        if (programFilesX86) {
            pathsToCheck.push(join(programFilesX86, "StremioService", "stremio-service.exe"));
        }

        // Check each path
        for (const servicePath of pathsToCheck) {
            if (existsSync(servicePath)) {
                this.logger.info(`Found Stremio Service at: ${servicePath}`);
                return true;
            }
        }

        return false;
    }

    private static async installWindows(filePath: string) {
        this.logger.info("Starting Windows installation process...");

        // Use -Wait flag to wait for the installer to complete
        // Removed /S (silent) flag as it doesn't work reliably with UAC elevation
        const ps = `Start-Process -FilePath "${filePath}" -Verb RunAs -Wait -PassThru`;

        try {
            await this.execFileAsync("powershell.exe", [
                "-ExecutionPolicy", "Bypass",
                "-NoProfile",
                "-Command", ps
            ], {
                windowsHide: true,
                timeout: TIMEOUTS.INSTALL_COMPLETION + 30000 // Add buffer for UAC prompt
            });

            this.logger.info("Installer process completed.");
        } catch (error) {
            // If timeout or error, check if installation succeeded anyway
            this.logger.warn(`Installer process returned error or timeout: ${(error as Error).message}`);
        }

        // Give the system a moment to register the installation
        await new Promise(r => setTimeout(r, 2000));

        // Verify installation
        const installed = await this.isServiceInstalled();
        if (installed) {
            this.logger.info("Stremio Service installation verified successfully.");
            // Clean up installer file
            if (existsSync(filePath)) {
                try {
                    unlinkSync(filePath);
                    this.logger.info("Installer file cleaned up.");
                } catch (err) {
                    this.logger.warn("Failed to delete installer file: " + (err as Error).message);
                }
            }
        } else {
            // Fall back to polling-based wait
            this.logger.info("Installation not immediately detected, waiting for completion...");
            const success = await this.waitForInstallCompletion(TIMEOUTS.INSTALL_COMPLETION, filePath);

            if (success) {
                this.logger.info("Stremio Service detected as installed or running.");
            } else {
                this.logger.warn("Installation timeout or failed to detect Stremio Service.");
            }
        }
    }

    private static async installMac(filePath: string) {
        const volume = "/Volumes/StremioService";
        try {
            await this.execFileAsync("hdiutil", ["attach", filePath, "-mountpoint", volume]);
            await this.execFileAsync("cp", ["-R", `${volume}/StremioService.app`, "/Applications/"]);
        } catch (err) {
            this.logger.error(`DMG install failed: ${err}`);
        } finally {
            await this.execFileAsync("hdiutil", ["detach", volume]).catch(() => {});
        }

        this.logger.info("Waiting for Stremio Service installation to finish...");
        const success = await this.waitForInstallCompletion(TIMEOUTS.INSTALL_COMPLETION, filePath); 

        if (success) {
            this.logger.info("Stremio Service detected as installed or running.");
        } else {
            this.logger.warn("Installation timeout or failed to detect Stremio Service.");
        }
    }
    
    private static async installLinux(filePath: string) {
        try {
            const fileName = basename(filePath);
            const isDeb = fileName.endsWith(".deb");
            const isRpm = fileName.endsWith(".rpm");
            const isFlatpak = fileName.endsWith(".flatpak");
            
            if (isDeb) {
                // Install Debian package using dpkg or apt
                this.logger.info(`Installing Debian package: ${fileName}`);
                
                // Try using apt first (better dependency handling), fallback to dpkg
                try {
                    await this.execFileAsync("sudo", ["apt", "install", "-y", filePath]);
                    this.logger.info("Stremio Service installed using apt");
                } catch (aptError) {
                    this.logger.warn(`apt install failed, trying dpkg: ${(aptError as Error).message}`);
                    try {
                        await this.execFileAsync("sudo", ["dpkg", "-i", filePath]);
                        // Fix any dependency issues
                        await this.execFileAsync("sudo", ["apt", "install", "-f", "-y"]).catch(() => {});
                        this.logger.info("Stremio Service installed using dpkg");
                    } catch (dpkgError) {
                        throw new Error(`Failed to install .deb package: ${(dpkgError as Error).message}`);
                    }
                }
            } else if (isRpm) {
                // Install RedHat package using rpm or dnf/yum
                this.logger.info(`Installing RPM package: ${fileName}`);
                
                // Try using dnf/yum first (better dependency handling), fallback to rpm
                try {
                    // Check if dnf exists, otherwise use yum
                    try {
                        await this.execFileAsync("dnf", ["--version"]);
                        await this.execFileAsync("sudo", ["dnf", "install", "-y", filePath]);
                        this.logger.info("Stremio Service installed using dnf");
                    } catch {
                        await this.execFileAsync("sudo", ["yum", "install", "-y", filePath]);
                        this.logger.info("Stremio Service installed using yum");
                    }
                } catch (yumError) {
                    this.logger.warn(`dnf/yum install failed, trying rpm: ${(yumError as Error).message}`);
                    try {
                        await this.execFileAsync("sudo", ["rpm", "-i", "--nodeps", filePath]);
                        this.logger.info("Stremio Service installed using rpm");
                    } catch (rpmError) {
                        throw new Error(`Failed to install .rpm package: ${(rpmError as Error).message}`);
                    }
                }
            } else if (isFlatpak) {
                // Fallback to Flatpak installation
                this.logger.info(`Installing Flatpak package: ${fileName}`);
                await this.execFileAsync("flatpak", [
                    "remote-add",
                    "--if-not-exists",
                    "flathub",
                    "https://dl.flathub.org/repo/flathub.flatpakrepo"
                ]).catch(() => {});

                try {
                    await this.execFileAsync("flatpak", ["info", "org.freedesktop.Platform//24.08"]);
                } catch {
                    this.logger.info("Installing Flatpak runtime org.freedesktop.Platform//24.08...");
                    await this.execFileAsync("flatpak", ["install", "-y", "flathub", "org.freedesktop.Platform//24.08"]);
                }

                await this.execFileAsync("flatpak", ["install", "--user", "-y", filePath]);
                this.logger.info("Stremio Service installed using Flatpak");
            } else {
                throw new Error(`Unsupported Linux package format: ${fileName}`);
            }

            const success = await this.waitForInstallCompletion(TIMEOUTS.INSTALL_COMPLETION, filePath);

            if (success) {
                this.logger.info("Stremio Service detected as installed or running.");
            } else {
                this.logger.warn("Installation timeout or failed to detect Stremio Service.");
            }
        } catch (err) {
            this.logger.error(`Linux package install failed: ${(err as Error).message}`);
            throw err; // Re-throw to be caught by the caller
        }
    }
    
    public static terminate(): number {
        try {
            this.logger.info("Terminating Stremio Service.");

            // Use stored PID first, fall back to system lookup
            const pid = this.servicePid || this.getStremioServicePid();
            if (pid) {
                if (process.platform === 'win32') {
                    // On Windows, use taskkill with /F (force) and /T (kill process tree)
                    // This ensures child processes like stremio-runtime.exe are also terminated
                    try {
                        const execSync = require('child_process').execSync;
                        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
                        this.logger.info(`Stremio Service (PID: ${pid}) and its child processes terminated.`);
                    } catch (taskkillError) {
                        // If taskkill fails, try the old method as fallback
                        this.logger.warn(`taskkill failed, trying process.kill: ${(taskkillError as Error).message}`);
                        try {
                            process.kill(pid, 'SIGTERM');
                            this.logger.info("Stremio Service terminated via process.kill.");
                        } catch (killError) {
                            this.logger.error(`Both termination methods failed: ${(killError as Error).message}`);
                            // Reset tracking flags even on error
                            this.appStartedService = false;
                            this.servicePid = null;
                            return 2;
                        }
                    }
                    // Also kill any remaining stremio-runtime.exe processes as a safety measure
                    try {
                        const execSync = require('child_process').execSync;
                        execSync('taskkill /F /IM stremio-runtime.exe', { stdio: 'ignore' });
                        this.logger.info("Killed any remaining stremio-runtime.exe processes.");
                    } catch (runtimeError) {
                        // Ignore if no stremio-runtime.exe processes are running
                        // Error code 128 typically means "process not found"
                    }
                } else {
                    // On Unix-like systems, SIGTERM should properly terminate child processes
                    process.kill(pid, 'SIGTERM');
                    this.logger.info("Stremio Service terminated.");
                }
                // Reset tracking flags
                this.appStartedService = false;
                this.servicePid = null;
                return 0;
            } else {
                this.logger.error("Failed to find Stremio Service PID.");
                // Try to kill stremio-runtime.exe processes directly if PID not found
                if (process.platform === 'win32') {
                    try {
                        const execSync = require('child_process').execSync;
                        execSync('taskkill /F /IM stremio-runtime.exe', { stdio: 'ignore' });
                        this.logger.info("Killed stremio-runtime.exe processes directly.");
                    } catch (runtimeError) {
                        // Ignore if no stremio-runtime.exe processes are running
                    }
                }
                return 1;
            }
        } catch (e) {
            this.logger.error(`Error terminating service: ${(e as Error).message}`);
            return 2;
        }
    }

    /**
     * Restarts the Stremio Service.
     * This is useful when streaming configuration changes require a service restart.
     * @returns Promise that resolves when the service has been restarted
     */
    public static async restartService(): Promise<boolean> {
        try {
            this.logger.info("Restarting Stremio Service...");

            // Only terminate if we started it or if it's running
            const wasRunning = await this.isProcessRunning();

            if (wasRunning) {
                this.terminate();
                // Wait for the service to fully stop
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Start the service again
            await this.start();

            // Verify it's running
            await new Promise(resolve => setTimeout(resolve, 1000));
            const isRunning = await this.isProcessRunning();

            if (isRunning) {
                this.logger.info("Stremio Service restarted successfully");
                return true;
            } else {
                this.logger.warn("Stremio Service may not have started properly after restart");
                return false;
            }
        } catch (error) {
            this.logger.error(`Failed to restart Stremio Service: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Terminates the Stremio Service only if this app instance started it.
     * This prevents killing a service that was started by another application.
     * @returns true if service was terminated, false if it was left running
     */
    public static terminateIfStartedByApp(): boolean {
        if (this.appStartedService) {
            this.logger.info("App started the service, terminating...");
            const result = this.terminate();
            return result === 0;
        } else {
            this.logger.info("Service was not started by this app, leaving it running.");
            return false;
        }
    }

    /**
     * Forcefully terminates ALL Stremio-related processes regardless of who started them.
     * This should be called when the app is closing to ensure no orphan processes remain.
     */
    public static forceTerminate(): void {
        const execSync = require('child_process').execSync;
        this.logger.info("Force terminating all Stremio processes...");

        try {
            if (process.platform === 'win32') {
                // Windows: Kill stremio-service.exe and stremio-runtime.exe
                try {
                    execSync('taskkill /F /IM stremio-service.exe /T', { stdio: 'ignore' });
                    this.logger.info("Killed stremio-service.exe");
                } catch (e) { /* Process might not exist */ }

                try {
                    execSync('taskkill /F /IM stremio-runtime.exe', { stdio: 'ignore' });
                    this.logger.info("Killed stremio-runtime.exe");
                } catch (e) { /* Process might not exist */ }
            } else if (process.platform === 'darwin') {
                // macOS: Kill stremio-service and any related node processes
                try {
                    execSync('pkill -9 -f stremio-service', { stdio: 'ignore' });
                    this.logger.info("Killed stremio-service processes");
                } catch (e) { /* Process might not exist */ }

                try {
                    execSync('pkill -9 -f "server.js"', { stdio: 'ignore' });
                    this.logger.info("Killed server.js processes");
                } catch (e) { /* Process might not exist */ }
            } else {
                // Linux: Kill stremio-service and related processes
                try {
                    execSync('pkill -9 -f stremio-service', { stdio: 'ignore' });
                    this.logger.info("Killed stremio-service processes");
                } catch (e) { /* Process might not exist */ }

                try {
                    execSync('pkill -9 -f "server.js"', { stdio: 'ignore' });
                    this.logger.info("Killed server.js processes");
                } catch (e) { /* Process might not exist */ }
            }

            // Reset tracking flags
            this.appStartedService = false;
            this.servicePid = null;
            this.logger.info("Force termination complete.");
        } catch (error) {
            this.logger.error(`Error during force termination: ${(error as Error).message}`);
        }
    }
    
    private static getStremioServicePid(): number | null {
        switch (process.platform) {
            case 'win32':
                return this.getPidForWindows();
            case 'darwin':
            case 'linux':
                return this.getPidForUnix();
            default:
                this.logger.error('Unsupported operating system');
                return null;
        }
    }
    
    private static getPidForWindows(): number | null {
        const execSync = require('child_process').execSync;
        try {
            const output = execSync('tasklist /FI "IMAGENAME eq stremio-service.exe"').toString();
            
            const lines = output.split('\n');
            
            for (const line of lines) {
                if (line.includes('stremio-service.exe')) {
                    const columns = line.trim().split(/\s+/);
                    if (columns.length > 1) {
                        return parseInt(columns[1], 10);
                    }
                }
            }
            
            this.logger.error("Stremio service not found in tasklist.");
        } catch (error) {
            this.logger.error('Error retrieving PID for Stremio service on Windows:' + error);
        }
        return null;
    }
    
    
    private static getPidForUnix(): number | null {
        const execSync = require('child_process').execSync;
        try {
            const output = execSync("pgrep -f stremio-service").toString();
            return parseInt(output.trim(), 10);
        } catch (error) {
            this.logger.error('Error retrieving PID for Stremio service on Unix: ' + error);
        }
        return null;
    }

    public static findExecutable(): string | null {
        // Check bundled service first
        const bundledPath = this.getBundledServicePath();
        if (bundledPath) {
            return bundledPath;
        }

        // Check current directory
        const localPath = resolve('./stremio-service.exe');
        if (existsSync(localPath)) {
            this.logger.info("StremioService executable found in the current directory.");
            return localPath;
        }

        const pathsToCheck: string[] = [];

        // LOCALAPPDATA\Programs\StremioService
        const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
        pathsToCheck.push(join(localAppData, 'Programs', 'StremioService', 'stremio-service.exe'));

        // Program Files
        const programFiles = process.env.ProgramFiles;
        if (programFiles) {
            pathsToCheck.push(join(programFiles, 'StremioService', 'stremio-service.exe'));
        }

        // Program Files (x86)
        const programFilesX86 = process.env['ProgramFiles(x86)'];
        if (programFilesX86) {
            pathsToCheck.push(join(programFilesX86, 'StremioService', 'stremio-service.exe'));
        }

        for (const path of pathsToCheck) {
            const fullPath = resolve(path);
            this.logger.info("Checking existence of " + fullPath);
            try {
                if (existsSync(fullPath)) {
                    this.logger.info(`StremioService executable found at: ${fullPath}`);
                    return fullPath;
                }
            } catch (error) {
                this.logger.error(`Error checking StremioService existence at ${fullPath}: ${(error as Error).message}`);
            }
        }

        this.logger.warn("StremioService executable not found in any known location");
        return null;
    }
    
    public static async isProcessRunning(): Promise<boolean> {
        try {
            switch (process.platform) {

                case "win32": 
                    const { stdout } = await this.execFileAsync("tasklist", ["/FI", 'IMAGENAME eq stremio-service.exe']);
                    return stdout.toLowerCase().includes("stremio-service.exe");
                case "darwin":
                case "linux": 
                    try {
                        await this.execFileAsync("pgrep", ["-f", "stremio-service"]);
                        return true;
                    } catch {
                        return false;
                    }
                default:
                    this.logger.error("Unsupported operating system");
                    return false;
            }

        } catch (error) {
            this.logger.error(`Error checking service running state: ${(error as Error).message}`);
            return false;
        }
    }
}

export default StremioService;