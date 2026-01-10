import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { getLogger } from "../utils/logger";
import { STREAMING_PROFILES, STREAMING_PROFILE_SETTINGS } from "../constants";

const logger = getLogger("StreamingConfig");

// Interface for server-settings.json structure
export interface ServerSettings {
    cacheSize?: number;
    btMaxConnections?: number;
    btHandshakeTimeout?: number;
    btRequestTimeout?: number;
    btDownloadSpeedSoftLimit?: number;
    btDownloadSpeedHardLimit?: number;
    btMinPeersForStable?: number;
    [key: string]: unknown; // Allow additional unknown fields
}

export type StreamingProfile = typeof STREAMING_PROFILES[keyof typeof STREAMING_PROFILES];

class StreamingConfig {
    /**
     * Gets the platform-specific path for Stremio's server-settings.json
     */
    public static getServerSettingsPath(): string {
        let basePath: string;

        switch (process.platform) {
            case "win32":
                // Windows: %LOCALAPPDATA%\stremio-server\
                basePath = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
                return join(basePath, "stremio-server", "server-settings.json");
            case "darwin":
                // macOS: ~/Library/Application Support/stremio-server/
                return join(homedir(), "Library", "Application Support", "stremio-server", "server-settings.json");
            case "linux":
                // Linux: ~/.stremio-server/
                return join(homedir(), ".stremio-server", "server-settings.json");
            default:
                logger.warn(`Unknown platform: ${process.platform}, defaulting to Linux path`);
                return join(homedir(), ".stremio-server", "server-settings.json");
        }
    }

    /**
     * Gets the directory containing server-settings.json
     */
    public static getServerSettingsDir(): string {
        const settingsPath = this.getServerSettingsPath();
        return settingsPath.substring(0, settingsPath.lastIndexOf(process.platform === "win32" ? "\\" : "/"));
    }

    /**
     * Reads the current server settings from disk
     * @returns The parsed settings object, or null if file doesn't exist or is invalid
     */
    public static readServerSettings(): ServerSettings | null {
        const settingsPath = this.getServerSettingsPath();

        if (!existsSync(settingsPath)) {
            logger.info(`Server settings file not found at: ${settingsPath}`);
            return null;
        }

        try {
            const content = readFileSync(settingsPath, "utf-8");
            const settings = JSON.parse(content) as ServerSettings;
            logger.info("Successfully read server settings");
            return settings;
        } catch (error) {
            logger.error(`Failed to read server settings: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Writes settings to the server-settings.json file
     * Preserves any existing fields not managed by StreamGo
     * @param settings The settings to write
     * @returns true if successful, false otherwise
     */
    public static writeServerSettings(settings: ServerSettings): boolean {
        const settingsPath = this.getServerSettingsPath();
        const settingsDir = this.getServerSettingsDir();

        try {
            // Ensure directory exists
            if (!existsSync(settingsDir)) {
                mkdirSync(settingsDir, { recursive: true });
                logger.info(`Created settings directory: ${settingsDir}`);
            }

            // Read existing settings to preserve unknown fields
            const existingSettings = this.readServerSettings() || {};

            // Merge new settings with existing (new settings take precedence)
            const mergedSettings = { ...existingSettings, ...settings };

            // Write to file with pretty formatting
            writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), "utf-8");
            logger.info(`Successfully wrote server settings to: ${settingsPath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to write server settings: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Gets the settings for a specific profile
     * @param profile The profile name
     * @returns The settings object for the profile
     */
    public static getProfileSettings(profile: StreamingProfile): ServerSettings {
        const profileKey = profile as keyof typeof STREAMING_PROFILE_SETTINGS;

        if (!(profileKey in STREAMING_PROFILE_SETTINGS)) {
            logger.warn(`Unknown profile: ${profile}, defaulting to balanced`);
            return { ...STREAMING_PROFILE_SETTINGS.balanced };
        }

        return { ...STREAMING_PROFILE_SETTINGS[profileKey] };
    }

    /**
     * Applies a performance profile to the server settings
     * @param profile The profile to apply
     * @returns true if successful, false otherwise
     */
    public static applyProfile(profile: StreamingProfile): boolean {
        const settings = this.getProfileSettings(profile);
        const success = this.writeServerSettings(settings);

        if (success) {
            logger.info(`Applied streaming profile: ${profile}`);
        } else {
            logger.error(`Failed to apply streaming profile: ${profile}`);
        }

        return success;
    }

    /**
     * Detects which profile best matches the current settings
     * @returns The matching profile name, or null if no match
     */
    public static detectCurrentProfile(): StreamingProfile | null {
        const currentSettings = this.readServerSettings();

        if (!currentSettings) {
            return null;
        }

        // Check each profile for a match (using btMaxConnections as primary indicator)
        for (const [profileName, profileSettings] of Object.entries(STREAMING_PROFILE_SETTINGS)) {
            if (currentSettings.btMaxConnections === profileSettings.btMaxConnections &&
                currentSettings.cacheSize === profileSettings.cacheSize) {
                return profileName as StreamingProfile;
            }
        }

        // No exact match found
        return null;
    }

    /**
     * Gets a human-readable description of a profile
     */
    public static getProfileDescription(profile: StreamingProfile): string {
        switch (profile) {
            case STREAMING_PROFILES.CONSERVATIVE:
                return "Lower resource usage, suitable for limited bandwidth or older hardware. Uses 2GB cache and 55 max connections.";
            case STREAMING_PROFILES.BALANCED:
                return "Recommended for most users. Good balance between performance and resource usage. Uses 5GB cache and 100 max connections.";
            case STREAMING_PROFILES.AGGRESSIVE:
                return "Optimized for HD/4K content. Higher resource usage for better streaming performance. Uses 10GB cache and 200 max connections.";
            default:
                return "Unknown profile";
        }
    }

    /**
     * Formats a byte size to human-readable string
     */
    public static formatBytes(bytes: number): string {
        if (bytes >= 1073741824) {
            return `${(bytes / 1073741824).toFixed(1)} GB`;
        } else if (bytes >= 1048576) {
            return `${(bytes / 1048576).toFixed(1)} MB`;
        } else if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${bytes} B`;
    }
}

export default StreamingConfig;
