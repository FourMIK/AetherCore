/**
 * AetherCore Authentication Service
 */

import pino from 'pino';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { getDefaultC2Endpoint } from '@aethercore/shared';

dotenv.config();

// Initialize structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

const AETHER_BUNKER_ENDPOINT = process.env.AETHER_BUNKER_ENDPOINT || getDefaultC2Endpoint();
const DEFAULT_JWT_ISSUER = 'aethercore-auth';
const DEFAULT_JWT_AUDIENCE = 'aethercore-services';

type JwtHeader = {
  alg?: string;
  typ?: string;
};

type JwtPayload = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
};

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'MALFORMED_ENCODING'
  | 'MALFORMED_JSON'
  | 'UNSUPPORTED_ALG'
  | 'MISSING_SIGNING_SECRET'
  | 'BAD_SIGNATURE'
  | 'MISSING_SUBJECT'
  | 'EXPIRED_TOKEN'
  | 'INVALID_ISSUED_AT'
  | 'TOKEN_NOT_ACTIVE'
  | 'ISSUER_MISMATCH'
  | 'AUDIENCE_MISMATCH';

export type AuthClaims = {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nbf?: number;
};

export type AuthResult = { ok: true; claims: AuthClaims } | { ok: false; code: AuthErrorCode; context?: string };

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const padded = padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), '=');
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export class AuthService {
  constructor() {
    logger.info({ aetherBunkerEndpoint: AETHER_BUNKER_ENDPOINT }, 'Auth service initialized');
  }

  authenticate(token: string): AuthResult {
    logger.debug({ event: 'auth.authenticate' }, 'Authenticating token');

    const fail = (code: AuthErrorCode, reason: string, context?: string): AuthResult => {
      logger.warn({ event: 'auth.validation_failed', reason, code, context }, 'Token authentication failed');
      return { ok: false, code, context };
    };

    if (!token || token.trim().length === 0) {
      return fail('MISSING_TOKEN', 'MISSING_TOKEN');
    }

    const segments = token.split('.');
    if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
      return fail('MALFORMED_TOKEN', 'MALFORMED_TOKEN');
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const headerJson = decodeBase64Url(headerSegment);
    const payloadJson = decodeBase64Url(payloadSegment);

    if (!headerJson || !payloadJson) {
      return fail('MALFORMED_ENCODING', 'MALFORMED_ENCODING');
    }

    const header = safeParseJson<JwtHeader>(headerJson);
    const payload = safeParseJson<JwtPayload>(payloadJson);

    if (!header || !payload) {
      return fail('MALFORMED_JSON', 'MALFORMED_JSON');
    }

    if (header.alg !== 'HS256') {
      return fail('UNSUPPORTED_ALG', 'UNSUPPORTED_ALG', `alg=${header.alg ?? 'undefined'}`);
    }

    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) {
      logger.error(
        { event: 'auth.validation_failed', reason: 'MISSING_SIGNING_SECRET', code: 'MISSING_SIGNING_SECRET' },
        'Token authentication failed',
      );
      return { ok: false, code: 'MISSING_SIGNING_SECRET' };
    }

    const expectedSignature = toBase64Url(
      crypto.createHmac('sha256', secret).update(`${headerSegment}.${payloadSegment}`).digest(),
    );
    const providedSignature = Buffer.from(signatureSegment);
    const computedSignature = Buffer.from(expectedSignature);
    if (
      providedSignature.length !== computedSignature.length ||
      !crypto.timingSafeEqual(providedSignature, computedSignature)
    ) {
      return fail('BAD_SIGNATURE', 'BAD_SIGNATURE');
    }

    const now = Math.floor(Date.now() / 1000);
    const expectedIssuer = process.env.AUTH_JWT_ISSUER || DEFAULT_JWT_ISSUER;
    const expectedAudience = process.env.AUTH_JWT_AUDIENCE || DEFAULT_JWT_AUDIENCE;

    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      return fail('MISSING_SUBJECT', 'MISSING_SUBJECT');
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now >= payload.exp) {
      return fail('EXPIRED_TOKEN', 'EXPIRED_TOKEN');
    }

    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now) {
      return fail('INVALID_ISSUED_AT', 'INVALID_ISSUED_AT');
    }

    if (typeof payload.nbf === 'number' && Number.isFinite(payload.nbf) && payload.nbf > now) {
      return fail('TOKEN_NOT_ACTIVE', 'TOKEN_NOT_ACTIVE');
    }

    if (payload.iss !== expectedIssuer) {
      return fail('ISSUER_MISMATCH', 'ISSUER_MISMATCH');
    }

    if (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) {
      return fail('AUDIENCE_MISMATCH', 'AUDIENCE_MISMATCH');
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.some((audience) => audience === expectedAudience)) {
      return fail('AUDIENCE_MISMATCH', 'AUDIENCE_MISMATCH');
    }

    logger.info({ event: 'auth.authenticated', subject: payload.sub }, 'Token authentication successful');
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        iss: payload.iss,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
        ...(typeof payload.nbf === 'number' ? { nbf: payload.nbf } : {}),
      },
    };
  }
}

export default AuthService;
