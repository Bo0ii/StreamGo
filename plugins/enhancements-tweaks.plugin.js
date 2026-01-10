/**
 * @name Enhancements Tweaks
 * @description Interface tweaks, player enhancements, and subtitle customization all in one plugin.
 * @version 1.0.0
 * @author Bo0ii
 */

class EnhancementsTweaks {
    constructor() {
        this.video = null;
        this.subtitleDelay = 0;
        this.keyboardShortcutsSetup = false;
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        // Apply interface tweaks
        this.applyInterfaceTweaks();
        
        // Setup subtitle controls
        this.setupSubtitleControls();
        
        // Watch for player page navigation
        window.addEventListener('hashchange', () => {
            if (location.href.includes('#/player')) {
                // Wait longer to ensure video is initialized
                setTimeout(() => {
                    this.injectControlBarButtons();
                    this.setupPlayerControls();
                }, 2000);
            } else {
                // Clean up when leaving player page
                this.cleanup();
            }
        });

        // Initial setup if already on player page - wait for video to be ready
        if (location.href.includes('#/player')) {
            this.waitForVideoAndInject();
        }
    }
    
    waitForVideoAndInject() {
        // Wait for video element to exist and be ready - but don't interfere with playback
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max wait
        let injected = false;
        
        const checkAndInject = setInterval(() => {
            attempts++;
            const video = document.querySelector('video');
            const controlBar = document.querySelector('.control-bar-buttons-container-SWhkU') ||
                             document.querySelector('[class*="control-bar-buttons-container"]');
            
            // Wait until video has loaded some metadata before injecting
            if (video && controlBar && attempts > 15 && !injected) {
                // Video exists and control bar exists, now inject buttons
                // But only if video is not currently loading/playing to avoid interference
                try {
                    injected = true;
                    clearInterval(checkAndInject);
                    this.injectControlBarButtons();
                    // Delay player controls setup to not interfere with playback
                    setTimeout(() => {
                        this.setupPlayerControls();
                    }, 1000);
                } catch (error) {
                    console.error('[EnhancementsTweaks] Error during injection:', error);
                    injected = false;
                }
            } else if (attempts >= maxAttempts) {
                clearInterval(checkAndInject);
            }
        }, 100);
        
        // Also set up a one-time observer for when control bar appears
        // But make it very selective to avoid interfering with video
        const observer = new MutationObserver((mutations) => {
            // Only react to additions, not removals
            const hasAdditions = mutations.some(m => m.addedNodes.length > 0);
            if (!hasAdditions || injected) return;
            
            const controlBar = document.querySelector('.control-bar-buttons-container-SWhkU') ||
                             document.querySelector('[class*="control-bar-buttons-container"]');
            const video = document.querySelector('video');
            
            // Only inject if control bar exists, video exists, and buttons aren't already injected
            // And make sure we don't interfere with video playback
            if (controlBar && video && !controlBar.querySelector('.enhanced-controls-group')) {
                // Wait a bit to ensure video playback has started
                setTimeout(() => {
                    if (!injected && location.href.includes('#/player')) {
                        try {
                            injected = true;
                            this.injectControlBarButtons();
                            this.setupPlayerControls();
                        } catch (error) {
                            console.error('[EnhancementsTweaks] Error during observer injection:', error);
                            injected = false;
                        }
                    }
                }, 2000);
            }
        });
        
        // Only observe a very specific container, not the entire body
        const playerContainer = document.querySelector('[class*="player-container"]');
        
        if (playerContainer) {
            observer.observe(playerContainer, { 
                childList: true, 
                subtree: false, // Don't observe subtree to reduce interference
                attributes: false
            });
            
            // Disconnect observer after 30 seconds to prevent memory leaks
            setTimeout(() => observer.disconnect(), 30000);
        }
    }
    
    cleanup() {
        // Remove injected buttons when leaving player page
        const buttonGroup = document.querySelector('.enhanced-controls-group');
        if (buttonGroup) {
            buttonGroup.remove();
        }
        this.video = null;
        this.keyboardShortcutsSetup = false;
        
        // Remove keyboard handler
        if (this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
            this.keyboardHandler = null;
        }
    }

    applyInterfaceTweaks() {
        // This will be handled by the existing tweaks-category functionality
        // The plugin just ensures the functionality is available
        let styleEl = document.getElementById('enhanced-tweaks-plugin-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-tweaks-plugin-style';
            document.head.appendChild(styleEl);
        }

        const fullHeightBackground = localStorage.getItem('fullHeightBackground') === 'true';
        const hidePosterHover = localStorage.getItem('hidePosterHover') === 'true';
        const hideContextDots = localStorage.getItem('hideContextDots') === 'true';
        const roundedPosters = localStorage.getItem('roundedPosters') === 'true';

        let css = `
            /* Hide old player overlay */
            #enhanced-player-overlay {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                z-index: -1 !important;
            }
        `;

        if (fullHeightBackground) {
            css += `
                [class*="hero-container"] {
                    height: 100vh !important;
                    margin-top: 0 !important;
                }
            `;
        }

        if (hidePosterHover) {
            css += `
                [class*="meta-item-container"]:hover {
                    background-color: transparent !important;
                }
            `;
        }

        if (hideContextDots) {
            css += `
                [class*="menu-button-container"],
                [class*="context-menu"] {
                    display: none !important;
                }
            `;
        }

        if (roundedPosters) {
            css += `
                [class*="poster-image"],
                [class*="poster-container"] {
                    border-radius: 8px !important;
                }
            `;
        }

        styleEl.textContent = css;
    }

    injectControlBarButtons() {
        // Don't inject if not on player page
        if (!location.href.includes('#/player')) {
            return;
        }
        
        // Find the control bar buttons container
        const controlBarContainer = document.querySelector('.control-bar-buttons-container-SWhkU') ||
                                   document.querySelector('[class*="control-bar-buttons-container"]') ||
                                   document.querySelector('[class*="control-bar"] [class*="buttons"]');

        if (!controlBarContainer) {
            return;
        }

        // Check if buttons are already injected
        if (controlBarContainer.querySelector('.enhanced-controls-group')) {
            return;
        }

        // Get video element - don't block if video isn't ready yet
        this.video = document.querySelector('video');
        // Continue even if video isn't ready - it will be set up when it becomes available

        // Create button container wrapper
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'enhanced-controls-group';
        buttonGroup.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-left: 8px;';

        // Skip Intro Button
        const skipIntroBtn = this.createControlButton('enhanced-skip-intro-btn', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M5.59,7.41L10.18,12L5.59,16.59L7,18L13,12L7,6L5.59,7.41M16,6H18V18H16V6Z"/>
            </svg>
        `, 'Skip Intro (Shift+Left)', () => this.skipIntro());

        // Skip Outro Button
        const skipOutroBtn = this.createControlButton('enhanced-skip-outro-btn', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z"/>
            </svg>
        `, 'Skip Outro (Shift+Right)', () => this.skipOutro());

        // Speed Control
        const speedControl = this.createSpeedControl();

        // Screenshot Button
        const screenshotBtn = this.createControlButton('enhanced-screenshot-btn', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z"/>
            </svg>
        `, 'Screenshot (S)', () => this.takeScreenshot());

        // Subtitle Controls
        const subtitleControls = this.createSubtitleControls();

        // Add buttons to group
        buttonGroup.appendChild(skipIntroBtn);
        buttonGroup.appendChild(skipOutroBtn);
        buttonGroup.appendChild(speedControl);
        buttonGroup.appendChild(screenshotBtn);
        buttonGroup.appendChild(subtitleControls);

        // Insert after existing buttons (but don't interfere with video)
        try {
            controlBarContainer.appendChild(buttonGroup);
            
            // Inject styles to hide old overlay and style new buttons
            this.injectControlBarStyles();
            
            // Setup keyboard shortcuts only once
            if (!this.keyboardShortcutsSetup) {
                this.setupKeyboardShortcuts();
                this.keyboardShortcutsSetup = true;
            }
        } catch (error) {
            console.error('[EnhancementsTweaks] Error injecting control bar buttons:', error);
        }
    }

    createControlButton(id, innerHTML, title, onClick) {
        const button = document.createElement('div');
        button.id = id;
        button.className = 'control-bar-button-FQUsj button-container-zVLH6 enhanced-control-bar-button';
        button.innerHTML = innerHTML;
        button.title = title;
        button.style.cssText = 'display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 4px 6px;';
        
        // Make sure SVG icons match native button style - use icon-qy6I6 class for proper sizing
        const svg = button.querySelector('svg');
        if (svg) {
            // The icon-qy6I6 class will handle sizing via CSS (width: 2.3rem, height: 2.3rem from theme)
            // But we'll make them smaller and bolder to match native buttons better
            svg.style.color = 'white';
            svg.style.fill = 'currentColor';
        }
        
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return button;
    }

    createSpeedControl() {
        const container = document.createElement('div');
        container.className = 'enhanced-speed-control';
        container.style.cssText = 'display: flex; align-items: center; gap: 4px; margin: 0 4px;';

        const select = document.createElement('select');
        select.className = 'enhanced-speed-select';
        select.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            padding: 4px 8px;
            color: white;
            font-size: 12px;
            cursor: pointer;
            outline: none;
        `;

        [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(speed => {
            const option = document.createElement('option');
            option.value = speed.toString();
            option.textContent = `${speed}x`;
            if (speed === 1) option.selected = true;
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            this.setPlaybackSpeed(parseFloat(select.value));
        });

        // Restore saved speed
        const savedSpeed = localStorage.getItem('playbackSpeed') || '1';
        select.value = savedSpeed;
        if (this.video) {
            this.video.playbackRate = parseFloat(savedSpeed);
        }

        container.appendChild(select);
        return container;
    }

    createSubtitleControls() {
        const container = document.createElement('div');
        container.className = 'enhanced-subtitle-controls';
        container.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-left: 4px;';

        // Subtitle delay minus
        const delayMinus = this.createControlButton('enhanced-sub-delay-minus', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M19,13H5V11H19V13Z"/>
            </svg>
        `, 'Subtitle Delay -0.5s (G)', () => {
            this.adjustSubtitleDelay(-0.5);
        });

        // Subtitle delay display
        const delayDisplay = document.createElement('span');
        delayDisplay.id = 'enhanced-sub-delay-display';
        delayDisplay.textContent = '0.0s';
        delayDisplay.style.cssText = 'font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.9); min-width: 35px; text-align: center;';

        // Subtitle delay plus
        const delayPlus = this.createControlButton('enhanced-sub-delay-plus', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
            </svg>
        `, 'Subtitle Delay +0.5s (H)', () => {
            this.adjustSubtitleDelay(0.5);
        });

        // Subtitle size control (simple +/- buttons for now)
        const sizeMinus = this.createControlButton('enhanced-sub-size-minus', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M19,13H5V11H19V13Z"/>
            </svg>
        `, 'Decrease Subtitle Size', () => {
            this.adjustSubtitleSize(-2);
        });

        const sizePlus = this.createControlButton('enhanced-sub-size-plus', `
            <svg viewBox="0 0 24 24" class="icon-qy6I6" fill="currentColor">
                <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
            </svg>
        `, 'Increase Subtitle Size', () => {
            this.adjustSubtitleSize(2);
        });

        container.appendChild(delayMinus);
        container.appendChild(delayDisplay);
        container.appendChild(delayPlus);
        container.appendChild(sizeMinus);
        container.appendChild(sizePlus);

        return container;
    }

    setupPlayerControls() {
        if (!this.video) {
            this.video = document.querySelector('video');
        }
        
        if (this.video) {
            // Only set playback speed if video is ready
            const savedSpeed = localStorage.getItem('playbackSpeed') || '1';
            if (this.video.readyState >= 2) {
                this.video.playbackRate = parseFloat(savedSpeed);
            } else {
                this.video.addEventListener('loadedmetadata', () => {
                    this.video.playbackRate = parseFloat(savedSpeed);
                }, { once: true });
            }
            
            // Apply subtitle styles
            this.applySubtitleStyle();
        } else {
            // Apply subtitle styles even if video isn't ready yet
            this.applySubtitleStyle();
        }
    }

    setupKeyboardShortcuts() {
        // Remove existing listener if any
        if (this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
        }
        
        // Create new handler
        this.keyboardHandler = (e) => {
            if (!location.href.includes('#/player')) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

            switch (e.key.toLowerCase()) {
                case 's':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        this.takeScreenshot();
                    }
                    break;
                case '[':
                    e.preventDefault();
                    this.decreaseSpeed();
                    break;
                case ']':
                    e.preventDefault();
                    this.increaseSpeed();
                    break;
                case 'arrowleft':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.skipIntro();
                    }
                    break;
                case 'arrowright':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.skipOutro();
                    }
                    break;
                case 'g':
                    e.preventDefault();
                    this.adjustSubtitleDelay(-0.5);
                    break;
                case 'h':
                    e.preventDefault();
                    this.adjustSubtitleDelay(0.5);
                    break;
            }
        };
        
        document.addEventListener('keydown', this.keyboardHandler);
    }

    skipIntro() {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) return;
        }
        const skipAmount = parseInt(localStorage.getItem('skipIntroSeconds') || '85');
        if (this.video.currentTime + skipAmount <= this.video.duration) {
            this.video.currentTime += skipAmount;
            this.showToast(`Skipped ${skipAmount}s`);
        }
    }

    skipOutro() {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) return;
        }
        const remainingTime = this.video.duration - this.video.currentTime;
        if (remainingTime > 30) {
            this.video.currentTime = this.video.duration - 5;
            this.showToast('Skipped to end');
        } else {
            this.showToast('Already near end');
        }
    }

    setPlaybackSpeed(speed) {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) {
                // Video not ready yet, just save the preference
                localStorage.setItem('playbackSpeed', speed.toString());
                return;
            }
        }
        // Only set playback rate if video is loaded and ready
        if (this.video.readyState >= 2) {
            this.video.playbackRate = speed;
        } else {
            // Wait for video to be ready
            this.video.addEventListener('loadedmetadata', () => {
                this.video.playbackRate = speed;
            }, { once: true });
        }
        localStorage.setItem('playbackSpeed', speed.toString());
        this.showToast(`Speed: ${speed}x`);
        
        // Update select if it exists
        const select = document.querySelector('.enhanced-speed-select');
        if (select) {
            select.value = speed.toString();
        }
    }

    decreaseSpeed() {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) return;
        }
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currentSpeed = this.video.playbackRate || 1;
        const currentIndex = speeds.indexOf(currentSpeed);
        if (currentIndex === -1) {
            // Find closest speed
            const closest = speeds.reduce((prev, curr) => 
                Math.abs(curr - currentSpeed) < Math.abs(prev - currentSpeed) ? curr : prev
            );
            const closestIndex = speeds.indexOf(closest);
            if (closestIndex > 0) {
                this.setPlaybackSpeed(speeds[closestIndex - 1]);
            }
        } else if (currentIndex > 0) {
            this.setPlaybackSpeed(speeds[currentIndex - 1]);
        }
    }

    increaseSpeed() {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) return;
        }
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currentSpeed = this.video.playbackRate || 1;
        const currentIndex = speeds.indexOf(currentSpeed);
        if (currentIndex === -1) {
            // Find closest speed
            const closest = speeds.reduce((prev, curr) => 
                Math.abs(curr - currentSpeed) < Math.abs(prev - currentSpeed) ? curr : prev
            );
            const closestIndex = speeds.indexOf(closest);
            if (closestIndex < speeds.length - 1) {
                this.setPlaybackSpeed(speeds[closestIndex + 1]);
            }
        } else if (currentIndex < speeds.length - 1) {
            this.setPlaybackSpeed(speeds[currentIndex + 1]);
        }
    }

    async takeScreenshot() {
        if (!this.video) {
            this.video = document.querySelector('video');
            if (!this.video) return;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth || 1920;
            canvas.height = this.video.videoHeight || 1080;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            
            // Trigger download
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `stremio-screenshot-${timestamp}.png`;
            link.href = dataUrl;
            link.click();
            
            this.showToast('Screenshot saved');
        } catch (err) {
            console.error('Screenshot error:', err);
            this.showToast('Screenshot failed');
        }
    }

    adjustSubtitleDelay(delta) {
        this.subtitleDelay += delta;
        const delayDisplay = document.getElementById('enhanced-sub-delay-display');
        if (delayDisplay) {
            delayDisplay.textContent = `${this.subtitleDelay.toFixed(1)}s`;
        }
        this.applySubtitleDelay();
        this.showToast(`Subtitle delay: ${this.subtitleDelay.toFixed(1)}s`);
    }

    applySubtitleDelay() {
        // This is a visual indication - true subtitle timing requires WebVTT manipulation
        let styleEl = document.getElementById('enhanced-subtitle-delay-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-subtitle-delay-style';
            document.head.appendChild(styleEl);
        }
        // Note: Actual subtitle delay implementation would require modifying WebVTT cues
        styleEl.textContent = '';
    }

    adjustSubtitleSize(delta) {
        const currentSize = parseInt(localStorage.getItem('subtitleFontSize') || '24');
        const newSize = Math.max(16, Math.min(48, currentSize + delta));
        localStorage.setItem('subtitleFontSize', newSize.toString());
        this.applySubtitleStyle();
        this.showToast(`Subtitle size: ${newSize}px`);
    }

    applySubtitleStyle() {
        let styleEl = document.getElementById('enhanced-subtitle-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'enhanced-subtitle-style';
            document.head.appendChild(styleEl);
        }

        const fontSize = localStorage.getItem('subtitleFontSize') || '24';
        const color = localStorage.getItem('subtitleColor') || '#ffffff';
        const bgColor = localStorage.getItem('subtitleBgColor') || 'rgba(0,0,0,0.8)';

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

    setupSubtitleControls() {
        // Watch for subtitle settings changes from the settings page
        window.addEventListener('storage', (e) => {
            if (e.key === 'subtitleFontSize' || e.key === 'subtitleColor' || e.key === 'subtitleBgColor') {
                this.applySubtitleStyle();
            }
        });

        // Initial application
        this.applySubtitleStyle();
    }
    
    injectControlBarStyles() {
        // Only inject once
        if (document.getElementById('enhanced-control-bar-styles')) {
            return;
        }
        
        const style = document.createElement('style');
        style.id = 'enhanced-control-bar-styles';
        style.textContent = `
            /* Hide old player overlay */
            #enhanced-player-overlay {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
            
            /* Style enhanced control bar buttons to match existing ones exactly */
            .enhanced-control-bar-button {
                color: white !important;
                fill: white !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                padding: 4px 6px !important;
                min-width: auto !important;
                min-height: auto !important;
                width: auto !important;
                height: auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 8px !important;
                margin: 0 2px !important;
            }
            
            /* Make icons smaller and bolder to match native buttons */
            /* Override theme's 2.3rem size - make icons smaller to match native control bar buttons */
            .control-bar-buttons-container-SWhkU .enhanced-control-bar-button svg,
            .control-bar-buttons-container-SWhkU .enhanced-control-bar-button .icon-qy6I6,
            [class*="control-bar-buttons-container"] .enhanced-control-bar-button svg,
            [class*="control-bar-buttons-container"] .enhanced-control-bar-button .icon-qy6I6 {
                width: 1.15rem !important;
                height: 1.15rem !important;
                color: white !important;
                fill: white !important;
                stroke: none !important;
            }
            
            /* Make paths bolder by ensuring they're completely filled (bolder than strokes) */
            .enhanced-control-bar-button svg path {
                fill: white !important;
                stroke: none !important;
                stroke-width: 0 !important;
            }
            
            /* Make sure all icon elements (including groups) are white */
            .enhanced-control-bar-button svg * {
                fill: white !important;
                color: white !important;
                stroke: none !important;
            }
            
            .enhanced-control-bar-button:hover {
                background: rgba(255, 255, 255, 0.1) !important;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
            }
            
            /* Subtitle control buttons use same styling */
            .enhanced-subtitle-controls .enhanced-control-bar-button {
                padding: 4px 6px !important;
            }
            
            /* Style speed select to match control bar */
            .enhanced-speed-control select {
                background: rgba(255, 255, 255, 0.1) !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
                border-radius: 4px !important;
                padding: 4px 8px !important;
                color: white !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                outline: none !important;
                min-width: 60px !important;
                height: 32px !important;
            }
            
            .enhanced-speed-control select:hover {
                background: rgba(255, 255, 255, 0.15) !important;
            }
            
            .enhanced-speed-control select option {
                background: rgba(30, 30, 30, 0.95) !important;
                color: white !important;
            }
            
            /* Style subtitle delay display */
            #enhanced-sub-delay-display {
                font-size: 12px !important;
                font-weight: 500 !important;
                color: rgba(255, 255, 255, 0.9) !important;
            }
            
            /* Ensure control group matches spacing */
            .enhanced-controls-group {
                gap: 4px !important;
                margin-left: 8px !important;
                margin-right: 4px !important;
            }
            
            /* Make sure all text in buttons is white */
            .enhanced-subtitle-controls span,
            .enhanced-subtitle-controls #enhanced-sub-delay-display {
                color: white !important;
            }
        `;
        document.head.appendChild(style);
    }

    showToast(message) {
        const existing = document.querySelector('.enhanced-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'enhanced-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10001;
            pointer-events: none;
            animation: fadeInOut 2s ease;
        `;

        // Add animation
        if (!document.getElementById('enhanced-toast-style')) {
            const style = document.createElement('style');
            style.id = 'enhanced-toast-style';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
                    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
}

new EnhancementsTweaks();
