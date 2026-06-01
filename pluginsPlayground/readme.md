# KoBar Plugins Playground

This directory is dedicated for testing the plugins (extensions) you develop for KoBar.

## How to Use?

1. Copy or create the main folder of the extension you developed in this directory (`pluginsPlayground`).
2. The folder must contain a valid `manifest.json` and `index.js` (or the file specified as `entry` in the manifest file).
3. When KoBar is running, the extensions here are automatically detected and appear in the app's Plugins tab.
4. To prevent conflicts and easily distinguish them, the names of the extensions loaded from here are automatically prefixed with a **[DEV]** tag and are considered **enabled** by default.

Happy coding!
