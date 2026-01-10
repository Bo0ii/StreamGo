const fs = require('fs');
const path = require('path');

// Copy .html and .js files from src/components/** to dist/components/**
function copyFiles(srcDir, destDir) {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    
    const items = fs.readdirSync(srcDir);
    
    items.forEach(item => {
        const srcPath = path.join(srcDir, item);
        const destPath = path.join(destDir, item);
        
        const stat = fs.statSync(srcPath);
        
        if (stat.isDirectory()) {
            copyFiles(srcPath, destPath);
        } else if (stat.isFile() && !srcPath.endsWith('.ts')) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${srcPath} to ${destPath}`);
        }
    });
}

// Generate version file from package.json (or copy existing if it exists and matches)
const packageJsonPath = path.join(__dirname, 'package.json');
const versionFileDest = path.join(__dirname, 'dist', 'version');

if (fs.existsSync(packageJsonPath)) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.version) {
            // Write version to dist/version
            fs.writeFileSync(versionFileDest, packageJson.version, 'utf-8');
            console.log(`Generated version file from package.json: ${packageJson.version}`);
            
            // Also update root version file if it exists (or create it)
            const rootVersionFile = path.join(__dirname, 'version');
            fs.writeFileSync(rootVersionFile, packageJson.version, 'utf-8');
        }
    } catch (error) {
        console.error(`Failed to read version from package.json: ${error.message}`);
        // Fallback: copy existing version file if it exists
        const versionFileSrc = path.join(__dirname, 'version');
        if (fs.existsSync(versionFileSrc)) {
            fs.copyFileSync(versionFileSrc, versionFileDest);
            console.log(`Copied existing version file: ${versionFileSrc} to ${versionFileDest}`);
        } else {
            console.log('No version file found and failed to read from package.json.');
        }
    }
} else {
    console.log('No package.json found in the root directory.');
}

const srcDir = 'src/components';
const destDir = 'dist/components';

copyFiles(srcDir, destDir);

// Copy bundled plugins from root plugins/ to dist/plugins/
const pluginsSrcDir = path.join(__dirname, 'plugins');
const pluginsDestDir = path.join(__dirname, 'dist', 'plugins');

if (fs.existsSync(pluginsSrcDir)) {
    copyFiles(pluginsSrcDir, pluginsDestDir);
    console.log('Copied bundled plugins to dist/plugins/');
} else {
    console.log('No plugins folder found in the root directory.');
}

// Copy bundled themes from root themes/ to dist/themes/
const themesSrcDir = path.join(__dirname, 'themes');
const themesDestDir = path.join(__dirname, 'dist', 'themes');

if (fs.existsSync(themesSrcDir)) {
    copyFiles(themesSrcDir, themesDestDir);
    console.log('Copied bundled themes to dist/themes/');
} else {
    console.log('No themes folder found in the root directory.');
}