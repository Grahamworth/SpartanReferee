// A few stills of the promo, to check it before rendering all of it:  node promo/peek.mjs 2 8 14 ...
import { launch } from './cdp.mjs';
const page = await launch({ port: 9335 });
await page.size(1920, 1080, 1);
await page.goto('http://localhost:8795/promo/spartanreferee.html', 1000);
await page.eval('window.ready');
for (const t of process.argv.slice(2)) { await page.eval(`window.render(${t}); true`); await page.shot(new URL(`peek-${t}.jpg`, import.meta.url), { format: 'jpeg', quality: 80 }); }
await page.close();
