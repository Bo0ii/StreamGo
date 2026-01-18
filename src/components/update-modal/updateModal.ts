import { marked } from "marked";
import TemplateCache from "../../utils/templateCache";
import Updater from "../../core/Updater";
import { IPC_CHANNELS } from "../../constants";
import { ipcRenderer } from "electron";

type UpdateState = 'idle' | 'downloading' | 'ready_to_install' | 'restarting' | 'error';

let updateState: UpdateState = 'idle';
let installerPath: string | null = null;
let countdownInterval: NodeJS.Timeout | null = null;

export async function getUpdateModalTemplate(): Promise<string> {
    let template = TemplateCache.load(__dirname, 'update-modal');
    
    const releaseNotes = await Updater.getReleaseNotes();
    const markdown = await marked(releaseNotes, { gfm: true, breaks: true });

    const currentVersion = Updater.getCurrentVersion();
    const latestVersion = await Updater.getLatestVersion();

    const html = template
        .replace("{{ releaseNotes }}", markdown)
        .replace(/\{\{\s*currentVersion\s*\}\}/g, currentVersion)
        .replace(/\{\{\s*newVersion\s*\}\}/g, latestVersion);

    // Initialize event handlers after a short delay to ensure DOM is ready
    setTimeout(() => {
        initializeUpdateModal();
    }, 100);

    return html;
}

function initializeUpdateModal(): void {
    const modalContainer = document.getElementById('updateModalContainer');
    if (!modalContainer) return;

    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const closeButton = document.getElementById('updateModalCloseButton');
    const progressContainer = document.getElementById('updateProgressContainer');
    const progressBar = document.getElementById('updateProgressBar');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (!installButton || !ignoreButton || !progressContainer || !progressBar || !statusText || !detailsText) {
        console.error('Update modal elements not found');
        return;
    }

    // Setup Install/Restart button click handler
    installButton.addEventListener('click', async () => {
        if (updateState === 'idle') {
            await startDownload();
        } else if (updateState === 'ready_to_install' || updateState === 'restarting') {
            // User clicked Restart button - close instantly (skip/cancel countdown)
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            performInstallation();
        }
    });

    // Setup Ignore button - only allow closing if not downloading/restarting
    ignoreButton.addEventListener('click', () => {
        if (updateState !== 'downloading' && updateState !== 'restarting') {
            cleanupAndClose();
        }
    });

    // Setup Close button - only allow closing if not downloading/restarting
    if (closeButton) {
        closeButton.onclick = () => {
            if (updateState !== 'downloading' && updateState !== 'restarting') {
                cleanupAndClose();
            }
        };
    }

    // Setup IPC listeners for progress updates
    ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, (_: any, data: { progress: number; bytesDownloaded: number; totalBytes: number }) => {
        updateDownloadProgress(data.progress, data.bytesDownloaded, data.totalBytes);
    });

    ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOAD_COMPLETE, (_: any, data: { installerPath: string }) => {
        installerPath = data.installerPath;
        onDownloadComplete();
    });

    ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, (_: any, error: { stage: string; message: string }) => {
        onUpdateError(error.stage, error.message);
    });
}

async function startDownload(): Promise<void> {
    updateState = 'downloading';

    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const progressContainer = document.getElementById('updateProgressContainer');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (!installButton || !ignoreButton || !progressContainer || !statusText || !detailsText) return;

    // Update UI for downloading state
    progressContainer.style.display = 'block';
    statusText.textContent = 'Downloading update...';
    detailsText.textContent = 'Preparing download...';
    (installButton as HTMLElement).style.opacity = '0.6';
    (installButton as HTMLElement).style.pointerEvents = 'none';
    (ignoreButton as HTMLElement).style.opacity = '0.6';
    (ignoreButton as HTMLElement).style.pointerEvents = 'none';

    try {
        const result = await ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD_START);
        if (!result.success) {
            throw new Error(result.error || 'Download failed');
        }
    } catch (error) {
        onUpdateError('download', (error as Error).message);
    }
}

function startRestartCountdown(): void {
    if (!installerPath) {
        onUpdateError('install', 'Installer path not found. Please try downloading again.');
        return;
    }

    updateState = 'restarting';

    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (!installButton || !ignoreButton || !statusText || !detailsText) return;

    // Disable buttons during countdown
    (installButton as HTMLElement).style.opacity = '0.6';
    (installButton as HTMLElement).style.pointerEvents = 'none';
    (ignoreButton as HTMLElement).style.opacity = '0.6';
    (ignoreButton as HTMLElement).style.pointerEvents = 'none';

    statusText.textContent = 'Preparing to restart...';
    detailsText.textContent = 'The app will close and the installer will continue automatically.';

    // Start countdown from 10
    let countdown = 10;
    const buttonLabel = installButton.querySelector('.label-wbfsE');

    const updateCountdown = () => {
        if (buttonLabel) {
            buttonLabel.textContent = `Restarting (${countdown})`;
        }
        detailsText.textContent = `The app will close in ${countdown} seconds and the installer will continue automatically.`;

        countdown--;

        if (countdown < 0) {
            // Countdown finished - start installation
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            performInstallation();
        }
    };

    // Update immediately
    updateCountdown();

    // Then update every second
    countdownInterval = setInterval(updateCountdown, 1000);
}

async function performInstallation(): Promise<void> {
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (statusText && detailsText) {
        statusText.textContent = 'Closing application...';
        detailsText.textContent = 'The installer will continue automatically. Please wait...';
    }

    try {
        // Tell main process to start installation - app will quit
        const result = await ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL_START, installerPath);
        if (!result.success) {
            throw new Error(result.error || 'Installation failed');
        }
        // Note: App will quit before we get here
    } catch (error) {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        onUpdateError('install', (error as Error).message);
    }
}

function updateDownloadProgress(progress: number, bytesDownloaded: number, totalBytes: number): void {
    // Use requestAnimationFrame to ensure UI updates happen during repaint cycle
    // This is especially important on Windows where the UI thread needs explicit repaint events
    requestAnimationFrame(() => {
        const progressBar = document.getElementById('updateProgressBar');
        const statusText = document.getElementById('updateStatusText');
        const detailsText = document.getElementById('updateDetailsText');

        if (!progressBar || !statusText || !detailsText) return;

        // Reset any error styling
        detailsText.style.color = '';
        progressBar.style.background = 'linear-gradient(90deg, #4a90e2, #357abd)';

        progressBar.style.width = `${Math.min(progress, 100)}%`;
        statusText.textContent = `Downloading update... ${Math.round(progress)}%`;

        // Format bytes
        const downloadedMB = (bytesDownloaded / (1024 * 1024)).toFixed(2);
        const totalMB = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(2) : '?';
        detailsText.textContent = `Downloaded ${downloadedMB} MB of ${totalMB} MB`;
        
        // Force a repaint on Windows by accessing offsetHeight (triggers layout recalculation)
        // This ensures the progress bar visual update is immediately visible
        if (process.platform === 'win32') {
            void progressBar.offsetHeight;
        }
    });
}

function onDownloadComplete(): void {
    updateState = 'ready_to_install';

    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');
    const progressBar = document.getElementById('updateProgressBar');

    if (!installButton || !ignoreButton || !statusText || !detailsText || !progressBar) return;

    progressBar.style.width = '100%';

    // Download complete - ready to restart and install
    statusText.textContent = 'Download complete! Ready to restart.';
    detailsText.textContent = 'Click Restart to close immediately, or wait for auto-restart.';

    // Update button to show "Restart"
    const buttonLabel = installButton.querySelector('.label-wbfsE');
    if (buttonLabel) {
        buttonLabel.textContent = 'Restart';
    }
    installButton.setAttribute('title', 'Restart and Install');
    (installButton as HTMLElement).style.opacity = '1';
    (installButton as HTMLElement).style.pointerEvents = 'auto';

    // Re-enable ignore button
    (ignoreButton as HTMLElement).style.opacity = '1';
    (ignoreButton as HTMLElement).style.pointerEvents = 'auto';

    // Auto-start the 10-second countdown (user can click Restart to close instantly)
    startRestartCountdown();
}

function onUpdateError(stage: string, message: string): void {
    updateState = 'error';

    // Clear countdown if active
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');
    const progressBar = document.getElementById('updateProgressBar');

    if (!installButton || !ignoreButton || !statusText || !detailsText || !progressBar) return;

    statusText.textContent = `Error during ${stage}`;

    // Add helpful context to error messages
    let displayMessage = message;
    if (stage === 'download') {
        if (message.includes('corrupted') || message.includes('size')) {
            displayMessage += '\n\nThis usually happens due to network issues. Click "Retry Download" to try again. If it keeps failing, try downloading the update manually from the releases page.';
        } else if (message.includes('HTTP') || message.includes('Network')) {
            displayMessage += '\n\nPlease check your internet connection and try again.';
        }
    } else if (stage === 'install') {
        if (message.includes('integrity') || message.includes('NSIS')) {
            displayMessage = 'The installer file may be corrupted. Click "Retry" to download and install again.';
        }
    }

    // Show detailed error message with line breaks preserved
    detailsText.innerHTML = displayMessage.replace(/\n/g, '<br>');
    detailsText.style.color = '#ff6b6b';
    progressBar.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';

    // Re-enable buttons
    const buttonLabel = installButton.querySelector('.label-wbfsE');
    if (buttonLabel) {
        buttonLabel.textContent = 'Retry';
    }
    (installButton as HTMLElement).style.opacity = '1';
    (installButton as HTMLElement).style.pointerEvents = 'auto';
    (ignoreButton as HTMLElement).style.opacity = '1';
    (ignoreButton as HTMLElement).style.pointerEvents = 'auto';

    // Reset state to idle so retry will work
    updateState = 'idle';
    installerPath = null;
}

// Removed: restartApplication - not used in current flow
// For macOS, the app automatically restarts after installation
// For Windows/Linux, the app quits and installer/script handles the restart

function cleanupAndClose(): void {
    // Clear countdown if active
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    // Remove IPC listeners to prevent memory leaks
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_COMPLETE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);

    const modalContainer = document.getElementById('updateModalContainer');
    if (modalContainer) {
        modalContainer.remove();
    }

    // Reset state
    updateState = 'idle';
    installerPath = null;
}
