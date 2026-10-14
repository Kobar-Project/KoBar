'use strict';

// T-217: electron-builder configuration (replaces the old "build" key in package.json).
// Use the npm scripts (`dist:store`, `dist:direct:win`, `dist:mac`); they set KOBAR_FLAVOR for both the Vite build and this
// file, and always pass `--publish never`. The logic lives in tools/builderConfig.cjs; this file only wires the readers.
//
// kobar-secrets.json is read here at build time ONLY for the store flavor, and only for fields that are not already set via
// KOBAR_APPX_IDENTITY_NAME / KOBAR_APPX_PUBLISHER / KOBAR_APPX_PUBLISHER_DISPLAY_NAME. Nothing is written to disk.

const fs = require('node:fs');
const path = require('node:path');
const { createBuilderConfig } = require('./tools/builderConfig.cjs');

function readJsonIfExists(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = createBuilderConfig({
    env: process.env,
    readSettings: () => readJsonIfExists(path.join(__dirname, 'kobar-settings.json')),
    readSecrets: () => readJsonIfExists(path.join(__dirname, 'kobar-secrets.json')),
});
