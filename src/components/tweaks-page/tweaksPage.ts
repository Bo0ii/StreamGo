import TemplateCache from '../../utils/templateCache';
import Helpers from '../../utils/Helpers';
import logger from '../../utils/logger';
import { STORAGE_KEYS, CLASSES } from '../../constants';

const VERTICAL_NAV_SELECTOR = 'nav[class*="vertical-nav-bar"]';
const ROUTE_CONTENT_SELECTOR = '[class*="route-content"]';

export function getTweaksPageTemplate(): string {
	const template = TemplateCache.load(__dirname, 'tweaks-page');

	const fullHeightBackground = localStorage.getItem(STORAGE_KEYS.FULL_HEIGHT_BACKGROUND) === 'true';
	const hidePosterHover = localStorage.getItem(STORAGE_KEYS.HIDE_POSTER_HOVER) === 'true';
	const hideContextDots = localStorage.getItem(STORAGE_KEYS.HIDE_CONTEXT_DOTS) === 'true';
	const roundedPosters = localStorage.getItem(STORAGE_KEYS.ROUNDED_POSTERS) === 'true';

	return template
		.replace("{{ fullHeightBackground }}", fullHeightBackground ? "checked" : "")
		.replace("{{ hidePosterHover }}", hidePosterHover ? "checked" : "")
		.replace("{{ hideContextDots }}", hideContextDots ? "checked" : "")
		.replace("{{ roundedPosters }}", roundedPosters ? "checked" : "");
}

export function injectTweaksNavItem(): void {
	// Wait for the vertical nav bar to exist
	Helpers.waitForElm(VERTICAL_NAV_SELECTOR).then(() => {
		const verticalNav = document.querySelector(VERTICAL_NAV_SELECTOR);
		if (!verticalNav) return;

		// Check if already injected
		if (document.getElementById('tweaks-nav-item')) return;

		// Find the settings nav item (last icon before the bottom)
		const navItems = verticalNav.querySelectorAll('[class*="nav-tab"]');
		const settingsItem = Array.from(navItems).find(item => {
			const href = item.getAttribute('href');
			return href && href.includes('settings');
		});

		// Create tweaks nav item
		const tweaksNavItem = document.createElement('a');
		tweaksNavItem.id = 'tweaks-nav-item';
		tweaksNavItem.href = '#/tweaks';
		tweaksNavItem.setAttribute('tabindex', '0');
		tweaksNavItem.setAttribute('title', 'Tweaks');

		// Copy classes from an existing nav item
		if (navItems.length > 0) {
			tweaksNavItem.className = navItems[0].className;
		}

		// Add the tweaks icon (wrench/tool icon)
		tweaksNavItem.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: currentcolor;">
				<path d="M5.33 3.271a3.5 3.5 0 0 1 4.472 4.474L20.647 18.59l-2.122 2.121L7.68 9.867a3.5 3.5 0 0 1-4.472-4.474L5.444 7.63a1.5 1.5 0 1 0 2.121-2.121L5.329 3.27zm10.367 1.884l3.182-1.768 1.414 1.414-1.768 3.182-1.768.354-2.12 2.121-1.415-1.414 2.121-2.121.354-1.768zm-6.718 8.132l1.414 1.414-5.303 5.303a1 1 0 0 1-1.492-1.327l.078-.087 5.303-5.303z"/>
			</svg>
		`;

		// Insert before settings
		if (settingsItem) {
			verticalNav.insertBefore(tweaksNavItem, settingsItem);
		} else {
			verticalNav.appendChild(tweaksNavItem);
		}

		logger.info("Tweaks nav item injected into vertical sidebar");
	}).catch(err => logger.error("Failed to inject tweaks nav item: " + err));
}

export function handleTweaksRoute(): boolean {
	if (!location.hash.includes('#/tweaks')) {
		return false;
	}

	logger.info("Handling tweaks route");

	// Find the route content area and replace it with tweaks page
	Helpers.waitForElm(ROUTE_CONTENT_SELECTOR).then(() => {
		const routeContent = document.querySelector(ROUTE_CONTENT_SELECTOR);
		if (!routeContent) return;

		// Clear existing content and inject tweaks page
		routeContent.innerHTML = getTweaksPageTemplate();

		// Setup toggle event listeners
		setupTweaksPageControls();

		// Update nav item selection
		updateNavSelection();
	}).catch(err => logger.error("Failed to render tweaks page: " + err));

	return true;
}

function updateNavSelection(): void {
	// Remove selected class from all nav items
	const navItems = document.querySelectorAll(`${VERTICAL_NAV_SELECTOR} [class*="nav-tab"]`);
	navItems.forEach(item => {
		item.classList.remove('selected');
		// Also try to remove Stremio's selected class pattern
		const classes = Array.from(item.classList);
		classes.forEach(cls => {
			if (cls.includes('selected')) {
				item.classList.remove(cls);
			}
		});
	});

	// Add selected to tweaks nav item
	const tweaksNav = document.getElementById('tweaks-nav-item');
	if (tweaksNav) {
		// Find and add the selected class pattern from other nav items
		const firstNav = document.querySelector(`${VERTICAL_NAV_SELECTOR} [class*="nav-tab"]`);
		if (firstNav) {
			const selectedClass = Array.from(firstNav.classList).find(cls => cls.includes('selected')) || 'selected';
			tweaksNav.classList.add(selectedClass.replace('selected', '') + 'selected');
		}
	}
}

function setupTweaksPageControls(): void {
	// Full height background toggle
	const fullHeightToggle = document.getElementById('fullHeightBackgroundToggle');
	fullHeightToggle?.addEventListener('click', () => {
		fullHeightToggle.classList.toggle(CLASSES.CHECKED);
		const isChecked = fullHeightToggle.classList.contains(CLASSES.CHECKED);
		logger.info(`Full height background toggled ${isChecked ? "ON" : "OFF"}`);
		localStorage.setItem(STORAGE_KEYS.FULL_HEIGHT_BACKGROUND, isChecked ? "true" : "false");
		applyTweaks();
	});

	// Hide poster hover toggle
	const hidePosterToggle = document.getElementById('hidePosterHoverToggle');
	hidePosterToggle?.addEventListener('click', () => {
		hidePosterToggle.classList.toggle(CLASSES.CHECKED);
		const isChecked = hidePosterToggle.classList.contains(CLASSES.CHECKED);
		logger.info(`Hide poster hover toggled ${isChecked ? "ON" : "OFF"}`);
		localStorage.setItem(STORAGE_KEYS.HIDE_POSTER_HOVER, isChecked ? "true" : "false");
		applyTweaks();
	});

	// Hide context dots toggle
	const hideDotsToggle = document.getElementById('hideContextDotsToggle');
	hideDotsToggle?.addEventListener('click', () => {
		hideDotsToggle.classList.toggle(CLASSES.CHECKED);
		const isChecked = hideDotsToggle.classList.contains(CLASSES.CHECKED);
		logger.info(`Hide context dots toggled ${isChecked ? "ON" : "OFF"}`);
		localStorage.setItem(STORAGE_KEYS.HIDE_CONTEXT_DOTS, isChecked ? "true" : "false");
		applyTweaks();
	});

	// Rounded posters toggle
	const roundedToggle = document.getElementById('roundedPostersToggle');
	roundedToggle?.addEventListener('click', () => {
		roundedToggle.classList.toggle(CLASSES.CHECKED);
		const isChecked = roundedToggle.classList.contains(CLASSES.CHECKED);
		logger.info(`Rounded posters toggled ${isChecked ? "ON" : "OFF"}`);
		localStorage.setItem(STORAGE_KEYS.ROUNDED_POSTERS, isChecked ? "true" : "false");
		applyTweaks();
	});
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
