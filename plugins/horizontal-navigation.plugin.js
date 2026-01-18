/**
 * @name Horizontal Navigation
 * @description Moves your vertical navigation bar to a horizontal position.
 * @version 1.0.0
 * @author Fxy
 */

let cachedNavbars = new Map();

function moveNavbar(verticalNavbar, targetParent) {
    if (!verticalNavbar || !targetParent) return;

    // Move instantly - no visibility toggle to avoid flicker
    if (verticalNavbar.parentElement !== targetParent) {
        targetParent.appendChild(verticalNavbar);
    }
}

function fixAllNavbars() {
    const verticalNavbars = Array.from(document.querySelectorAll('[class*="vertical-nav-bar"]'));

    verticalNavbars.forEach(vNav => {
        if (!cachedNavbars.has(vNav) || !document.body.contains(cachedNavbars.get(vNav))) {
            cachedNavbars.set(vNav, vNav.parentElement);
        }
        const originalParent = cachedNavbars.get(vNav);

        const hNav = vNav.closest('div')?.querySelector('[class*="horizontal-nav-bar"]');
        const horizontalVisible = hNav?.offsetParent !== null;
        const originalVisible = originalParent?.offsetParent !== null;

        if (horizontalVisible) {
            moveNavbar(vNav, hNav);
            hNav.querySelectorAll("a").forEach(link => {
                link.querySelector("svg")?.remove();
                const label = link.querySelector("div");
                if (label) label.className = "nav-label";
            });
        } else if (!horizontalVisible && originalVisible) {
            moveNavbar(vNav, originalParent);
        }
    });
}

// MutationObserver handles all DOM changes - INSTANT response
let rafId;
const observer = new MutationObserver(() => {
    // Cancel any pending animation frame
    if (rafId) cancelAnimationFrame(rafId);
    // Use requestAnimationFrame for immediate next-frame execution
    rafId = requestAnimationFrame(() => {
        fixAllNavbars();
        // Double-tap for safety
        requestAnimationFrame(fixAllNavbars);
    });
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true });

// Initial call - immediate and on next frames
fixAllNavbars();
requestAnimationFrame(fixAllNavbars);
requestAnimationFrame(() => requestAnimationFrame(fixAllNavbars));