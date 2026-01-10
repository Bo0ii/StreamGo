import TemplateCache from '../../utils/templateCache';
import Helpers from '../../utils/Helpers';
import logger from '../../utils/logger';
import { STORAGE_KEYS, SELECTORS, CLASSES } from '../../constants';

const DEFAULT_ACCENT_COLOR = '#7b5bf5';

export function getAppearanceCategoryTemplate(
	darkMode: boolean,
	accentColor: string
): string {
	let template = TemplateCache.load(__dirname, 'appearance-category');

	return template
		.replace("{{ darkMode }}", darkMode ? "checked" : "")
		.replace(/\{\{\s*accentColor\s*\}\}/g, accentColor || DEFAULT_ACCENT_COLOR);
}

export function getAppearanceIcon(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon">
		<g><path fill="none" d="M0 0h24v24H0z"></path>
		<path d="M12 2c5.522 0 10 3.978 10 8.889a5.558 5.558 0 0 1-5.556 5.555h-1.966c-.922 0-1.667.745-1.667 1.667 0 .422.167.811.422 1.1.267.3.434.689.434 1.122C13.667 21.256 12.9 22 12 22 6.478 22 2 17.522 2 12S6.478 2 12 2zM7.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" style="fill:currentcolor"></path></g></svg>`;
}

export function applyUserAppearance(): void {
	// Apply accent color
	const accentColor = localStorage.getItem(STORAGE_KEYS.ACCENT_COLOR);
	if (accentColor) {
		applyAccentColor(accentColor);
	}

	// Apply dark mode
	const darkMode = localStorage.getItem(STORAGE_KEYS.DARK_MODE) === 'true';
	if (darkMode) {
		applyDarkMode(true);
	}
}

export function writeAppearance(): void {
	// Write appearance to Themes category instead of separate Appearance category
	Helpers.waitForElm(SELECTORS.THEMES_CATEGORY).then(() => {
		const darkMode = localStorage.getItem(STORAGE_KEYS.DARK_MODE) === 'true';
		const accentColor = localStorage.getItem(STORAGE_KEYS.ACCENT_COLOR) || DEFAULT_ACCENT_COLOR;

		const themesCategory = document.querySelector(SELECTORS.THEMES_CATEGORY);
		if (themesCategory) {
			themesCategory.innerHTML += getAppearanceCategoryTemplate(darkMode, accentColor);
		}
	}).catch(err => logger.error("Failed to write appearance section: " + err));
}

export function setupAppearanceControls(): void {
	// Dark mode toggle
	Helpers.waitForElm('#darkModeToggle').then(() => {
		const toggle = document.getElementById('darkModeToggle');
		toggle?.addEventListener('click', () => {
			toggle.classList.toggle(CLASSES.CHECKED);
			const isChecked = toggle.classList.contains(CLASSES.CHECKED);
			logger.info(`Dark mode toggled ${isChecked ? "ON" : "OFF"}`);
			localStorage.setItem(STORAGE_KEYS.DARK_MODE, isChecked ? "true" : "false");
			applyDarkMode(isChecked);
		});
	}).catch(err => logger.warn("Dark mode toggle not found: " + err));

	// Preset color options
	Helpers.waitForElm('#accentColorPicker').then(() => {
		const colorPicker = document.getElementById('accentColorPicker');
		const colorOptions = colorPicker?.querySelectorAll('.color-option');

		// Highlight current accent color
		const currentColor = localStorage.getItem(STORAGE_KEYS.ACCENT_COLOR) || DEFAULT_ACCENT_COLOR;
		colorOptions?.forEach(option => {
			const color = option.getAttribute('data-color');
			if (color?.toLowerCase() === currentColor.toLowerCase()) {
				(option as HTMLElement).style.borderColor = 'white';
				(option as HTMLElement).style.transform = 'scale(1.1)';
			}
		});

		// Color option click handlers
		colorOptions?.forEach(option => {
			option.addEventListener('click', () => {
				const color = option.getAttribute('data-color');
				if (color) {
					setAccentColor(color);
					updateColorSelection(colorOptions, option);
				}
			});
		});
	}).catch(err => logger.warn("Accent color picker not found: " + err));

	// Custom color picker
	Helpers.waitForElm('#customAccentColor').then(() => {
		const colorInput = document.getElementById('customAccentColor') as HTMLInputElement;
		const textInput = document.getElementById('customAccentColorText') as HTMLInputElement;

		colorInput?.addEventListener('input', () => {
			const color = colorInput.value;
			setAccentColor(color);
			if (textInput) textInput.value = color;
			clearPresetSelection();
		});

		textInput?.addEventListener('change', () => {
			const color = textInput.value;
			if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
				setAccentColor(color);
				if (colorInput) colorInput.value = color;
				clearPresetSelection();
			}
		});
	}).catch(err => logger.warn("Custom accent color input not found: " + err));

	// Reset button
	Helpers.waitForElm('#resetAccentColor').then(() => {
		const resetBtn = document.getElementById('resetAccentColor');
		resetBtn?.addEventListener('click', () => {
			setAccentColor(DEFAULT_ACCENT_COLOR);
			const colorInput = document.getElementById('customAccentColor') as HTMLInputElement;
			const textInput = document.getElementById('customAccentColorText') as HTMLInputElement;
			if (colorInput) colorInput.value = DEFAULT_ACCENT_COLOR;
			if (textInput) textInput.value = DEFAULT_ACCENT_COLOR;

			// Re-highlight default color
			const colorOptions = document.querySelectorAll('.color-option');
			colorOptions.forEach(option => {
				const color = option.getAttribute('data-color');
				if (color === DEFAULT_ACCENT_COLOR) {
					(option as HTMLElement).style.borderColor = 'white';
					(option as HTMLElement).style.transform = 'scale(1.1)';
				} else {
					(option as HTMLElement).style.borderColor = 'transparent';
					(option as HTMLElement).style.transform = 'scale(1)';
				}
			});
		});
	}).catch(err => logger.warn("Reset accent color button not found: " + err));
}

function setAccentColor(color: string): void {
	localStorage.setItem(STORAGE_KEYS.ACCENT_COLOR, color);
	applyAccentColor(color);
	logger.info(`Accent color set to: ${color}`);
}

function applyAccentColor(color: string): void {
	let styleEl = document.getElementById('enhanced-accent-color');
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'enhanced-accent-color';
		document.head.appendChild(styleEl);
	}

	// Convert hex to rgba for transparency
	const hexToRgba = (hex: string, alpha: number): string => {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	};

	styleEl.textContent = `
		:root {
			--accent-color: ${color} !important;
			--secondary-accent-color: ${color} !important;
		}
		/* Toggle switches - only the inner toggle */
		.toggle-container-lZfHP.checked .toggle-toOWM {
			background-color: ${color} !important;
		}
		/* Selected sidebar items - only icon and text color, no background */
		[class*="selected-"],
		.selected-S7SeK,
		[class*="menu-"] [class*="selected"],
		[class*="nav-"] [class*="selected"] {
			background-color: transparent !important;
			color: ${color} !important;
		}
		[class*="selected-"] svg,
		.selected-S7SeK svg,
		[class*="menu-"] [class*="selected"] svg,
		[class*="nav-"] [class*="selected"] svg {
			fill: ${color} !important;
			color: ${color} !important;
		}
		[class*="selected-"] [class*="icon"],
		.selected-S7SeK [class*="icon"],
		[class*="selected-"] path,
		.selected-S7SeK path {
			fill: ${color} !important;
			color: ${color} !important;
		}
		/* Progress bars */
		.progress-bar-container .progress-bar,
		[class*="progress-bar"] > div,
		[class*="progress"] [class*="bar"] {
			background-color: ${color} !important;
		}
		/* Links */
		a[class*="link"]:hover,
		[class*="action"]:hover {
			color: ${color} !important;
		}
		/* About StremGo card - dynamic accent color */
		.about-stremgo-card {
			background: ${hexToRgba(color, 0.1)} !important;
			border: 1px solid ${hexToRgba(color, 0.2)} !important;
		}
		.about-link {
			color: ${color} !important;
		}
	`;
}

function applyDarkMode(enabled: boolean): void {
	let styleEl = document.getElementById('enhanced-dark-mode');
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'enhanced-dark-mode';
		document.head.appendChild(styleEl);
	}

	if (enabled) {
		styleEl.textContent = `
			:root {
				--primary-background-color: #1a1a1a !important;
				--secondary-background-color: #1a1a1a !important;
				--tertiary-background-color: #1a1a1a !important;
				--overlay-color: #242424 !important;
			}
			body, html, #app {
				background-color: #1a1a1a !important;
			}
			/* All route and content containers */
			[class*="route-"],
			[class*="router-"],
			[class*="routes-container"],
			[class*="route-content"] {
				background-color: #1a1a1a !important;
			}
			/* Settings specific */
			[class*="settings-container"],
			[class*="settings-content"],
			[class*="sections-container"] {
				background-color: #1a1a1a !important;
			}
			/* Sidebar/menu */
			[class*="menu-"],
			[class*="vertical-nav"],
			[class*="nav-bar"] {
				background-color: #1a1a1a !important;
			}
			/* Main scrollable areas */
			[class*="scroll-pane"],
			[class*="modal-container"] > div {
				background-color: #1a1a1a !important;
			}
		`;
	} else {
		styleEl.textContent = '';
	}
}

function updateColorSelection(options: NodeListOf<Element>, selectedOption: Element): void {
	options.forEach(option => {
		(option as HTMLElement).style.borderColor = 'transparent';
		(option as HTMLElement).style.transform = 'scale(1)';
	});
	(selectedOption as HTMLElement).style.borderColor = 'white';
	(selectedOption as HTMLElement).style.transform = 'scale(1.1)';
}

function clearPresetSelection(): void {
	const colorOptions = document.querySelectorAll('.color-option');
	colorOptions.forEach(option => {
		(option as HTMLElement).style.borderColor = 'transparent';
		(option as HTMLElement).style.transform = 'scale(1)';
	});
}
