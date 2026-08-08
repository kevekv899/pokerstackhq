/**
 * The game server must accept exactly the tokens the Next.js app issues, and
 * nothing else. Tokens here are signed the way `src/lib/auth.ts` signs them —
 * HS256 over the encoded JWT_SECRET, carrying `{ userId, username, email }` —
 * so a drift in either half fails this file rather than production.
 */

import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';

import { encodeSecret, verifySessionToken } from '../auth.js';

const SECRET = encodeSecret('test-secret-value');
const OTHER_SECRET = encodeSecret('a-different-secret');

/** Mirrors `signToken()` in src/lib/auth.ts. */
async function signPsToken(
  payload: { userId: number | string; username?: string; email?: string },
  {
    secret = SECRET,
    expiresIn = '7d',
  }: { secret?: Uint8Array; expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

describe('verifySessionToken', () => {
  it('accepts a valid ps_token and returns the identity', async () => {
    const token = await signPsToken({
      userId: 42,
      username: 'kevin',
      email: 'kevin@example.com',
    });

    // The app mints a numeric userId; the engine keys players by string.
    expect(await verifySessionToken(token, SECRET)).toEqual({ id: '42', name: 'kevin' });
  });

  it('falls back to the id when the token carries no username', async () => {
    const token = await signPsToken({ userId: 7 });
    expect(await verifySessionToken(token, SECRET)).toEqual({ id: '7', name: '7' });
  });

  it('rejects a tampered payload', async () => {
    const token = await signPsToken({ userId: 42, username: 'kevin' });
    const [header, , signature] = token.split('.');

    // Re-encode the claims as a different user, keeping the original signature.
    const forgedClaims = Buffer.from(
      JSON.stringify({ userId: 99, username: 'attacker', exp: 4102444800 }),
    )
      .toString('base64url')
      .replace(/=+$/, '');

    expect(await verifySessionToken(`${header}.${forgedClaims}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signPsToken({ userId: 42, username: 'kevin' }, { secret: OTHER_SECRET });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    // Backdated: issued and expired well before now.
    const token = await new SignJWT({ userId: 42, username: 'kevin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(SECRET);

    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('rejects an unsigned (alg: none) token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ userId: 42, exp: 4102444800 })).toString('base64url');

    expect(await verifySessionToken(`${header}.${claims}.`, SECRET)).toBeNull();
  });

  it('rejects malformed and missing tokens', async () => {
    for (const bad of ['', 'not-a-jwt', 'a.b.c', null, undefined, 42, {}]) {
      expect(await verifySessionToken(bad, SECRET)).toBeNull();
    }
  });

  it('rejects a well-signed token with no usable userId', async () => {
    const token = await new SignJWT({ username: 'kevin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(SECRET);

    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });
});
