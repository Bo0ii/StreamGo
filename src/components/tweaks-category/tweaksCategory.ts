import TemplateCache from '../../utils/templateCache';
import Helpers from '../../utils/Helpers';
import logger from '../../utils/logger';
import { STORAGE_KEYS, SELECTORS, CLASSES, PLAYER_DEFAULTS } from '../../constants';

export function getTweaksCategoryTemplate(
	fullHeightBackground: boolean,
	performanceMode: boolean,
	hidePosterHover: boolean,
	hideContextDots: boolean,
	roundedPosters: boolean,
	ambilightEnabled: boolean,
	skipIntroSeconds: string,
	subtitleFontSize: string,
	subtitleColor: string,
	subtitleBgOpacity: string
): string {
	let template = TemplateCache.load(__dirname, 'tweaks-category');

	return template
		.replace("{{ fullHeightBackground }}", fullHeightBackground ? "checked" : "")
		.replace("{{ performanceMode }}", performanceMode ? "checked" : "")
		.replace("{{ hidePosterHover }}", hidePosterHover ? "checked" : "")
		.replace("{{ hideContextDots }}", hideContextDots ? "checked" : "")
		.replace("{{ roundedPosters }}", roundedPosters ? "checked" : "")
		.replace(/\{\{\s*ambilightEnabled\s*\}\}/g, ambilightEnabled ? CLASSES.CHECKED : '')
		.replace(/\{\{\s*skipIntroSeconds\s*\}\}/g, skipIntroSeconds)
		.replace(/\{\{\s*subtitleFontSize\s*\}\}/g, subtitleFontSize)
		.replace(/\{\{\s*subtitleColor\s*\}\}/g, subtitleColor)
		.replace(/\{\{\s*subtitleBgOpacity\s*\}\}/g, subtitleBgOpacity);
}

export function getTweaksIcon(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
		<g><path fill="none" d="M0 0h24v24H0z"></path>
		<path d="M5.33 3.271a3.5 3.5 0 0 1 4.472 4.474L20.647 18.59l-2.122 2.121L7.68 9.867a3.5 3.5 0 0 1-4.472-4.474L5.444 7.63a1.5 1.5 0 1 0 2.121-2.121L5.329 3.27zm10.367 1.884l3.182-1.768 1.414 1.414-1.768 3.182-1.768.354-2.12 2.121-1.415-1.414 2.121-2.121.354-1.768zm-6.718 8.132l1.414 1.414-5.303 5.303a1 1 0 0 1-1.492-1.327l.078-.087 5.303-5.303z" style="fill:currentcolor"></path></g></svg>`;
}

export function writeTweaks(): void {
	Helpers.waitForElm(SELECTORS.TWEAKS_CATEGORY).then(() => {
		const fullHeightBackground = localStorage.getItem(STORAGE_KEYS.FULL_HEIGHT_BACKGROUND) === 'true';
		const performanceMode = localStorage.getItem(STORAGE_KEYS.PERFORMANCE_MODE) === 'true';
		const hidePosterHover = localStorage.getItem(STORAGE_KEYS.HIDE_POSTER_HOVER) === 'true';
		const hideContextDots = localStorage.getItem(STORAGE_KEYS.HIDE_CONTEXT_DOTS) === 'true';
		const roundedPosters = localStorage.getItem(STORAGE_KEYS.ROUNDED_POSTERS) === 'true';

		// Player settings
		const ambilightEnabled = localStorage.getItem(STORAGE_KEYS.AMBILIGHT_ENABLED) === 'true';
		const skipIntroSeconds = localStorage.getItem(STORAGE_KEYS.SKIP_INTRO_SECONDS) || PLAYER_DEFAULTS.SKIP_INTRO_SECONDS.toString();
		const subtitleFontSize = localStorage.getItem(STORAGE_KEYS.SUBTITLE_FONT_SIZE) || PLAYER_DEFAULTS.SUBTITLE_FONT_SIZE.toString();
		const subtitleColor = localStorage.getItem(STORAGE_KEYS.SUBTITLE_COLOR) || PLAYER_DEFAULTS.SUBTITLE_COLOR;

		// Parse background opacity from rgba
		const bgColor = localStorage.getItem(STORAGE_KEYS.SUBTITLE_BG_COLOR) || PLAYER_DEFAULTS.SUBTITLE_BG_COLOR;
		const opacityMatch = bgColor.match(/[\d.]+(?=\))/);
		const subtitleBgOpacity = opacityMatch ? Math.round(parseFloat(opacityMatch[0]) * 100).toString() : '80';

		const tweaksCategory = document.querySelector(SELECTORS.TWEAKS_CATEGORY);
		if (tweaksCategory) {
			tweaksCategory.innerHTML += getTweaksCategoryTemplate(
				fullHeightBackground,
				performanceMode,
				hidePosterHover,
				hideContextDots,
				roundedPosters,
				ambilightEnabled,
				skipIntroSeconds,
				subtitleFontSize,
				subtitleColor,
				subtitleBgOpacity
			);
		}
	}).catch(err => logger.error("Failed to write tweaks section: " + err));
}

export function setupTweaksControls(): void {
	// Performance mode toggle
	Helpers.waitForElm('#performanceModeToggle').then(() => {
		const toggle = document.getElementById('performanceModeToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Performance mode toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.PERFORMANCE_MODE, isChecked ? "true" : "false");
			applyPerformanceMode(isChecked);
		});
	}).catch(err => logger.warn("Performance mode toggle not found: " + err));

	// Full height background toggle
	Helpers.waitForElm('#fullHeightBackgroundToggle').then(() => {
		const toggle = document.getElementById('fullHeightBackgroundToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Full height background toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.FULL_HEIGHT_BACKGROUND, isChecked ? "true" : "false");
			applyTweaks();
		});
	}).catch(err => logger.warn("Full height background toggle not found: " + err));

	// Hide poster hover toggle
	Helpers.waitForElm('#hidePosterHoverToggle').then(() => {
		const toggle = document.getElementById('hidePosterHoverToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Hide poster hover toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.HIDE_POSTER_HOVER, isChecked ? "true" : "false");
			applyTweaks();
		});
	}).catch(err => logger.warn("Hide poster hover toggle not found: " + err));

	// Hide context dots toggle
	Helpers.waitForElm('#hideContextDotsToggle').then(() => {
		const toggle = document.getElementById('hideContextDotsToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Hide context dots toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.HIDE_CONTEXT_DOTS, isChecked ? "true" : "false");
			applyTweaks();
		});
	}).catch(err => logger.warn("Hide context dots toggle not found: " + err));

	// Rounded posters toggle
	Helpers.waitForElm('#roundedPostersToggle').then(() => {
		const toggle = document.getElementById('roundedPostersToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Rounded posters toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.ROUNDED_POSTERS, isChecked ? "true" : "false");
			applyTweaks();
		});
	}).catch(err => logger.warn("Rounded posters toggle not found: " + err));

	// === Player Settings Controls ===

	// Ambilight toggle
	Helpers.waitForElm('#ambilightToggle').then(() => {
		const toggle = document.getElementById('ambilightToggle');
		if (!toggle || toggle.hasAttribute('data-handler-attached')) return;
		toggle.setAttribute('data-handler-attached', 'true');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			localStorage.setItem(STORAGE_KEYS.AMBILIGHT_ENABLED, isChecked ? 'true' : 'false');
			logger.info(`[Tweaks] Ambilight toggled ${isChecked ? 'ON' : 'OFF'}`);
		});
	}).catch(err => logger.warn("Ambilight toggle not found: " + err));

	// Skip intro duration
	Helpers.waitForElm('#skipIntroDuration').then(() => {
		const input = document.getElementById('skipIntroDuration') as HTMLInputElement;
		if (!input || input.hasAttribute('data-handler-attached')) return;
		input.setAttribute('data-handler-attached', 'true');
		input.addEventListener('change', () => {
			const value = Math.min(180, Math.max(30, parseInt(input.value) || PLAYER_DEFAULTS.SKIP_INTRO_SECONDS));
			input.value = value.toString();
			localStorage.setItem(STORAGE_KEYS.SKIP_INTRO_SECONDS, value.toString());
			logger.info(`[Tweaks] Skip intro duration set to ${value}s`);
		});
	}).catch(err => logger.warn("Skip intro duration input not found: " + err));

	// Subtitle font size
	Helpers.waitForElm('#settingsSubtitleSize').then(() => {
		const slider = document.getElementById('settingsSubtitleSize') as HTMLInputElement;
		if (!slider || slider.hasAttribute('data-handler-attached')) return;
		slider.setAttribute('data-handler-attached', 'true');
		const valueDisplay = document.getElementById('settingsSubtitleSizeValue');

		slider.addEventListener('input', () => {
			const value = slider.value;
			if (valueDisplay) valueDisplay.textContent = `${value}px`;
			localStorage.setItem(STORAGE_KEYS.SUBTITLE_FONT_SIZE, value);
			applySubtitleStyleFromSettings();
		});
	}).catch(err => logger.warn("Subtitle font size slider not found: " + err));

	// Subtitle color
	Helpers.waitForElm('#settingsSubtitleColor').then(() => {
		const colorPicker = document.getElementById('settingsSubtitleColor') as HTMLInputElement;
		if (!colorPicker || colorPicker.hasAttribute('data-handler-attached')) return;
		colorPicker.setAttribute('data-handler-attached', 'true');
		const valueDisplay = document.getElementById('settingsSubtitleColorValue');

		colorPicker.addEventListener('input', () => {
			const value = colorPicker.value;
			if (valueDisplay) valueDisplay.textContent = value;
			localStorage.setItem(STORAGE_KEYS.SUBTITLE_COLOR, value);
			applySubtitleStyleFromSettings();
		});
	}).catch(err => logger.warn("Subtitle color picker not found: " + err));

	// Subtitle background opacity
	Helpers.waitForElm('#settingsSubtitleBgOpacity').then(() => {
		const slider = document.getElementById('settingsSubtitleBgOpacity') as HTMLInputElement;
		if (!slider || slider.hasAttribute('data-handler-attached')) return;
		slider.setAttribute('data-handler-attached', 'true');
		const valueDisplay = document.getElementById('settingsSubtitleBgOpacityValue');

		slider.addEventListener('input', () => {
			const value = parseInt(slider.value);
			if (valueDisplay) valueDisplay.textContent = `${value}%`;
			const bgColor = `rgba(0,0,0,${value / 100})`;
			localStorage.setItem(STORAGE_KEYS.SUBTITLE_BG_COLOR, bgColor);
			applySubtitleStyleFromSettings();
		});
	}).catch(err => logger.warn("Subtitle background opacity slider not found: " + err));
}

function applySubtitleStyleFromSettings(): void {
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

// Apply performance mode - adds body class for CSS optimizations
export function applyPerformanceMode(enabled: boolean): void {
	if (enabled) {
		document.body.classList.add('performance-mode-enabled');
		logger.info('Performance mode enabled - blur effects disabled, animations simplified');
	} else {
		document.body.classList.remove('performance-mode-enabled');
		logger.info('Performance mode disabled - full visual effects restored');
	}
}

// Initialize performance mode on page load
export function initPerformanceMode(): void {
	const performanceMode = localStorage.getItem(STORAGE_KEYS.PERFORMANCE_MODE) === 'true';
	applyPerformanceMode(performanceMode);
}

export function applyTweaks(): void {
	let styleEl = document.getElementById('enhanced-tweaks');
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'enhanced-tweaks';
		document.head.appendChild(styleEl);
	}

	let css = '';

	// Full height background
	const fullHeightBackground = localStorage.getItem(STORAGE_KEYS.FULL_HEIGHT_BACKGROUND) === 'true';
	if (fullHeightBackground) {
		css += `
			/* Make movie/show background fill to top */
			[class*="metadetails-container"],
			[class*="meta-details-container"] {
				margin-top: 0 !important;
				padding-top: 0 !important;
			}
			[class*="background-image-layer"],
			[class*="meta-details"] [class*="background"],
			[class*="metadetails"] [class*="background"] {
				top: 0 !important;
				height: 100vh !important;
				margin-top: 0 !important;
			}
			/* Ensure the background extends behind the nav bar */
			[class*="route-content"] {
				overflow: visible !important;
			}
			[class*="horizontal-nav-bar"] {
				background: transparent !important;
			}
		`;
	}

	// Hide poster hover effects
	const hidePosterHover = localStorage.getItem(STORAGE_KEYS.HIDE_POSTER_HOVER) === 'true';
	if (hidePosterHover) {
		css += `
			/* Remove hover background color effects */
			[class*="poster-container"]:hover,
			[class*="meta-item"]:hover,
			[class*="poster"]:hover,
			[class*="meta-preview"]:hover {
				background-color: transparent !important;
			}
			/* Remove any overlay/highlight on hover */
			[class*="poster-container"]::after,
			[class*="poster-container"]::before,
			[class*="meta-item"]::after,
			[class*="meta-item"]::before {
				background-color: transparent !important;
				opacity: 0 !important;
			}
		`;
	}

	// Hide context menu dots
	const hideContextDots = localStorage.getItem(STORAGE_KEYS.HIDE_CONTEXT_DOTS) === 'true';
	if (hideContextDots) {
		css += `
			/* Hide 3 vertical dots menu on posters */
			[class*="context-menu-button"],
			[class*="menu-button-container"],
			[class*="poster-container"] [class*="button"][class*="menu"],
			[class*="poster"] [class*="dots"],
			[class*="meta-item"] [class*="menu-icon"],
			.context-menu-button-XO6iA {
				display: none !important;
			}
		`;
	}

	// Rounded poster corners
	const roundedPosters = localStorage.getItem(STORAGE_KEYS.ROUNDED_POSTERS) === 'true';
	if (roundedPosters) {
		css += `
			/* Movie poster - rounded corners */
			[class*="poster-container"],
			[class*="poster-container"] [class*="poster"],
			[class*="meta-item"] [class*="poster"],
			[class*="poster-image"] {
				border-radius: 8px !important;
				overflow: hidden !important;
			}
		`;
	}

	styleEl.textContent = css;
}
