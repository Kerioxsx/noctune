// Starts Vite, builds the main process, then launches Electron against the dev server.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { execSync } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
execSync('node scripts/build-main.mjs', { stdio: 'inherit' });
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' } });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
