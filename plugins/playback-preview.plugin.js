/**
 * @name Playback Preview
 * @description Netflix-style trailer preview on hover - plays trailers when hovering over posters.
 * @version 1.0.0
 * @author Bo0ii
 */

(function() {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        HOVER_DELAY: 1200,           // 1.2 seconds before showing preview
        API_BASE: 'https://v3-cinemeta.strem.io/meta',
        API_TIMEOUT: 5000,           // 5 second timeout for API requests
        YOUTUBE_EMBED: 'https://www.youtube-nocookie.com/embed',
        PREVIEW_WIDTH: 420,          // Popup width in pixels
        PREVIEW_HEIGHT: 260,         // Popup height in pixels
        ANIMATION_DURATION: 300,     // Expansion animation in ms
        MAX_CACHE_SIZE: 100          // Maximum cached trailer entries
    };

    const SELECTORS = {
        POSTER_CONTAINER: '[class*="poster-container"]',
        META_ITEM: '[class*="meta-item"]'
    };

    const DATA_ATTRS = {
        PROCESSED: 'data-preview-processed',
        MEDIA_ID: 'data-preview-media-id',
        MEDIA_TYPE: 'data-preview-media-type'
    };

    // ==================== CSS STYLES ====================
    const styles = `
        /* Main popup container */
        .playback-preview-popup {
            background: #000;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1);
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Video container - full height */
        .preview-video-container {
            position: relative;
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
        }

        .preview-video-container iframe {
            width: 100%;
            height: 100%;
            border: none;
            pointer-events: none;
        }

        /* Overlay to block YouTube hover elements */
        .preview-iframe-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 5;
            pointer-events: none;
        }

        /* Loading spinner */
        .preview-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 13px;
            z-index: 6;
        }

        .preview-loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(255, 255, 255, 0.2);
            border-top-color: rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            animation: preview-spin 0.8s linear infinite;
        }

        @keyframes preview-spin {
            to { transform: rotate(360deg); }
        }

        /* Unmute button */
        .preview-unmute-button {
            position: absolute;
            bottom: 16px;
            right: 16px;
            width: 36px;
            height: 36px;
            background: rgba(0, 0, 0, 0.6);
            border: 1.5px solid rgba(255, 255, 255, 0.4);
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            z-index: 15;
            pointer-events: auto;
        }

        .preview-unmute-button:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.6);
            transform: scale(1.05);
        }

        .preview-unmute-button svg {
            width: 18px;
            height: 18px;
            color: white;
            fill: currentColor;
        }

        /* Info overlay at bottom - over the video with gradient blur */
        .preview-info {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 12px 16px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            z-index: 10;
            pointer-events: none;
        }

        /* Gradient blur pseudo-element - bottom to top fade */
        .preview-info::before {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 100px;
            /* Blur effect */
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            /* Simple linear mask: bottom 100% -> middle 50% -> top 0% */
            mask-image: linear-gradient(to top,
                black 0%,
                rgba(0, 0, 0, 0.5) 50%,
                transparent 100%);
            -webkit-mask-image: linear-gradient(to top,
                black 0%,
                rgba(0, 0, 0, 0.5) 50%,
                transparent 100%);
            z-index: -1;
            pointer-events: none;
            border-radius: 0 0 12px 12px;
        }

        .preview-title {
            font-size: 15px;
            font-weight: 600;
            color: white;
            margin-bottom: 5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        }

        .preview-meta {
            display: flex;
            gap: 12px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.85);
        }

        .preview-meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        }

        .preview-meta-item.rating {
            color: #f5c518;
        }

        .preview-meta-item.rating svg {
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
        }
    `;

    // ==================== STATE ====================
    const trailerCache = new Map();

    const hoverState = {
        activeTimer: null,
        activePopup: null,
        activeCard: null,
        isMuted: true
    };

    // ==================== UTILITY FUNCTIONS ====================

    // Check if device supports touch (disable on touch devices)
    function isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    // Inject CSS styles into document
    function injectStyles() {
        if (document.getElementById('playback-preview-css')) return;
        const styleEl = document.createElement('style');
        styleEl.id = 'playback-preview-css';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // ==================== MEDIA ID EXTRACTION ====================

    function extractMediaInfo(posterElement) {
        // Strategy 1: Check parent anchor href for detail URL
        // Format: #/detail/{type}/{id} or href containing /detail/
        const anchor = posterElement.closest('a[href*="/detail/"]') ||
                       posterElement.querySelector('a[href*="/detail/"]');

        if (anchor) {
            const href = anchor.getAttribute('href') || '';
            const match = href.match(/\/detail\/(movie|series)\/(tt\d{7,})/);
            if (match) {
                return { type: match[1], id: match[2] };
            }
        }

        // Strategy 2: Check all images in poster for IMDB ID in src
        // Metahub URLs contain the IMDB ID
        const images = posterElement.querySelectorAll('img');
        for (const img of images) {
            const src = img.src || img.getAttribute('src') || '';
            const imdbMatch = src.match(/tt\d{7,}/);
            if (imdbMatch) {
                // Try to determine type from URL or context
                const type = src.includes('poster') || src.includes('movie') ? 'movie' : 'series';
                return { type, id: imdbMatch[0] };
            }
        }

        // Strategy 3: Check meta-item container for any links with IMDB ID
        const metaItem = posterElement.closest(SELECTORS.META_ITEM);
        if (metaItem) {
            const links = metaItem.querySelectorAll('a[href*="tt"]');
            for (const link of links) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/(movie|series)\/(tt\d{7,})/);
                if (match) {
                    return { type: match[1], id: match[2] };
                }
                // Just IMDB ID without type
                const idMatch = href.match(/tt\d{7,}/);
                if (idMatch) {
                    return { type: 'movie', id: idMatch[0] };
                }
            }
        }

        // Strategy 4: Check data attributes
        const dataId = posterElement.getAttribute('data-id') ||
                       posterElement.closest('[data-id]')?.getAttribute('data-id');
        if (dataId && dataId.match(/^tt\d{7,}$/)) {
            return { type: 'movie', id: dataId };
        }

        return null;
    }

    // ==================== API FETCHING ====================

    function addToCache(key, value) {
        if (trailerCache.size >= CONFIG.MAX_CACHE_SIZE) {
            // Remove oldest entry
            const firstKey = trailerCache.keys().next().value;
            trailerCache.delete(firstKey);
        }
        trailerCache.set(key, value);
    }

    async function fetchTrailerData(mediaId, mediaType) {
        const cacheKey = `${mediaType}-${mediaId}`;

        // Check cache first
        if (trailerCache.has(cacheKey)) {
            return trailerCache.get(cacheKey);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

            const response = await fetch(
                `${CONFIG.API_BASE}/${mediaType}/${mediaId}.json`,
                { signal: controller.signal }
            );

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.log(`[PlaybackPreview] API returned ${response.status} for ${mediaId}`);
                addToCache(cacheKey, null);
                return null;
            }

            const data = await response.json();
            const meta = data.meta;

            if (!meta) {
                addToCache(cacheKey, null);
                return null;
            }

            // Extract YouTube trailer ID
            // Prefer trailerStreams, fallback to trailers array
            let youtubeId = null;

            if (meta.trailerStreams && meta.trailerStreams.length > 0) {
                youtubeId = meta.trailerStreams[0].ytId;
            } else if (meta.trailers && meta.trailers.length > 0) {
                youtubeId = meta.trailers[0].source;
            }

            const result = {
                youtubeId,
                title: meta.name || meta.title || 'Unknown',
                year: meta.year ? meta.year.toString() : null,
                rating: meta.imdbRating || null,
                description: meta.description || null
            };

            addToCache(cacheKey, result);
            return result;

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`[PlaybackPreview] Request timed out for ${mediaId}`);
            } else {
                console.log(`[PlaybackPreview] Fetch error for ${mediaId}:`, error.message);
            }
            // Cache null to prevent retry spam
            addToCache(cacheKey, null);
            return null;
        }
    }

    // ==================== POPUP UI ====================

    // SVG icons
    const ICONS = {
        mutedVolume: `<svg viewBox="0 0 24 24"><path d="M3,9H7L12,4V20L7,15H3V9M16.59,12L14,9.41L15.41,8L18,10.59L20.59,8L22,9.41L19.41,12L22,14.59L20.59,16L18,13.41L15.41,16L14,14.59L16.59,12Z"/></svg>`,
        unmutedVolume: `<svg viewBox="0 0 24 24"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>`,
        star: `<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>`
    };

    function calculatePopupPosition(anchorRect) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 15;

        // Center horizontally relative to anchor
        let left = anchorRect.left + (anchorRect.width / 2) - (CONFIG.PREVIEW_WIDTH / 2);

        // Keep within viewport bounds
        left = Math.max(padding, Math.min(left, viewportWidth - CONFIG.PREVIEW_WIDTH - padding));

        // Position directly on the movie card (centered on it)
        // Center vertically relative to anchor
        let top = anchorRect.top + (anchorRect.height / 2) - (CONFIG.PREVIEW_HEIGHT / 2);

        // Adjust if popup would go outside viewport bounds
        if (top < padding) {
            // Too close to top, shift down
            top = padding;
        } else if (top + CONFIG.PREVIEW_HEIGHT > viewportHeight - padding) {
            // Too close to bottom, shift up
            top = viewportHeight - CONFIG.PREVIEW_HEIGHT - padding;
        }

        return { left, top };
    }

    function createPreviewPopup(trailerData, anchorRect) {
        // Remove any existing preview
        removeExistingPreview();

        const popup = document.createElement('div');
        popup.id = 'playback-preview-popup';
        popup.className = 'playback-preview-popup';

        // Calculate final position
        const position = calculatePopupPosition(anchorRect);

        // Set initial state for animation (match card size/position)
        popup.style.cssText = `
            position: fixed;
            left: ${anchorRect.left}px;
            top: ${anchorRect.top}px;
            width: ${anchorRect.width}px;
            height: ${anchorRect.height}px;
            z-index: 10000;
            opacity: 0;
            transform-origin: center center;
        `;

        // Build YouTube embed URL with parameters
        const youtubeParams = new URLSearchParams({
            autoplay: '1',
            mute: '1',
            controls: '0',
            modestbranding: '1',
            rel: '0',
            showinfo: '0',
            fs: '0',
            playsinline: '1',
            loop: '1',
            playlist: trailerData.youtubeId  // Required for loop to work
        });

        const youtubeUrl = `${CONFIG.YOUTUBE_EMBED}/${trailerData.youtubeId}?${youtubeParams}`;

        // Create content
        popup.innerHTML = `
            <div class="preview-video-container">
                <div class="preview-loading">
                    <div class="preview-loading-spinner"></div>
                    <span>Loading trailer...</span>
                </div>
                <iframe
                    id="preview-youtube-iframe"
                    src="${youtubeUrl}"
                    frameborder="0"
                    allow="autoplay; encrypted-media"
                    style="opacity: 0; transition: opacity 0.3s ease;"
                ></iframe>
                <div class="preview-iframe-overlay"></div>
                <div class="preview-info">
                    <div class="preview-title">${escapeHtml(trailerData.title)}</div>
                    <div class="preview-meta">
                        ${trailerData.year ? `<span class="preview-meta-item">${trailerData.year}</span>` : ''}
                        ${trailerData.rating ? `<span class="preview-meta-item rating">${ICONS.star} ${trailerData.rating}</span>` : ''}
                    </div>
                </div>
                <button class="preview-unmute-button" id="preview-unmute-btn" title="Toggle sound">
                    ${ICONS.mutedVolume}
                </button>
            </div>
        `;

        document.body.appendChild(popup);

        // Setup iframe load handler
        const iframe = popup.querySelector('#preview-youtube-iframe');
        const loadingEl = popup.querySelector('.preview-loading');

        iframe.onload = () => {
            if (loadingEl) loadingEl.style.display = 'none';
            iframe.style.opacity = '1';
        };

        // Setup unmute button handler
        setupUnmuteButton(popup);

        // Trigger expansion animation
        requestAnimationFrame(() => {
            popup.style.transition = `all ${CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
            popup.style.left = `${position.left}px`;
            popup.style.top = `${position.top}px`;
            popup.style.width = `${CONFIG.PREVIEW_WIDTH}px`;
            popup.style.height = `${CONFIG.PREVIEW_HEIGHT}px`;
            popup.style.opacity = '1';
        });

        // Reset muted state
        hoverState.isMuted = true;

        return popup;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function setupUnmuteButton(popup) {
        const unmuteBtn = popup.querySelector('#preview-unmute-btn');
        const iframe = popup.querySelector('#preview-youtube-iframe');

        if (!unmuteBtn || !iframe) return;

        unmuteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Toggle mute by updating iframe src
            const currentSrc = iframe.src;

            if (hoverState.isMuted) {
                iframe.src = currentSrc.replace('mute=1', 'mute=0');
                unmuteBtn.innerHTML = ICONS.unmutedVolume;
                unmuteBtn.title = 'Mute';
            } else {
                iframe.src = currentSrc.replace('mute=0', 'mute=1');
                unmuteBtn.innerHTML = ICONS.mutedVolume;
                unmuteBtn.title = 'Unmute';
            }

            hoverState.isMuted = !hoverState.isMuted;
        });
    }

    function removeExistingPreview() {
        const existing = document.getElementById('playback-preview-popup');
        if (existing) {
            // Stop the video by removing iframe src
            const iframe = existing.querySelector('iframe');
            if (iframe) {
                iframe.src = '';
            }

            // Animate out
            existing.style.opacity = '0';
            existing.style.transform = 'scale(0.95)';
            setTimeout(() => {
                if (existing.parentNode) {
                    existing.remove();
                }
            }, 200);
        }
    }

    // ==================== HOVER STATE MANAGEMENT ====================

    async function handleMouseEnter(posterElement) {
        // Clear any existing timer
        if (hoverState.activeTimer) {
            clearTimeout(hoverState.activeTimer);
            hoverState.activeTimer = null;
        }

        // Start new timer
        hoverState.activeTimer = setTimeout(async () => {
            // Extract media info from poster
            const mediaInfo = extractMediaInfo(posterElement);

            if (!mediaInfo) {
                console.log('[PlaybackPreview] Could not extract media info from poster');
                return;
            }

            console.log(`[PlaybackPreview] Fetching trailer for ${mediaInfo.type}/${mediaInfo.id}`);

            // Fetch trailer data
            const trailerData = await fetchTrailerData(mediaInfo.id, mediaInfo.type);

            if (!trailerData || !trailerData.youtubeId) {
                console.log(`[PlaybackPreview] No trailer available for ${mediaInfo.id}`);
                return;
            }

            // Double-check mouse is still over this card
            if (!posterElement.matches(':hover')) {
                return;
            }

            // Get card position for animation
            const rect = posterElement.getBoundingClientRect();

            // Create and show preview
            hoverState.activePopup = createPreviewPopup(trailerData, rect);
            hoverState.activeCard = posterElement;

        }, CONFIG.HOVER_DELAY);
    }

    function handleMouseLeave(posterElement) {
        // Cancel pending timer
        if (hoverState.activeTimer) {
            clearTimeout(hoverState.activeTimer);
            hoverState.activeTimer = null;
        }

        // Don't immediately hide popup - give time to move to popup
        setTimeout(() => {
            const popup = document.getElementById('playback-preview-popup');

            // If no popup exists or mouse is over popup, don't hide
            if (!popup) return;
            if (popup.matches(':hover')) return;

            // If mouse is back over the card, don't hide
            if (posterElement.matches(':hover')) return;

            // Hide popup
            if (hoverState.activeCard === posterElement) {
                removeExistingPreview();
                hoverState.activePopup = null;
                hoverState.activeCard = null;
            }
        }, 150);
    }

    // Setup global document listener for popup hover handling
    function setupPopupHoverHandling() {
        let popupLeaveTimer = null;

        document.addEventListener('mouseover', (e) => {
            const popup = document.getElementById('playback-preview-popup');
            if (!popup) return;

            // Clear any pending hide timer
            if (popupLeaveTimer) {
                clearTimeout(popupLeaveTimer);
                popupLeaveTimer = null;
            }

            // Check if mouse is over popup or active card
            const isOverPopup = popup.contains(e.target);
            const isOverCard = hoverState.activeCard && hoverState.activeCard.contains(e.target);

            if (!isOverPopup && !isOverCard) {
                // Start timer to hide popup
                popupLeaveTimer = setTimeout(() => {
                    const currentPopup = document.getElementById('playback-preview-popup');
                    if (currentPopup && !currentPopup.matches(':hover') &&
                        (!hoverState.activeCard || !hoverState.activeCard.matches(':hover'))) {
                        removeExistingPreview();
                        hoverState.activePopup = null;
                        hoverState.activeCard = null;
                    }
                }, 300);
            }
        });
    }

    // ==================== INITIALIZATION ====================

    function processAllCards() {
        const cards = document.querySelectorAll(
            `${SELECTORS.POSTER_CONTAINER}:not([${DATA_ATTRS.PROCESSED}])`
        );

        cards.forEach(card => {
            // Ensure position is relative for any potential overlays
            if (window.getComputedStyle(card).position === 'static') {
                card.style.position = 'relative';
            }

            // Add event listeners
            card.addEventListener('mouseenter', () => handleMouseEnter(card));
            card.addEventListener('mouseleave', () => handleMouseLeave(card));

            // Mark as processed
            card.setAttribute(DATA_ATTRS.PROCESSED, 'true');
        });

        if (cards.length > 0) {
            console.log(`[PlaybackPreview] Processed ${cards.length} new poster cards`);
        }
    }

    function init() {
        console.log('[PlaybackPreview] Initializing...');

        // Check for touch device
        if (isTouchDevice()) {
            console.log('[PlaybackPreview] Touch device detected, plugin disabled');
            return;
        }

        // Inject styles
        injectStyles();

        // Initial run after delay (DOM may still be loading)
        setTimeout(processAllCards, 1500);

        // Watch for new cards (infinite scroll, navigation)
        const observer = new MutationObserver(() => {
            // Debounce processing
            clearTimeout(observer.processTimeout);
            observer.processTimeout = setTimeout(processAllCards, 300);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Setup global popup hover handling
        setupPopupHoverHandling();

        // MutationObserver handles dynamic content - removed redundant 5s polling

        // Clean up on navigation
        window.addEventListener('hashchange', () => {
            removeExistingPreview();
            hoverState.activeTimer = null;
            hoverState.activePopup = null;
            hoverState.activeCard = null;
        });

        console.log('[PlaybackPreview] Ready!');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
