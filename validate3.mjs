import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const OUT = 'C:\\Users\\Administrator\\Desktop\\stST\\local\\shots\\1to1';
const DEV = '0bf369d72c97f15e';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
let cur = { console: [], pageerror: [], bad: [] };
pg.on('console', m => { if (m.type() === 'error') cur.console.push(m.text().slice(0, 220)); });
pg.on('pageerror', e => cur.pageerror.push(String(e).slice(0, 220)));
pg.on('response', r => { const u = r.url(); if ((u.includes('/m/') || u.includes('/api/') || u.includes('.js')) && r.status() >= 400) cur.bad.push(r.status() + ' ' + u.replace(BASE, '').slice(0, 120)); });

await pg.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1800);
const ins = pg.locator('input:not([type=checkbox])');
await ins.nth(0).fill('admin'); await ins.nth(1).fill('admin123');
await pg.locator('button[type=submit]').first().click();
await pg.waitForTimeout(2000);
await pg.goto(BASE + '/?standalone=1#/devices/' + DEV + '/show', { waitUntil: 'domcontentloaded' });
await pg.reload({ waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(4000);

const names = await pg.evaluate(() => Array.from(document.querySelectorAll('[role=tab]')).map(e => (e.innerText || '').trim()));
console.log('TABS(' + names.length + '): ' + names.join(' | '));

const res = [];
for (let i = 0; i < names.length; i++) {
  cur = { console: [], pageerror: [], bad: [] };
  let ok = false;
  try {
    const t = pg.locator('[role=tab]').nth(i);
    await t.scrollIntoViewIfNeeded();
    await t.click({ timeout: 6000 });
    ok = true;
  } catch (e) { cur.pageerror.push('CLICK:' + String(e).slice(0, 140)); }
  await pg.waitForTimeout(2600);
  let head = '';
  try { head = await pg.evaluate(() => { const m = document.querySelector('[role=tabpanel]') || document.querySelector('main') || document.body; return (m.innerText || '').replace(/\s+/g, ' ').slice(0, 110); }); } catch (e) { head = 'EVAL_FAIL'; }
  try { await pg.screenshot({ path: OUT + '\\tab_' + String(i).padStart(2, '0') + '_' + (names[i] || '').replace(/[\\/:*?"<>|]/g, '') + '.png' }); } catch (e) {}
  const fail = cur.bad.length + cur.pageerror.length;
  res.push({ i, name: names[i], clicked: ok, head, bad: cur.bad.slice(), console: cur.console.slice(), pageerror: cur.pageerror.slice() });
  console.log((fail === 0 ? 'OK  ' : 'FAIL') + ' [' + i + '] ' + names[i] + ' bad=' + cur.bad.length + ' err=' + cur.pageerror.length + ' | ' + head.slice(0, 70));
}
fs.writeFileSync('C:\\Users\\Administrator\\Desktop\\stST\\local\\_ui_devtabs.json', JSON.stringify(res, null, 1), 'utf8');
console.log('consoleErrors=' + res.reduce((a, e) => a + e.console.length, 0));
await browser.close();
