import { getLogger } from "./logger";
import { existsSync } from "fs";
import { spawn } from "child_process";
import * as process from 'process';

const logger = getLogger("ExternalPlayer");

// Player executable paths by platform
const PLAYER_PATHS: Record<string, Record<string, string[]>> = {
    win32: {
        vlc: [
            "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
            "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"
        ],
        mpchc: [
            "C:\\Program Files\\MPC-HC\\mpc-hc64.exe",
            "C:\\Program Files (x86)\\MPC-HC\\mpc-hc.exe",
            "C:\\Program Files\\MPC-HC64\\mpc-hc64.exe"
        ]
    },
    darwin: {
        vlc: [
            "/Applications/VLC.app/Contents/MacOS/VLC"
        ],
        mpchc: [] // MPC-HC not available on macOS
    },
    linux: {
        vlc: [
            "/usr/bin/vlc",
            "/snap/bin/vlc",
            "/var/lib/flatpak/exports/bin/org.videolan.VLC"
        ],
        mpchc: [] // MPC-HC not available on Linux
    }
};

class ExternalPlayer {
    /**
     * Detect if a player is installed and return its path
     */
    public static detectPlayer(player: string): string | null {
        const platform = process.platform;
        const paths = PLAYER_PATHS[platform]?.[player];

        if (!paths || paths.length === 0) {
            logger.warn(`No known paths for player "${player}" on platform "${platform}"`);
            return null;
        }

        for (const path of paths) {
            if (existsSync(path)) {
                logger.info(`Found ${player} at: ${path}`);
                return path;
            }
        }

        logger.warn(`Player "${player}" not found in common installation paths`);
        return null;
    }

    /**
     * Validate if a custom player path exists and is accessible
     */
    public static validatePath(path: string): boolean {
        if (!path || path.trim() === '') {
            return false;
        }
        return existsSync(path);
    }

    /**
     * Launch an external player with the given stream URL
     */
    public static launch(player: string, url: string, title?: string, customPath?: string): void {
        const playerPath = customPath && this.validatePath(customPath)
            ? customPath
            : this.detectPlayer(player);

        if (!playerPath) {
            logger.error(`Cannot launch ${player}: player not found`);
            return;
        }

        const args = this.getPlayerArgs(player, url, title);

        logger.info(`Launching ${player}: ${playerPath} ${args.join(' ')}`);

        try {
            const child = spawn(playerPath, args, {
                detached: true,
                stdio: "ignore"
            });
            child.unref();
            logger.info(`${player} launched successfully`);
        } catch (err) {
            logger.error(`Failed to launch ${player}: ${(err as Error).message}`);
        }
    }

    /**
     * Get the command line arguments for a specific player
     */
    private static getPlayerArgs(player: string, url: string, title?: string): string[] {
        switch (player) {
            case 'vlc':
                const vlcArgs = [url];
                if (title) {
                    vlcArgs.push(`--meta-title=${title}`);
                }
                vlcArgs.push('--fullscreen');
                return vlcArgs;

            case 'mpchc':
                return [url, '/fullscreen', '/play'];

            default:
                return [url];
        }
    }

    /**
     * Get list of available players on current platform
     */
    public static getAvailablePlayers(): string[] {
        const platform = process.platform;
        const platformPaths = PLAYER_PATHS[platform];

        if (!platformPaths) {
            return [];
        }

        const available: string[] = [];
        for (const [player, paths] of Object.entries(platformPaths)) {
            if (paths.length > 0) {
                for (const path of paths) {
                    if (existsSync(path)) {
                        available.push(player);
                        break;
                    }
                }
            }
        }

        return available;
    }
}

export default ExternalPlayer;
