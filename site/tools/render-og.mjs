import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from the repository root:
//   node site/tools/render-og.mjs
// Requires playwright-core and a Chromium-based browser (Edge by default).
const browser = await chromium.launch({
  executablePath: process.env.HTML_ATELIER_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve('site/tools/og-cover.html')).href, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({
  path: 'site/assets/og-cover.png',
  scale: 'css',
  clip: { x: 0, y: 0, width: 1200, height: 630 },
});
console.log('site/assets/og-cover.png written (1200x630)');
await browser.close();
