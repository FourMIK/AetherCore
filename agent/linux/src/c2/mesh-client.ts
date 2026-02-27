import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import WebSocket, { type RawData } from 'ws';
import {
  createMessageEnvelope,
  isEnvelopeVerified,
  parseMessageEnvelope,
  serializeForSigning,
  type MessageEnvelope,
} from '@aethercore/shared';

export interface MeshIdentity {
  device_id: string;
  public_key?: string;
  chat_public_key?: string;
  hardware_serial: string;
  certificate_serial: string;
  trust_score: number;
  enrolled_at: number;
  tpm_backed: boolean;
}

export interface MeshClientConfig {
  endpoint: string;
  identity: MeshIdentity;
  reconnectIntervalMs: number;
  maxReconnectIntervalMs: number;
  heartbeatIntervalMs: number;
  connectTimeoutMs: number;
  onConnected?: () => void | Promise<void>;
  onDisconnected?: (reason: string) => void | Promise<void>;
  onChatMessage?: (message: MeshChatMessage) => void | Promise<void>;
  onAckMessage?: (ack: MeshAckMessage) => void | Promise<void>;
  onNodePresence?: (presence: MeshNodePresence) => void | Promise<void>;
  onEnvelope?: (envelope: MessageEnvelope) => void | Promise<void>;
}

type MeshState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'stopped';

export interface MeshChatMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  verified: boolean;
}

export interface MeshAckMessage {
  id: string;
  originalMessageId: string;
  recipientId: string;
  delivered: boolean;
  reason?: string;
  timestamp: Date;
}

export interface MeshNodePresence {
  deviceId: string;
  trustScore: number;
  tpmBacked: boolean;
  endpoint: string;
  lastSeen: Date;
}

type PresenceReason = 'startup' | 'heartbeat';

type PresencePayload = {
  type: 'RALPHIE_PRESENCE';
  reason: PresenceReason;
  timestamp: number;
  endpoint: string;
  last_disconnect_reason: string;
  identity: MeshIdentity & { public_key: string };
  telemetry?: unknown;
};

function normalizePublicKeyPem(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function publicKeyFingerprint(pem: string): string | null {
  try {
    const key = crypto.createPublicKey(pem);
    const der = key.export({ type: 'spki', format: 'der' });
    return der.toString('hex');
  } catch {
    return null;
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      normalized[key] = stableJsonValue(entryValue);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export class MeshClient {
  private readonly config: MeshClientConfig;
  private state: MeshState = 'idle';
  private backoffMs: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ws: WebSocket | null = null;
  private lastDisconnectReason = 'unknown';
  private messageQueue: MessageEnvelope[] = [];
  private signingPrivateKey: crypto.KeyObject;
  private advertisedPublicKeyPem: string;
  private chatEncryptionPrivateKey: crypto.KeyObject;
  private chatEncryptionPublicKeyPem: string;
  private peerChatEncryptionKeys = new Map<string, crypto.KeyObject>();
  private chatEpochCounter = 0;

  constructor(config: MeshClientConfig) {
    this.config = config;
    this.backoffMs = Math.max(config.reconnectIntervalMs, 1000);
    const signingMaterial = this.initializeSigningMaterial();
    this.signingPrivateKey = signingMaterial.privateKey;
    this.advertisedPublicKeyPem = signingMaterial.publicKeyPem;
    const chatKeyMaterial = this.initializeChatEncryptionMaterial();
    this.chatEncryptionPrivateKey = chatKeyMaterial.privateKey;
    this.chatEncryptionPublicKeyPem = chatKeyMaterial.publicKeyPem;
    this.peerChatEncryptionKeys.set(this.config.identity.device_id, chatKeyMaterial.publicKey);
  }

  public start(): void {
    if (this.state === 'stopped') {
      this.state = 'idle';
    }
    this.scheduleReconnect(0);
  }

  public stop(): void {
    this.state = 'stopped';
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors during shutdown.
      }
      this.ws = null;
    }
  }

  public async sendChatMessage(recipientId: string, content: string): Promise<string> {
    const encryptedPayload = this.encryptChatPayload(recipientId, content);
    const envelope = createMessageEnvelope('chat', this.config.identity.device_id, {
      recipientId,
      ...encryptedPayload,
    });
    envelope.signature = this.signEnvelope(envelope);
    this.sendEnvelope(envelope);
    return envelope.message_id;
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.state === 'stopped') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.state = 'connecting';
    const endpoint = this.config.endpoint;
    const allowInsecureTls = process.env.C2_TLS_INSECURE === '1';

    this.ws = new WebSocket(endpoint, {
      handshakeTimeout: this.config.connectTimeoutMs,
      rejectUnauthorized: !allowInsecureTls,
    });

    this.ws.once('open', () => {
      void (async () => {
        if (this.state === 'stopped') {
          return;
        }

        this.state = 'connected';
        console.log(`[Mesh] Reachable: ${this.config.endpoint}`);

        this.backoffMs = Math.max(this.config.reconnectIntervalMs, 1000);
        await this.emitPresence('startup');
        this.sendMeshPresenceEnvelope('startup');
        this.flushMessageQueue();
        this.startHeartbeat();

        if (this.config.onConnected) {
          await this.config.onConnected();
        }
      })().catch((error) => {
        console.error('[Mesh] Failed during on-open initialization:', error);
      });
    });

    this.ws.on('message', (data: RawData) => {
      void this.handleIncomingMessage(data);
    });

    this.ws.on('close', (code: number, reasonBuf: Buffer) => {
      const reason = reasonBuf.toString() || `close code ${code}`;
      void this.handleDisconnect(reason);
    });

    this.ws.on('error', (error: Error) => {
      const reason = error instanceof Error ? error.message : String(error);
      void this.handleDisconnect(reason);
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.heartbeatTimer = setInterval(() => {
      void this.emitPresence('heartbeat');
      this.sendMeshPresenceEnvelope('heartbeat');
    }, this.config.heartbeatIntervalMs);
  }

  private async handleDisconnect(reason: string): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    const wasConnected = this.state === 'connected';
    this.state = 'disconnected';
    this.lastDisconnectReason = reason;
    this.clearTimers();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    if (wasConnected) {
      console.warn(`[Mesh] Unreachable: ${reason}`);
      if (this.config.onDisconnected) {
        await this.config.onDisconnected(reason);
      }
    }

    this.backoffMs = Math.min(
      Math.max(this.config.maxReconnectIntervalMs, this.config.reconnectIntervalMs),
      Math.floor(this.backoffMs * 2),
    );
    console.log(`[Mesh] Reprobe in ${this.backoffMs}ms`);
    this.scheduleReconnect(this.backoffMs);
  }

  private async handleIncomingMessage(data: RawData): Promise<void> {
    const rawText = typeof data === 'string' ? data : data.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const eventType = (parsed as { type?: unknown }).type;
    if (eventType === 'SYSTEM_STATUS') {
      return;
    }
    if (eventType === 'ERROR') {
      const details = parsed as { code?: string; message?: string };
      console.warn(`[Mesh] Gateway error: ${details.code || 'UNKNOWN'} ${details.message || ''}`.trim());
      return;
    }
    if (eventType === 'RALPHIE_PRESENCE') {
      const directRecord = (parsed as { data?: unknown }).data;
      await this.emitNodePresenceFromRecord(directRecord);
      return;
    }
    if (eventType === 'RALPHIE_PRESENCE_SNAPSHOT') {
      const nodes = (parsed as { nodes?: unknown }).nodes;
      if (Array.isArray(nodes)) {
        for (const record of nodes) {
          await this.emitNodePresenceFromRecord(record);
        }
      }
      return;
    }

    try {
      const envelope = parseMessageEnvelope(parsed);
      if (envelope.type === 'presence' && envelope.payload && typeof envelope.payload === 'object') {
        const payload = envelope.payload as Record<string, unknown>;
        if (typeof payload.chat_public_key === 'string') {
          this.cachePeerChatEncryptionKey(envelope.from, payload.chat_public_key);
        }
      }
      if (this.config.onEnvelope) {
        await this.config.onEnvelope(envelope);
      }
      if (envelope.type === 'chat') {
        const payload = envelope.payload as Record<string, unknown> | null;
        if (payload && typeof payload.senderChatPublicKey === 'string') {
          this.cachePeerChatEncryptionKey(envelope.from, payload.senderChatPublicKey);
        }
        const recipientId =
          payload && typeof payload.recipientId === 'string' ? payload.recipientId : null;
        if (payload && recipientId === this.config.identity.device_id) {
          let content: string;
          try {
            content = this.decryptChatPayload(envelope.from, payload);
          } catch (error) {
            console.warn(
              `[Mesh] Rejected chat payload from ${envelope.from}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
          const chatMessage: MeshChatMessage = {
            id: envelope.message_id,
            from: envelope.from,
            to: recipientId,
            content,
            timestamp: new Date(envelope.timestamp),
            verified: isEnvelopeVerified(envelope),
          };
          console.log(
            `[Mesh] Chat RX from=${chatMessage.from} verified=${chatMessage.verified} msg="${chatMessage.content}"`,
          );
          if (this.config.onChatMessage) {
            await this.config.onChatMessage(chatMessage);
          }
        }
        return;
      }

      if (envelope.type === 'ack') {
        const payload = envelope.payload as {
          delivered?: boolean;
          reason?: string;
          originalMessageId?: string;
          recipientId?: string;
        };
        const delivered = payload?.delivered === true;
        console.log(
          `[Mesh] Chat ACK id=${payload?.originalMessageId || 'unknown'} delivered=${delivered} ${payload?.reason || ''}`.trim(),
        );
        if (this.config.onAckMessage) {
          await this.config.onAckMessage({
            id: envelope.message_id,
            originalMessageId: payload?.originalMessageId || 'unknown',
            recipientId: this.extractRecipientId(payload),
            delivered,
            reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
            timestamp: new Date(envelope.timestamp),
          });
        }
      }
    } catch {
      // Ignore frames that are not C2 envelopes.
    }
  }

  private extractRecipientId(payload: { recipientId?: unknown } | null | undefined): string {
    if (!payload || typeof payload.recipientId !== 'string' || payload.recipientId.length === 0) {
      return 'unknown';
    }
    return payload.recipientId;
  }

  private cachePeerChatEncryptionKey(peerId: string, publicKeyPem: string): void {
    if (!peerId || !publicKeyPem) {
      return;
    }
    try {
      const normalized = publicKeyPem.trim();
      if (!normalized) {
        return;
      }
      const publicKey = crypto.createPublicKey(normalized);
      this.peerChatEncryptionKeys.set(peerId, publicKey);
    } catch (error) {
      console.warn(
        `[Mesh] Ignoring invalid chat encryption key for ${peerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private encryptChatPayload(recipientId: string, content: string): Record<string, unknown> {
    const recipientPublicKey = this.peerChatEncryptionKeys.get(recipientId);
    if (!recipientPublicKey) {
      throw new Error(`recipient ${recipientId} has not advertised a chat encryption key yet`);
    }

    const ephemeral = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const ephemeralPrivateKey = crypto.createPrivateKey(ephemeral.privateKey);
    const sharedSecret = crypto.diffieHellman({
      privateKey: ephemeralPrivateKey,
      publicKey: recipientPublicKey,
    });
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
    const nonce = crypto.randomBytes(12);
    const keyEpoch = this.chatEpochCounter + 1;
    const aad = Buffer.from(`${this.config.identity.device_id}|${recipientId}|${keyEpoch}`, 'utf-8');

    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(content, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    this.chatEpochCounter = keyEpoch;

    return {
      content: '',
      encrypted: true,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: authTag.toString('base64'),
      senderEphemeralPublicKey: ephemeral.publicKey.toString(),
      senderChatPublicKey: this.chatEncryptionPublicKeyPem,
      keyAgreement: 'ECDH-P256',
      cipher: 'AES-256-GCM',
      keyEpoch,
    };
  }

  private decryptChatPayload(senderId: string, payload: Record<string, unknown>): string {
    if (payload.encrypted !== true) {
      if (typeof payload.content === 'string') {
        return payload.content;
      }
      throw new Error('chat payload content is missing');
    }

    const recipientId =
      typeof payload.recipientId === 'string' && payload.recipientId.length > 0 ? payload.recipientId : null;
    const ciphertextB64 = typeof payload.ciphertext === 'string' ? payload.ciphertext : null;
    const nonceB64 = typeof payload.nonce === 'string' ? payload.nonce : null;
    const authTagB64 = typeof payload.authTag === 'string' ? payload.authTag : null;
    const senderEphemeralPublicKey =
      typeof payload.senderEphemeralPublicKey === 'string' ? payload.senderEphemeralPublicKey : null;
    const keyEpoch = typeof payload.keyEpoch === 'number' && Number.isFinite(payload.keyEpoch) ? payload.keyEpoch : 0;
    if (!recipientId || !ciphertextB64 || !nonceB64 || !authTagB64 || !senderEphemeralPublicKey) {
      throw new Error('encrypted chat payload is missing required fields');
    }

    const senderEphemeralKey = crypto.createPublicKey(senderEphemeralPublicKey);
    const sharedSecret = crypto.diffieHellman({
      privateKey: this.chatEncryptionPrivateKey,
      publicKey: senderEphemeralKey,
    });
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
    const nonce = Buffer.from(nonceB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const aad = Buffer.from(`${senderId}|${recipientId}|${keyEpoch}`, 'utf-8');

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf-8');
  }

  private async emitNodePresenceFromRecord(record: unknown): Promise<void> {
    if (!record || typeof record !== 'object') {
      return;
    }
    const identity = (record as { identity?: unknown }).identity;
    const endpoint = (record as { endpoint?: unknown }).endpoint;
    const receivedAt = (record as { received_at?: unknown; timestamp?: unknown }).received_at;
    const timestamp = (record as { timestamp?: unknown }).timestamp;
    if (!identity || typeof identity !== 'object') {
      return;
    }

    const deviceId = (identity as { device_id?: unknown }).device_id;
    const chatPublicKey = (identity as { chat_public_key?: unknown }).chat_public_key;
    const trustScore = (identity as { trust_score?: unknown }).trust_score;
    const tpmBacked = (identity as { tpm_backed?: unknown }).tpm_backed;
    if (
      typeof deviceId !== 'string' ||
      typeof trustScore !== 'number' ||
      typeof tpmBacked !== 'boolean' ||
      typeof endpoint !== 'string'
    ) {
      return;
    }
    if (typeof chatPublicKey === 'string') {
      this.cachePeerChatEncryptionKey(deviceId, chatPublicKey);
    }

    let lastSeen = Date.now();
    if (typeof receivedAt === 'number' && Number.isFinite(receivedAt) && receivedAt > 0) {
      lastSeen = receivedAt;
    } else if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      lastSeen = timestamp;
    }

    if (this.config.onNodePresence) {
      await this.config.onNodePresence({
        deviceId,
        trustScore,
        tpmBacked,
        endpoint,
        lastSeen: new Date(lastSeen),
      });
    }
  }

  private sendMeshPresenceEnvelope(reason: 'startup' | 'heartbeat'): void {
    const envelope = createMessageEnvelope('presence', this.config.identity.device_id, {
      status: 'online',
      trustScore: this.config.identity.trust_score,
      role: 'operator',
      callsign: this.config.identity.device_id.slice(0, 12).toUpperCase(),
      name: this.config.identity.device_id,
      verified: this.config.identity.tpm_backed,
      endpoint: this.config.endpoint,
      reason,
      public_key: this.advertisedPublicKeyPem,
      chat_public_key: this.chatEncryptionPublicKeyPem,
    });
    envelope.signature = this.signEnvelope(envelope);
    this.sendEnvelope(envelope);
  }

  private sendEnvelope(envelope: MessageEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(envelope);
      return;
    }

    this.ws.send(JSON.stringify(envelope));
  }

  private flushMessageQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.messageQueue.length === 0) {
      return;
    }

    while (this.messageQueue.length > 0) {
      const envelope = this.messageQueue.shift();
      if (!envelope) {
        break;
      }
      this.ws.send(JSON.stringify(envelope));
    }
  }

  private signEnvelope(envelope: Omit<MessageEnvelope, 'trust_status' | 'verification_status'>): string {
    const serialized = serializeForSigning(envelope);
    const signature = crypto.sign(null, Buffer.from(serialized, 'utf-8'), this.signingPrivateKey);
    return signature.toString('hex');
  }

  private signPresencePayload(payload: PresencePayload): string {
    const serialized = stableStringify(payload);
    const signature = crypto.sign(null, Buffer.from(serialized, 'utf-8'), this.signingPrivateKey);
    return signature.toString('hex');
  }

  private async emitPresence(reason: PresenceReason): Promise<void> {
    const payload: PresencePayload = {
      type: 'RALPHIE_PRESENCE',
      reason,
      timestamp: Date.now(),
      endpoint: this.config.endpoint,
      last_disconnect_reason: this.lastDisconnectReason,
      identity: {
        device_id: this.config.identity.device_id,
        hardware_serial: this.config.identity.hardware_serial,
        certificate_serial: this.config.identity.certificate_serial,
        trust_score: this.config.identity.trust_score,
        enrolled_at: this.config.identity.enrolled_at,
        tpm_backed: this.config.identity.tpm_backed,
        public_key: this.advertisedPublicKeyPem,
      },
    };

    const signedPayload = {
      ...payload,
      signature: this.signPresencePayload(payload),
    };
    const serialized = JSON.stringify(signedPayload);
    console.log(`[Mesh] Presence ${reason}: ${serialized}`);
    try {
      await postPresence(this.config.endpoint, serialized, this.config.connectTimeoutMs);
    } catch (error) {
      const reasonText = error instanceof Error ? error.message : String(error);
      this.lastDisconnectReason = reasonText;
      console.warn(`[Mesh] Presence publish failed: ${reasonText}`);
    }
  }

  private initializeSigningMaterial(): { privateKey: crypto.KeyObject; publicKeyPem: string } {
    const configuredPath = process.env.CODERALPHIE_CHAT_SIGNING_KEY_PATH?.trim();
    const fallbackPath = process.env.AETHERCORE_SIGNING_PRIVATE_KEY_PATH?.trim();
    const keyCandidates = [
      configuredPath,
      fallbackPath,
      '/tmp/ralphie_dev.key',
      '/etc/coderalphie/keys/signing-private.pem',
      '/etc/coderalphie/keys/ed25519-private.pem',
    ].filter(
      (value): value is string => !!value && value.length > 0,
    );

    for (const keyPath of keyCandidates) {
      try {
        if (!fs.existsSync(keyPath)) {
          continue;
        }
        const privateKeyPem = fs.readFileSync(keyPath, 'utf-8');
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        const derivedPublicKeyPem = crypto
          .createPublicKey(privateKey)
          .export({ type: 'spki', format: 'pem' })
          .toString();
        const enrolledPublicKeyPem = normalizePublicKeyPem(this.config.identity.public_key);
        if (enrolledPublicKeyPem) {
          const derivedFp = publicKeyFingerprint(derivedPublicKeyPem);
          const enrolledFp = publicKeyFingerprint(enrolledPublicKeyPem);
          if (!derivedFp || !enrolledFp || derivedFp !== enrolledFp) {
            console.warn(
              `[Mesh] Signing key at ${keyPath} does not match enrolled identity public key; advertising derived key`,
            );
          }
        }
        return {
          privateKey,
          publicKeyPem: derivedPublicKeyPem,
        };
      } catch (error) {
        console.warn(
          `[Mesh] Failed to load signing key from ${keyPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Keep the fallback key stable across process restarts so gateway key binding remains valid.
    const fallbackKeyPath = '/tmp/ralphie_dev.key';
    try {
      const generated = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      fs.writeFileSync(fallbackKeyPath, generated.privateKey, { mode: 0o600 });
      const privateKey = crypto.createPrivateKey(generated.privateKey);
      const publicKeyPem = crypto
        .createPublicKey(privateKey)
        .export({ type: 'spki', format: 'pem' })
        .toString();
      console.warn(
        `[Mesh] No persisted signing key found; generated fallback signing key at ${fallbackKeyPath}`,
      );
      return {
        privateKey,
        publicKeyPem,
      };
    } catch (error) {
      const generated = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      console.warn(
        `[Mesh] Failed to persist fallback signing key (${fallbackKeyPath}): ${error instanceof Error ? error.message : String(error)}`,
      );
      console.warn(
        '[Mesh] Using ephemeral Ed25519 signing identity for this process; presence key binding may break after restart',
      );
      return {
        privateKey: crypto.createPrivateKey(generated.privateKey),
        publicKeyPem: generated.publicKey.toString(),
      };
    }
  }

  private initializeChatEncryptionMaterial(): {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
    publicKeyPem: string;
  } {
    const generated = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return {
      privateKey: crypto.createPrivateKey(generated.privateKey),
      publicKey: crypto.createPublicKey(generated.publicKey),
      publicKeyPem: generated.publicKey.toString(),
    };
  }
}

function postPresence(endpoint: string, body: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const wsUrl = new URL(endpoint);
    const isSecure = wsUrl.protocol === 'wss:';
    const port = wsUrl.port ? parseInt(wsUrl.port, 10) : isSecure ? 443 : 80;
    const protocol = isSecure ? 'https:' : 'http:';

    const req = (isSecure ? https : http).request(
      {
        protocol,
        hostname: wsUrl.hostname,
        port,
        path: '/ralphie/presence',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
        rejectUnauthorized: process.env.C2_TLS_INSECURE !== '1',
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
        });
        response.on('end', () => {
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          const responseBody = Buffer.concat(chunks)
            .toString('utf-8')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 400);
          if (responseBody.length > 0) {
            reject(new Error(`presence_post_failed status=${status} body=${responseBody}`));
            return;
          }
          reject(new Error(`presence_post_failed status=${status}`));
        });
      },
    );

    req.once('timeout', () => {
      req.destroy(new Error(`presence_post_timeout after ${timeoutMs}ms`));
    });
    req.once('error', (error) => reject(error));
    req.write(body);
    req.end();
  });
}
