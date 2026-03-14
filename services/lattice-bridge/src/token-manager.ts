import type pino from 'pino';
import * as grpc from '@grpc/grpc-js';
import type { BridgeConfig } from './types';

export interface AccessTokenSnapshot {
  value: string | null;
  expiresAtMs: number | null;
}

export class OAuthTokenManager {
  private token: string | null = null;
  private expiresAtMs: number | null = null;
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly logger: pino.Logger,
    private readonly onRefreshSuccess: () => void,
    private readonly onRefreshFailure: () => void,
  ) {}

  getSnapshot(): AccessTokenSnapshot {
    return { value: this.token, expiresAtMs: this.expiresAtMs };
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.expiresAtMs && Date.now() < this.expiresAtMs - 60_000) {
      return this.token;
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshToken();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  async buildGrpcMetadata(): Promise<grpc.Metadata> {
    const token = await this.getAccessToken();
    const metadata = new grpc.Metadata();
    metadata.set('authorization', `Bearer ${token}`);

    if (this.config.sandboxMode && this.config.sandboxesToken) {
      metadata.set('anduril-sandbox-authorization', `Bearer ${this.config.sandboxesToken}`);
    }

    return metadata;
  }

  private async refreshToken(): Promise<string> {
    if (!this.config.latticeBaseUrl || !this.config.latticeClientId || !this.config.latticeClientSecret) {
      this.onRefreshFailure();
      throw new Error(
        'Live lattice credentials are not configured (LATTICE_BASE_URL, LATTICE_CLIENT_ID, LATTICE_CLIENT_SECRET)',
      );
    }
    const endpoint = `${this.config.latticeBaseUrl.replace(/\/$/, '')}/api/v2/oauth/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', this.config.latticeClientId);
    body.set('client_secret', this.config.latticeClientSecret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.sandboxMode && this.config.sandboxesToken) {
      headers['Anduril-Sandbox-Authorization'] = `Bearer ${this.config.sandboxesToken}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      this.onRefreshFailure();
      const text = await response.text();
      this.logger.error(
        { status: response.status, body: text.slice(0, 512) },
        'Lattice OAuth token refresh failed',
      );
      throw new Error(`Lattice OAuth token refresh failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };

    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      this.onRefreshFailure();
      throw new Error('Lattice OAuth token refresh returned an invalid access token');
    }

    const expiresInSeconds =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) && payload.expires_in > 0
        ? payload.expires_in
        : 1800;

    this.token = payload.access_token;
    this.expiresAtMs = Date.now() + expiresInSeconds * 1000;
    this.onRefreshSuccess();

    this.logger.info({ expires_in_seconds: expiresInSeconds }, 'Lattice OAuth token refreshed');
    return this.token;
  }
}
