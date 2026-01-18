import { getLogger } from "./logger";
import { existsSync } from "fs";
import { spawn, execSync } from "child_process";
import * as process from 'process';
import * as path from 'path';

const logger = getLogger("ExternalPlayer");

// Result type for launch operation
export interface LaunchResult {
    success: boolean;
    error?: string;
}

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
        ],
        mpv: [
            "C:\\Program Files\\mpv\\mpv.exe",
            "C:\\Program Files (x86)\\mpv\\mpv.exe",
            path.join(process.env.LOCALAPPDATA || '', 'mpv', 'mpv.exe'),
            path.join(process.env.ProgramData || '', 'mpv', 'mpv.exe')
        ]
    },
    darwin: {
        vlc: [
            "/Applications/VLC.app/Contents/MacOS/VLC"
        ],
        mpchc: [], // MPC-HC not available on macOS
        mpv: [
            "/Applications/mpv.app/Contents/MacOS/mpv",
            "/usr/local/bin/mpv",
            "/opt/homebrew/bin/mpv",
            path.join(process.env.HOME || '', '.local', 'bin', 'mpv')
        ]
    },
    linux: {
        vlc: [
            "/usr/bin/vlc",
            "/snap/bin/vlc",
            "/var/lib/flatpak/exports/bin/org.videolan.VLC"
        ],
        mpchc: [], // MPC-HC not available on Linux
        mpv: [
            "/usr/bin/mpv",
            "/usr/local/bin/mpv",
            "/snap/bin/mpv",
            "/var/lib/flatpak/exports/bin/io.mpv.Mpv",
            path.join(process.env.HOME || '', '.local', 'bin', 'mpv')
        ]
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

        // Check predefined paths first
        for (const path of paths) {
            if (existsSync(path)) {
                logger.info(`Found ${player} at: ${path}`);
                return path;
            }
        }

        // Fallback: Check if player is available in system PATH
        try {
            const whichCommand = platform === 'win32' ? 'where' : 'which';
            const result = execSync(`${whichCommand} ${player}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });
            const pathFromWhich = result.trim().split('\n')[0];
            if (pathFromWhich && existsSync(pathFromWhich)) {
                logger.info(`Found ${player} in PATH at: ${pathFromWhich}`);
                return pathFromWhich;
            }
        } catch (e) {
            // Player not found in PATH, continue to warning below
        }

        logger.warn(`Player "${player}" not found in common installation paths or system PATH`);
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
     * @returns LaunchResult indicating success or failure with error message
     */
    public static launch(player: string, url: string, title?: string, customPath?: string): LaunchResult {
        logger.info(`[Launch] Platform: ${process.platform}, Player: ${player}`);
        logger.info(`[Launch] Custom path: ${customPath || 'none (auto-detect)'}`);

        const playerPath = customPath && this.validatePath(customPath)
            ? customPath
            : this.detectPlayer(player);

        logger.info(`[Launch] Resolved playerPath: ${playerPath || 'NOT FOUND'}`);

        if (!playerPath) {
            const error = `Cannot launch ${player}: player not found. Install ${player.toUpperCase()} or set a custom path in settings.`;
            logger.error(error);
            return { success: false, error };
        }

        const args = this.getPlayerArgs(player, url, title);

        logger.info(`[Launch] Spawning: "${playerPath}" with args: ${JSON.stringify(args)}`);

        try {
            const child = spawn(playerPath, args, {
                detached: true,
                stdio: "ignore"
            });
            child.unref();
            logger.info(`[Launch] ${player} launched successfully`);
            return { success: true };
        } catch (err) {
            const error = `Failed to launch ${player}: ${(err as Error).message}`;
            logger.error(error);
            return { success: false, error };
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
                // Removed --fullscreen flag to allow windowed mode
                return vlcArgs;

            case 'mpchc':
                // Removed /fullscreen flag to allow windowed mode
                return [url, '/play'];

            case 'mpv':
                const mpvArgs = [
                    url,
                    '--force-window=immediate',  // Open window immediately
                    '--keep-open=yes',           // Keep window open when playback ends
                    '--no-terminal'              // Don't create console window on Windows
                ];
                if (title) {
                    mpvArgs.push(`--force-media-title=${title}`);
                }
                return mpvArgs;

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
