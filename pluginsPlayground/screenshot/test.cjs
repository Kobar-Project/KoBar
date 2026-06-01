const fs = require('fs');
global.window = {};
global.window.React = require('react');
global.window.useAppStore = { getState: () => ({}), setState: () => {} };
global.window.api = {};
global.window.KoBarExtensions = {
    registerSidebarButton: () => console.log('Button registered'),
    registerPanel: () => console.log('Panel registered')
};
global.document = { createElement: () => ({}) };

try {
    const code = fs.readFileSync('./dist/index.js', 'utf8');
    eval(code);
    console.log('Success');
} catch (e) {
    console.error('Error:', e);
}
