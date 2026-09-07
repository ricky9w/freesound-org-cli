import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import pc from 'picocolors';
import { spinner } from '@clack/prompts';

export class AppError extends Error {
  constructor(public code: string, message: string, public hint?: string, public status?: number) { super(message); }
}
export function networkError(error: unknown): AppError {
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  if (code && /CERT|SSL|TLS|VERIFY/.test(code)) return new AppError('TLS_ERROR', 'Freesound HTTPS certificate validation failed.', `TLS error: ${code}. Keep certificate verification enabled; retry after the certificate or trust-chain issue is resolved.`);
  return new AppError('NETWORK_ERROR', 'Could not reach Freesound.');
}
export const machine = () => process.argv.includes('--json') || (!process.argv.includes('--human') && (!process.stdout.isTTY || !!process.env.CI));
export const interactive = () => !!process.stdin.isTTY && !!process.stderr.isTTY && !machine();
export function output(data: unknown) {
  if (machine()) console.log(JSON.stringify({ schemaVersion: 1, ok: true, data }));
  else console.log(pc.green('✓ ') + human(data));
}
function clean(s: string) { return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '); }
function human(data: unknown): string {
  if (data && typeof data === 'object' && 'results' in data && Array.isArray(data.results)) {
    return data.results.map((x: Record<string, unknown>) => `${x.id ?? ''}  ${clean(String(x.name ?? ''))}  ${x.duration ?? ''}s`).join('\n');
  }
  return JSON.stringify(data, null, 2);
}
export function fail(error: unknown) {
  const e = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The operation could not be completed.', 'Run the command again with --help; credentials are never included in diagnostics.');
  if (machine()) console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: e.code, message: e.message, hint: e.hint, status: e.status } }));
  else console.error(pc.red(e.message) + (e.hint ? `\n${e.hint}` : ''));
  process.exitCode = 1;
}
export async function progress<T>(label: string, task: () => Promise<T>): Promise<T> {
  const s = interactive() ? spinner({ output: process.stderr }) : undefined;
  s?.start(label);
  try { const result = await task(); s?.stop(label); return result; }
  catch (e) { s?.stop('Stopped'); throw e; }
}
export const configDir = () => process.env.FSND_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'fsnd');
export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new AppError('INVALID_CONFIG', 'A JSON file could not be read.', path); }
}
export async function privateJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export async function locked<T>(name: string, task: () => Promise<T>): Promise<T> {
  const path = join(configDir(), `${name}.lock`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let handle;
  for (let i = 0; i < 80; i++) {
    try { handle = await open(path, 'wx', 0o600); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  if (!handle) throw new AppError('AUTH_BUSY', 'Another authentication operation is running.', 'If it crashed, remove the stale auth.lock file after confirming no fsnd process is active.');
  try { return await task(); } finally { await handle.close(); await rm(path, { force: true }); }
}
export function positive(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new AppError('INVALID_ARGUMENT', `${name} must be an integer between 1 and ${max}.`);
  return n;
}
