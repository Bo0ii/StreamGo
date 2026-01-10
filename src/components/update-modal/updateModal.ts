import { marked } from "marked";
import TemplateCache from "../../utils/templateCache";
import Updater from "../../core/Updater";
import { IPC_CHANNELS } from "../../constants";
import { ipcRenderer } from "electron";

type UpdateState = 'idle' | 'downloading' | 'installing' | 'completed' | 'error';

let updateState: UpdateState = 'idle';
let installerPath: string | null = null;

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

    // Setup Install button click handler
    installButton.addEventListener('click', async () => {
        if (updateState === 'idle') {
            await startDownload();
        } else if (updateState === 'completed') {
            restartApplication();
        }
    });

    // Setup Ignore button - only allow closing if not downloading/installing
    ignoreButton.addEventListener('click', () => {
        if (updateState !== 'downloading' && updateState !== 'installing') {
            cleanupAndClose();
        }
    });

    // Setup Close button - only allow closing if not downloading/installing
    if (closeButton) {
        closeButton.onclick = () => {
            if (updateState !== 'downloading' && updateState !== 'installing') {
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

    ipcRenderer.on(IPC_CHANNELS.UPDATE_INSTALL_START, () => {
        onInstallStart();
    });

    ipcRenderer.on(IPC_CHANNELS.UPDATE_INSTALL_COMPLETE, () => {
        onInstallComplete();
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

function updateDownloadProgress(progress: number, bytesDownloaded: number, totalBytes: number): void {
    const progressBar = document.getElementById('updateProgressBar');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (!progressBar || !statusText || !detailsText) return;

    progressBar.style.width = `${Math.min(progress, 100)}%`;
    statusText.textContent = `Downloading update... ${Math.round(progress)}%`;

    // Format bytes
    const downloadedMB = (bytesDownloaded / (1024 * 1024)).toFixed(2);
    const totalMB = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(2) : '?';
    detailsText.textContent = `Downloaded ${downloadedMB} MB of ${totalMB} MB`;
}

function onDownloadComplete(): void {
    updateState = 'installing';
    
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');
    const progressBar = document.getElementById('updateProgressBar');

    if (!statusText || !detailsText || !progressBar) return;

    statusText.textContent = 'Download complete. Installing update...';
    detailsText.textContent = 'This may take a few moments...';
    progressBar.style.width = '100%';

    // Start installation
    if (installerPath) {
        ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL_START, installerPath).catch((error: Error) => {
            onUpdateError('install', error.message);
        });
    }
}

function onInstallStart(): void {
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');

    if (!statusText || !detailsText) return;

    statusText.textContent = 'Installing update...';
    detailsText.textContent = 'Please wait while the update is installed...';
}

function onInstallComplete(): void {
    updateState = 'completed';
    
    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');
    const progressBar = document.getElementById('updateProgressBar');

    if (!installButton || !ignoreButton || !statusText || !detailsText || !progressBar) return;

    // Update UI for completed state
    progressBar.style.width = '100%';
    statusText.textContent = 'Installation complete!';
    detailsText.textContent = 'Click Restart to apply the update.';

    // Update button to "Restart"
    const buttonLabel = installButton.querySelector('.label-wbfsE');
    if (buttonLabel) {
        buttonLabel.textContent = 'Restart';
    }
    installButton.setAttribute('title', 'Restart');
    (installButton as HTMLElement).style.opacity = '1';
    (installButton as HTMLElement).style.pointerEvents = 'auto';
    
    // Re-enable ignore button but hide it since we want to encourage restart
    (ignoreButton as HTMLElement).style.opacity = '0.5';
}

function onUpdateError(stage: string, message: string): void {
    updateState = 'error';
    
    const installButton = document.getElementById('updateInstallButton');
    const ignoreButton = document.getElementById('updateIgnoreButton');
    const statusText = document.getElementById('updateStatusText');
    const detailsText = document.getElementById('updateDetailsText');
    const progressBar = document.getElementById('updateProgressBar');

    if (!installButton || !ignoreButton || !statusText || !detailsText || !progressBar) return;

    statusText.textContent = `Error during ${stage}`;
    detailsText.textContent = message;
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
}

function restartApplication(): void {
    ipcRenderer.send(IPC_CHANNELS.UPDATE_RESTART_APP);
}

function cleanupAndClose(): void {
    // Remove IPC listeners to prevent memory leaks
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_COMPLETE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_INSTALL_START);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_INSTALL_COMPLETE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);

    const modalContainer = document.getElementById('updateModalContainer');
    if (modalContainer) {
        modalContainer.remove();
    }

    // Reset state
    updateState = 'idle';
    installerPath = null;
}
