import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const hash = value => createHash('sha256').update(value).digest('hex');
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function passwordPolicy(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new ApiError(400, 'Use a password with 12 to 128 characters.');
}
export async function hashPassword(password) {
  passwordPolicy(password);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, value] = encoded.split(':');
  const candidate = await derive(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(value, 'hex'));
}
export function sessionToken(request) {
  const value = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('retail_session='))?.slice(15);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : '';
}
export async function issueSession(sql, staffId, response, secure) {
  const token = randomBytes(32).toString('hex');
  const ttl = 12 * 60 * 60;
  (await sql.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now()));
  (await sql.prepare('INSERT INTO sessions(token_hash,staff_id,expires) VALUES(?,?,?)').run(hash(token), staffId, Date.now() + ttl * 1000));
  response.setHeader('Set-Cookie', `retail_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${secure ? '; Secure' : ''}`);
}
export async function clearSession(sql, request, response, secure) {
  (await sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(sessionToken(request))));
  response.setHeader('Set-Cookie', `retail_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}
export async function currentUser(sql, request) {
  const row = (await sql.prepare('SELECT r.data FROM sessions s JOIN records r ON r.kind=\'staff\' AND r.id=s.staff_id WHERE s.token_hash=? AND s.expires>?').get(hash(sessionToken(request)), Date.now()));
  const user = row && JSON.parse(row.data);
  return user?.active ? user : null;
}
export function protectWrite(request, allowedOrigins) {
  // JSON + a custom header cannot be submitted by cross-origin HTML forms.
  // No CORS permissions are granted; also reject cross-site browser requests.
  if (request.headers['x-retail-request'] !== '1') throw new ApiError(403, 'The request could not be verified. Refresh and try again.');
  if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && !allowedOrigins.has(request.headers.origin))) throw new ApiError(403, 'This site is not allowed to change store records.');
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'Send application/json.');
}
