import { createClient } from '@supabase/supabase-js';
import { UUID, validateEntry } from '../public/ap-survey/schema.js';

const BUCKET = 'ap-survey-photos';
const COOKIE = '__Host-ap-survey';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json', ...extra } });
}
function config(env) {
  if (!/^https:\/\//.test(env.SUPABASE_URL || '') || !env.SUPABASE_SECRET_KEY || !/^\d{6}$/.test(env.AP_SURVEY_PIN || '') || (env.AP_SURVEY_SESSION_SECRET || '').length < 32) {
    throw new HttpError(503, 'Survey server settings are incomplete. Check the four Production variables in Cloudflare.');
  }
}
export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export async function issueSession(env, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const payload = `${expires}.${crypto.randomUUID()}`;
  const signature = await hmac(env.AP_SURVEY_SESSION_SECRET, `session:${env.AP_SURVEY_PIN}:${payload}`);
  return `${payload}.${signature}`;
}
export async function authenticated(request, env, now = Date.now()) {
  const token = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) || !UUID.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expires = Number(parts[0]);
  if (expires <= now / 1000 || expires > now / 1000 + SESSION_SECONDS + 60) return false;
  return equal(parts[2], await hmac(env.AP_SURVEY_SESSION_SECRET, `session:${env.AP_SURVEY_PIN}:${parts[0]}.${parts[1]}`));
}
function cookie(token, age = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}
export async function readBody(request, max = MAX_BODY) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
  if (Number(request.headers.get('Content-Length')) > max) throw new HttpError(413, 'Photo or request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing request body.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, 'Photo or request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
function dbError(error) {
  if (error && /new_cabling|additional_ap_required|expansion_cabling|remarks/.test(error.message || '')) throw new HttpError(503, 'Database upgrade needed: run the latest survey SQL migration in Supabase. Your draft remains on this device.');
  if (error) throw new HttpError(503, 'Database request failed. Check the Supabase table and server settings; your form has not been cleared.');
}
export function fromRow(row) {
  return { id: row.id, building: row.building, floor: row.floor, room: row.room, category: row.category, network: row.network_type, model: row.old_ap_model, hostname: row.old_ap_hostname, serial: row.old_ap_serial, mac: row.old_ap_mac, lanRoom: row.lan_room, relocation: row.relocation_required ? 'Yes' : 'No', reason: row.relocation_reason, newCabling: row.relocation_required ? (row.new_cabling || 'Not assessed') : '', additionalAP:row.additional_ap_required===true?'Yes':row.additional_ap_required===false?'No':'', expansionCabling:row.additional_ap_required===true?(row.expansion_cabling||'Not assessed'):'', remarks:row.remarks||'', hasPhoto: !!row.photo_path, updatedAt: row.updated_at, createdAt: row.created_at };
}
function toRow(entry) {
  return { id: entry.id, building: entry.building.trim(), floor: entry.floor.trim(), room: entry.room.trim(), category: entry.category, network_type: entry.network, old_ap_model: entry.model.trim(), old_ap_hostname: entry.hostname.trim(), old_ap_serial: entry.serial.trim(), old_ap_mac: entry.mac.trim(), lan_room: entry.lanRoom, relocation_required: entry.relocation === 'Yes', relocation_reason: entry.relocation === 'Yes' ? entry.reason.trim() : '' };
}
async function find(db, id) {
  const { data, error } = await db.from('ap_survey_entries').select('*').eq('id', id).maybeSingle();
  dbError(error); return data;
}
export function photoBytes(value) {
  const match = typeof value === 'string' && value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > 7 * 1024 * 1024) throw new HttpError(400, 'Use a JPG, PNG or WebP photo under 5 MB.');
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch { throw new HttpError(400, 'Invalid photo encoding.'); }
  if (bytes.length > 5 * 1024 * 1024) throw new HttpError(413, 'Photo must be under 5 MB.');
  const valid = match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : match[1] === 'png' ? [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)
      : new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  if (!valid) throw new HttpError(400, 'Photo contents do not match its image format.');
  return { bytes, type: `image/${match[1]}`, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}
async function writeEntry(db, entry, expected, isNew) {
  const invalid = validateEntry(entry); if (invalid) throw new HttpError(400, invalid);
  const old = await find(db, entry.id);
  if (!isNew && !old) throw new HttpError(409, 'This entry was deleted on another device. Copy its details into a new entry.');
  const expansion = entry.additionalAP === undefined ? old?.additional_ap_required ?? null : entry.additionalAP === '' ? null : entry.additionalAP === 'Yes';
  let path = old?.photo_path || null;
  let image;
  if (entry.photo) {
    image = photoBytes(entry.photo);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', image.bytes)), b => b.toString(16).padStart(2, '0')).join('');
    path = `${entry.id}/${hash}.${image.extension}`;
  }
  if ((entry.relocation === 'Yes' || expansion === true) && !path) throw new HttpError(400, 'Attach one wide-angle room photo for relocation or expansion.');
  const row = { ...toRow(entry), photo_path: path, new_cabling: entry.relocation === 'Yes' ? (entry.newCabling ?? old?.new_cabling ?? 'Not assessed') : null };
  row.additional_ap_required = expansion;
  row.expansion_cabling = expansion===true?(entry.expansionCabling ?? old?.expansion_cabling ?? 'Not assessed'):null;
  row.remarks = entry.remarks ?? old?.remarks ?? '';
  const matchesOld = old && Object.keys(row).every(key => row[key] === old[key]);
  // A lost response can be retried safely using the same UUID and contents.
  if (matchesOld) return fromRow(old);
  if (isNew && old) throw new HttpError(409, 'This entry ID already exists with different details.');
  if (!isNew && (!expected || expected !== old.updated_at)) throw new HttpError(409, 'This entry changed on another device. Refresh entries before editing it again.');
  if (image) {
    const { error } = await db.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.type, upsert: false });
    // Deterministic names make upload retries safe. All other failures stop the save.
    if (error && String(error.statusCode) !== '409' && error.message !== 'The resource already exists') throw new HttpError(503, 'Photo upload failed. Your entry is still available locally.');
  }
  const query = isNew ? db.from('ap_survey_entries').insert(row)
    : db.from('ap_survey_entries').update(row).eq('id', entry.id).eq('updated_at', expected);
  const { data, error } = await query.select('*').maybeSingle();
  if (error?.code === '23505') {
    const concurrent = await find(db, entry.id);
    if (concurrent && Object.keys(row).every(key => row[key] === concurrent[key])) return fromRow(concurrent);
    throw new HttpError(409, 'This entry was saved elsewhere with different details.');
  }
  dbError(error);
  if (!data) throw new HttpError(409, 'This entry changed on another device. Refresh entries before editing it again.');
  // Retain old photo objects: an in-flight edit or backup may still use them.
  // Only the current photo_path is exposed. See setup notes for orphan cleanup.
  return fromRow(data);
}
export async function handle(request, env, suppliedDb) {
  try {
    config(env);
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/ap-survey\/?/, '').replace(/\/$/, '');
    if (!['GET','POST','PUT','DELETE'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Requests must come from this website.');
    const db = suppliedDb || createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    if (route === 'login' && request.method === 'POST') {
      const body = await readBody(request, 1024);
      if (!/^\d{6}$/.test(body.pin || '')) throw new HttpError(400, 'Enter your six-digit PIN.');
      const clientHash = await hmac(env.AP_SURVEY_SESSION_SECRET, `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
      const { data, error } = await db.rpc('ap_survey_take_login_attempt', { client_hash: clientHash });
      if (error) throw new HttpError(503, 'Login protection is not ready. Run the login-limits SQL migration in Supabase.');
      if (data !== true) return json({ error: 'Too many login attempts. Wait 15 minutes and try again.' }, 429, { 'Retry-After': '900' });
      const actual = await hmac(env.AP_SURVEY_SESSION_SECRET, `pin:${body.pin}`);
      const wanted = await hmac(env.AP_SURVEY_SESSION_SECRET, `pin:${env.AP_SURVEY_PIN}`);
      if (!equal(actual, wanted)) throw new HttpError(401, 'Incorrect PIN.');
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(await issueSession(env)) });
    }
    if (!await authenticated(request, env)) throw new HttpError(401, 'Enter your PIN to continue.');
    if (route === 'session' && request.method === 'GET') return json({ ok: true });
    if (route === 'logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    if (route === 'entries' && request.method === 'GET') {
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid page.');
      const { data, error } = await db.from('ap_survey_entries').select('*').order('created_at').order('id').range(offset, offset + 499);
      dbError(error); return json({ entries: data.map(fromRow), nextOffset: data.length === 500 ? offset + 500 : null });
    }
    if (route === 'entries' && request.method === 'POST') {
      const { entry } = await readBody(request);
      return json({ entry: await writeEntry(db, entry, null, true) }, 201);
    }
    const entryRoute = route.match(/^entries\/([a-f0-9-]+)$/i);
    if (entryRoute && UUID.test(entryRoute[1])) {
      const id = entryRoute[1];
      if (request.method === 'PUT') {
        const body = await readBody(request);
        if (body.entry?.id !== id) throw new HttpError(400, 'Entry ID mismatch.');
        return json({ entry: await writeEntry(db, body.entry, body.expectedUpdatedAt, false) });
      }
      if (request.method === 'DELETE') {
        const { expectedUpdatedAt } = await readBody(request, 1024);
        if (typeof expectedUpdatedAt !== 'string') throw new HttpError(400, 'Missing entry version.');
        const old = await find(db, id);
        if (!old) return json({ ok: true });
        if (old.updated_at !== expectedUpdatedAt) throw new HttpError(409, 'This entry changed on another device. Refresh before deleting.');
        const { data, error } = await db.from('ap_survey_entries').delete().eq('id', id).eq('updated_at', expectedUpdatedAt).select('id');
        dbError(error); if (!data.length) throw new HttpError(409, 'This entry changed on another device.');
        return json({ ok: true });
      }
    }
    const photoRoute = route.match(/^photos\/([a-f0-9-]+)$/i);
    if (photoRoute && UUID.test(photoRoute[1]) && request.method === 'GET') {
      const row = await find(db, photoRoute[1]);
      if (!row?.photo_path) throw new HttpError(404, 'Photo not found.');
      const { data, error } = await db.storage.from(BUCKET).download(row.photo_path);
      if (error) throw new HttpError(503, 'Photo could not be downloaded. Try again.');
      const extension = row.photo_path.split('.').pop();
      const name = `${row.building}-${row.floor}-${row.room}-survey`.replace(/[^a-z0-9_-]/gi, '-').slice(0,120);
      return new Response(data, { headers: { ...headers, 'Content-Type': data.type || 'image/jpeg', 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${name}.${extension}"` } });
    }
    throw new HttpError(404, 'Unknown survey endpoint.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Never log request bodies, environment variables or upstream credentials.
    return json({ error: 'Survey server error. Your form has not been cleared; please try again.' }, 500);
  }
}
