import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RalphieConfig } from './bootstrap/configValidator';

export type PeerStatus = 'online' | 'offline' | 'busy' | 'away' | 'unknown';

export interface ChatRecord {
  id: string;
  direction: 'in' | 'out' | 'ack';
  peer: string;
  content: string;
  timestamp: number;
  verified: boolean;
  delivered?: boolean;
  reason?: string;
}

export interface PeerState {
  id: string;
  status: PeerStatus;
  trustScore: number;
  verified: boolean;
  endpoint: string;
  tpmBacked: boolean | null;
  lastSeen: number;
}

export const HISTORY_PATH =
  process.env.CODERALPHIE_CHAT_HISTORY?.trim() || '/opt/coderalphie/chat/history.json';
export const MAX_HISTORY_PER_PEER = Number(process.env.CODERALPHIE_CHAT_MAX_PER_PEER || '200');

export function buildMeshEndpoint(config: Readonly<RalphieConfig>): string {
  const explicitEndpoint = process.env.C2_WS_URL?.trim();
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const server = config.c2.server.trim().replace(/\/+$/, '');
  if (server.startsWith('ws://') || server.startsWith('wss://')) {
    const normalized = new URL(server);
    if (!normalized.port) {
      normalized.port = String(config.c2.port);
    }
    return normalized.toString();
  }

  const scheme = config.c2.use_wss ? 'wss' : 'ws';
  return `${scheme}://${server}:${config.c2.port}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseStatus(input: unknown): PeerStatus {
  return input === 'online' || input === 'offline' || input === 'busy' || input === 'away'
    ? input
    : 'unknown';
}

export function clampTrust(value: unknown, fallback = 0.5): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  if (value > 1) {
    return Math.max(0, Math.min(1, value / 100));
  }
  return Math.max(0, Math.min(1, value));
}

export function historyLine(item: ChatRecord): string {
  const ts = new Date(item.timestamp).toISOString().slice(11, 19);
  if (item.direction === 'ack') {
    return `${ts} ACK -> ${item.peer} delivered=${item.delivered ? 'yes' : 'no'} ${item.reason || ''}`.trim();
  }
  return `${ts} ${item.direction.toUpperCase()} ${item.peer} ${item.verified ? '[verified]' : '[unverified]'} ${item.content}`;
}

export async function loadHistory(): Promise<Map<string, ChatRecord[]>> {
  const store = new Map<string, ChatRecord[]>();
  try {
    const raw = await fs.readFile(HISTORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { by_peer?: Record<string, ChatRecord[]> };
    if (!parsed.by_peer || typeof parsed.by_peer !== 'object') {
      return store;
    }
    Object.entries(parsed.by_peer).forEach(([peer, entries]) => {
      if (!Array.isArray(entries)) {
        return;
      }
      store.set(
        peer,
        entries.filter(
          (e) =>
            e &&
            typeof e.id === 'string' &&
            (e.direction === 'in' || e.direction === 'out' || e.direction === 'ack') &&
            typeof e.peer === 'string' &&
            typeof e.content === 'string' &&
            typeof e.timestamp === 'number' &&
            typeof e.verified === 'boolean',
        ),
      );
    });
  } catch {
    // Fresh install or unreadable history is non-fatal.
  }
  return store;
}

export async function saveHistory(historyByPeer: Map<string, ChatRecord[]>): Promise<void> {
  const parent = path.dirname(HISTORY_PATH);
  await fs.mkdir(parent, { recursive: true });
  const byPeer: Record<string, ChatRecord[]> = {};
  historyByPeer.forEach((entries, peer) => {
    byPeer[peer] = entries;
  });
  await fs.writeFile(
    HISTORY_PATH,
    JSON.stringify(
      {
        updated_at: Date.now(),
        by_peer: byPeer,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
