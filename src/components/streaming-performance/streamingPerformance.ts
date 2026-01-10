import TemplateCache from '../../utils/templateCache';
import Helpers from '../../utils/Helpers';
import logger from '../../utils/logger';
import { STORAGE_KEYS, STREAMING_PROFILES, STREAMING_PROFILE_SETTINGS, IPC_CHANNELS, SELECTORS } from '../../constants';
import { ipcRenderer } from 'electron';

// Profile descriptions
const PROFILE_DESCRIPTIONS: Record<string, string> = {
    conservative: "Lower resource usage, suitable for limited bandwidth or older hardware. Uses 2GB cache and 55 max connections.",
    balanced: "Recommended for most users. Good balance between performance and resource usage. Uses 5GB cache and 100 max connections.",
    aggressive: "Optimized for HD/4K content. Higher resource usage for better streaming performance. Uses 10GB cache and 200 max connections.",
};

/**
 * Formats bytes to human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes >= 1073741824) {
        return `${(bytes / 1073741824).toFixed(1)} GB`;
    } else if (bytes >= 1048576) {
        return `${(bytes / 1048576).toFixed(0)} MB/s`;
    }
    return `${bytes} B`;
}

/**
 * Gets the SVG icon for the streaming performance category
 */
export function getStreamingPerformanceIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>`;
}

/**
 * Gets the streaming performance template with current values populated
 */
export function getStreamingPerformanceTemplate(currentProfile: string): string {
    let template = TemplateCache.load(__dirname, 'streaming-performance');

    const profileSettings = STREAMING_PROFILE_SETTINGS[currentProfile as keyof typeof STREAMING_PROFILE_SETTINGS]
        || STREAMING_PROFILE_SETTINGS.balanced;

    return template
        .replace(/\{\{\s*conservativeSelected\s*\}\}/g, currentProfile === 'conservative' ? 'selected' : '')
        .replace(/\{\{\s*balancedSelected\s*\}\}/g, currentProfile === 'balanced' ? 'selected' : '')
        .replace(/\{\{\s*aggressiveSelected\s*\}\}/g, currentProfile === 'aggressive' ? 'selected' : '')
        .replace(/\{\{\s*profileDescription\s*\}\}/g, PROFILE_DESCRIPTIONS[currentProfile] || PROFILE_DESCRIPTIONS.balanced)
        .replace(/\{\{\s*cacheSize\s*\}\}/g, formatBytes(profileSettings.cacheSize))
        .replace(/\{\{\s*maxConnections\s*\}\}/g, profileSettings.btMaxConnections.toString())
        .replace(/\{\{\s*speedLimit\s*\}\}/g, formatBytes(profileSettings.btDownloadSpeedHardLimit))
        .replace(/\{\{\s*minPeers\s*\}\}/g, profileSettings.btMinPeersForStable.toString());
}

/**
 * Updates the profile details display based on selected profile
 */
function updateProfileDetails(profile: string): void {
    const profileSettings = STREAMING_PROFILE_SETTINGS[profile as keyof typeof STREAMING_PROFILE_SETTINGS]
        || STREAMING_PROFILE_SETTINGS.balanced;

    const descriptionEl = document.getElementById('profileDescriptionText');
    const cacheSizeEl = document.getElementById('profileCacheSize');
    const maxConnectionsEl = document.getElementById('profileMaxConnections');
    const speedLimitEl = document.getElementById('profileSpeedLimit');
    const minPeersEl = document.getElementById('profileMinPeers');

    if (descriptionEl) descriptionEl.textContent = PROFILE_DESCRIPTIONS[profile] || PROFILE_DESCRIPTIONS.balanced;
    if (cacheSizeEl) cacheSizeEl.textContent = formatBytes(profileSettings.cacheSize);
    if (maxConnectionsEl) maxConnectionsEl.textContent = profileSettings.btMaxConnections.toString();
    if (speedLimitEl) speedLimitEl.textContent = formatBytes(profileSettings.btDownloadSpeedHardLimit);
    if (minPeersEl) minPeersEl.textContent = profileSettings.btMinPeersForStable.toString();
}

/**
 * Updates the status message
 */
function updateStatus(message: string, isError = false): void {
    const statusEl = document.getElementById('streamingProfileStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = isError ? '#f44336' : '#4caf50';
    }
}

/**
 * Writes the streaming performance section to the settings page
 */
export function writeStreamingPerformance(): void {
    Helpers.waitForElm(SELECTORS.TWEAKS_CATEGORY).then(() => {
        // Get current profile from localStorage or default to balanced
        const currentProfile = localStorage.getItem(STORAGE_KEYS.STREAMING_PROFILE) || STREAMING_PROFILES.BALANCED;

        const tweaksCategory = document.querySelector(SELECTORS.TWEAKS_CATEGORY);
        if (tweaksCategory) {
            tweaksCategory.innerHTML += getStreamingPerformanceTemplate(currentProfile);
            logger.info("[StreamingPerformance] Streaming performance section added to settings");
        }
    }).catch(err => logger.error("[StreamingPerformance] Failed to write streaming performance section: " + err));
}

/**
 * Sets up event listeners for the streaming performance controls
 */
export function setupStreamingPerformanceControls(): void {
    // Profile selector change handler
    Helpers.waitForElm('#streamingProfileSelect').then(() => {
        const select = document.getElementById('streamingProfileSelect') as HTMLSelectElement;
        if (!select || select.hasAttribute('data-handler-attached')) return;
        select.setAttribute('data-handler-attached', 'true');

        select.addEventListener('change', () => {
            const selectedProfile = select.value;
            updateProfileDetails(selectedProfile);
            updateStatus(''); // Clear status when changing selection
            logger.info(`[StreamingPerformance] Profile selection changed to: ${selectedProfile}`);
        });
    }).catch(err => logger.warn("[StreamingPerformance] Profile select not found: " + err));

    // Apply button click handler
    Helpers.waitForElm('#applyStreamingProfileBtn').then(() => {
        const button = document.getElementById('applyStreamingProfileBtn') as HTMLButtonElement;
        if (!button || button.hasAttribute('data-handler-attached')) return;
        button.setAttribute('data-handler-attached', 'true');

        button.addEventListener('click', async () => {
            const select = document.getElementById('streamingProfileSelect') as HTMLSelectElement;
            const selectedProfile = select?.value || STREAMING_PROFILES.BALANCED;

            // Disable button during operation
            button.disabled = true;
            button.textContent = 'Applying...';
            updateStatus('Applying profile...');

            try {
                // Apply the profile via IPC
                const applyResult = await ipcRenderer.invoke(IPC_CHANNELS.SET_STREAMING_PROFILE, selectedProfile);

                if (!applyResult.success) {
                    throw new Error('Failed to apply profile');
                }

                // Save to localStorage
                localStorage.setItem(STORAGE_KEYS.STREAMING_PROFILE, selectedProfile);

                updateStatus('Profile applied. Restarting service...');
                logger.info(`[StreamingPerformance] Profile ${selectedProfile} applied successfully`);

                // Restart the streaming service
                button.textContent = 'Restarting...';
                const restartResult = await ipcRenderer.invoke(IPC_CHANNELS.RESTART_STREAMING_SERVICE);

                if (restartResult.success) {
                    updateStatus('Service restarted successfully!');
                    logger.info("[StreamingPerformance] Streaming service restarted successfully");
                } else {
                    updateStatus('Profile applied but service restart may have failed', true);
                    logger.warn("[StreamingPerformance] Service restart may have failed");
                }
            } catch (error) {
                updateStatus(`Error: ${(error as Error).message}`, true);
                logger.error(`[StreamingPerformance] Failed to apply profile: ${(error as Error).message}`);
            } finally {
                // Re-enable button
                button.disabled = false;
                button.textContent = 'Apply & Restart Service';

                // Clear status after 5 seconds
                setTimeout(() => updateStatus(''), 5000);
            }
        });
    }).catch(err => logger.warn("[StreamingPerformance] Apply button not found: " + err));

    // Setup collapsible behavior
    Helpers.waitForElm('#streamingPerformanceSection').then(() => {
        const header = document.querySelector('[data-section="streaming-performance"].enhanced-collapsible-header') as HTMLElement;
        if (!header || header.hasAttribute('data-handler-attached')) return;
        header.setAttribute('data-handler-attached', 'true');

        const content = document.querySelector('[data-section="streaming-performance"].enhanced-collapsible-content') as HTMLElement;
        const icon = header.querySelector('.enhanced-collapsible-icon') as HTMLElement;

        if (content) {
            // Start collapsed
            content.style.display = 'none';

            header.addEventListener('click', () => {
                const isVisible = content.style.display !== 'none';
                content.style.display = isVisible ? 'none' : 'block';
                if (icon) {
                    icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
                }
            });
        }
    }).catch(err => logger.warn("[StreamingPerformance] Collapsible setup failed: " + err));
}

/**
 * Loads current streaming configuration from main process
 */
export async function loadCurrentConfig(): Promise<void> {
    try {
        const config = await ipcRenderer.invoke(IPC_CHANNELS.GET_STREAMING_CONFIG);

        if (config.profile) {
            localStorage.setItem(STORAGE_KEYS.STREAMING_PROFILE, config.profile);

            const select = document.getElementById('streamingProfileSelect') as HTMLSelectElement;
            if (select) {
                select.value = config.profile;
                updateProfileDetails(config.profile);
            }
        }

        logger.info(`[StreamingPerformance] Loaded config: profile=${config.profile || 'none'}, path=${config.settingsPath}`);
    } catch (error) {
        logger.warn(`[StreamingPerformance] Failed to load current config: ${(error as Error).message}`);
    }
}
