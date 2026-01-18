import TemplateCache from "../../utils/templateCache";
import Helpers from "../../utils/Helpers";
import logger from "../../utils/logger";
import { STORAGE_KEYS, PLAYER_DEFAULTS } from "../../constants";
import Anime4KWebGL, { Anime4KMode } from "../../utils/Anime4KWebGL";

interface FilterSettings {
    sharpness: number;
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
    highlights: number;
    shadows: number;
    denoise: number;
    edgeEnhance: number;
    fakeHDR: boolean;
    animeEnhance: boolean;
    antiAliasing: boolean;
    anime4kMode: Anime4KMode;
    motionSmooth: number;
}

// Numeric-only settings for slider handling (excludes boolean toggles and string modes)
type NumericFilterSettings = Omit<FilterSettings, 'fakeHDR' | 'animeEnhance' | 'antiAliasing' | 'anime4kMode'>;

// Default accent color (purple) - used when user hasn't set a custom color
const DEFAULT_ACCENT_COLOR = '#7b5bf5';

class VideoFilter {
    private video: HTMLVideoElement | null = null;
    private filterButton: HTMLElement | null = null;
    private popup: HTMLElement | null = null;
    private isInitialized: boolean = false;
    private settings: FilterSettings;
    private svgFilterId: string = 'video-sharpen-filter';
    private hdrFilterId: string = 'video-hdr-filter';
    private animeFilterId: string = 'video-anime-filter';
    private antiAliasingFilterId: string = 'video-antialias-filter';
    private anime4kRenderer: Anime4KWebGL | null = null;

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
            highlights: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_HIGHLIGHTS) || PLAYER_DEFAULTS.VIDEO_FILTER_HIGHLIGHTS.toString()),
            shadows: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_SHADOWS) || PLAYER_DEFAULTS.VIDEO_FILTER_SHADOWS.toString()),
            denoise: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_DENOISE) || PLAYER_DEFAULTS.VIDEO_FILTER_DENOISE.toString()),
            edgeEnhance: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_EDGE_ENHANCE) || PLAYER_DEFAULTS.VIDEO_FILTER_EDGE_ENHANCE.toString()),
            fakeHDR: localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_FAKE_HDR) === 'true',
            animeEnhance: localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_ANIME_ENHANCE) === 'true',
            antiAliasing: localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_ANTI_ALIASING) === 'true',
            anime4kMode: (localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_ANIME4K_MODE) || PLAYER_DEFAULTS.VIDEO_FILTER_ANIME4K_MODE) as Anime4KMode,
            motionSmooth: parseInt(localStorage.getItem(STORAGE_KEYS.VIDEO_FILTER_MOTION_SMOOTH) || PLAYER_DEFAULTS.VIDEO_FILTER_MOTION_SMOOTH.toString()),
        };
    }

    private saveSettings(): void {
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_SHARPNESS, this.settings.sharpness.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_BRIGHTNESS, this.settings.brightness.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_CONTRAST, this.settings.contrast.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_SATURATION, this.settings.saturation.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_TEMPERATURE, this.settings.temperature.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_HIGHLIGHTS, this.settings.highlights.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_SHADOWS, this.settings.shadows.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_DENOISE, this.settings.denoise.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_EDGE_ENHANCE, this.settings.edgeEnhance.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_FAKE_HDR, this.settings.fakeHDR.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_ANIME_ENHANCE, this.settings.animeEnhance.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_ANTI_ALIASING, this.settings.antiAliasing.toString());
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_ANIME4K_MODE, this.settings.anime4kMode);
        localStorage.setItem(STORAGE_KEYS.VIDEO_FILTER_MOTION_SMOOTH, this.settings.motionSmooth.toString());
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
            this.initAnime4K();
            this.applyFilters();
            this.setupEventListeners();
            this.isInitialized = true;
            logger.info("[VideoFilter] Video filter initialized successfully");
        }).catch(err => {
            logger.error(`[VideoFilter] Failed to find video element: ${err}`);
        });
    }

    private initAnime4K(): void {
        if (!this.video) return;

        // Check WebGL support
        if (!Anime4KWebGL.isSupported()) {
            logger.warn('[VideoFilter] Anime4K WebGL not supported on this device');
            return;
        }

        // Create Anime4K renderer
        this.anime4kRenderer = new Anime4KWebGL();
        const success = this.anime4kRenderer.init(this.video);

        if (success) {
            // Apply saved mode
            if (this.settings.anime4kMode !== 'off') {
                this.anime4kRenderer.setMode(this.settings.anime4kMode);
            }
            logger.info('[VideoFilter] Anime4K WebGL initialized');
        } else {
            logger.warn('[VideoFilter] Failed to initialize Anime4K WebGL');
            this.anime4kRenderer = null;
        }
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
        template = template.replace(/\{\{\s*highlights\s*\}\}/g, this.settings.highlights.toString());
        template = template.replace(/\{\{\s*shadows\s*\}\}/g, this.settings.shadows.toString());
        template = template.replace(/\{\{\s*denoise\s*\}\}/g, this.settings.denoise.toString());
        template = template.replace(/\{\{\s*edgeEnhance\s*\}\}/g, this.settings.edgeEnhance.toString());
        template = template.replace(/\{\{\s*fakeHDRChecked\s*\}\}/g, this.settings.fakeHDR ? 'checked' : '');
        template = template.replace(/\{\{\s*animeEnhanceChecked\s*\}\}/g, this.settings.animeEnhance ? 'checked' : '');
        template = template.replace(/\{\{\s*antiAliasingChecked\s*\}\}/g, this.settings.antiAliasing ? 'checked' : '');
        template = template.replace(/\{\{\s*anime4kMode\s*\}\}/g, this.settings.anime4kMode);
        template = template.replace(/\{\{\s*motionSmooth\s*\}\}/g, this.settings.motionSmooth.toString());
        template = template.replace(/\{\{\s*anime4kSupported\s*\}\}/g, Anime4KWebGL.isSupported() ? '' : 'disabled');

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

        // Create SVG element with advanced filters
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('style', 'position: absolute; visibility: hidden;');
        svg.innerHTML = `
            <defs>
                <filter id="${this.svgFilterId}" color-interpolation-filters="sRGB">
                    <!-- ============ DENOISE SECTION ============ -->
                    <!-- Step 1: Create blurred version for noise reduction -->
                    <feGaussianBlur id="denoise-blur" in="SourceGraphic" stdDeviation="0" result="blurred"/>

                    <!-- Step 2: Detect edges from original to preserve them -->
                    <feConvolveMatrix order="3" in="SourceGraphic" preserveAlpha="true"
                        kernelMatrix="0 -1 0 -1 4 -1 0 -1 0" result="edges-raw"/>

                    <!-- Step 3: Convert edges to grayscale mask (luminance) -->
                    <feColorMatrix type="matrix" in="edges-raw"
                        values="0.299 0.587 0.114 0 0
                                0.299 0.587 0.114 0 0
                                0.299 0.587 0.114 0 0
                                0 0 0 1 0" result="edge-luminance"/>

                    <!-- Step 4: Amplify edge mask -->
                    <feComponentTransfer in="edge-luminance" result="edge-mask">
                        <feFuncR type="linear" slope="3" intercept="0"/>
                        <feFuncG type="linear" slope="3" intercept="0"/>
                        <feFuncB type="linear" slope="3" intercept="0"/>
                    </feComponentTransfer>

                    <!-- Step 5: Mix blurred and original based on edge mask (preserve edges) -->
                    <feComposite id="denoise-mix" operator="arithmetic" in="SourceGraphic" in2="blurred"
                        k1="0" k2="1" k3="0" k4="0" result="denoised"/>

                    <!-- ============ SHARPENING SECTION (Unsharp Mask) ============ -->
                    <!-- Step 1: Create blur for unsharp mask -->
                    <feGaussianBlur id="sharpen-blur" in="denoised" stdDeviation="0.8" result="sharp-blurred"/>

                    <!-- Step 2: Subtract blurred from original to get high-frequency detail -->
                    <feComposite operator="arithmetic" in="denoised" in2="sharp-blurred"
                        k1="0" k2="1" k3="-1" k4="0" result="high-freq"/>

                    <!-- Step 3: Scale and add high-frequency back (unsharp mask) -->
                    <feComposite id="sharpen-amount" operator="arithmetic" in="high-freq" in2="denoised"
                        k1="0" k2="0" k3="1" k4="0" result="sharpened"/>

                    <!-- ============ EDGE ENHANCEMENT SECTION ============ -->
                    <!-- Laplacian edge detection with controlled blending -->
                    <feConvolveMatrix id="edge-enhance-matrix" order="3" in="sharpened" preserveAlpha="true"
                        kernelMatrix="0 0 0 0 1 0 0 0 0" result="edge-enhanced"/>

                    <!-- ============ TEMPERATURE ADJUSTMENT ============ -->
                    <feColorMatrix id="temperature-matrix" type="matrix" in="edge-enhanced"
                        values="1 0 0 0 0
                                0 1 0 0 0
                                0 0 1 0 0
                                0 0 0 1 0" result="temp-adjusted"/>

                    <!-- ============ HIGHLIGHTS ADJUSTMENT ============ -->
                    <!-- Uses gamma curve to target bright areas only -->
                    <feComponentTransfer id="highlights-transfer" in="temp-adjusted" result="highlights-adjusted">
                        <feFuncR id="highlights-r" type="gamma" amplitude="1" exponent="1" offset="0"/>
                        <feFuncG id="highlights-g" type="gamma" amplitude="1" exponent="1" offset="0"/>
                        <feFuncB id="highlights-b" type="gamma" amplitude="1" exponent="1" offset="0"/>
                    </feComponentTransfer>

                    <!-- ============ SHADOWS ADJUSTMENT ============ -->
                    <!-- Uses gamma curve to target dark areas only -->
                    <feComponentTransfer id="shadows-transfer" in="highlights-adjusted" result="final">
                        <feFuncR id="shadows-r" type="gamma" amplitude="1" exponent="1" offset="0"/>
                        <feFuncG id="shadows-g" type="gamma" amplitude="1" exponent="1" offset="0"/>
                        <feFuncB id="shadows-b" type="gamma" amplitude="1" exponent="1" offset="0"/>
                    </feComponentTransfer>
                </filter>

                <!-- ============ FAKE HDR FILTER ============ -->
                <!-- HDR-like tone mapping: preserve shadows, lift mids & highlights, no clipping -->
                <filter id="${this.hdrFilterId}" color-interpolation-filters="sRGB">
                    <!-- S-curve tone mapping: shadows preserved, subtle highlight lift -->
                    <!-- Input:  0    0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8  0.9  1.0 -->
                    <!-- Output: 0   0.09 0.18 0.29 0.40 0.52 0.64 0.75 0.84 0.93 1.0 -->
                    <feComponentTransfer in="SourceGraphic" result="hdr-tonemapped">
                        <feFuncR type="table" tableValues="0 0.09 0.18 0.29 0.40 0.52 0.64 0.75 0.84 0.93 1.0"/>
                        <feFuncG type="table" tableValues="0 0.09 0.18 0.29 0.40 0.52 0.64 0.75 0.84 0.93 1.0"/>
                        <feFuncB type="table" tableValues="0 0.09 0.18 0.29 0.40 0.52 0.64 0.75 0.84 0.93 1.0"/>
                    </feComponentTransfer>

                    <!-- Subtle saturation boost (+1%) -->
                    <feColorMatrix type="saturate" values="1.01" in="hdr-tonemapped" result="hdr-final"/>
                </filter>

                <!-- ============ ANIME ENHANCE FILTER ============ -->
                <!-- Subtle line art enhancement for anime -->
                <filter id="${this.animeFilterId}" color-interpolation-filters="sRGB">
                    <!-- Step 1: Gentle sharpening kernel (subtle edge enhancement) -->
                    <feConvolveMatrix order="3" in="SourceGraphic" preserveAlpha="true"
                        kernelMatrix="0 -0.08 0
                                      -0.08  1.32 -0.08
                                      0 -0.08 0" result="anime-sharpened"/>

                    <!-- Step 2: Tiny saturation boost for anime colors -->
                    <feColorMatrix type="saturate" values="1.04" in="anime-sharpened" result="anime-final"/>
                </filter>

                <!-- ============ ANTI-ALIASING FILTER ============ -->
                <!-- FXAA-inspired edge smoothing to reduce jaggies -->
                <filter id="${this.antiAliasingFilterId}" color-interpolation-filters="sRGB">
                    <!-- Step 1: Extract luminance for edge detection -->
                    <feColorMatrix type="matrix" in="SourceGraphic"
                        values="0.299 0.587 0.114 0 0
                                0.299 0.587 0.114 0 0
                                0.299 0.587 0.114 0 0
                                0 0 0 1 0" result="aa-luma"/>

                    <!-- Step 2: Detect edges using Sobel operator -->
                    <feConvolveMatrix order="3" in="aa-luma" preserveAlpha="true"
                        kernelMatrix="-1 -2 -1
                                       0  0  0
                                       1  2  1" result="aa-edge-y"/>
                    <feConvolveMatrix order="3" in="aa-luma" preserveAlpha="true"
                        kernelMatrix="-1  0  1
                                      -2  0  2
                                      -1  0  1" result="aa-edge-x"/>

                    <!-- Step 3: Combine edge magnitudes -->
                    <feComposite operator="arithmetic" in="aa-edge-x" in2="aa-edge-x"
                        k1="1" k2="0" k3="0" k4="0" result="aa-edge-x2"/>
                    <feComposite operator="arithmetic" in="aa-edge-y" in2="aa-edge-y"
                        k1="1" k2="0" k3="0" k4="0" result="aa-edge-y2"/>
                    <feComposite operator="arithmetic" in="aa-edge-x2" in2="aa-edge-y2"
                        k1="0" k2="1" k3="1" k4="0" result="aa-edges"/>

                    <!-- Step 4: Create edge mask (threshold edges) -->
                    <feComponentTransfer in="aa-edges" result="aa-mask">
                        <feFuncR type="linear" slope="3" intercept="0"/>
                        <feFuncG type="linear" slope="3" intercept="0"/>
                        <feFuncB type="linear" slope="3" intercept="0"/>
                    </feComponentTransfer>

                    <!-- Step 5: Blur only the edges (subtle smoothing) -->
                    <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="aa-blurred"/>

                    <!-- Step 6: Blend original with blurred based on edge mask -->
                    <!-- More blur applied to edge areas, original preserved elsewhere -->
                    <feComposite operator="arithmetic" in="aa-blurred" in2="SourceGraphic"
                        k1="0" k2="0.3" k3="0.7" k4="0" result="aa-final"/>
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
        logger.info("[VideoFilter] SVG filter injected");
    }

    private updateSharpenMatrix(intensity: number): void {
        // Unsharp mask: add scaled high-frequency detail back to image
        // sharpen-amount composite: k1*in*in2 + k2*in + k3*in2 + k4
        // in = high-freq detail, in2 = denoised original
        // Result = (sharpenAmount * high-freq) + (1 * original)
        const sharpenAmount = document.getElementById('sharpen-amount');
        if (!sharpenAmount) return;

        // intensity 0-100 maps to sharpening strength
        // 0 = no sharpening (k2=0, k3=1), 100 = strong sharpening (k2=1.5, k3=1)
        const strength = (intensity / 100) * 1.5; // 0 to 1.5

        // k2 controls high-freq contribution, k3=1 keeps original
        sharpenAmount.setAttribute('k2', strength.toString());
        sharpenAmount.setAttribute('k3', '1');
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

    private updateDenoiseBlur(intensity: number): void {
        const denoiseBlur = document.getElementById('denoise-blur');
        const denoiseMix = document.getElementById('denoise-mix');
        if (!denoiseBlur || !denoiseMix) return;

        // intensity 0-100 maps to:
        // - blur stdDeviation: 0-1.5 (subtle blur for noise reduction)
        // - mix ratio between original and blurred
        const stdDev = (intensity / 100) * 1.5;
        denoiseBlur.setAttribute('stdDeviation', stdDev.toString());

        // Edge-preserving mix: blend original with blurred
        // k2 = original weight, k3 = blurred weight
        // At 0 intensity: 100% original (k2=1, k3=0)
        // At 100 intensity: 30% original + 70% blurred (k2=0.3, k3=0.7)
        // This keeps edges sharper than pure blur
        const blurWeight = (intensity / 100) * 0.7;
        const originalWeight = 1 - blurWeight;

        denoiseMix.setAttribute('k2', originalWeight.toString());
        denoiseMix.setAttribute('k3', blurWeight.toString());
    }

    private updateEdgeEnhancement(intensity: number): void {
        const edgeMatrix = document.getElementById('edge-enhance-matrix');
        if (!edgeMatrix) return;

        // Edge enhancement using Laplacian-like kernel
        // At 0: identity kernel [0 0 0 | 0 1 0 | 0 0 0]
        // At 100: strong edge enhancement [-0.5 -0.5 -0.5 | -0.5 5 -0.5 | -0.5 -0.5 -0.5]
        const k = (intensity / 100) * 0.5; // 0 to 0.5 (subtle range)
        const center = 1 + 8 * k;
        const edge = -k;

        const kernel = `${edge} ${edge} ${edge} ${edge} ${center} ${edge} ${edge} ${edge} ${edge}`;
        edgeMatrix.setAttribute('kernelMatrix', kernel);
    }

    private updateHighlights(intensity: number): void {
        // Highlights adjustment using gamma curve
        // Gamma < 1 brightens highlights, Gamma > 1 darkens them
        // intensity 100 = neutral, <100 = darker highlights, >100 = brighter highlights
        const highlightsR = document.getElementById('highlights-r');
        const highlightsG = document.getElementById('highlights-g');
        const highlightsB = document.getElementById('highlights-b');
        if (!highlightsR || !highlightsG || !highlightsB) return;

        // Map intensity (50-150 range typically) to gamma exponent
        // intensity 100 = gamma 1.0 (neutral)
        // intensity 150 = gamma 0.7 (brighter highlights)
        // intensity 50 = gamma 1.4 (darker highlights)
        // Using amplitude to specifically target highlights (bright values)
        const normalized = intensity / 100; // 0.5 to 1.5

        // For highlights: we use amplitude > 1 with offset to target bright areas
        // gamma with exponent < 1 lifts the curve more at high values
        const exponent = 1 / normalized; // 2.0 to 0.67

        // Adjust amplitude to compensate and keep midtones stable
        const amplitude = Math.pow(0.5, exponent - 1); // Keeps midpoint roughly stable

        [highlightsR, highlightsG, highlightsB].forEach(func => {
            func.setAttribute('exponent', exponent.toFixed(3));
            func.setAttribute('amplitude', amplitude.toFixed(3));
        });
    }

    private updateShadows(intensity: number): void {
        // Shadows adjustment using gamma curve with offset
        // intensity 100 = neutral, <100 = darker shadows, >100 = lifted shadows
        const shadowsR = document.getElementById('shadows-r');
        const shadowsG = document.getElementById('shadows-g');
        const shadowsB = document.getElementById('shadows-b');
        if (!shadowsR || !shadowsG || !shadowsB) return;

        // Map intensity to shadow lift/crush
        // Using offset to add/subtract from dark areas primarily
        const normalized = (intensity - 100) / 100; // -0.5 to 0.5

        // Offset lifts blacks (positive) or crushes them (negative)
        // Keep it subtle to avoid washing out or clipping
        const offset = normalized * 0.15; // -0.075 to 0.075

        // Use gamma > 1 for shadow areas to affect primarily dark tones
        // Exponent > 1 darkens shadows, < 1 lifts them
        const exponent = 1 - (normalized * 0.3); // 1.15 to 0.85

        [shadowsR, shadowsG, shadowsB].forEach(func => {
            func.setAttribute('exponent', exponent.toFixed(3));
            func.setAttribute('offset', offset.toFixed(4));
        });
    }

    private applyFilters(): void {
        if (!this.video) return;

        // Build CSS filter string for basic adjustments (brightness, contrast, saturation)
        const cssFilters: string[] = [];

        // Brightness (100 = normal) - simple global brightness
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

        // Advanced SVG filters: sharpness, temperature, denoise, edge enhancement, highlights, shadows
        const hasSharpen = this.settings.sharpness > 0;
        const hasTemperature = this.settings.temperature !== 0;
        const hasDenoise = this.settings.denoise > 0;
        const hasEdgeEnhance = this.settings.edgeEnhance > 0;
        const hasHighlights = this.settings.highlights !== 100;
        const hasShadows = this.settings.shadows !== 100;

        // Always apply SVG filter if any advanced effect is active
        if (hasSharpen || hasTemperature || hasDenoise || hasEdgeEnhance || hasHighlights || hasShadows) {
            cssFilters.push(`url(#${this.svgFilterId})`);

            // Update all SVG filter parameters
            this.updateSharpenMatrix(this.settings.sharpness);
            this.updateTemperatureMatrix(this.settings.temperature);
            this.updateDenoiseBlur(this.settings.denoise);
            this.updateEdgeEnhancement(this.settings.edgeEnhance);
            this.updateHighlights(this.settings.highlights);
            this.updateShadows(this.settings.shadows);
        }

        // Apply Fake HDR filter if enabled
        if (this.settings.fakeHDR) {
            cssFilters.push(`url(#${this.hdrFilterId})`);
        }

        // Apply Anime Enhance filter if enabled
        if (this.settings.animeEnhance) {
            cssFilters.push(`url(#${this.animeFilterId})`);
        }

        // Apply Anti-Aliasing filter if enabled
        if (this.settings.antiAliasing) {
            cssFilters.push(`url(#${this.antiAliasingFilterId})`);
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

        // Apply to both video AND anime4k canvas so filters stack with Anime4K
        styleEl.textContent = `
            video, #anime4k-canvas {
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
        this.setupSlider('video-filter-highlights', 'highlights', 'highlights-value', '%');
        this.setupSlider('video-filter-shadows', 'shadows', 'shadows-value', '%');
        this.setupSlider('video-filter-denoise', 'denoise', 'denoise-value', '%');
        this.setupSlider('video-filter-edge-enhance', 'edgeEnhance', 'edge-enhance-value', '%');

        // Fake HDR toggle
        const fakeHDRToggle = document.getElementById('video-filter-fake-hdr') as HTMLInputElement;
        if (fakeHDRToggle) {
            fakeHDRToggle.addEventListener('change', () => {
                this.settings.fakeHDR = fakeHDRToggle.checked;
                this.applyFilters();
                this.saveSettings();
                logger.info(`[VideoFilter] Fake HDR ${this.settings.fakeHDR ? 'enabled' : 'disabled'}`);
            });
        }

        // Anime Enhance toggle
        const animeEnhanceToggle = document.getElementById('video-filter-anime-enhance') as HTMLInputElement;
        if (animeEnhanceToggle) {
            animeEnhanceToggle.addEventListener('change', () => {
                this.settings.animeEnhance = animeEnhanceToggle.checked;
                this.applyFilters();
                this.saveSettings();
                logger.info(`[VideoFilter] Anime Enhance ${this.settings.animeEnhance ? 'enabled' : 'disabled'}`);
            });
        }

        // Anti-Aliasing toggle
        const antiAliasingToggle = document.getElementById('video-filter-anti-aliasing') as HTMLInputElement;
        if (antiAliasingToggle) {
            antiAliasingToggle.addEventListener('change', () => {
                this.settings.antiAliasing = antiAliasingToggle.checked;
                this.applyFilters();
                this.saveSettings();
                logger.info(`[VideoFilter] Anti-Aliasing ${this.settings.antiAliasing ? 'enabled' : 'disabled'}`);
            });
        }

        // Anime4K mode selector
        this.setupAnime4KModeSelector();

        // Motion Smooth slider
        this.setupSlider('video-filter-motion-smooth', 'motionSmooth', 'motion-smooth-value', '%');

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

    private setupSlider(sliderId: string, settingKey: keyof NumericFilterSettings, valueId: string, suffix: string): void {
        const slider = document.getElementById(sliderId) as HTMLInputElement;
        const valueDisplay = document.getElementById(valueId);

        if (!slider || !valueDisplay) return;

        slider.addEventListener('input', () => {
            const value = parseInt(slider.value);
            (this.settings as NumericFilterSettings)[settingKey] = value;
            valueDisplay.textContent = `${value}${suffix}`;
            this.applyFilters();
        });

        // Save on change (when user releases slider)
        slider.addEventListener('change', () => {
            this.saveSettings();
        });
    }

    private setupAnime4KModeSelector(): void {
        const modeButtons = document.querySelectorAll('.anime4k-mode-btn');
        const warningPopup = document.getElementById('bo0ii-warning-popup');
        const cancelBtn = document.getElementById('bo0ii-cancel-btn');
        const confirmBtn = document.getElementById('bo0ii-confirm-btn');

        // Set initial active state based on current mode
        modeButtons.forEach(btn => {
            const mode = btn.getAttribute('data-mode');
            if (mode === this.settings.anime4kMode) {
                btn.classList.add('active');
            }
        });

        // Helper to apply mode
        const applyMode = (mode: Anime4KMode) => {
            // Update UI
            modeButtons.forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector(`.anime4k-mode-btn[data-mode="${mode}"]`);
            activeBtn?.classList.add('active');

            // Update settings
            this.settings.anime4kMode = mode;
            this.saveSettings();

            // Apply to renderer
            if (this.anime4kRenderer) {
                this.anime4kRenderer.setMode(mode);
            }

            logger.info(`[VideoFilter] Anime4K mode changed to: ${mode}`);
        };

        // Add click handlers
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode') as Anime4KMode;
                if (!mode) return;

                // Special handling for Bo0ii mode - show warning first
                if (mode === 'bo0ii') {
                    warningPopup?.classList.remove('hidden');
                    return;
                }

                applyMode(mode);
            });
        });

        // Warning popup cancel button
        cancelBtn?.addEventListener('click', () => {
            warningPopup?.classList.add('hidden');
        });

        // Warning popup confirm button
        confirmBtn?.addEventListener('click', () => {
            warningPopup?.classList.add('hidden');
            applyMode('bo0ii');
        });

        // Close popup when clicking outside content
        warningPopup?.addEventListener('click', (e) => {
            if (e.target === warningPopup) {
                warningPopup.classList.add('hidden');
            }
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
            highlights: PLAYER_DEFAULTS.VIDEO_FILTER_HIGHLIGHTS,
            shadows: PLAYER_DEFAULTS.VIDEO_FILTER_SHADOWS,
            denoise: PLAYER_DEFAULTS.VIDEO_FILTER_DENOISE,
            edgeEnhance: PLAYER_DEFAULTS.VIDEO_FILTER_EDGE_ENHANCE,
            fakeHDR: PLAYER_DEFAULTS.VIDEO_FILTER_FAKE_HDR,
            animeEnhance: PLAYER_DEFAULTS.VIDEO_FILTER_ANIME_ENHANCE,
            antiAliasing: PLAYER_DEFAULTS.VIDEO_FILTER_ANTI_ALIASING,
            anime4kMode: PLAYER_DEFAULTS.VIDEO_FILTER_ANIME4K_MODE as Anime4KMode,
            motionSmooth: PLAYER_DEFAULTS.VIDEO_FILTER_MOTION_SMOOTH,
        };

        // Update sliders
        this.updateSlider('video-filter-sharpness', 'sharpness-value', this.settings.sharpness, '%');
        this.updateSlider('video-filter-brightness', 'brightness-value', this.settings.brightness, '%');
        this.updateSlider('video-filter-contrast', 'contrast-value', this.settings.contrast, '%');
        this.updateSlider('video-filter-saturation', 'saturation-value', this.settings.saturation, '%');
        this.updateSlider('video-filter-temperature', 'temperature-value', this.settings.temperature, '');
        this.updateSlider('video-filter-highlights', 'highlights-value', this.settings.highlights, '%');
        this.updateSlider('video-filter-shadows', 'shadows-value', this.settings.shadows, '%');
        this.updateSlider('video-filter-denoise', 'denoise-value', this.settings.denoise, '%');
        this.updateSlider('video-filter-edge-enhance', 'edge-enhance-value', this.settings.edgeEnhance, '%');

        // Reset Fake HDR toggle
        const fakeHDRToggle = document.getElementById('video-filter-fake-hdr') as HTMLInputElement;
        if (fakeHDRToggle) {
            fakeHDRToggle.checked = this.settings.fakeHDR;
        }

        // Reset Anime Enhance toggle
        const animeEnhanceToggle = document.getElementById('video-filter-anime-enhance') as HTMLInputElement;
        if (animeEnhanceToggle) {
            animeEnhanceToggle.checked = this.settings.animeEnhance;
        }

        // Reset Anti-Aliasing toggle
        const antiAliasingToggle = document.getElementById('video-filter-anti-aliasing') as HTMLInputElement;
        if (antiAliasingToggle) {
            antiAliasingToggle.checked = this.settings.antiAliasing;
        }

        // Reset Anime4K mode selector
        const anime4kModeButtons = document.querySelectorAll('.anime4k-mode-btn');
        anime4kModeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === this.settings.anime4kMode);
        });
        if (this.anime4kRenderer) {
            this.anime4kRenderer.setMode(this.settings.anime4kMode);
        }

        // Reset Motion Smooth slider
        this.updateSlider('video-filter-motion-smooth', 'motion-smooth-value', this.settings.motionSmooth, '%');

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

        // Cleanup Anime4K renderer
        if (this.anime4kRenderer) {
            this.anime4kRenderer.cleanup();
            this.anime4kRenderer = null;
        }

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
