const { chromium } = require('playwright');
const path = require('path');

(async () => {
    try {
        const browser = await chromium.launch();
        const page = await browser.newPage();
        
        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

        await page.goto('file://' + path.resolve(__dirname, 'test.html'));
        await page.waitForTimeout(1000);
        await browser.close();
    } catch (e) {
        console.error(e);
    }
})();
