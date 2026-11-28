import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/** Small JSON documents in userData. Writes are atomic (tmp file + rename). */
export const dataDir = () => app.getPath('userData');

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const v = JSON.parse(await fs.readFile(join(dataDir(), `${name}.json`), 'utf8'));
    // a file that holds the wrong kind of value (null, a number...) is treated as missing
    return (v === null || typeof v !== typeof fallback ? fallback : v) as T;
  } catch {
    return fallback;
  }
}

const queues = new Map<string, Promise<void>>();
export function writeJson(name: string, value: unknown): Promise<void> {
  const file = join(dataDir(), `${name}.json`);
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, file);
  });
  queues.set(name, next.catch(() => undefined));
  return next;
}

/**
 * Provider credentials. Values are encrypted with the OS credential store via
 * Electron safeStorage (Keychain on macOS, DPAPI on Windows, libsecret/kwallet
 * on Linux). Nothing is written if encryption is unavailable, so tokens never
 * land on disk in plaintext. Values never cross into the renderer.
 */
type SecretFile = Record<string, string>;
const SECRET_FILE = 'secrets';

/** Uses the async check where Electron has it (the sync one is deprecated from Electron 45). */
export async function secureStorageAvailable(): Promise<boolean> {
  const ss = safeStorage as typeof safeStorage & { isAsyncEncryptionAvailable?: () => Promise<boolean> };
  return ss.isAsyncEncryptionAvailable ? ss.isAsyncEncryptionAvailable() : ss.isEncryptionAvailable();
}

export async function setSecret(key: string, value: string | null) {
  const all = await readJson<SecretFile>(SECRET_FILE, {});
  if (value === null) delete all[key];
  else {
    if (!(await secureStorageAvailable())) throw new Error('Secure credential storage is not available on this system.');
    all[key] = safeStorage.encryptString(value).toString('base64');
  }
  await writeJson(SECRET_FILE, all);
}

export async function getSecret(key: string): Promise<string | null> {
  const all = await readJson<SecretFile>(SECRET_FILE, {});
  const v = all[key];
  if (!v || !(await secureStorageAvailable())) return null;
  try {
    return safeStorage.decryptString(Buffer.from(v, 'base64'));
  } catch {
    return null;
  }
}
