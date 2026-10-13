// dist/index.html を A4 の PDF にする。理解度チェックの答え（<details>）は開いた状態で印刷する。
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [html, pdf, png] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
await page.emulateMedia({ media: 'print', colorScheme: 'light' });
await page.addStyleTag({ content: `
  @page { size: A4; margin: 16mm 14mm 18mm; }
  html, body { background: #fff !important; color: #1f2328 !important; }
  body { font-size: 9.6pt; line-height: 1.6; } main { max-width: none !important; } pre, code { font-size: 8.4pt !important; } table { font-size: 9pt; } h1 { font-size: 17pt !important; }
  figure, img, svg, table, pre { break-inside: avoid; }
  h2 { break-after: avoid; margin-top: 1.1em !important; font-size: 13pt !important; } h3 { font-size: 11pt !important; }
  h2:not(:first-of-type) { break-before: auto; }
  img, svg { max-width: 100% !important; height: auto; }
  figure svg { width: auto !important; height: auto; } #mmd-versions { max-height: 100mm; } #mmd-refresh { max-height: 150mm; } #mmd-protect, #mmd-count { max-height: 82mm; }
` });
if (png) await page.screenshot({ path: png, fullPage: true });
await page.pdf({ path: pdf, format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-size:8pt;color:#666;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' } });
await browser.close();
console.log('wrote', pdf);
