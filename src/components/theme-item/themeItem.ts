import TemplateCache from '../../utils/templateCache';
import MetaData from '../../interfaces/MetaData';

export function getThemeItemTemplate(
    filename: string,
    metaData: MetaData,
    applied: boolean
): string {
    let template = TemplateCache.load(__dirname, 'theme-item');

    // Replace metadata placeholders
    const metaKeys = ['name', 'description', 'author', 'version'] as const;
    metaKeys.forEach(key => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        template = template.replace(regex, metaData[key] || '');
    });

    // Add "Enhanced by Bo0ii" for liquid-glass theme
    let enhancedByText = '';
    if (filename === 'liquid-glass.theme.css' || metaData.author?.includes('Fxy') || metaData.author?.includes('MOERA1') || metaData.author?.includes('Moerat')) {
        enhancedByText = '<br><span style="font-size: 0.85em; color: rgba(255, 255, 255, 0.7);">Enhanced by Bo0ii</span>';
    }

    // Add locked badge for locked themes (e.g., liquid-glass)
    const isLocked = metaData.locked === true;
    const lockedBadge = isLocked ? '<span style="font-size: 0.75em; color: #f5bf42; margin-left: 8px; background: rgba(245, 191, 66, 0.15); padding: 2px 6px; border-radius: 4px;">DEFAULT</span>' : '';

    return template
        .replace("{{ disabled }}", applied ? "disabled" : "")
        .replace(/\{\{\s*fileName\s*\}\}/g, filename)
        .replace("{{ label }}", applied ? "Applied" : "Apply")
        .replace("{{ buttonClass }}", applied ? "uninstall-button-container-oV4Yo" : "install-button-container-yfcq5")
        .replace("{{ enhancedByText }}", enhancedByText)
        .replace("{{ lockedBadge }}", lockedBadge);
}
