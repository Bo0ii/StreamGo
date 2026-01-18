import { ipcRenderer } from "electron";
import TemplateCache from "../../utils/templateCache";
import Helpers from "../../utils/Helpers";
import logger from "../../utils/logger";
import {
    STORAGE_KEYS,
    IPC_CHANNELS,
    TIMEOUTS,
    PLAYER_DEFAULTS,
    PLAYBACK_SPEEDS
} from "../../constants";

interface SavedPosition {
    time: number;
    duration: number;
    timestamp: number;
}

interface PlayerState {
    metaItem?: {
        content?: {
            id?: string;
            name?: string;
        };
    };
    seriesInfo?: {
        season?: number;
        episode?: number;
    };
}

class PlayerOverlay {
    private overlay: HTMLElement | null = null;
    private video: HTMLVideoElement | null = null;
    private hideTimeout: ReturnType<typeof setTimeout> | null = null;
    private positionSaveInterval: ReturnType<typeof setInterval> | null = null;
    private subtitleDelay: number = 0;
    // Kept for cleanup() method compatibility but currently unused
    // @ts-expect-error - Variable kept for cleanup() compatibility
    private _isInitialized: boolean = false;
    private ambilightEnabled: boolean = false;
    private ambilightCanvas: HTMLCanvasElement | null = null;
    private ambilightCtx: CanvasRenderingContext2D | null = null;
    private ambilightAnimationId: number | null = null;

    public init(): void {
        // Overlay is now disabled - controls are in the control bar
        // Keeping this method to prevent errors but not initializing
        return;
    }

    // Disabled - controls moved to control bar. Kept for potential future use.
    // @ts-expect-error - Method disabled but kept for potential future use
    private _waitForVideo(): void {
        // Method disabled but kept for potential future use
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private injectOverlay(): void {
        // Remove existing overlay if present
        document.getElementById('enhanced-player-overlay')?.remove();
        document.getElementById('enhanced-player-overlay-styles')?.remove();
        document.getElementById('screenshot-flash')?.remove();

        // Load and inject template
        let template = TemplateCache.load(__dirname, 'player-overlay');

        // Replace placeholders
        const fontSize = localStorage.getItem(STORAGE_KEYS.SUBTITLE_FONT_SIZE) || PLAYER_DEFAULTS.SUBTITLE_FONT_SIZE.toString();
        template = template.replace(/\{\{\s*subtitleFontSize\s*\}\}/g, fontSize);

        // Create container and inject
        const container = document.createElement('div');
        container.innerHTML = template;
        document.body.appendChild(container);

        // Add screenshot flash element
        const flash = document.createElement('div');
        flash.id = 'screenshot-flash';
        document.body.appendChild(flash);

        this.overlay = document.getElementById('enhanced-player-overlay');
        logger.info("[PlayerOverlay] Overlay injected");
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private setupEventListeners(): void {
        if (!this.video || !this.overlay) return;

        // Show/hide overlay on mouse movement
        document.addEventListener('mousemove', () => this.showOverlay());
        this.overlay.addEventListener('mouseenter', () => this.showOverlay());

        // Skip intro button
        document.getElementById('skip-intro-btn')?.addEventListener('click', () => this.skipIntro());

        // Skip outro button
        document.getElementById('skip-outro-btn')?.addEventListener('click', () => this.skipOutro());

        // Playback speed
        const speedSelect = document.getElementById('playback-speed') as HTMLSelectElement;
        speedSelect?.addEventListener('change', (e) => {
            const speed = parseFloat((e.target as HTMLSelectElement).value);
            this.setPlaybackSpeed(speed);
        });

        // Screenshot button
        document.getElementById('screenshot-btn')?.addEventListener('click', () => this.takeScreenshot());

        // PiP button
        document.getElementById('pip-btn')?.addEventListener('click', () => this.togglePiP());

        // Subtitle delay buttons
        document.getElementById('sub-delay-minus')?.addEventListener('click', () => this.adjustSubtitleDelay(-0.5));
        document.getElementById('sub-delay-plus')?.addEventListener('click', () => this.adjustSubtitleDelay(0.5));

        // Subtitle size slider
        const sizeSlider = document.getElementById('subtitle-size') as HTMLInputElement;
        sizeSlider?.addEventListener('input', (e) => {
            const size = (e.target as HTMLInputElement).value;
            this.setSubtitleSize(parseInt(size));
        });

        // Handle page navigation away from player
        window.addEventListener('hashchange', () => {
            if (!location.href.includes('#/player')) {
                this.cleanup();
            }
        });

        // Save position before unload
        window.addEventListener('beforeunload', () => this.savePosition());
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            // Only active on player page
            if (!location.href.includes('#/player')) return;

            // Ignore if typing in input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const key = e.key.toLowerCase();

            switch (key) {
                case 's':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        this.takeScreenshot();
                    }
                    break;
                case 'p':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        this.togglePiP();
                    }
                    break;
                case '[':
                    e.preventDefault();
                    this.decreaseSpeed();
                    break;
                case ']':
                    e.preventDefault();
                    this.increaseSpeed();
                    break;
                case 'arrowleft':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.skipIntro();
                    }
                    break;
                case 'arrowright':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.skipOutro();
                    }
                    break;
                case 'g':
                    e.preventDefault();
                    this.adjustSubtitleDelay(-0.5);
                    break;
                case 'h':
                    e.preventDefault();
                    this.adjustSubtitleDelay(0.5);
                    break;
            }
        });
    }

    private showOverlay(): void {
        if (!this.overlay || !location.href.includes('#/player')) return;

        this.overlay.classList.add('visible');

        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        this.hideTimeout = setTimeout(() => {
            this.overlay?.classList.remove('visible');
        }, TIMEOUTS.OVERLAY_HIDE_DELAY);
    }

    private skipIntro(): void {
        if (!this.video) return;
        const skipAmount = parseInt(localStorage.getItem(STORAGE_KEYS.SKIP_INTRO_SECONDS) || PLAYER_DEFAULTS.SKIP_INTRO_SECONDS.toString());
        this.video.currentTime += skipAmount;
        this.showToast(`Skipped ${skipAmount}s`);
        logger.info(`[PlayerOverlay] Skipped intro: +${skipAmount}s`);
    }

    private skipOutro(): void {
        if (!this.video) return;
        const remainingTime = this.video.duration - this.video.currentTime;
        if (remainingTime > 30) {
            this.video.currentTime = this.video.duration - 5;
            this.showToast('Skipped to end');
        } else {
            this.showToast('Already near end');
        }
        logger.info(`[PlayerOverlay] Skipped to outro`);
    }

    private setPlaybackSpeed(speed: number): void {
        if (!this.video) return;
        this.video.playbackRate = speed;
        localStorage.setItem(STORAGE_KEYS.PLAYBACK_SPEED, speed.toString());
        this.showToast(`Speed: ${speed}x`);
        logger.info(`[PlayerOverlay] Playback speed set to ${speed}x`);
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private restorePlaybackSpeed(): void {
        const savedSpeed = localStorage.getItem(STORAGE_KEYS.PLAYBACK_SPEED);
        if (savedSpeed && this.video) {
            const speed = parseFloat(savedSpeed);
            this.video.playbackRate = speed;
            const speedSelect = document.getElementById('playback-speed') as HTMLSelectElement;
            if (speedSelect) {
                speedSelect.value = speed.toString();
            }
        }
    }

    private decreaseSpeed(): void {
        if (!this.video) return;
        const currentSpeed = this.video.playbackRate;
        const currentIndex = PLAYBACK_SPEEDS.indexOf(currentSpeed as typeof PLAYBACK_SPEEDS[number]);
        if (currentIndex > 0) {
            this.setPlaybackSpeed(PLAYBACK_SPEEDS[currentIndex - 1]);
            this.updateSpeedSelect(PLAYBACK_SPEEDS[currentIndex - 1]);
        }
    }

    private increaseSpeed(): void {
        if (!this.video) return;
        const currentSpeed = this.video.playbackRate;
        const currentIndex = PLAYBACK_SPEEDS.indexOf(currentSpeed as typeof PLAYBACK_SPEEDS[number]);
        if (currentIndex < PLAYBACK_SPEEDS.length - 1) {
            this.setPlaybackSpeed(PLAYBACK_SPEEDS[currentIndex + 1]);
            this.updateSpeedSelect(PLAYBACK_SPEEDS[currentIndex + 1]);
        }
    }

    private updateSpeedSelect(speed: number): void {
        const speedSelect = document.getElementById('playback-speed') as HTMLSelectElement;
        if (speedSelect) {
            speedSelect.value = speed.toString();
        }
    }

    private async takeScreenshot(): Promise<void> {
        if (!this.video) return;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth;
            canvas.height = this.video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/png');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `stremio-screenshot-${timestamp}.png`;

            // Flash effect
            const flash = document.getElementById('screenshot-flash');
            if (flash) {
                flash.classList.add('flash');
                setTimeout(() => flash.classList.remove('flash'), 300);
            }

            // Send to main process for saving
            ipcRenderer.send(IPC_CHANNELS.SAVE_SCREENSHOT, { dataUrl, filename });
            this.showToast('Screenshot saved');
            logger.info(`[PlayerOverlay] Screenshot taken: ${filename}`);
        } catch (err) {
            logger.error(`[PlayerOverlay] Screenshot error: ${(err as Error).message}`);
            this.showToast('Screenshot failed');
        }
    }

    private async togglePiP(): Promise<void> {
        if (!this.video) return;

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                this.showToast('PiP disabled');
            } else if (document.pictureInPictureEnabled) {
                await this.video.requestPictureInPicture();
                this.showToast('PiP enabled');
            } else {
                this.showToast('PiP not supported');
            }
        } catch (err) {
            logger.error(`[PlayerOverlay] PiP error: ${(err as Error).message}`);
            this.showToast('PiP failed');
        }
    }

    private adjustSubtitleDelay(delta: number): void {
        this.subtitleDelay += delta;
        localStorage.setItem(STORAGE_KEYS.SUBTITLE_DELAY, this.subtitleDelay.toString());

        const delayDisplay = document.getElementById('sub-delay-value');
        if (delayDisplay) {
            delayDisplay.textContent = `${this.subtitleDelay.toFixed(1)}s`;
        }

        // Apply delay via CSS (moves subtitles visually)
        this.applySubtitleDelay();
        this.showToast(`Subtitle delay: ${this.subtitleDelay.toFixed(1)}s`);
    }

    private applySubtitleDelay(): void {
        // Note: True subtitle timing modification requires parsing and modifying WebVTT
        // This is a visual indication; actual implementation may need more complex logic
        let styleEl = document.getElementById('enhanced-subtitle-delay-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-subtitle-delay-style';
            document.head.appendChild(styleEl);
        }

        // This CSS approach provides visual feedback but true delay requires cue manipulation
        styleEl.textContent = `
            /* Subtitle delay indicator */
            [class*="subtitles"]::after {
                content: '${this.subtitleDelay !== 0 ? `Delay: ${this.subtitleDelay.toFixed(1)}s` : ''}';
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                font-size: 10px;
                color: rgba(255,255,255,0.5);
                margin-bottom: 4px;
            }
        `;
    }

    private setSubtitleSize(size: number): void {
        localStorage.setItem(STORAGE_KEYS.SUBTITLE_FONT_SIZE, size.toString());

        const sizeDisplay = document.getElementById('subtitle-size-value');
        if (sizeDisplay) {
            sizeDisplay.textContent = `${size}px`;
        }

        this.applySubtitleStyle();
    }

    private applySubtitleStyle(): void {
        let styleEl = document.getElementById('enhanced-subtitle-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-subtitle-style';
            document.head.appendChild(styleEl);
        }

        const fontSize = localStorage.getItem(STORAGE_KEYS.SUBTITLE_FONT_SIZE) || PLAYER_DEFAULTS.SUBTITLE_FONT_SIZE.toString();
        const color = localStorage.getItem(STORAGE_KEYS.SUBTITLE_COLOR) || PLAYER_DEFAULTS.SUBTITLE_COLOR;
        const bgColor = localStorage.getItem(STORAGE_KEYS.SUBTITLE_BG_COLOR) || PLAYER_DEFAULTS.SUBTITLE_BG_COLOR;

        styleEl.textContent = `
            ::cue {
                font-size: ${fontSize}px !important;
                color: ${color} !important;
                background-color: ${bgColor} !important;
                font-family: Arial, sans-serif !important;
            }
            [class*="subtitles-container"], [class*="subtitle"] {
                font-size: ${fontSize}px !important;
            }
        `;
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private setupPositionSaving(): void {
        // Save position periodically
        this.positionSaveInterval = setInterval(() => this.savePosition(), TIMEOUTS.POSITION_SAVE_INTERVAL);

        // Save on pause
        this.video?.addEventListener('pause', () => this.savePosition());
    }

    private async savePosition(): Promise<void> {
        if (!this.video || this.video.currentTime < 60) return;

        try {
            const playerState = await Helpers._eval('core.transport.getState("player")') as PlayerState | null;
            const contentId = playerState?.metaItem?.content?.id;

            if (!contentId) return;

            const positions: Record<string, SavedPosition> = JSON.parse(
                localStorage.getItem(STORAGE_KEYS.SAVED_POSITIONS) || '{}'
            );

            positions[contentId] = {
                time: this.video.currentTime,
                duration: this.video.duration,
                timestamp: Date.now()
            };

            // Keep only last 100 entries
            const entries = Object.entries(positions);
            if (entries.length > 100) {
                entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                const trimmed = Object.fromEntries(entries.slice(0, 100));
                localStorage.setItem(STORAGE_KEYS.SAVED_POSITIONS, JSON.stringify(trimmed));
            } else {
                localStorage.setItem(STORAGE_KEYS.SAVED_POSITIONS, JSON.stringify(positions));
            }
        } catch (err) {
            // Silently fail - position saving is not critical
        }
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private async loadSavedPosition(): Promise<void> {
        if (!this.video) return;

        try {
            const playerState = await Helpers._eval('core.transport.getState("player")') as PlayerState | null;
            const contentId = playerState?.metaItem?.content?.id;

            if (!contentId) return;

            const positions: Record<string, SavedPosition> = JSON.parse(
                localStorage.getItem(STORAGE_KEYS.SAVED_POSITIONS) || '{}'
            );

            const saved = positions[contentId];

            if (saved && saved.time > 60 && saved.time < saved.duration - 60) {
                // Only resume if significant position
                this.video.currentTime = saved.time;
                this.showToast(`Resumed at ${Helpers.formatTime(saved.time)}`);
                logger.info(`[PlayerOverlay] Resumed playback at ${Helpers.formatTime(saved.time)}`);
            }
        } catch (err) {
            // Silently fail
        }
    }

    // @ts-expect-error - Method disabled but kept for potential future use
    private checkAmbilightSetting(): void {
        this.ambilightEnabled = localStorage.getItem(STORAGE_KEYS.AMBILIGHT_ENABLED) === 'true';
        if (this.ambilightEnabled) {
            this.startAmbilight();
        }
    }

    private startAmbilight(): void {
        if (!this.video || this.ambilightAnimationId) return;

        this.ambilightCanvas = document.createElement('canvas');
        this.ambilightCanvas.width = 16;
        this.ambilightCanvas.height = 9;
        this.ambilightCtx = this.ambilightCanvas.getContext('2d');

        // Add event listeners to pause/resume animation with playback
        this.video.addEventListener('play', () => {
            if (!this.ambilightAnimationId && this.ambilightEnabled) {
                this.animateAmbilight();
            }
        });

        this.video.addEventListener('pause', () => {
            if (this.ambilightAnimationId) {
                cancelAnimationFrame(this.ambilightAnimationId);
                this.ambilightAnimationId = null;
            }
        });

        this.animateAmbilight();
        logger.info('[PlayerOverlay] Ambilight started');
    }

    private animateAmbilight(): void {
        if (!this.video || !this.ambilightCtx || !this.ambilightCanvas) return;

        // Only process frames when video is actively playing
        if (!this.video.paused && !this.video.ended) {
            this.ambilightCtx.drawImage(this.video, 0, 0, this.ambilightCanvas.width, this.ambilightCanvas.height);
            const colors = this.extractEdgeColors();
            this.applyAmbilightGlow(colors);

            // Continue animation only if still playing
            this.ambilightAnimationId = requestAnimationFrame(() => {
                setTimeout(() => this.animateAmbilight(), TIMEOUTS.AMBILIGHT_SAMPLE_INTERVAL);
            });
        } else {
            // Video is paused/ended - stop animation to save CPU/GPU
            this.ambilightAnimationId = null;
        }
    }

    private extractEdgeColors(): { top: string; bottom: string; left: string; right: string } {
        if (!this.ambilightCtx || !this.ambilightCanvas) {
            return { top: '#000', bottom: '#000', left: '#000', right: '#000' };
        }

        const imageData = this.ambilightCtx.getImageData(0, 0, this.ambilightCanvas.width, this.ambilightCanvas.height);
        const data = imageData.data;
        const w = this.ambilightCanvas.width;
        const h = this.ambilightCanvas.height;

        // Sample colors from edges
        const topColor = this.averageColor(data, 0, w);
        const bottomColor = this.averageColor(data, (h - 1) * w * 4, w);
        const leftColor = this.averageVerticalEdge(data, 0, w, h);
        const rightColor = this.averageVerticalEdge(data, w - 1, w, h);

        return { top: topColor, bottom: bottomColor, left: leftColor, right: rightColor };
    }

    private averageColor(data: Uint8ClampedArray, startIdx: number, pixels: number): string {
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < pixels; i++) {
            const idx = startIdx + i * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
        }
        r = Math.round(r / pixels);
        g = Math.round(g / pixels);
        b = Math.round(b / pixels);
        return `rgb(${r},${g},${b})`;
    }

    private averageVerticalEdge(data: Uint8ClampedArray, x: number, width: number, height: number): string {
        let r = 0, g = 0, b = 0;
        for (let y = 0; y < height; y++) {
            const idx = (y * width + x) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
        }
        r = Math.round(r / height);
        g = Math.round(g / height);
        b = Math.round(b / height);
        return `rgb(${r},${g},${b})`;
    }

    private applyAmbilightGlow(colors: { top: string; bottom: string; left: string; right: string }): void {
        let styleEl = document.getElementById('enhanced-ambilight-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-ambilight-style';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            body::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                z-index: -1;
                box-shadow:
                    inset 0 -80px 120px -40px ${colors.bottom},
                    inset 0 80px 120px -40px ${colors.top},
                    inset -80px 0 120px -40px ${colors.right},
                    inset 80px 0 120px -40px ${colors.left};
                opacity: 0.6;
                transition: box-shadow 0.3s ease;
            }
        `;
    }

    private stopAmbilight(): void {
        if (this.ambilightAnimationId) {
            cancelAnimationFrame(this.ambilightAnimationId);
            this.ambilightAnimationId = null;
        }

        const styleEl = document.getElementById('enhanced-ambilight-style');
        if (styleEl) {
            styleEl.textContent = '';
        }
    }

    private showToast(message: string): void {
        // Remove existing toast
        document.querySelector('.overlay-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'overlay-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Show
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Hide after 2 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    public cleanup(): void {
        logger.info('[PlayerOverlay] Cleaning up...');

        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        if (this.positionSaveInterval) {
            clearInterval(this.positionSaveInterval);
        }

        this.savePosition();
        this.stopAmbilight();

        document.getElementById('enhanced-player-overlay')?.remove();
        document.getElementById('enhanced-player-overlay-styles')?.remove();
        document.getElementById('screenshot-flash')?.remove();
        document.getElementById('enhanced-subtitle-style')?.remove();
        document.getElementById('enhanced-subtitle-delay-style')?.remove();

        this.overlay = null;
        this.video = null;
        this._isInitialized = false;
    }
}

// Singleton instance
const playerOverlay = new PlayerOverlay();

export function initPlayerOverlay(): void {
    playerOverlay.init();
}

export function cleanupPlayerOverlay(): void {
    playerOverlay.cleanup();
}

export default playerOverlay;
