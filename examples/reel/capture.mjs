// Render the reel video: every frame of reel.html screenshotted with Playwright,
// piped into ffmpeg with the soundtrack from beat.mjs.
//
// Usage:
//   node examples/reel/beat.mjs out
//   npm i --prefix deps katex @fontsource-variable/archivo @fontsource/ibm-plex-mono
//   DEPS=deps/node_modules node examples/reel/capture.mjs out [out/reel.mp4]
//   ... capture.mjs out --stills 60,300,900   (PNG previews of a few frames)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const [dir = 'reel-out', ...rest] = process.argv.slice(2);
const stillsArg = rest.indexOf('--stills');
const stills = stillsArg >= 0 ? rest[stillsArg + 1].split(',').map(Number) : null;
const outFile = rest.find((a) => a.endsWith('.mp4')) ?? join(dir, 'reel.mp4');
const depsDir = process.env.DEPS;
if (!depsDir) throw new Error('Set DEPS to a node_modules folder with katex and the fonts (see the usage above)');

const data = JSON.parse(readFileSync(join(dir, 'reel-data.json'), 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.route('http://reel.local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  const file = path.startsWith('/deps/') ? join(depsDir, decodeURIComponent(path.slice(6))) : join(here, path.slice(1));
  route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' });
});
page.on('pageerror', (e) => { console.error(e); process.exit(1); });
await page.goto('http://reel.local/reel.html');
await page.evaluate((d) => window.init(d), data);

if (stills) {
  for (const f of stills) {
    await page.evaluate((f) => window.render(f), f);
    writeFileSync(join(dir, `still-${f}.png`), await page.screenshot({ type: 'png' }));
  }
  console.log('stills written');
} else {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(data.fps), '-c:v', 'mjpeg', '-i', '-',
    '-i', join(dir, 'reel.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < data.frames; f++) {
    await page.evaluate((f) => window.render(f), f);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${data.frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`${outFile} written`);
}
await browser.close();
