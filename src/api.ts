import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, link, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authorization } from './auth.js';
import { AppError, privateJson, networkError } from './core.js';

export const API = 'https://freesound.org/apiv2/';
export type Json = Record<string, unknown>;
export function apiURL(path: string) {
  const url = new URL(path.replace(/^\//, ''), API);
  if (url.origin !== new URL(API).origin || !url.pathname.startsWith('/apiv2/') || url.username || url.password || /oauth2\//.test(url.pathname)) throw new AppError('INVALID_PATH', 'Use an API resource path, for example sounds/123/.');
  if (url.searchParams.has('token')) throw new AppError('INVALID_PATH', 'Pass credentials through configuration, not URLs.');
  return url;
}
async function request(url: URL, header: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try { r = await fetch(url, { headers: { Authorization: header, 'User-Agent': 'fsnd/0.1.0' }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw networkError(e); }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      const seconds = Number(r.headers.get('retry-after') || attempt + 1);
      if (!Number.isFinite(seconds) || seconds > 8) { await r.body?.cancel(); throw new AppError('RATE_LIMITED', 'Freesound asked us to wait before another request.', 'Try again later.', r.status); }
      await r.body?.cancel(); await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000)); continue;
    }
    if (!r.ok) { await r.body?.cancel(); throw new AppError(r.status === 401 ? 'AUTH_REJECTED' : r.status === 429 ? 'RATE_LIMITED' : 'API_ERROR', `Freesound returned HTTP ${r.status}.`, r.status === 401 ? 'Run fsnd auth status or log in again.' : undefined, r.status); }
    return r;
  }
}
export async function api(path: string, mode = 'auto', params: Record<string, string | number | undefined> = {}, oauth = false): Promise<Json> {
  const url = apiURL(path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const response = await request(url, await authorization(mode, oauth));
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', 'Expected a JSON object from Freesound.');
  return value as Json;
}
export async function search(query: string, options: { mode?: string; filter?: string; sort?: string; fields?: string; page: number; pageSize: number; pages: number }) {
  const results: unknown[] = []; let last: Json = {};
  for (let i = 0; i < options.pages; i++) {
    last = await api('search/text/', options.mode, { query, filter: options.filter, sort: options.sort,
      fields: options.fields || 'id,name,username,duration,license,tags,previews,type', page: options.page + i, page_size: options.pageSize });
    if (!Array.isArray(last.results)) throw new AppError('INVALID_RESPONSE', 'Search results are missing.');
    results.push(...last.results); if (!last.next) break;
  }
  return { count: last.count, results, next: last.next || null, returned: results.length };
}
export function validateDownloadURL(url: URL) {
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'freesound.org' || url.hostname.endsWith('.freesound.org'))) throw new AppError('DOWNLOAD_HOST', 'The download points outside the supported Freesound hosts.');
}
export async function downloadResponse(url: URL, auth?: string): Promise<Response> {
  for (let i = 0; i < 6; i++) {
    validateDownloadURL(url);
    // Bearer credentials are only sent to the API origin, never a CDN redirect.
    const headers: Record<string, string> = { 'User-Agent': 'fsnd/0.1.0' };
    if (auth && url.origin === new URL(API).origin && url.pathname.startsWith('/apiv2/')) headers.Authorization = auth;
    let r: Response;
    try { r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(600000) }); }
    catch (e) { throw networkError(e); }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get('location'); await r.body?.cancel();
      if (!location) throw new AppError('INVALID_REDIRECT', 'Download redirect has no destination.');
      url = new URL(location, url); continue;
    }
    if (!r.ok) { await r.body?.cancel(); throw new AppError('DOWNLOAD_FAILED', `Download returned HTTP ${r.status}.`, undefined, r.status); }
    return r;
  }
  throw new AppError('INVALID_REDIRECT', 'Too many download redirects.');
}
export async function saveResponse(response: Response, output: string) {
  const file = resolve(output); const temp = `${file}.${randomUUID()}.part`;
  await mkdir(dirname(file), { recursive: true });
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || /json|text\/|html/.test(contentType)) { await response.body?.cancel(); throw new AppError('INVALID_AUDIO', 'The server did not return audio.'); }
  let bytes = 0; const hash = createHash('sha256');
  const counter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(temp, { flags: 'wx' }));
    if (!bytes) throw new AppError('EMPTY_AUDIO', 'The server returned an empty file.');
    await link(temp, file); // Exclusive publication, even if another process finished first.
    return { file, bytes, sha256: hash.digest('hex'), contentType };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('OUTPUT_EXISTS', 'The output file already exists.', file); throw e; }
  finally { await rm(temp, { force: true }); }
}
export async function download(id: number, output: string, preview: boolean, mode?: string) {
  const file = resolve(output), metadataFile = `${file}.json`;
  for (const path of [file, metadataFile]) {
    try { await stat(path); throw new AppError('OUTPUT_EXISTS', 'An output file already exists.', path); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const metadata = await api(`sounds/${id}/`, mode);
  const previews = metadata.previews as Record<string, string> | undefined;
  const target = preview ? previews?.['preview-hq-mp3'] || previews?.['preview-lq-mp3'] : `${API}sounds/${id}/download/`;
  if (!target) throw new AppError('PREVIEW_UNAVAILABLE', 'No MP3 preview is available.');
  const auth = preview ? undefined : await authorization(mode, true);
  const saved = await saveResponse(await downloadResponse(new URL(target), auth), file);
  await privateJson(metadataFile, { schemaVersion: 1, source: 'freesound', soundId: id, preview, retrievedAt: new Date().toISOString(), ...saved, metadata });
  return { ...saved, preview, metadataFile };
}
