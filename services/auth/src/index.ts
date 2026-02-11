/**
 * AetherCore Authentication Service
 */

import pino from 'pino';
import dotenv from 'dotenv';
import crypto from 'crypto';

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

const AETHER_BUNKER_ENDPOINT = process.env.AETHER_BUNKER_ENDPOINT || 'localhost:50051';
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

  authenticate(token: string): boolean {
    logger.debug({ event: 'auth.authenticate' }, 'Authenticating token');

    if (!token || token.trim().length === 0) {
      logger.warn({ event: 'auth.validation_failed', reason: 'missing_token' }, 'Token authentication failed');
      return false;
    }

    const segments = token.split('.');
    if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
      logger.warn({ event: 'auth.validation_failed', reason: 'malformed_token' }, 'Token authentication failed');
      return false;
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const headerJson = decodeBase64Url(headerSegment);
    const payloadJson = decodeBase64Url(payloadSegment);

    if (!headerJson || !payloadJson) {
      logger.warn({ event: 'auth.validation_failed', reason: 'malformed_encoding' }, 'Token authentication failed');
      return false;
    }

    const header = safeParseJson<JwtHeader>(headerJson);
    const payload = safeParseJson<JwtPayload>(payloadJson);

    if (!header || !payload) {
      logger.warn({ event: 'auth.validation_failed', reason: 'malformed_json' }, 'Token authentication failed');
      return false;
    }

    if (header.alg !== 'HS256') {
      logger.warn({ event: 'auth.validation_failed', reason: 'unsupported_algorithm' }, 'Token authentication failed');
      return false;
    }

    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) {
      logger.error({ event: 'auth.validation_failed', reason: 'missing_signing_secret' }, 'Token authentication failed');
      return false;
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
      logger.warn({ event: 'auth.validation_failed', reason: 'bad_signature' }, 'Token authentication failed');
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const expectedIssuer = process.env.AUTH_JWT_ISSUER || DEFAULT_JWT_ISSUER;
    const expectedAudience = process.env.AUTH_JWT_AUDIENCE || DEFAULT_JWT_AUDIENCE;

    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      logger.warn({ event: 'auth.validation_failed', reason: 'missing_subject' }, 'Token authentication failed');
      return false;
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now >= payload.exp) {
      logger.warn({ event: 'auth.validation_failed', reason: 'expired_or_missing_exp' }, 'Token authentication failed');
      return false;
    }

    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now) {
      logger.warn({ event: 'auth.validation_failed', reason: 'invalid_or_missing_iat' }, 'Token authentication failed');
      return false;
    }

    if (typeof payload.nbf === 'number' && Number.isFinite(payload.nbf) && payload.nbf > now) {
      logger.warn({ event: 'auth.validation_failed', reason: 'token_not_active' }, 'Token authentication failed');
      return false;
    }

    if (payload.iss !== expectedIssuer) {
      logger.warn({ event: 'auth.validation_failed', reason: 'issuer_mismatch' }, 'Token authentication failed');
      return false;
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.some((audience) => audience === expectedAudience)) {
      logger.warn({ event: 'auth.validation_failed', reason: 'audience_mismatch' }, 'Token authentication failed');
      return false;
    }

    logger.info({ event: 'auth.authenticated', subject: payload.sub }, 'Token authentication successful');
    return true;
  }
}

export default AuthService;
