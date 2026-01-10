import TemplateCache from '../../utils/templateCache';

export function getAboutCategoryTemplate(
    version: string,
    checkForUpdatesOnStartup: boolean,
    discordRichPresence: boolean,
    enableTransparentThemes: boolean,
    customPlayerPath: string = '',
    playerStatus: string = ''
): string {
    let template = TemplateCache.load(__dirname, 'about-category');

    // Show custom path container if a custom path is set
    const showCustomPath = customPlayerPath.length > 0 ? 'block' : 'none';

    return template
        .replace("{{ version }}", version)
        .replace("{{ checkForUpdatesOnStartup }}", checkForUpdatesOnStartup ? "checked" : "")
        .replace("{{ discordrichpresence }}", discordRichPresence ? "checked" : "")
        .replace("{{ enableTransparentThemes }}", enableTransparentThemes ? "checked" : "")
        .replace("{{ customPathDisplay }}", showCustomPath)
        .replace("{{ customPath }}", customPlayerPath)
        .replace("{{ playerStatus }}", playerStatus);
}
