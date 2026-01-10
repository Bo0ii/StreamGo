import TemplateCache from '../../utils/templateCache';
import MetaData from '../../interfaces/MetaData';

export function getPluginItemTemplate(
    filename: string, 
    metaData: MetaData,
    checked: boolean
): string {
    let template = TemplateCache.load(__dirname, 'plugin-item');
    
    // Replace metadata placeholders
    const metaKeys = ['name', 'description', 'author', 'version'] as const;
    metaKeys.forEach(key => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        template = template.replace(regex, metaData[key] || '');
    });

    // Add "Enhanced by the author B00ii" in red for Enhanced Video Player (author Fxy)
    let enhancedByText = '';
    if (metaData.name === 'Enhanced Video Player' && (metaData.author?.includes('Fxy') || metaData.author?.includes('FXY'))) {
        enhancedByText = '<br><span style="color: red; font-size: 0.9em;"><b>Enhanced by the author B00ii</b></span>';
    }

    return template
        .replace("{{ checked }}", checked ? "checked" : "")
        .replace(/\{\{\s*fileName\s*\}\}/g, filename)
        .replace("{{ enhancedByText }}", enhancedByText);
}
