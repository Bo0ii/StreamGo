import { homedir } from "os";
import { join, dirname } from "path";

class Properties {
    public static themeLinkSelector: string = "head > link[rel=stylesheet]";

    private static baseDataPath: string = process.platform === "win32"
        ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
        : process.platform === "darwin"
            ? join(homedir(), "Library", "Application Support")
            : join(homedir(), ".config");

    public static enhancedPath = join(Properties.baseDataPath, "streamgo");

    // User-installed plugins/themes (in user config directory)
    public static themesPath = join(Properties.enhancedPath, "themes");
    public static pluginsPath = join(Properties.enhancedPath, "plugins");

    // Bundled plugins/themes (shipped with the app)
    // In dev: dist/plugins and dist/themes
    // In production: resources/plugins and resources/themes
    private static isPackaged = __dirname.includes("app.asar");

    public static bundledPluginsPath = Properties.isPackaged
        ? join(process.resourcesPath, "plugins")
        : join(dirname(__dirname), "plugins");

    public static bundledThemesPath = Properties.isPackaged
        ? join(process.resourcesPath, "themes")
        : join(dirname(__dirname), "themes");
}

export default Properties;
