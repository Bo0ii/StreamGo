<p align="center">
	<a href="https://stremio.com/">
		<img src="https://github.com/Bo0ii/StreamGo/raw/main/images/icons/main.png" alt="StreamGo Icon" width="128">
	</a>
	<h1 align="center">StreamGo</h1>
	<h5 align="center">This is a community project and is <b>NOT</b> affiliated with Stremio in any way.</h5>
	<p align="center">
		<a href="https://github.com/Bo0ii/StreamGo/releases/latest">
			<img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/Bo0ii/StreamGo/total?style=for-the-badge&color=%237B5BF5">
		</a>
		<a href="https://github.com/Bo0ii/StreamGo/stargazers">
			<img src="https://img.shields.io/github/stars/Bo0ii/StreamGo.svg?style=for-the-badge&color=%237B5BF5" alt="stargazers">
		</a>
		<a href="https://github.com/Bo0ii/StreamGo/releases/latest">
			<img src="https://img.shields.io/github/v/release/Bo0ii/StreamGo?label=Latest%20Release&style=for-the-badge&color=%237B5BF5" alt="Latest Version">
		</a>
		<br>
		<a href="https://nodejs.org/">
			<img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="NodeJS">
		</a>
		<a href="https://www.typescriptlang.org/">
			<img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
		</a>
		<a href="https://www.electronjs.org/">
			<img src="https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=Electron&logoColor=white" alt="Electron">
		</a>
		<a href="https://developer.mozilla.org/en-US/docs/Web/HTML">
			<img src="https://img.shields.io/badge/HTML-239120?style=for-the-badge&logo=html5&logoColor=white" alt="HTML">
		</a>
		<a href="https://developer.mozilla.org/en-US/docs/Web/CSS">
			<img src="https://img.shields.io/badge/CSS-2965F1?&style=for-the-badge&logo=css3&logoColor=white" alt="CSS">
		</a>
	</p>
</p>

## Table of Contents
- [Table of Contents](#table-of-contents)
- [What is StreamGo?](#what-is-streamgo)
	- [How It Works](#how-it-works)
	- [Features](#features)
- [Exclusive Features](#exclusive-features)
- [Downloads](#downloads)
- [Build From Source](#build-from-source)
- [Themes and Plugins](#themes-and-plugins)
	- [Installing Themes](#installing-themes)
	- [Installing Plugins](#installing-plugins)
- [What Is the Difference Between Plugins and Addons?](#what-is-the-difference-between-plugins-and-addons)
- [Creating Your Own Plugin](#creating-your-own-plugin)
- [Creating Your Own Theme](#creating-your-own-theme)
- [Known Issues](#known-issues)
- [Important Notice](#important-notice)

## What is StreamGo?

StreamGo is an Electron-based [Stremio](https://www.stremio.com/) desktop client with support for plugins and themes. It enhances the default Stremio experience by adding more customization options and integrations.

### How It Works
- It runs the Stremio streaming server automatically in the background.
- It loads [the web version of Stremio](https://web.stremio.com) within an Electron environment.

### Features
- **Themes** - Customize the look and feel of Stremio with different themes to match your style.
- **Plugins** - Extend Stremio's functionality with JavaScript plugins for more features.
- **Built-in Toggleable Discord Rich Presence** - Show what you're watching on Discord with an easy-to-toggle Rich Presence feature.

## Exclusive Features

StreamGo includes several exclusive features that enhance your Stremio experience beyond the standard version:

### Optimized Speed & Performance
StreamGo addresses a major performance issue found in other Stremio clients by implementing extensive optimizations that make the UI feel truly native and smooth:

- **GPU-Accelerated Rendering** - Platform-specific rendering backends (Metal for macOS, D3D11 for Windows, OpenGL for Linux) ensure optimal performance on your system with full GPU acceleration enabled.
- **144Hz+ High Refresh Rate Support** - Optimized for smooth scrolling and transitions on high refresh rate displays (144Hz, 240Hz, and beyond) with unlocked frame rates and disabled VSync for consistent, responsive performance.
- **Intelligent Scroll Optimizations** - Dynamic scroll state detection that automatically disables heavy effects (transitions, shadows, blur) during scrolling for buttery-smooth 200fps+ performance, then re-enables them when idle.
- **Hardware Video Decoding** - Full HEVC/H.265 hardware decoding support for efficient video playback with reduced CPU usage and better battery life on supported hardware.
- **Native-Like Smoothness** - GPU-accelerated compositing, zero-copy rendering, and optimized rasterization pipelines ensure the UI feels as responsive and fluid as a native desktop application, addressing the laggy and janky scrolling issues common in other Stremio clients.
- **Smart Resource Management** - Consolidated observers, RAF-batched handlers, and early DOM loading minimize overhead and ensure fast startup times and responsive interactions.

### Core Systems
- **Automatic Update System** - StreamGo automatically checks for updates and can download and install the latest version directly from within the app, ensuring you always have the newest features and bug fixes.
- **Automatic Stremio Service Download & Installation** - The app automatically detects if Stremio Service is missing and offers to download and install it for you, with support for Windows, macOS, and Linux (including Debian, RPM, and Flatpak distributions).

### Built-in Plugins by Bo0ii
- **Playback Preview** - Netflix-style trailer preview system that automatically plays trailers when you hover over movie or TV show posters, giving you a quick preview before selecting content.
- **Card Hover Info** - Enhanced movie and show cards that display IMDb ratings and release dates when you hover over them, providing instant information at a glance.
- **Enhancements Tweaks** - A comprehensive plugin that adds interface tweaks, player enhancements, and subtitle customization options all in one package.
- **Enhanced External Player** - Seamlessly run movies and shows in external players like VLC or MPC-HC with automatic detection and smooth integration, giving you more control over your viewing experience.

### Other Exclusive Features
- **Built-in Discord Rich Presence** - Toggleable Discord Rich Presence integration that displays what you're watching on Discord, allowing friends to see your current activity (can be enabled/disabled in settings).
- **Extensive Bug Fixes & Optimizations** - Continuous improvements addressing playback issues, cross-platform compatibility, audio track selection, subtitle menu functionality, and many other issues that plague other Stremio clients. Regular updates ensure a stable, polished experience.

## Downloads
You can download the latest version from [the releases tab](https://github.com/Bo0ii/StreamGo/releases).

## Build From Source
1. Clone the repository: `git clone https://github.com/Bo0ii/StreamGo.git`
2. Navigate to the project directory: `cd StreamGo`
3. Install dependencies: `npm install`
4. Build the project with electron-builder:
    - For Windows: `npm run build:win`
    - For Linux (x64): `npm run build:linux:x64`
    - For Linux (arm64): `npm run build:linux:arm64`
    - For macOS (x86): `npm run build:mac:x64`
    - For macOS (arm64): `npm run build:mac:arm64`

## Themes and Plugins

### Installing Themes
1. Go to the settings and scroll down.
2. Click on the "OPEN THEMES FOLDER" button.
3. Move your theme into the opened folder.
4. Restart StreamGo.
5. You should see your theme in the settings with an option to apply it.

### Installing Plugins
1. Go to the settings and scroll down.
2. Click on the "OPEN PLUGINS FOLDER" button.
3. Move your plugin into the opened folder.
4. Restart StreamGo or reload using <kbd>Ctrl</kbd> + <kbd>R</kbd>
5. You should see your plugin in the settings with an option to enable it.

## What Is the Difference Between Plugins and Addons?
- **Addons** are available on the normal version of Stremio. They add catalogs and streams for Stremio.
- **Plugins** add more functionality to Stremio, like new features.

## Creating Your Own Plugin
Plugins are simply JavaScript files running on the client side. Create a JavaScript file with a `.plugin.js` extension and write your code as you would normally for the client side.

You are required to provide metadata for the plugin. Here is an example:

```js
/**
 * @name YourPluginNameHere
 * @description What does your plugin do?
 * @updateUrl your plugin's raw file URL for update checking. (Set this to 'none' if you don't want to provide one)
 * @version VersionHere (e.g., 1.0.0)
 * @author AuthorName
 */
```

**To submit your plugin:** Submit it to the [Community Registry](https://github.com/REVENGE977/stremio-enhanced-registry) by following the instructions there. Your plugin will appear in the "Browse Plugins/Themes" section once approved.

## Creating Your Own Theme
Create a file with a name ending in `.theme.css` and write your CSS modifications there. You can use the devtools (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>) to find an element's class name, etc.

*You are also required to provide metadata in your theme, in the same way as plugins.*

**To submit your theme:** Submit it to the [Community Registry](https://github.com/REVENGE977/stremio-enhanced-registry) by following the instructions there. Your theme will appear in the "Browse Plugins/Themes" section once approved.

**Note:** Only `.plugin.js` and `.theme.css` files will be accepted.

## Known Issues
- Subtitles are not available for **some** streams that have embedded subs. This seems to be an issue with either [Stremio Web](https://web.stremio.com/) or Stremio Service, as it also occurs in the browser. Subtitles do work fine for **most** streams though.
- On macOS, you'll need to bypass Gatekeeper to run the app. This is because the app is not signed.

## Important Notice
**This project is not affiliated in any way with Stremio.**

This project is licensed under the MIT License.

<p align="center">Developed by <a href="https://github.com/Bo0ii">Bo0ii</a> | Forked from <a href="https://github.com/REVENGE977">REVENGE977</a> | Licensed under MIT</p>
<p align="center">Community Registry by <a href="https://github.com/REVENGE977">REVENGE977</a></p>
