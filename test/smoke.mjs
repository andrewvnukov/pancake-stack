// Playwright smoke-тест «Блинная Горка / Pancake Stack».
// Запуск: node test/smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url);
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok  ', msg); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));

let s0 = await state();
assert(typeof s0.coins === 'number', 'render_game_to_text returns state');
assert(s0.height === 0, 'round starts at height 0');

// точный тап по canvas (реальный ввод, не хук) роняет блин — движущийся блин
// заранее выравнивается хуком над вершиной (иначе момент клика случаен по фазе
// качания и тест был бы флаки), но сам дроп выполняет настоящий pointerdown.
await page.evaluate(() => { const top = window.__topPos(); window.__alignMover(top.x); });
await page.mouse.click(210, 400);
await page.waitForTimeout(80);
let s1 = await state();
assert(s1.height === 1, 'real tap on canvas drops a pancake (height -> 1)');
assert(s1.coins > s0.coins, 'dropping a pancake earns honey');

// принудительно идеальное совмещение -> серия перфектов растит комбо
await page.evaluate(() => { window.__forcePerfect(); window.__drop(); });
await page.waitForTimeout(50);
await page.evaluate(() => { window.__forcePerfect(); window.__drop(); });
await page.waitForTimeout(50);
let s2 = await state();
assert(s2.height === 3, 'forced perfect drops keep stacking (height -> 3)');
assert(s2.combo >= 1, 'consecutive perfect drops build combo');
assert(s2.topW === s0.topW || s2.topW > 0, 'top width stays valid after perfect drops');

// гарантированный промах без страховок роняет стопку и обновляет рекорд
await page.evaluate(() => { S.upSteady = 0; S.roundSaves = 0; });
await page.evaluate(() => { window.__forceMiss(); window.__drop(); });
await page.waitForTimeout(1300);
let s3 = await state();
assert(s3.height === 0, 'miss without rescue ends the round (height resets to 0)');
assert(s3.bestHeight >= 3, 'best height records the fallen run');

// покупка начинки (полка вкусов)
await page.evaluate(() => { window.__grant(100000); });
let before = await state();
const bought = await page.evaluate(() => window.__buyNextTopping());
assert(bought === true, 'buying next topping succeeds with enough honey');
let afterBuy = await state();
assert(afterBuy.toppings === before.toppings + 1, 'topping count increases after purchase');
assert(afterBuy.coins < before.coins, 'buying topping spends honey');

// апгрейды
const upBefore = await state();
await page.evaluate(() => window.__buyUp('upTray'));
await page.evaluate(() => window.__buyUp('upEye'));
await page.evaluate(() => window.__buyUp('upSteady'));
const upAfter = await state();
assert(upAfter.upTray > upBefore.upTray, 'upTray upgrade purchased');
assert(upAfter.upEye > upBefore.upEye, 'upEye upgrade purchased');
assert(upAfter.upSteady > upBefore.upSteady, 'upSteady upgrade purchased');

// страховка от промаха (upSteady>0) спасает раунд вместо завершения
await page.evaluate(() => { S.roundSaves = 1; });
const savesBefore = await state();
await page.evaluate(() => { window.__forceMiss(); window.__drop(); });
await page.waitForTimeout(80);
const savesAfter = await state();
assert(savesAfter.height === savesBefore.height + 1, 'rescue charge saves the run on a miss (height still grows)');
assert(savesAfter.roundSaves === savesBefore.roundSaves - 1, 'rescue charge is consumed');

// панели: магазин / улучшения / полка
await page.click('#shopBtn'); await page.waitForTimeout(150);
assert(await page.isVisible('#modal:not(.hidden)'), 'shop modal opens');
await page.click('#mClose'); await page.waitForTimeout(250);
await page.click('#upBtn'); await page.waitForTimeout(150);
assert(await page.isVisible('#modal:not(.hidden)'), 'upgrades modal opens');
await page.click('#mClose'); await page.waitForTimeout(250);
await page.click('#shelfBtn'); await page.waitForTimeout(150);
assert(await page.isVisible('#modal:not(.hidden)'), 'shelf (collection) modal opens');
await page.click('#mClose'); await page.waitForTimeout(250);

// переключатель языка
const langBefore = await state();
await page.click('#langBtn'); await page.waitForTimeout(80);
const langAfter = await state();
assert(langAfter.lang !== langBefore.lang, 'language toggle switches lang');

// награды: подарок / ×2 (без SDK выдаются сразу)
const coinsBeforeGift = (await state()).coins;
await page.click('#giftBtn'); await page.waitForTimeout(100);
assert((await state()).coins > coinsBeforeGift, 'gift button grants honey');
await page.click('#x2Btn'); await page.waitForTimeout(100);
assert((await state()).x2 === true, 'x2 button activates honey x2');

// время не ломает состояние
await page.evaluate(() => window.advanceTime(5000));
const afterTime = await state();
assert(typeof afterTime.coins === 'number', 'advanceTime does not break state');

// сейв переживает перезагрузку
const savedCoins = (await state()).coins;
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
const reloaded = await state();
assert(reloaded.coins === savedCoins, 'save persists across reload');

assert(errors.length === 0, 'no console/page errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

await browser.close();
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
