/**
 * @name Enhanced External Player
 * @description Run movies and shows in external players like VLC or MPC-HC with auto-detection and seamless integration.
 * @version 1.0.0
 * @author Bo0ii
 */

(function() {
    'use strict';

    const STORAGE_KEYS = {
        EXTERNAL_PLAYER: 'externalPlayer',
        EXTERNAL_PLAYER_PATH: 'externalPlayerPath'
    };

    const PLAYERS = {
        BUILTIN: 'builtin',
        VLC: 'vlc',
        MPCHC: 'mpchc',
        M3U: 'm3u'
    };

    // CSS styles for enhanced external player UI
    const styles = `
        /* External player indicator badge */
        .external-player-badge {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 16px;
            background: rgba(30, 30, 30, 0.9);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: white;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 9999;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
        }

        .external-player-badge.visible {
            opacity: 1;
            transform: translateY(0);
        }

        .external-player-badge .player-icon {
            width: 18px;
            height: 18px;
            fill: #f5c518;
        }

        .external-player-badge .player-name {
            color: #f5c518;
            font-weight: 600;
        }

        /* Enhanced play button styling when external player is active */
        body[data-external-player="vlc"] [class*="play-icon"],
        body[data-external-player="mpchc"] [class*="play-icon"] {
            position: relative;
        }

        body[data-external-player="vlc"] [class*="play-icon"]::after,
        body[data-external-player="mpchc"] [class*="play-icon"]::after {
            content: '';
            position: absolute;
            bottom: -4px;
            right: -4px;
            width: 12px;
            height: 12px;
            background: #f5c518;
            border-radius: 50%;
            border: 2px solid rgba(0, 0, 0, 0.5);
        }

        /* Keyboard shortcut hint */
        .external-player-shortcut-hint {
            position: fixed;
            bottom: 70px;
            right: 20px;
            padding: 6px 12px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            border-radius: 6px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 11px;
            z-index: 9998;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }

        .external-player-shortcut-hint.visible {
            opacity: 1;
        }

        .external-player-shortcut-hint kbd {
            background: rgba(255, 255, 255, 0.15);
            padding: 2px 6px;
            border-radius: 3px;
            margin: 0 2px;
            font-family: monospace;
        }
    `;

    // Player icons (SVG)
    const playerIcons = {
        vlc: `<svg class="player-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 1.5L3 22.5h18L12 1.5zm0 5.5l5.5 12h-11L12 7z"/>
        </svg>`,
        mpchc: `<svg class="player-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5v14l11-7L8 5z"/>
        </svg>`
    };

    // Inject styles
    function injectStyles() {
        if (document.getElementById('enhanced-external-player-styles')) return;
        const styleEl = document.createElement('style');
        styleEl.id = 'enhanced-external-player-styles';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // Create player badge
    function createPlayerBadge() {
        if (document.getElementById('external-player-badge')) return;

        const badge = document.createElement('div');
        badge.id = 'external-player-badge';
        badge.className = 'external-player-badge';
        document.body.appendChild(badge);
        return badge;
    }

    // Update badge visibility and content
    function updateBadge() {
        const badge = document.getElementById('external-player-badge') || createPlayerBadge();
        if (!badge) return;

        const player = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);

        if (player === PLAYERS.VLC) {
            badge.innerHTML = `${playerIcons.vlc}<span>Playing in <span class="player-name">VLC</span></span>`;
            badge.classList.add('visible');
            document.body.setAttribute('data-external-player', 'vlc');
        } else if (player === PLAYERS.MPCHC) {
            badge.innerHTML = `${playerIcons.mpchc}<span>Playing in <span class="player-name">MPC-HC</span></span>`;
            badge.classList.add('visible');
            document.body.setAttribute('data-external-player', 'mpchc');
        } else {
            badge.classList.remove('visible');
            document.body.removeAttribute('data-external-player');
        }
    }

    // Show badge temporarily when changing players
    function showBadgeTemporarily(duration = 3000) {
        const badge = document.getElementById('external-player-badge');
        if (!badge) return;

        badge.classList.add('visible');
        setTimeout(() => {
            const player = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);
            if (player !== PLAYERS.VLC && player !== PLAYERS.MPCHC) {
                badge.classList.remove('visible');
            }
        }, duration);
    }

    // Watch for player route to show badge
    function watchPlayerRoute() {
        const checkRoute = () => {
            const isPlayerRoute = location.href.includes('#/player');
            const badge = document.getElementById('external-player-badge');
            const player = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);

            if (isPlayerRoute && (player === PLAYERS.VLC || player === PLAYERS.MPCHC)) {
                badge?.classList.add('visible');
            } else if (!isPlayerRoute) {
                badge?.classList.remove('visible');
            }
        };

        // Check on hash change
        window.addEventListener('hashchange', checkRoute);

        // Initial check
        checkRoute();
    }

    // Keyboard shortcut to toggle external player
    function setupKeyboardShortcut() {
        document.addEventListener('keydown', (e) => {
            // Alt+E to toggle external player
            if (e.altKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                toggleExternalPlayer();
            }
        });
    }

    // Toggle between built-in and external player
    function toggleExternalPlayer() {
        const current = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);

        if (current === PLAYERS.VLC || current === PLAYERS.MPCHC) {
            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, PLAYERS.BUILTIN);
            showNotification('Switched to built-in player');
        } else {
            // Default to VLC
            localStorage.setItem(STORAGE_KEYS.EXTERNAL_PLAYER, PLAYERS.VLC);
            showNotification('Switched to VLC external player');
        }

        updateBadge();
    }

    // Show a notification
    function showNotification(message) {
        const existing = document.getElementById('external-player-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.id = 'external-player-notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            padding: 12px 20px;
            background: rgba(30, 30, 30, 0.95);
            backdrop-filter: blur(12px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 13px;
            z-index: 99999;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    // Add animation keyframes
    function addAnimations() {
        if (document.getElementById('external-player-animations')) return;
        const style = document.createElement('style');
        style.id = 'external-player-animations';
        style.textContent = `
            @keyframes slideIn {
                from { opacity: 0; transform: translateX(20px); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes slideOut {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(20px); }
            }
        `;
        document.head.appendChild(style);
    }

    // Log current external player status
    function logStatus() {
        const player = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER);
        const customPath = localStorage.getItem(STORAGE_KEYS.EXTERNAL_PLAYER_PATH);

        console.log('[Enhanced External Player] Status:', {
            player: player || 'built-in',
            customPath: customPath || 'auto-detect',
            platform: navigator.platform
        });
    }

    // Initialize
    function init() {
        console.log('[Enhanced External Player] Initializing...');

        injectStyles();
        addAnimations();
        createPlayerBadge();
        updateBadge();
        watchPlayerRoute();
        setupKeyboardShortcut();
        logStatus();

        // Watch for localStorage changes
        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_KEYS.EXTERNAL_PLAYER) {
                updateBadge();
                showBadgeTemporarily();
            }
        });

        // Also watch for direct changes (same tab)
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = function(key, value) {
            originalSetItem.apply(this, arguments);
            if (key === STORAGE_KEYS.EXTERNAL_PLAYER) {
                setTimeout(() => {
                    updateBadge();
                    showBadgeTemporarily();
                }, 100);
            }
        };

        console.log('[Enhanced External Player] Ready! Press Alt+E to toggle external player.');
    }

    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
