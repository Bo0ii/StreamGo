/**
 * @name DOM Inspector
 * @description Debugging tool to investigate Stremio's DOM structure on different routes
 * @version 1.0.0
 * @author StreamGo Dev
 */

(function() {
    'use strict';

    // Style for the inspector panel
    const style = document.createElement('style');
    style.textContent = `
        #dom-inspector-panel {
            position: fixed;
            top: 60px;
            right: 20px;
            width: 450px;
            max-height: 80vh;
            background: rgba(15, 15, 17, 0.98);
            border: 1px solid rgba(123, 91, 245, 0.5);
            border-radius: 12px;
            z-index: 999999;
            font-family: monospace;
            font-size: 11px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }

        #dom-inspector-header {
            padding: 12px 16px;
            background: rgba(123, 91, 245, 0.2);
            border-bottom: 1px solid rgba(123, 91, 245, 0.3);
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: white;
            font-weight: 600;
            font-size: 13px;
        }

        #dom-inspector-content {
            padding: 12px;
            overflow-y: auto;
            flex: 1;
            color: rgba(255, 255, 255, 0.9);
            line-height: 1.5;
        }

        .dom-section {
            margin-bottom: 16px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 6px;
            border-left: 3px solid rgba(123, 91, 245, 0.4);
        }

        .dom-section-title {
            color: #7b5bf5;
            font-weight: 700;
            margin-bottom: 8px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .dom-item {
            padding: 4px 0;
            display: flex;
            align-items: flex-start;
        }

        .dom-label {
            color: rgba(255, 255, 255, 0.6);
            min-width: 140px;
            flex-shrink: 0;
        }

        .dom-value {
            color: #10b981;
            word-break: break-all;
        }

        .dom-value.not-found {
            color: #ef4444;
        }

        .dom-value.warning {
            color: #f59e0b;
        }

        #dom-inspector-close {
            background: rgba(239, 68, 68, 0.2);
            border: none;
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
        }

        #dom-inspector-close:hover {
            background: rgba(239, 68, 68, 0.4);
        }

        #dom-inspector-refresh {
            background: rgba(16, 185, 129, 0.2);
            border: none;
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            margin-right: 8px;
        }

        #dom-inspector-refresh:hover {
            background: rgba(16, 185, 129, 0.4);
        }

        .route-change-marker {
            background: rgba(123, 91, 245, 0.3);
            padding: 8px 12px;
            border-radius: 6px;
            margin-bottom: 12px;
            color: white;
            font-size: 12px;
            font-weight: 600;
        }

        .element-list {
            margin-top: 6px;
            padding-left: 12px;
        }

        .element-item {
            padding: 3px 0;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.7);
        }
    `;
    document.head.appendChild(style);

    // Create the inspector panel
    function createInspectorPanel() {
        const panel = document.createElement('div');
        panel.id = 'dom-inspector-panel';
        panel.innerHTML = `
            <div id="dom-inspector-header">
                <span>🔍 DOM Inspector</span>
                <div>
                    <button id="dom-inspector-refresh">Refresh</button>
                    <button id="dom-inspector-close">Close</button>
                </div>
            </div>
            <div id="dom-inspector-content"></div>
        `;
        document.body.appendChild(panel);

        // Close button
        document.getElementById('dom-inspector-close').addEventListener('click', () => {
            panel.remove();
        });

        // Refresh button
        document.getElementById('dom-inspector-refresh').addEventListener('click', () => {
            updateInspectorContent();
        });

        return panel;
    }

    // Get all elements matching a selector
    function getElements(selector) {
        try {
            return document.querySelectorAll(selector);
        } catch (e) {
            return [];
        }
    }

    // Inspect the current DOM structure
    function inspectDOM() {
        const data = {
            route: location.hash || '#/',
            timestamp: new Date().toLocaleTimeString(),

            // Main navigation containers
            mainNavBarsContainer: getElements('[class*="main-nav-bars-container"]'),
            horizontalNavBar: getElements('[class*="horizontal-nav-bar"]'),
            horizontalNavBarContainer: getElements('[class*="horizontal-nav-bar-container"]'),
            verticalNavBar: getElements('[class*="vertical-nav-bar"]'),

            // Buttons and controls
            buttonsContainer: getElements('[class*="buttons-container"]'),
            navButtons: getElements('[class*="horizontal-nav-bar"] [class*="button"]'),

            // Route content
            routeContainer: getElements('[class*="route-container"]'),
            routeContent: getElements('[class*="route-content"]'),

            // Specific elements
            searchBar: getElements('[class*="search-bar"]'),
            settingsLink: getElements('a[href="#/settings"]'),
            fullscreenButton: getElements('[title*="ullscreen"]'),

            // Custom injected elements
            plusButton: getElements('#plus-nav-button'),
            appIcon: getElements('.app-icon-glass-theme'),
            profileSwitcher: getElements('.sgp-nav-profile'),
        };

        return data;
    }

    // Format the inspection data into HTML
    function formatInspectionData(data) {
        let html = `<div class="route-change-marker">📍 Route: ${data.route} (${data.timestamp})</div>`;

        // Main Navigation Section
        html += `<div class="dom-section">
            <div class="dom-section-title">Main Navigation Containers</div>`;

        html += formatElement('main-nav-bars-container', data.mainNavBarsContainer);
        html += formatElement('horizontal-nav-bar', data.horizontalNavBar);
        html += formatElement('horizontal-nav-bar-container', data.horizontalNavBarContainer);
        html += formatElement('vertical-nav-bar', data.verticalNavBar);

        html += `</div>`;

        // Buttons Section
        html += `<div class="dom-section">
            <div class="dom-section-title">Navigation Controls</div>`;

        html += formatElement('buttons-container', data.buttonsContainer);
        html += formatElement('nav buttons', data.navButtons);
        html += formatElement('search-bar', data.searchBar);
        html += formatElement('fullscreen button', data.fullscreenButton);

        html += `</div>`;

        // Custom Elements Section
        html += `<div class="dom-section">
            <div class="dom-section-title">Custom Injected Elements</div>`;

        html += formatElement('Plus button', data.plusButton);
        html += formatElement('App icon', data.appIcon);
        html += formatElement('Profile switcher', data.profileSwitcher);

        html += `</div>`;

        // Route Content Section
        html += `<div class="dom-section">
            <div class="dom-section-title">Route Content</div>`;

        html += formatElement('route-container', data.routeContainer);
        html += formatElement('route-content', data.routeContent);

        html += `</div>`;

        // Additional Details
        html += `<div class="dom-section">
            <div class="dom-section-title">Additional Info</div>`;

        const totalNavBars = data.horizontalNavBarContainer.length;
        const mainNavExists = data.mainNavBarsContainer.length > 0;
        const buttonsInMainNav = mainNavExists ?
            document.querySelectorAll('[class*="main-nav-bars-container"] [class*="buttons-container"]').length : 0;

        html += `
            <div class="dom-item">
                <span class="dom-label">Total horizontal navbars:</span>
                <span class="dom-value ${totalNavBars > 1 ? 'warning' : ''}">${totalNavBars}</span>
            </div>
            <div class="dom-item">
                <span class="dom-label">Main nav exists:</span>
                <span class="dom-value ${mainNavExists ? '' : 'not-found'}">${mainNavExists ? 'YES' : 'NO'}</span>
            </div>
            <div class="dom-item">
                <span class="dom-label">Buttons in main nav:</span>
                <span class="dom-value ${buttonsInMainNav === 0 ? 'not-found' : ''}">${buttonsInMainNav}</span>
            </div>
        `;

        html += `</div>`;

        // Show all nav bars in detail
        if (totalNavBars > 0) {
            html += `<div class="dom-section">
                <div class="dom-section-title">Nav Bars Breakdown (${totalNavBars} found)</div>`;

            data.horizontalNavBarContainer.forEach((nav, index) => {
                const isInMainNav = nav.closest('[class*="main-nav-bars-container"]') !== null;
                const isInRouteContent = nav.closest('[class*="route-content"]') !== null;
                const hasButtons = nav.querySelector('[class*="buttons-container"]') !== null;
                const buttonCount = nav.querySelectorAll('[class*="button"]').length;

                html += `
                    <div class="element-item">
                        Nav #${index + 1}:
                        ${isInMainNav ? '🟢 MAIN NAV' : ''}
                        ${isInRouteContent ? '🟡 IN ROUTE' : ''}
                        | Buttons: ${buttonCount}
                        ${hasButtons ? '✓' : '✗'} has buttons-container
                    </div>
                `;
            });

            html += `</div>`;
        }

        return html;
    }

    // Format a single element check
    function formatElement(label, elements) {
        const count = elements.length;
        const valueClass = count === 0 ? 'not-found' : (count > 1 ? 'warning' : '');
        const status = count === 0 ? '✗ Not found' : (count === 1 ? '✓ Found' : `⚠ Found ${count}`);

        return `
            <div class="dom-item">
                <span class="dom-label">${label}:</span>
                <span class="dom-value ${valueClass}">${status}</span>
            </div>
        `;
    }

    // Update the inspector panel content
    function updateInspectorContent() {
        const panel = document.getElementById('dom-inspector-panel');
        if (!panel) return;

        const content = panel.querySelector('#dom-inspector-content');
        if (!content) return;

        const data = inspectDOM();
        content.innerHTML = formatInspectionData(data);
    }

    // Initialize the inspector
    function init() {
        console.log('[DOM Inspector] Plugin loaded');

        // Create panel
        const panel = createInspectorPanel();
        updateInspectorContent();

        // Auto-refresh on hash change
        window.addEventListener('hashchange', () => {
            setTimeout(() => {
                updateInspectorContent();
            }, 500); // Wait for Stremio to update DOM
        });

        // Also observe DOM mutations
        const observer = new MutationObserver(() => {
            // Debounce updates
            clearTimeout(observer.updateTimeout);
            observer.updateTimeout = setTimeout(() => {
                updateInspectorContent();
            }, 1000);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
