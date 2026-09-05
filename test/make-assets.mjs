// Headless-генерация магазинных ассетов (без внешних image-API).
// Делает: скриншоты геймплея с реального билда + обложки RU/EN + иконку из card.html.
// Запуск из папки игры:  node test/make-assets.mjs
// Правь CONFIG под конкретную игру (title/heroSvg/палитра/кадры).
// heroSvg — ВЕКТОРНАЯ SVG-разметка героя обложки (viewBox 0 0 100 100), НЕ эмодзи.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const out = resolve(root, 'store-assets');
mkdirSync(out, { recursive: true });
const gameUrl = 'file://' + resolve(root, 'index.html');
const cardUrl = 'file://' + resolve(root, 'store', 'card.html');

// ---- CONFIG ----
const CONFIG = {
  titleRu: 'Блинная Горка', titleEn: 'Pancake Stack',
  subRu: 'Строй блинную башню', subEn: 'Build a pancake tower',
  // герой обложки: стопка блинов на тарелке, векторный SVG (без эмодзи)
  heroSvg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="50" cy="86" rx="34" ry="8" fill="#F7F0DE" stroke="#5C3B23" stroke-width="3"/>'
    + '<g stroke="#5C3B23" stroke-width="3" stroke-linejoin="round">'
    + '<rect x="26" y="66" width="48" height="10" rx="5" fill="#B9843C"/>'
    + '<ellipse cx="50" cy="76" rx="24" ry="7" fill="#9C6A3C"/>'
    + '<rect x="29" y="52" width="42" height="10" rx="5" fill="#C97F22"/>'
    + '<ellipse cx="50" cy="62" rx="21" ry="6.5" fill="#A9691F"/>'
    + '<rect x="32" y="38" width="36" height="10" rx="5" fill="#EEB85C"/>'
    + '<ellipse cx="50" cy="48" rx="18" ry="6" fill="#C9925A"/>'
    + '<ellipse cx="50" cy="38" rx="18" ry="7" fill="#F2C97A"/>'
    + '</g>'
    + '<ellipse cx="42" cy="34" rx="7" ry="3.4" fill="#FFF3D6" opacity=".8"/>'
    + '<circle cx="46" cy="40" r="2" fill="#8A5A24" opacity=".5"/><circle cx="58" cy="37" r="2" fill="#8A5A24" opacity=".5"/>'
    + '</svg>',
  accent: '#E8A33D', bg: '#F6D9A0', ink: '#5C3B23',
  // характерные экраны десктопа (1920x1080): геймплей / высокая стопка / магазин / улучшения / полка
  shots: [
    ['d1-gameplay', async p => {
      await p.evaluate(async () => { for (let i=0;i<3;i++){ const top=window.__topPos(); window.__alignMover(top.x); window.__drop(); await new Promise(r=>setTimeout(r,450)); } });
    }],
    ['d2-tall-stack', async p => {
      await p.evaluate(async () => { for (let i=0;i<14;i++){ const top=window.__topPos(); window.__alignMover(top.x); window.__drop(); await new Promise(r=>setTimeout(r,450)); } });
    }],
    ['d3-shop', async p => { await p.evaluate(() => window.__grant(50000)); await p.click('#shopBtn'); }],
    ['d4-upgrades', async p => { await p.evaluate(() => window.__grant(50000)); await p.click('#upBtn'); }],
    ['d5-shelf', async p => { await p.evaluate(() => { window.__grant(1000000); for(let i=0;i<9;i++) window.__buyNextTopping(); }); await p.click('#shelfBtn'); }],
  ],
};

const browser = await chromium.launch();

async function shot(url, w, h, file, prep, locale) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale });
  await page.goto(url);
  await page.waitForTimeout(400);
  if (prep) await prep(page);
  // скрыть активный toast перед снимком — чистый кадр
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, file) });
  await page.close();
  console.log('saved', file);
}

// Скриншоты геймплея (десктоп 1920x1080) — RU и EN локали (авто-язык через navigator.language)
for (const [name, prep] of CONFIG.shots) {
  await shot(gameUrl, 1920, 1080, name + '.png',    prep, 'ru-RU');
  await shot(gameUrl, 1920, 1080, name + '-en.png', prep, 'en-US');
}

// Обложки 800x470 и иконка 512x512 из card.html
const card = (o) => cardUrl + '?' + new URLSearchParams(o).toString();
await shot(card({ w:800,h:470,mode:'cover',title:CONFIG.titleRu,sub:CONFIG.subRu,heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 800, 470, 'cover.png');
await shot(card({ w:800,h:470,mode:'cover',title:CONFIG.titleEn,sub:CONFIG.subEn,heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 800, 470, 'cover-en.png');
await shot(card({ w:512,h:512,mode:'icon',heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 512, 512, 'icon.png');

await browser.close();
console.log('\nАссеты готовы в', out);
