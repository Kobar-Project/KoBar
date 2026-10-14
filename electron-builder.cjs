'use strict';

// T-217: electron-builder auto-discovers `electron-builder.cjs` (not `electron-builder.config.cjs`). This stub makes a bare
// `npx electron-builder` load the real config, so it hits the KOBAR_FLAVOR guard instead of silently using defaults.
module.exports = require('./electron-builder.config.cjs');
