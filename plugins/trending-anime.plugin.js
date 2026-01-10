/**
 * @name Trending Anime
 * @description Adds a Trending Anime row to the homepage displaying top airing anime from MyAnimeList.
 * @version 1.7.1
 * @author Bo0ii
 */

(function() {
    'use strict';

    // Cleanup any existing observer from previous loads
    if (window.trendingAnimeObserver) {
        window.trendingAnimeObserver.disconnect();
        delete window.trendingAnimeObserver;
    }

    // Constants
    const JIKAN_API = 'https://api.jikan.moe/v4/top/anime';
    const FETCH_TIMEOUT = 15000;
    const MAX_ANIME = 25;
    const CACHE_TTL = 600000; // 10 minutes
    const ROW_ID = 'trending-anime-row';
    const DEBUG = false;

    // State
    let animeCache = [];
    let cacheTimestamp = 0;
    let isInitializing = false;

    function log(...args) {
        if (DEBUG) console.log('[TrendingAnime]', ...args);
    }

    // Fallback anime data
    const fallbackAnime = [
        { mal_id: 21, title: 'One Piece', poster: 'https://cdn.myanimelist.net/images/anime/1244/138851l.jpg', score: 8.71, episodes: null, type: 'TV' },
        { mal_id: 51009, title: 'Jujutsu Kaisen Season 2', poster: 'https://cdn.myanimelist.net/images/anime/1792/138022l.jpg', score: 8.55, episodes: 23, type: 'TV' },
        { mal_id: 52991, title: 'Sousou no Frieren', poster: 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg', score: 9.13, episodes: 28, type: 'TV' },
        { mal_id: 55644, title: 'Oshi no Ko Season 2', poster: 'https://cdn.myanimelist.net/images/anime/1077/139569l.jpg', score: 8.21, episodes: 13, type: 'TV' },
        { mal_id: 54898, title: 'Dandadan', poster: 'https://cdn.myanimelist.net/images/anime/1551/142419l.jpg', score: 8.67, episodes: 12, type: 'TV' },
        { mal_id: 52034, title: 'Blue Lock', poster: 'https://cdn.myanimelist.net/images/anime/1258/126929l.jpg', score: 8.12, episodes: 24, type: 'TV' },
        { mal_id: 53887, title: 'Spy x Family Season 2', poster: 'https://cdn.myanimelist.net/images/anime/1506/138982l.jpg', score: 8.45, episodes: 12, type: 'TV' },
        { mal_id: 51019, title: 'Kimetsu no Yaiba: Hashira Training', poster: 'https://cdn.myanimelist.net/images/anime/1565/142733l.jpg', score: 7.86, episodes: 8, type: 'TV' }
    ];

    // CSS Styles - Matching liquid-glass theme EXACTLY
    const STYLES = `
        /* ==================== ROW CONTAINER - Match meta-row-container ==================== */
        .trending-anime-row {
            padding: 0;
            margin: 0;
            position: relative;
            display: flex;
            flex-direction: column;
        }

        /* ==================== ROW HEADER - Match meta-row-header exactly ==================== */
        .trending-anime-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 1rem;
            margin-bottom: 0;
            gap: 1rem;
        }

        .trending-anime-header-left {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .trending-anime-title {
            font-size: 1.4rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.9);
            margin: 0;
            padding: 0 5px;
            letter-spacing: 0;
        }

        .trending-anime-see-all {
            font-size: 0.85rem;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.6);
            text-decoration: none;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s ease;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .trending-anime-see-all:hover {
            color: rgba(255, 255, 255, 0.9);
            background: rgba(255, 255, 255, 0.08);
        }

        .trending-anime-see-all svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }

        /* ==================== SCROLLABLE CONTAINER - Match meta-items-container ==================== */
        .trending-anime-items {
            display: flex;
            gap: 12px;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-behavior: smooth;
            scrollbar-width: none;
            padding: 0.5rem 1rem 1rem 1rem;
            -webkit-overflow-scrolling: touch;
            transform: translate3d(0, 0, 0);
        }

        .trending-anime-items::-webkit-scrollbar {
            display: none;
        }

        /* ==================== CARD - Match meta-item-container with liquid-glass flex sizing ==================== */
        .trending-anime-card {
            /* Match the exact flex formula from liquid-glass: flex: calc(1 / var(--poster-shape-ratio)) 0 250px */
            flex: calc(1 / 0.675) 0 250px;
            cursor: pointer;
            position: relative;
            contain: layout paint style;
            transform: translate3d(0, 0, 0);
            -webkit-transform: translate3d(0, 0, 0);
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
            isolation: isolate;
        }

        .trending-anime-card:hover {
            will-change: transform;
        }

        .trending-anime-card:not(:hover) {
            will-change: auto;
        }

        /* ==================== POSTER - Match poster-container with liquid-glass overlay ==================== */
        .trending-anime-poster-container {
            position: relative;
            width: 100%;
            aspect-ratio: 0.675;
            border-radius: 8px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.03);
        }

        /* Gray overlay on hover - exact match to liquid-glass ::before */
        .trending-anime-poster-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            opacity: 0;
            z-index: 5;
            pointer-events: none;
            transition: opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            border-radius: inherit;
            transform: translate3d(0, 0, 0);
            -webkit-transform: translate3d(0, 0, 0);
            will-change: opacity;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
        }

        .trending-anime-card:hover .trending-anime-poster-container::before {
            opacity: 1;
        }

        /* Disable overlay during scroll */
        body.scrolling-active .trending-anime-card:hover .trending-anime-poster-container::before,
        body.performance-mode .trending-anime-card:hover .trending-anime-poster-container::before {
            opacity: 0;
            background: transparent;
        }

        /* ==================== POSTER IMAGE - Match poster-image exactly ==================== */
        .trending-anime-poster {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 8px;
            transform: translate3d(0, 0, 0);
            -webkit-transform: translate3d(0, 0, 0);
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
            will-change: auto;
            image-rendering: -webkit-optimize-contrast;
        }

        .trending-anime-poster.loading {
            opacity: 0;
        }

        .trending-anime-poster.loaded {
            opacity: 1;
            transition: opacity 0.2s ease;
        }

        /* ==================== PLAY ICON - Match liquid-glass play-icon-layer exactly ==================== */
        .trending-anime-play-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate3d(-50%, -50%, 0);
            -webkit-transform: translate3d(-50%, -50%, 0);
            z-index: 10;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 0;
            width: auto;
            height: auto;
            opacity: 0;
            transition: opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            pointer-events: none;
        }

        .trending-anime-card:hover .trending-anime-play-icon {
            opacity: 1;
        }

        /* Glass morphism play button - exact match to liquid-glass */
        .trending-anime-play-circle {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 999px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.5);
            backdrop-filter: blur(8px) saturate(130%);
            -webkit-backdrop-filter: blur(8px) saturate(130%);
            border: 1px solid rgba(255, 255, 255, 0.2);
            transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            transform: translate3d(0, 0, 0);
            -webkit-transform: translate3d(0, 0, 0);
            will-change: transform;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 3.5rem;
            height: 3.5rem;
        }

        /* Hover state - frosted white glass */
        .trending-anime-card:hover .trending-anime-play-circle {
            background: rgba(255, 255, 255, 0.45);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 -1px 0 rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px) saturate(140%) brightness(105%);
            -webkit-backdrop-filter: blur(10px) saturate(140%) brightness(105%);
            border: 1.5px solid rgba(255, 255, 255, 0.5);
            transform: translate3d(0, 0, 0) scale3d(1.02, 1.02, 1);
            -webkit-transform: translate3d(0, 0, 0) scale3d(1.02, 1.02, 1);
        }

        /* Disable effects during scroll */
        body.scrolling-active .trending-anime-card:hover .trending-anime-play-circle,
        body.performance-mode .trending-anime-card:hover .trending-anime-play-circle {
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            background: rgba(255, 255, 255, 0.2);
            box-shadow: none;
            transform: translate3d(0, 0, 0);
            -webkit-transform: translate3d(0, 0, 0);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .trending-anime-play-circle svg {
            width: 1.4rem;
            height: 1.4rem;
            fill: rgba(255, 255, 255, 0.9);
            margin-left: 2px;
            transition: opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), filter 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }

        .trending-anime-card:hover .trending-anime-play-circle svg {
            fill: rgba(255, 255, 255, 1);
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }

        /* ==================== TITLE BAR - Match title-bar-container exactly ==================== */
        .trending-anime-title-bar {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            height: auto;
            overflow: visible;
            padding: 0;
            position: relative;
        }

        .trending-anime-name {
            margin-top: 0.35rem;
            min-height: 1.3rem;
            font-size: inherit;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.87);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.1;
            margin-bottom: 0;
        }

        /* ==================== LOADING SKELETON ==================== */
        .trending-anime-skeleton {
            background: linear-gradient(90deg,
                rgba(255, 255, 255, 0.03) 25%,
                rgba(255, 255, 255, 0.06) 50%,
                rgba(255, 255, 255, 0.03) 75%
            );
            background-size: 200% 100%;
            animation: anime-skeleton-shimmer 1.5s infinite ease-in-out;
        }

        .trending-anime-skeleton-poster {
            aspect-ratio: 0.675;
            width: 100%;
            border-radius: 8px;
        }

        .trending-anime-skeleton-title {
            height: 14px;
            width: 75%;
            border-radius: 4px;
            margin-top: 0.35rem;
        }

        @keyframes anime-skeleton-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        /* ==================== PLACEHOLDER ==================== */
        .trending-anime-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.03);
            color: rgba(255, 255, 255, 0.15);
            font-size: 2rem;
            border-radius: 8px;
        }

        /* ==================== SCROLL ARROWS ==================== */
        .trending-anime-arrow {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            margin-top: 8px;
            width: 36px;
            height: 36px;
            background: rgba(0, 0, 0, 0.6);
            border-radius: 50%;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20;
            opacity: 0;
            transition: all 0.2s ease;
        }

        .trending-anime-row:hover .trending-anime-arrow:not(.hidden) {
            opacity: 1;
        }

        .trending-anime-arrow:hover {
            background: rgba(0, 0, 0, 0.8);
            transform: translateY(-50%) scale(1.05);
        }

        .trending-anime-arrow-left {
            left: 4px;
        }

        .trending-anime-arrow-right {
            right: 4px;
        }

        .trending-anime-arrow svg {
            width: 16px;
            height: 16px;
            fill: rgba(255, 255, 255, 0.9);
        }

        .trending-anime-arrow.hidden {
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `;

    // Inject CSS styles
    function injectStyles() {
        if (document.getElementById('trending-anime-styles')) return;
        const style = document.createElement('style');
        style.id = 'trending-anime-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
        log('Styles injected');
    }

    // Transform Jikan API data
    function transformAnimeData(item) {
        // Extract year from aired data
        let year = null;
        if (item.aired?.from) {
            year = new Date(item.aired.from).getFullYear();
        } else if (item.year) {
            year = item.year;
        }

        return {
            mal_id: item.mal_id,
            title: item.title_english || item.title,
            poster: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url,
            score: item.score,
            episodes: item.episodes,
            type: item.type || 'TV',
            status: item.status,
            rank: item.rank,
            year: year
        };
    }

    // Fetch top airing anime from Jikan API
    async function fetchTrendingAnime() {
        if (animeCache.length > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL) {
            log('Returning cached anime data');
            return animeCache;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            log('Fetching top airing anime from Jikan API...');
            const response = await fetch(`${JIKAN_API}?filter=airing&limit=${MAX_ANIME}`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            if (data.data && data.data.length > 0) {
                animeCache = data.data.map(transformAnimeData).filter(a => a.poster && a.title);
                cacheTimestamp = Date.now();
                log(`Fetched ${animeCache.length} top airing anime`);
                return animeCache;
            }

            throw new Error('No data returned');
        } catch (error) {
            log('Fetch error:', error.message);
            return fallbackAnime;
        }
    }

    // Check if on homepage
    function isBoardPage() {
        const currentHash = window.location.hash;
        return currentHash === '#/' || currentHash === '' || currentHash === '#';
    }

    function isBoardTabSelected() {
        const boardTab = document.querySelector(
            'a[title="Board"].selected, a[href="#/"].selected, [class*="nav-tab-button-container"][class*="selected"][href="#/"]'
        );
        return boardTab !== null;
    }

    function shouldShowAnimeRow() {
        return isBoardTabSelected() && isBoardPage();
    }

    // Find injection point
    function findInjectionPoint() {
        const boardRows = document.querySelectorAll('[class*="board-row"], [class*="meta-row-container"]');

        if (boardRows.length >= 2) {
            return { element: boardRows[1], position: 'afterend' };
        } else if (boardRows.length > 0) {
            return { element: boardRows[boardRows.length - 1], position: 'afterend' };
        }

        const boardContainer = document.querySelector(
            '.board-container-DTN_b > div > div > div, ' +
            '[class*="board-container"] > div > div > div, ' +
            '[class*="board-container"] > div'
        );

        if (boardContainer) {
            return { element: boardContainer, position: 'afterbegin' };
        }

        return null;
    }

    // SVG icons
    const playIcon = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const arrowRightIcon = `<svg viewBox="0 0 24 24"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>`;
    const arrowLeftIcon = `<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;

    // Create anime card HTML - matching native Stremio structure exactly
    function createAnimeCard(anime) {
        const escapedTitle = anime.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        return `
            <div class="trending-anime-card" data-mal-id="${anime.mal_id}" onclick="window.navigateToAnime(${anime.mal_id}, '${escapedTitle}')">
                <div class="trending-anime-poster-container">
                    <img
                        class="trending-anime-poster loading"
                        src="${anime.poster}"
                        alt="${escapedTitle}"
                        loading="lazy"
                        onload="this.classList.remove('loading'); this.classList.add('loaded');"
                        onerror="this.parentElement.innerHTML = '<div class=\\'trending-anime-placeholder\\'>🎬</div>';"
                    />
                    <div class="trending-anime-play-icon">
                        <div class="trending-anime-play-circle">
                            ${playIcon}
                        </div>
                    </div>
                </div>
                <div class="trending-anime-title-bar">
                    <p class="trending-anime-name" title="${escapedTitle}">${anime.title}</p>
                </div>
            </div>
        `;
    }

    // Create loading skeleton
    function createSkeletonCard() {
        return `
            <div class="trending-anime-card">
                <div class="trending-anime-skeleton trending-anime-skeleton-poster"></div>
                <div class="trending-anime-skeleton trending-anime-skeleton-title"></div>
            </div>
        `;
    }

    // Create the full row HTML
    function createRowHTML(animeList, isLoading = false) {
        const content = isLoading
            ? Array(12).fill(0).map(() => createSkeletonCard()).join('')
            : animeList.map(createAnimeCard).join('');

        return `
            <div class="trending-anime-row" id="${ROW_ID}">
                <div class="trending-anime-header">
                    <div class="trending-anime-header-left">
                        <h2 class="trending-anime-title">Trending Anime</h2>
                    </div>
                    <a class="trending-anime-see-all" onclick="window.navigateToAnimeDiscover()">
                        See All ${arrowRightIcon}
                    </a>
                </div>
                <div class="trending-anime-items" id="trending-anime-container">
                    ${content}
                </div>
                <div class="trending-anime-arrow trending-anime-arrow-left hidden" onclick="event.stopPropagation(); window.scrollTrendingAnime('left')">
                    ${arrowLeftIcon}
                </div>
                <div class="trending-anime-arrow trending-anime-arrow-right" onclick="event.stopPropagation(); window.scrollTrendingAnime('right')">
                    ${arrowRightIcon}
                </div>
            </div>
        `;
    }

    // Navigation handler - search for anime
    window.navigateToAnime = function(malId, title) {
        log('Navigating to anime:', malId, title);
        const searchQuery = encodeURIComponent(title);
        window.location.hash = `#/search?search=${searchQuery}`;
    };

    // Navigate to anime discover/search page
    window.navigateToAnimeDiscover = function() {
        log('Navigating to anime discover');
        // Navigate to discover with anime type selected
        // Try the discover page first, fallback to search
        window.location.hash = '#/discover/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/top?genre=Animation';
    };

    // Scroll handler
    window.scrollTrendingAnime = function(direction) {
        const container = document.getElementById('trending-anime-container');
        if (!container) return;

        const scrollAmount = 500;
        const newScrollLeft = direction === 'left'
            ? container.scrollLeft - scrollAmount
            : container.scrollLeft + scrollAmount;

        container.scrollTo({ left: newScrollLeft, behavior: 'smooth' });
        setTimeout(() => updateScrollArrows(), 350);
    };

    // Update scroll arrow visibility
    function updateScrollArrows() {
        const container = document.getElementById('trending-anime-container');
        const leftArrow = document.querySelector('.trending-anime-arrow-left');
        const rightArrow = document.querySelector('.trending-anime-arrow-right');

        if (!container || !leftArrow || !rightArrow) return;

        const scrollLeft = container.scrollLeft;
        const maxScroll = container.scrollWidth - container.clientWidth;

        leftArrow.classList.toggle('hidden', scrollLeft <= 5);
        rightArrow.classList.toggle('hidden', scrollLeft >= maxScroll - 5);
    }

    // Remove anime row
    function removeAnimeRow() {
        const row = document.getElementById(ROW_ID);
        if (row) {
            row.remove();
            log('Anime row removed');
        }
    }

    // Inject anime row
    async function injectAnimeRow() {
        if (isInitializing) return;
        if (document.getElementById(ROW_ID)) return;
        if (!shouldShowAnimeRow()) return;

        const injection = findInjectionPoint();
        if (!injection) {
            log('No injection point found');
            return;
        }

        isInitializing = true;
        log('Injecting anime row...');

        // Show loading state
        injection.element.insertAdjacentHTML(injection.position, createRowHTML([], true));

        // Setup scroll listener
        const container = document.getElementById('trending-anime-container');
        if (container) {
            container.addEventListener('scroll', () => updateScrollArrows(), { passive: true });
        }

        // Fetch real data
        const animeList = await fetchTrendingAnime();

        // Update with real content
        const existingRow = document.getElementById(ROW_ID);
        if (existingRow && shouldShowAnimeRow()) {
            existingRow.outerHTML = createRowHTML(animeList);

            // Re-setup scroll listener
            const newContainer = document.getElementById('trending-anime-container');
            if (newContainer) {
                newContainer.addEventListener('scroll', () => updateScrollArrows(), { passive: true });
                setTimeout(() => updateScrollArrows(), 100);
            }

            log('Anime row updated with', animeList.length, 'items');
        }

        isInitializing = false;
    }

    // Handle navigation
    function handleNavigation() {
        const shouldShow = shouldShowAnimeRow();
        const rowExists = document.getElementById(ROW_ID);

        if (!shouldShow && rowExists) {
            removeAnimeRow();
            return;
        }

        if (shouldShow && !rowExists) {
            setTimeout(() => injectAnimeRow(), 300);
        }
    }

    // Initialize
    function init() {
        log('Initializing Trending Anime plugin v1.7.1...');
        injectStyles();

        setTimeout(handleNavigation, 1000);

        window.addEventListener('hashchange', handleNavigation);
        window.addEventListener('popstate', () => setTimeout(handleNavigation, 100));

        window.trendingAnimeObserver = new MutationObserver((mutations) => {
            let relevantChange = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.classList?.contains('board-container-DTN_b') ||
                                node.querySelector?.('.board-container-DTN_b') ||
                                node.querySelector?.('[class*="board-row"]') ||
                                node.querySelector?.('[class*="meta-row-container"]')) {
                                relevantChange = true;
                                break;
                            }
                        }
                    }
                }
                if (relevantChange) break;
            }

            if (relevantChange) {
                setTimeout(handleNavigation, 200);
            }
        });

        window.trendingAnimeObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // MutationObserver handles DOM changes - removed redundant 3s polling

        log('Plugin initialized');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }

})();
