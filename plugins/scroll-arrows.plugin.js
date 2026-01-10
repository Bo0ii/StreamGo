/**
 * @name Scroll Arrows
 * @description Adds Netflix-style left/right scroll arrows to horizontal content rows.
 * @version 1.2.0
 * @author StremGo
 */

(function() {
    'use strict';

    const SCROLL_AMOUNT = 500; // pixels to scroll per click
    const ARROW_SIZE = 50;
    const DEBUG = false; // Set to true to see console logs

    function log(...args) {
        if (DEBUG) console.log('[ScrollArrows]', ...args);
    }

    // CSS styles for the arrows
    const styles = `
        .scroll-arrows-wrapper {
            position: relative !important;
            overflow: visible !important;
        }

        .scroll-arrow {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: ${ARROW_SIZE}px;
            height: ${ARROW_SIZE}px;
            background: rgba(0, 0, 0, 0.75);
            border-radius: 50%;
            border: 2px solid rgba(255, 255, 255, 0.3);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999;
            opacity: 0;
            transition: opacity 0.3s ease, background 0.2s ease, transform 0.2s ease;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            pointer-events: auto;
        }

        .scroll-arrow:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: translateY(-50%) scale(1.1);
        }

        .scroll-arrow:active {
            transform: translateY(-50%) scale(0.95);
        }

        .scroll-arrow-left {
            left: 5px;
        }

        .scroll-arrow-right {
            right: 5px;
        }

        .scroll-arrow svg {
            width: 24px;
            height: 24px;
            fill: white;
            pointer-events: none;
        }

        .scroll-arrows-wrapper:hover .scroll-arrow:not(.scroll-arrow-hidden) {
            opacity: 1;
        }

        .scroll-arrow-hidden {
            opacity: 0 !important;
            pointer-events: none !important;
        }

        /* Make meta row containers have proper overflow */
        [class*="meta-row-container"] [class*="meta-items-container"] {
            overflow-x: auto !important;
            scroll-behavior: smooth !important;
            scrollbar-width: none !important;
        }

        [class*="meta-row-container"] [class*="meta-items-container"]::-webkit-scrollbar {
            display: none !important;
        }
    `;

    // Inject styles
    function injectStyles() {
        if (document.getElementById('scroll-arrows-styles')) return;
        const styleEl = document.createElement('style');
        styleEl.id = 'scroll-arrows-styles';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
        log('Styles injected');
    }

    // SVG icons for arrows
    const leftArrowSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;
    const rightArrowSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>`;

    // Create arrow button
    function createArrow(direction) {
        const arrow = document.createElement('div');
        arrow.className = `scroll-arrow scroll-arrow-${direction}`;
        arrow.innerHTML = direction === 'left' ? leftArrowSVG : rightArrowSVG;
        return arrow;
    }

    // Update arrow visibility based on scroll position
    function updateArrowVisibility(scrollContainer, leftArrow, rightArrow) {
        const scrollLeft = scrollContainer.scrollLeft;
        const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;

        log('Scroll position:', scrollLeft, 'Max:', maxScroll);

        if (scrollLeft <= 5) {
            leftArrow.classList.add('scroll-arrow-hidden');
        } else {
            leftArrow.classList.remove('scroll-arrow-hidden');
        }

        if (scrollLeft >= maxScroll - 5) {
            rightArrow.classList.add('scroll-arrow-hidden');
        } else {
            rightArrow.classList.remove('scroll-arrow-hidden');
        }
    }

    // Add arrows to a meta row container
    function addArrowsToRow(rowContainer) {
        if (rowContainer.dataset.scrollArrowsAdded) return;

        // Find the scrollable container inside (meta-items-container)
        const scrollContainer = rowContainer.querySelector('[class*="meta-items-container"]');
        if (!scrollContainer) {
            log('No scrollable container found in row');
            return;
        }

        // Check if actually scrollable
        const isScrollable = scrollContainer.scrollWidth > scrollContainer.clientWidth + 20;
        log('Container scrollable:', isScrollable, 'scrollWidth:', scrollContainer.scrollWidth, 'clientWidth:', scrollContainer.clientWidth);

        if (!isScrollable) return;

        // Add wrapper class to row container
        rowContainer.classList.add('scroll-arrows-wrapper');

        const leftArrow = createArrow('left');
        const rightArrow = createArrow('right');

        rowContainer.appendChild(leftArrow);
        rowContainer.appendChild(rightArrow);

        // Click handlers with manual scroll
        leftArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Left arrow clicked, scrolling by', -SCROLL_AMOUNT);
            const currentScroll = scrollContainer.scrollLeft;
            scrollContainer.scrollTo({
                left: currentScroll - SCROLL_AMOUNT,
                behavior: 'smooth'
            });
            setTimeout(() => updateArrowVisibility(scrollContainer, leftArrow, rightArrow), 350);
        });

        rightArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            log('Right arrow clicked, scrolling by', SCROLL_AMOUNT);
            const currentScroll = scrollContainer.scrollLeft;
            scrollContainer.scrollTo({
                left: currentScroll + SCROLL_AMOUNT,
                behavior: 'smooth'
            });
            setTimeout(() => updateArrowVisibility(scrollContainer, leftArrow, rightArrow), 350);
        });

        // Listen for scroll events
        scrollContainer.addEventListener('scroll', () => {
            updateArrowVisibility(scrollContainer, leftArrow, rightArrow);
        }, { passive: true });

        // Initial visibility
        updateArrowVisibility(scrollContainer, leftArrow, rightArrow);

        rowContainer.dataset.scrollArrowsAdded = 'true';
        log('Arrows added to row container');
    }

    // Process all meta row containers
    function processRows() {
        // Target meta-row-container which contains the horizontal lists
        const rowContainers = document.querySelectorAll('[class*="meta-row-container"]');
        log('Found row containers:', rowContainers.length);

        rowContainers.forEach((row, index) => {
            log('Processing row', index);
            addArrowsToRow(row);
        });

        // Also check for board content containers (discover page)
        const boardContainers = document.querySelectorAll('[class*="board-content-container"]');
        log('Found board containers:', boardContainers.length);

        boardContainers.forEach((container) => {
            if (container.dataset.scrollArrowsAdded) return;

            const isScrollable = container.scrollWidth > container.clientWidth + 20;
            if (!isScrollable) return;

            const parent = container.parentElement;
            if (!parent) return;

            parent.classList.add('scroll-arrows-wrapper');

            const leftArrow = createArrow('left');
            const rightArrow = createArrow('right');

            parent.appendChild(leftArrow);
            parent.appendChild(rightArrow);

            leftArrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                container.scrollTo({
                    left: container.scrollLeft - SCROLL_AMOUNT,
                    behavior: 'smooth'
                });
                setTimeout(() => updateArrowVisibility(container, leftArrow, rightArrow), 350);
            });

            rightArrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                container.scrollTo({
                    left: container.scrollLeft + SCROLL_AMOUNT,
                    behavior: 'smooth'
                });
                setTimeout(() => updateArrowVisibility(container, leftArrow, rightArrow), 350);
            });

            container.addEventListener('scroll', () => {
                updateArrowVisibility(container, leftArrow, rightArrow);
            }, { passive: true });

            updateArrowVisibility(container, leftArrow, rightArrow);
            container.dataset.scrollArrowsAdded = 'true';
        });
    }

    // Initialize
    function init() {
        log('Initializing scroll arrows plugin');
        injectStyles();

        // Initial processing after a delay
        setTimeout(processRows, 1000);

        // Watch for DOM changes
        const observer = new MutationObserver(() => {
            setTimeout(processRows, 500);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Periodic check for dynamically loaded content
        setInterval(processRows, 3000);
    }

    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
