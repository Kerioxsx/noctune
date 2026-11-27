// Builds the static site into dist/: the page, its fonts and shots, the parts of the
// design-taste-frontend kit the page loads, and the app's own web build as the live demo.
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const kit = join(root, '.agents/skills/design-taste-frontend/assets');
const out = join(here, 'dist');

// The kit lives in the repo under .agents; copy it in when missing.
if (!existsSync(join(here, 'assets/system.css'))) cpSync(kit, join(here, 'assets'), { recursive: true });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'privacy.html', 'favicon.png', 'share.jpg', 'app-icon.png']) if (existsSync(join(here, f))) cpSync(join(here, f), join(out, f));
for (const d of ['fonts', 'shots']) cpSync(join(here, d), join(out, d), { recursive: true });

// Only the kit folders the page references (no photo library, scenes or objects).
const kitDirs = ['system.css', 'system.js', 'ui', 'motion', 'backgrounds', 'layout', 'moments/moments.js', 'moments/lib.js', 'moments/index.json', 'moments/line-carries-colour', 'icons/icon.css', 'icons/brand'];
for (const d of kitDirs) {
  const src = join(here, 'assets', d);
  if (existsSync(src)) cpSync(src, join(out, 'assets', d), { recursive: true, filter: (p) => !/\/(_demo|img)\b/.test(p) && !/\.(md|html|mjs)$/.test(p) });
}

// The live demo: the real app renderer with its demo library.
const appDist = join(root, 'app/dist');
if (!existsSync(join(appDist, 'index.html')) || process.env.REBUILD_APP) execSync('npx vite build', { cwd: join(root, 'app'), stdio: 'inherit' });
cpSync(appDist, join(out, 'app'), { recursive: true });
console.log('site built in', out, JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version);
