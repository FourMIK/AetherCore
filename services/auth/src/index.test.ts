import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { AuthService } from './index';

type Payload = {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Payload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(Buffer.from(JSON.stringify(header), 'utf8'));
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = toBase64Url(
    crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest(),
  );

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe('AuthService.authenticate', () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = 'test-secret';
    process.env.AUTH_JWT_ISSUER = 'test-issuer';
    process.env.AUTH_JWT_AUDIENCE = 'test-audience';
  });

  it('accepts a valid token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now,
        exp: now + 300,
      },
      'test-secret',
    );

    const service = new AuthService();
    assert.equal(service.authenticate(token), true);
  });

  it('rejects a malformed token', () => {
    const service = new AuthService();
    assert.equal(service.authenticate('not-a-jwt'), false);
  });

  it('rejects a token with a bad signature', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now,
        exp: now + 300,
      },
      'wrong-secret',
    );

    const service = new AuthService();
    assert.equal(service.authenticate(token), false);
  });

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now - 600,
        exp: now - 1,
      },
      'test-secret',
    );

    const service = new AuthService();
    assert.equal(service.authenticate(token), false);
  });
});
