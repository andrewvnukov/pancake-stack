// Playwright smoke-тест «Блинная Горка / Pancake Stack».
// Запуск: node test/smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');

const errors = [];
// Путь к бинарю Chromium можно задать через PW_CHROMIUM (окружение CI без
// скачанных браузеров Playwright); по умолчанию — обычный браузер Playwright.
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
// Сетевые сбои загрузки внешних ресурсов (шрифты, SDK Яндекса) — это не
// JS-ошибки игры: в офлайн-окружении они всегда есть и ничего не значат.
const isNetworkNoise = t => /Failed to load resource|ERR_(CONNECTION|NAME|INTERNET|NETWORK)/i.test(t);
page.on('console', m => { if (m.type() === 'error' && !isNetworkNoise(m.text())) errors.push(m.text()); });
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

// сейв переживает перезагрузку. Не строгое равенство: банки на полке капают
// мёдом в каждом кадре, поэтому между записью и снимком после reload мёда
// становится больше, а не меньше.
const savedCoins = JSON.parse(await page.evaluate(() => { persist(true); return window.render_game_to_text(); })).coins;
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
const reloaded = await state();
assert(reloaded.coins >= savedCoins, 'save persists across reload');

assert(errors.length === 0, 'no console/page errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

// ──────────────────────────────────────────────────────────────
//  Маршрут, офлайн, ежедневка, подсказки, подарки — проверки по
//  playermotivation.md §8 и idle-monetization.md §10
// ──────────────────────────────────────────────────────────────

// новый игрок видит первое место, ни один пункт чек-листа не закрыт сам собой
await page.evaluate(() => window.__seedSave(null));
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
let fresh0 = await state();
assert(fresh0.route === 0, 'new player starts at the first place');
assert(fresh0.goals.every(g => g === false), 'no checklist item is pre-completed for a new player');
assert(fresh0.ready === false, 'a new player cannot move on immediately');

// дальний горизонт открывается в одно нажатие из шапки
await page.evaluate(() => window.__closeModal());
await page.click('#routeChip');
assert(await page.isVisible('#modal:not(.hidden)'), 'route map opens in one tap from the HUD');
const stopsShown = await page.evaluate(() => document.querySelectorAll('#mBody .stop').length);
assert(stopsShown >= 5, 'the map shows the whole route (' + stopsShown + ')');
assert((await page.evaluate(() => document.querySelectorAll('#mBody .stop.fog').length)) > 0,
  'far places are still under fog');
await page.click('#mClose');

// подарки не двигают метрику прогресса, производство двигает
let g0 = await state();
await page.evaluate(() => window.__grant(1e6));
let g1 = await state();
assert(g1.coins > g0.coins && g1.lifetime === g0.lifetime, 'a gift does NOT move the lifetime-earned metric');
await page.evaluate(() => window.__earn(1000));
assert((await state()).lifetime > g1.lifetime, 'production DOES move the lifetime-earned metric');

// банки одной начинки складываются в доход
await page.evaluate(() => { window.__grant(1e9); window.__buyTopping('honey'); });
let one = await state();
await page.evaluate(() => window.__buyTopping('honey'));
let two = await state();
assert(two.jars === one.jars + 1, 'a topping can be bought more than once');
assert(two.baseIps > one.baseIps, 'every jar on the shelf adds passive income');
assert(two.toppings === one.toppings, 'a second jar does not count as a new topping');

// переезд ничего не отнимает; награда за место — подарок
await page.evaluate(() => window.__forceGoals());
let beforeMove = await state();
assert(beforeMove.ready === true, 'meeting all three goals unlocks the move');
await page.evaluate(() => { window.__route(); window.__closeModal(); });
let afterMove = await state();
assert(afterMove.route === beforeMove.route + 1, 'moving on advances the route');
assert(afterMove.jars >= beforeMove.jars && afterMove.toppings >= beforeMove.toppings,
  'moving on takes nothing away');
assert(afterMove.seeds > beforeMove.seeds, 'the place pays out honeycombs');
assert((afterMove.coins - beforeMove.coins) > (afterMove.lifetime - beforeMove.lifetime),
  'the place reward is a grant: it adds coins without moving the progress metric');

// за последним местом игра продолжается
await page.evaluate(() => {
  for (let i = 0; i < 8; i++) { window.__forceGoals(); window.__route(); window.__closeModal(); }
});
let looped = await state();
assert(looped.loop >= 1, 'the route continues past the finale into a second lap');
assert(isFinite(looped.baseIps), 'income stays finite after the finale');

// офлайн: короткая отлучка молчит, длинная показывает окно
await page.evaluate(() => { window.__setLastSeen(Date.now() - 10 * 1000); window.__checkOffline(); });
assert((await state()).modal !== 'offline', 'a 10-second absence does not open the return window');
await page.evaluate(() => { window.__setLastSeen(Date.now() - 6 * 3600 * 1000); });
const rep = await page.evaluate(() => window.__checkOffline());
assert(rep && rep.gained > 0, 'a 6-hour absence pays offline income');
assert((await state()).modal === 'offline', 'a long absence opens the return window');
await page.evaluate(() => window.__closeModal());

// доход за потолок ПРОПОРЦИОНАЛЕН времени (ловит скрытую обрезку в досчёте)
const prop = await page.evaluate(() => {
  const a = window.snapshot().coins; window.simulateFor(3600);
  const b = window.snapshot().coins; window.simulateFor(7200);
  return { h1: b - a, h2: window.snapshot().coins - b };
});
assert(prop.h1 > 0 && Math.abs(prop.h2 / prop.h1 - 2) < 0.05,
  'offline catch-up is proportional to time (' + (prop.h2 / prop.h1).toFixed(3) + ')');

// офлайн НЕ засчитывается в цели чек-листа
const dropsBefore = (await state()).drops;
await page.evaluate(() => window.simulateFor(6 * 3600));
assert((await state()).drops === dropsBefore,
  'the offline helper does not count towards the checklist');

// ежедневная серия: в один день награда одна
const firstDaily = await page.evaluate(() => window.__checkDaily());
if (firstDaily) await page.evaluate(() => window.__claimDaily());
assert((await page.evaluate(() => window.__checkDaily())) === false,
  'the daily bonus can only be claimed once per day');
await page.evaluate(() => window.__closeModal());

// реклама не стартует сама и не лезет сразу после запуска
assert((await page.evaluate(() => window.__adAllowed())) === false,
  'no interstitial during the warm-up right after boot');

// подсказки: не поверх открытого окна, один раз навсегда
await page.evaluate(() => window.__openModal('shop'));
assert((await page.evaluate(() => window.__tipTick())) === null, 'no tip on top of an open sheet');
await page.evaluate(() => window.__closeModal());
const tipId = await page.evaluate(() => { window.__hintDone(); return window.__tipTick(); });
assert(tipId !== null, 'a tip appears once its condition holds');
await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
assert((await state()).tips >= 1, 'a dismissed tip is recorded in the save');

// старый сейв без полей маршрута стартует на правдоподобном месте
// и НЕ получает наград за прошлое
await page.evaluate(() => window.__seedSave(JSON.stringify({
  v: 1, coins: 5000, toppings: ['honey', 'jam', 'cond'],
  upSteady: 2, upTray: 3, upEye: 2, bestHeight: 18,
})));
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
let legacy = await state();
assert(legacy.route >= 0 && legacy.route < 6, 'a legacy save lands on a valid place');
assert(legacy.seeds === 0 && legacy.seedsUsed === 0, 'a legacy save gets no combs for the past');
assert(legacy.jars === 3, 'a legacy shelf migrates without losing income');

// повреждённый сейв не заклинивает запуск
await page.evaluate(() => window.__seedSave('{not json at all'));
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
assert(typeof (await state()).coins === 'number', 'a corrupted save still boots the game');

// сейв из будущей версии: неизвестный id — это «ничего», а не самая дорогая начинка
await page.evaluate(() => window.__seedSave(JSON.stringify({
  v: 99, coins: 10, toppings: ['honey', 'caviar'], route: 99, loop: 3,
  jars: { caviar: 5, jam: 2 },
})));
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
let future = await state();
assert(future.route <= 5, 'an out-of-range place index is clamped on load');
assert(future.jars === 3, 'an unknown topping id on the shelf resolves to nothing');

assert(errors.length === 0, 'no console/page errors at the end' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

await browser.close();
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
