// Builds the static site into dist/: the page, fonts, screenshots, the vendored UI kit
// (vendor/, served as assets/) and the app's own web build as the live demo.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'privacy.html', 'favicon.png', 'share.jpg', 'app-icon.png']) if (existsSync(join(here, f))) cpSync(join(here, f), join(out, f));
for (const d of ['fonts', 'shots']) cpSync(join(here, d), join(out, d), { recursive: true });
cpSync(join(here, 'vendor'), join(out, 'assets'), { recursive: true });

// The live demo: the real app renderer with its demo library.
const appDist = join(root, 'app/dist');
if (!existsSync(join(appDist, 'index.html')) || process.env.REBUILD_APP) execSync('npx vite build', { cwd: join(root, 'app'), stdio: 'inherit' });
cpSync(appDist, join(out, 'app'), { recursive: true });
console.log('site built in', out);
