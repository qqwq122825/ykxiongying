import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const OUT = 'C:\\Users\\Administrator\\Desktop\\stST\\local\\shots\\1to1';
const DEV = '0bf369d72c97f15e';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
let cur = { console: [], pageerror: [], bad: [] };
pg.on('console', m => { if (m.type() === 'error') cur.console.push(m.text().slice(0, 200)); });
pg.on('pageerror', e => cur.pageerror.push(String(e).slice(0, 200)));
pg.on('response', r => { const u = r.url(); if (r.status() >= 400) cur.bad.push(r.status() + ' ' + u.replace(BASE, '').slice(0, 120)); });
await pg.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1600);
const ins = pg.locator('input:not([type=checkbox])');
await ins.nth(0).fill('admin'); await ins.nth(1).fill('admin123');
await pg.locator('button[type=submit]').first().click();
await pg.waitForTimeout(2000);
await pg.goto(BASE + '/?standalone=1#/devices/' + DEV + '/show', { waitUntil: 'domcontentloaded' });
await pg.reload({ waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(4000);
// open 群发功能 tab
const tabs = pg.locator('[role=tab]');
const n = await tabs.count();
for (let i = 0; i < n; i++) { const t = (await tabs.nth(i).innerText()).trim(); if (t.includes('群发')) { await tabs.nth(i).scrollIntoViewIfNeeded(); await tabs.nth(i).click(); break; } }
await pg.waitForTimeout(2500);
await pg.screenshot({ path: OUT + '\\bulk_00_wa.png' });
console.log('WA panel head: ' + (await pg.evaluate(() => (document.querySelector('[role=tabpanel]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200))));
// click Facebook sub-tab
const fb = pg.locator('button', { hasText: /Facebook/ }).first();
if (await fb.count() > 0) { await fb.click(); await pg.waitForTimeout(2500); await pg.screenshot({ path: OUT + '\\bulk_01_fb.png' });
  console.log('FB panel head: ' + (await pg.evaluate(() => (document.querySelector('[role=tabpanel]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200)))); }
// exercise: fill template + manual number + start
const ta = pg.locator('textarea');
const c2 = await ta.count();
console.log('textareas=' + c2);
if (c2 >= 2) { await ta.nth(0).fill('Hello from local panel'); await ta.nth(1).fill('8613800000001\n8613900000002'); }
const startBtn = pg.locator('button', { hasText: /开始群发/ }).first();
if (await startBtn.count() > 0) { await startBtn.click(); await pg.waitForTimeout(2500); }
await pg.screenshot({ path: OUT + '\\bulk_02_started.png' });
console.log('after start: ' + (await pg.evaluate(() => (document.querySelector('[role=tabpanel]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 260))));
console.log('badRequests=' + cur.bad.length + ' consoleErrors=' + cur.console.length + ' pageErrors=' + cur.pageerror.length);
cur.bad.slice(0, 8).forEach(x => console.log('  BAD ' + x));
cur.console.slice(0, 5).forEach(x => console.log('  ERR ' + x));
await browser.close();
