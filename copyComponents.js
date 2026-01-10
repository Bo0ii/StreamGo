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

// Copy the 'version' file from the root directory
const versionFileSrc = path.join(__dirname, 'version');
const versionFileDest = path.join(__dirname, 'dist', 'version');

if (fs.existsSync(versionFileSrc)) {
    fs.copyFileSync(versionFileSrc, versionFileDest);
    console.log(`Copied: ${versionFileSrc} to ${versionFileDest}`);
} else {
    console.log('No version file found in the root directory.');
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