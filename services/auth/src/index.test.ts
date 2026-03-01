import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { AuthErrorCode, AuthService } from './index';

type Payload = {
  sub?: string;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
};

type Header = {
  alg?: string;
  typ?: string;
};

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Payload, secret: string, header: Header = { alg: 'HS256', typ: 'JWT' }): string {
  const encodedHeader = toBase64Url(Buffer.from(JSON.stringify(header), 'utf8'));
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = toBase64Url(
    crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest(),
  );

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function expectAuthFailure(token: string, expectedCode: AuthErrorCode): void {
  const service = new AuthService();
  const result = service.authenticate(token);
  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail('Expected authentication to fail');
  }
  assert.equal(result.code, expectedCode);
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
    const result = service.authenticate(token);
    assert.equal(result.ok, true);
    if (!result.ok) {
      assert.fail('Expected authentication to succeed');
    }
    assert.equal(result.claims.sub, 'user-1');
  });

  it('rejects a missing token', () => {
    expectAuthFailure('', 'MISSING_TOKEN');
  });

  it('rejects a malformed token', () => {
    expectAuthFailure('not-a-jwt', 'MALFORMED_TOKEN');
  });

  it('rejects malformed encoding', () => {
    expectAuthFailure('@@@.@@@.sig', 'MALFORMED_ENCODING');
  });

  it('rejects malformed json', () => {
    const header = toBase64Url(Buffer.from('{', 'utf8'));
    const payload = toBase64Url(Buffer.from('{', 'utf8'));
    expectAuthFailure(`${header}.${payload}.sig`, 'MALFORMED_JSON');
  });

  it('rejects unsupported algorithm', () => {
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
      { alg: 'none', typ: 'JWT' },
    );

    expectAuthFailure(token, 'UNSUPPORTED_ALG');
  });

  it('rejects token with missing signing secret', () => {
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

    delete process.env.AUTH_JWT_SECRET;
    expectAuthFailure(token, 'MISSING_SIGNING_SECRET');
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

    expectAuthFailure(token, 'BAD_SIGNATURE');
  });

  it('rejects a token missing subject', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now,
        exp: now + 300,
      },
      'test-secret',
    );

    expectAuthFailure(token, 'MISSING_SUBJECT');
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

    expectAuthFailure(token, 'EXPIRED_TOKEN');
  });

  it('rejects a token with invalid issued-at claim', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now + 60,
        exp: now + 300,
      },
      'test-secret',
    );

    expectAuthFailure(token, 'INVALID_ISSUED_AT');
  });

  it('rejects a token that is not yet active', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'test-audience',
        iat: now,
        exp: now + 300,
        nbf: now + 60,
      },
      'test-secret',
    );

    expectAuthFailure(token, 'TOKEN_NOT_ACTIVE');
  });

  it('rejects a token with mismatched issuer', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'wrong-issuer',
        aud: 'test-audience',
        iat: now,
        exp: now + 300,
      },
      'test-secret',
    );

    expectAuthFailure(token, 'ISSUER_MISMATCH');
  });

  it('rejects a token with mismatched audience', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: 'user-1',
        iss: 'test-issuer',
        aud: 'wrong-audience',
        iat: now,
        exp: now + 300,
      },
      'test-secret',
    );

    expectAuthFailure(token, 'AUDIENCE_MISMATCH');
  });
});
