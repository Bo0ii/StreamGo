import TemplateCache from "../../utils/templateCache";
import Helpers from "../../utils/Helpers";
import logger from "../../utils/logger";
import { STORAGE_KEYS, PLAYER_DEFAULTS } from "../../constants";

interface FilterSettings {
    sharpness: number;
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
}

// Default accent color (purple) - used when user hasn't set a custom color
const DEFAULT_ACCENT_COLOR = '#7b5bf5';

class VideoFilter {
    private video: HTMLVideoElement | null = null;
    private filterButton: HTMLElement | null = null;
    private popup: HTMLElement | null = null;
    private isInitialized: boolean = false;
    private settings: FilterSettings;
    private svgFilterId: string = 'video-sharpen-filter';

    constructor() {
        this.settings = this.loadSettings();
    }

    /**
     * Convert hex color to RGB values string (e.g., "123, 91, 245")
     */
    private hexToRgb(hex: string): string {
        // Remove # if present
        hex = hex.replace(/^#/, '');

        // Parse hex values
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return `${r}, ${g}, ${b}`;
    }

    /**
     * Lighten a hex color by a percentage
     */
    private lightenColor(hex: string, percent: number): string {
        hex = hex.replace(/^#/, '');

        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);

        r = Math.min(255, Math.floor(r + (255 - r) * percent));
        g = Math.min(255, Math.floor(g + (255 - g) * percent));
        b = Math.min(255, Math.floor(b + (255 - b) * percent));

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * Get the current accent color from settings
     */
    private getAccentColor(): string {
        return localStorage.getItem(STORAGE_KEYS.ACCENT_COLOR) || DEFAULT_ACCENT_COLOR;
    }

    private loadSettings(): FilterSettings {
        return {
            sharpness: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_SHARPNESS) || PLAYER_DEFAULTS.VIDEO_FILTER_SHARPNESS.toString()),
            brightness: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_BRIGHTNESS) || PLAYER_DEFAULTS.VIDEO_FILTER_BRIGHTNESS.toString()),
            contrast: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_CONTRAST) || PLAYER_DEFAULTS.VIDEO_FILTER_CONTRAST.toString()),
            saturation: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_SATURATION) || PLAYER_DEFAULTS.VIDEO_FILTER_SATURATION.toString()),
            temperature: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_TEMPERATURE) || PLAYER_DEFAULTS.VIDEO_FILTER_TEMPERATURE.toString()),
        };
    }

    private saveSettings(): void {
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_SHARPNESS, this.settings.sharpness.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_BRIGHTNESS, this.settings.brightness.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_CONTRAST, this.settings.contrast.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_SATURATION, this.settings.saturation.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_TEMPERATURE, this.settings.temperature.toString());
    }

    public init(): void {
        if (!location.href.includes('#/player')) return;
        if (this.isInitialized) return;

        logger.info("[VideoFilter] Initializing video filter...");
        this.waitForVideo();
    }

    private waitForVideo(): void {
        Helpers.waitForElm('video').then((video) => {
            this.video = video as HTMLVideoElement;
            this.settings = this.loadSettings();
            this.injectUI();
            this.injectSVGFilter();
            this.applyFilters();
            this.setupEventListeners();
            this.isInitialized = true;
            logger.info("[VideoFilter] Video filter initialized successfully");
        }).catch(err => {
            logger.error(`[VideoFilter] Failed to find video element: ${err}`);
        });
    }

    private injectUI(): void {
        // Remove existing UI if present
        document.getElementById('video-filter-container')?.remove();
        document.getElementById('video-filter-styles')?.remove();

        // Load and inject template
        let template = TemplateCache.load(__dirname, 'video-filter');

        // Get accent color for theming
        const accentColor = this.getAccentColor();
        const accentColorLight = this.lightenColor(accentColor, 0.2);
        const accentColorRgb = this.hexToRgb(accentColor);

        // Replace placeholders with current values
        template = template.replace(/\{\{\s*sharpness\s*\}\}/g, this.settings.sharpness.toString());
        template = template.replace(/\{\{\s*brightness\s*\}\}/g, this.settings.brightness.toString());
        template = template.replace(/\{\{\s*contrast\s*\}\}/g, this.settings.contrast.toString());
        template = template.replace(/\{\{\s*saturation\s*\}\}/g, this.settings.saturation.toString());
        template = template.replace(/\{\{\s*temperature\s*\}\}/g, this.settings.temperature.toString());

        // Replace accent color placeholders
        template = template.replace(/\{\{\s*accentColor\s*\}\}/g, accentColor);
        template = template.replace(/\{\{\s*accentColorLight\s*\}\}/g, accentColorLight);
        template = template.replace(/\{\{\s*accentColorRgb\s*\}\}/g, accentColorRgb);

        // Create container and inject
        const container = document.createElement('div');
        container.id = 'video-filter-container';
        container.innerHTML = template;
        document.body.appendChild(container);

        // Store references
        this.filterButton = document.getElementById('video-filter-btn');
        this.popup = document.getElementById('video-filter-popup');

        // Position button in control bar
        this.positionFilterButton();

        logger.info(`[VideoFilter] UI injected with accent color: ${accentColor}`);
    }

    private positionFilterButton(): void {
        if (!this.filterButton) return;

        // Try to find Stremio's player control bar
        // Multiple selectors for different Stremio versions
        const controlBarSelectors = [
            '[class*="control-bar"]',
            '[class*="controls-bar"]',
            '[class*="player-controls"]',
            '[class*="ControlBar"]'
        ];

        let controlBar: Element | null = null;
        for (const selector of controlBarSelectors) {
            controlBar = document.querySelector(selector);
            if (controlBar) break;
        }

        if (controlBar) {
            // Find the right side of the control bar (where fullscreen button usually is)
            const rightSection = controlBar.querySelector('[class*="right"]') ||
                                 controlBar.querySelector('[class*="Right"]') ||
                                 controlBar;

            // Insert before the last button (usually fullscreen)
            const lastButton = rightSection.querySelector('button:last-of-type, [class*="button"]:last-of-type');
            if (lastButton) {
                lastButton.parentElement?.insertBefore(this.filterButton, lastButton);
                logger.info("[VideoFilter] Button positioned in control bar");
                return;
            }
        }

        // Fallback: Position fixed at bottom right
        this.filterButton.style.position = 'fixed';
        this.filterButton.style.bottom = '60px';
        this.filterButton.style.right = '20px';
        logger.info("[VideoFilter] Button positioned as fixed fallback");
    }

    private injectSVGFilter(): void {
        // Remove existing SVG filter if present
        document.getElementById(this.svgFilterId)?.parentElement?.remove();

        // Create SVG element with sharpen filter
        // Using a 3x3 convolution matrix for sharpening
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('style', 'position: absolute; visibility: hidden;');
        svg.innerHTML = `
            <defs>
                <filter id="${this.svgFilterId}" color-interpolation-filters="sRGB">
                    <!-- Sharpen using convolution matrix -->
                    <feConvolveMatrix id="sharpen-matrix" order="3" preserveAlpha="true"
                        kernelMatrix="0 0 0 0 1 0 0 0 0"/>
                    <!-- Color temperature adjustment using color matrix -->
                    <feColorMatrix id="temperature-matrix" type="matrix"
                        values="1 0 0 0 0
                                0 1 0 0 0
                                0 0 1 0 0
                                0 0 0 1 0"/>
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
        logger.info("[VideoFilter] SVG filter injected");
    }

    private updateSharpenMatrix(intensity: number): void {
        const sharpenMatrix = document.getElementById('sharpen-matrix');
        if (!sharpenMatrix) return;

        // intensity 0-100 maps to sharpness amount
        // Base kernel: [0, -k, 0, -k, 1+4k, -k, 0, -k, 0]
        // k = 0 means no sharpening, k = 1 means strong sharpening
        const k = intensity / 100; // 0 to 1
        const center = 1 + 4 * k;
        const edge = -k;

        // 3x3 sharpen kernel as flat array
        const kernel = `${0} ${edge} ${0} ${edge} ${center} ${edge} ${0} ${edge} ${0}`;
        sharpenMatrix.setAttribute('kernelMatrix', kernel);
    }

    private updateTemperatureMatrix(temperature: number): void {
        const tempMatrix = document.getElementById('temperature-matrix');
        if (!tempMatrix) return;

        // temperature: -100 (cool/blue) to +100 (warm/orange)
        const t = temperature / 100; // -1 to 1

        // Adjust red and blue channels inversely
        // Warm: increase red, decrease blue
        // Cool: decrease red, increase blue
        const redAdjust = 1 + t * 0.3;   // 0.7 to 1.3
        const blueAdjust = 1 - t * 0.3;  // 1.3 to 0.7

        // Color matrix for temperature:
        // [R] = [redAdjust, 0, 0, 0, 0]   [R]
        // [G] = [0, 1, 0, 0, 0]           [G]
        // [B] = [0, 0, blueAdjust, 0, 0]  [B]
        // [A] = [0, 0, 0, 1, 0]           [A]
        const values = `${redAdjust} 0 0 0 0  0 1 0 0 0  0 0 ${blueAdjust} 0 0  0 0 0 1 0`;
        tempMatrix.setAttribute('values', values);
    }

    private applyFilters(): void {
        if (!this.video) return;

        // Build CSS filter string for brightness, contrast, saturation
        const cssFilters: string[] = [];

        // Brightness (100 = normal)
        if (this.settings.brightness !== 100) {
            cssFilters.push(`brightness(${this.settings.brightness / 100})`);
        }

        // Contrast (100 = normal)
        if (this.settings.contrast !== 100) {
            cssFilters.push(`contrast(${this.settings.contrast / 100})`);
        }

        // Saturation (100 = normal)
        if (this.settings.saturation !== 100) {
            cssFilters.push(`saturate(${this.settings.saturation / 100})`);
        }

        // Apply SVG filter for sharpness and temperature
        const hasSharpen = this.settings.sharpness > 0;
        const hasTemperature = this.settings.temperature !== 0;

        if (hasSharpen || hasTemperature) {
            cssFilters.push(`url(#${this.svgFilterId})`);
            this.updateSharpenMatrix(this.settings.sharpness);
            this.updateTemperatureMatrix(this.settings.temperature);
        }

        // Apply combined filter to video
        const filterString = cssFilters.length > 0 ? cssFilters.join(' ') : 'none';

        // Create or update filter style
        let styleEl = document.getElementById('video-filter-applied-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'video-filter-applied-style';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            video {
                filter: ${filterString} !important;
            }
        `;

        logger.info(`[VideoFilter] Filters applied: ${filterString}`);
    }

    private setupEventListeners(): void {
        // Toggle popup on button click
        this.filterButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopup();
        });

        // Close popup when clicking outside
        document.addEventListener('click', (e) => {
            if (this.popup && !this.popup.classList.contains('hidden')) {
                const target = e.target as HTMLElement;
                if (!this.popup.contains(target) && target !== this.filterButton) {
                    this.hidePopup();
                }
            }
        });

        // Slider event listeners
        this.setupSlider('video-filter-sharpness', 'sharpness', 'sharpness-value', '%');
        this.setupSlider('video-filter-brightness', 'brightness', 'brightness-value', '%');
        this.setupSlider('video-filter-contrast', 'contrast', 'contrast-value', '%');
        this.setupSlider('video-filter-saturation', 'saturation', 'saturation-value', '%');
        this.setupSlider('video-filter-temperature', 'temperature', 'temperature-value', '');

        // Reset button
        document.getElementById('video-filter-reset')?.addEventListener('click', () => {
            this.resetFilters();
        });

        // Handle navigation away from player
        window.addEventListener('hashchange', () => {
            if (!location.href.includes('#/player')) {
                this.cleanup();
            }
        });

        // Keyboard shortcut: 'F' to toggle filters popup
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!location.href.includes('#/player')) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.togglePopup();
            }
        });

        logger.info("[VideoFilter] Event listeners setup complete");
    }

    private setupSlider(sliderId: string, settingKey: keyof FilterSettings, valueId: string, suffix: string): void {
        const slider = document.getElementById(sliderId) as HTMLInputElement;
        const valueDisplay = document.getElementById(valueId);

        if (!slider || !valueDisplay) return;

        slider.addEventListener('input', () => {
            const value = parseInt(slider.value);
            this.settings[settingKey] = value;
            valueDisplay.textContent = `${value}${suffix}`;
            this.applyFilters();
        });

        // Save on change (when user releases slider)
        slider.addEventListener('change', () => {
            this.saveSettings();
        });
    }

    private togglePopup(): void {
        if (!this.popup) return;

        if (this.popup.classList.contains('hidden')) {
            this.showPopup();
        } else {
            this.hidePopup();
        }
    }

    private showPopup(): void {
        if (!this.popup || !this.filterButton) return;
        this.popup.classList.remove('hidden');
        this.filterButton.classList.add('active');
    }

    private hidePopup(): void {
        if (!this.popup || !this.filterButton) return;
        this.popup.classList.add('hidden');
        this.filterButton.classList.remove('active');
    }

    private resetFilters(): void {
        this.settings = {
            sharpness: PLAYER_DEFAULTS.VIDEO_FILTER_SHARPNESS,
            brightness: PLAYER_DEFAULTS.VIDEO_FILTER_BRIGHTNESS,
            contrast: PLAYER_DEFAULTS.VIDEO_FILTER_CONTRAST,
            saturation: PLAYER_DEFAULTS.VIDEO_FILTER_SATURATION,
            temperature: PLAYER_DEFAULTS.VIDEO_FILTER_TEMPERATURE,
        };

        // Update sliders
        this.updateSlider('video-filter-sharpness', 'sharpness-value', this.settings.sharpness, '%');
        this.updateSlider('video-filter-brightness', 'brightness-value', this.settings.brightness, '%');
        this.updateSlider('video-filter-contrast', 'contrast-value', this.settings.contrast, '%');
        this.updateSlider('video-filter-saturation', 'saturation-value', this.settings.saturation, '%');
        this.updateSlider('video-filter-temperature', 'temperature-value', this.settings.temperature, '');

        this.applyFilters();
        this.saveSettings();

        this.showToast('Filters reset');
        logger.info("[VideoFilter] Filters reset to defaults");
    }

    private updateSlider(sliderId: string, valueId: string, value: number, suffix: string): void {
        const slider = document.getElementById(sliderId) as HTMLInputElement;
        const valueDisplay = document.getElementById(valueId);

        if (slider) slider.value = value.toString();
        if (valueDisplay) valueDisplay.textContent = `${value}${suffix}`;
    }

    private showToast(message: string): void {
        // Remove existing toast
        document.querySelector('.video-filter-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'video-filter-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 150px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 10003;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        `;
        document.body.appendChild(toast);

        // Show
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        // Hide after 2 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    public cleanup(): void {
        logger.info('[VideoFilter] Cleaning up...');

        this.hidePopup();

        document.getElementById('video-filter-container')?.remove();
        document.getElementById('video-filter-styles')?.remove();
        document.getElementById('video-filter-applied-style')?.remove();
        document.getElementById(this.svgFilterId)?.parentElement?.remove();

        this.filterButton = null;
        this.popup = null;
        this.video = null;
        this.isInitialized = false;
    }
}

// Singleton instance
const videoFilter = new VideoFilter();

export function initVideoFilter(): void {
    videoFilter.init();
}

export function cleanupVideoFilter(): void {
    videoFilter.cleanup();
}

export default videoFilter;
