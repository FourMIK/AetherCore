#!/usr/bin/env node

import * as readline from 'node:readline';
import type { MessageEnvelope } from '@aethercore/shared';
import { MeshClient, type MeshAckMessage, type MeshChatMessage, type MeshNodePresence } from './c2/mesh-client';
import { getConfigManager } from './device-management/configManager';
import { getDeviceIdentity } from './integration/onboarding';
import {
  MAX_HISTORY_PER_PEER,
  buildMeshEndpoint,
  clampTrust,
  historyLine,
  loadHistory,
  nowIso,
  parseStatus,
  saveHistory,
  type ChatRecord,
  type PeerState,
} from './chat-common';

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     CODERALPHIE CHAT APP                      ║');
  console.log('║       Pi-side authenticated messaging client (mesh)           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const identity = getDeviceIdentity();
  if (!identity) {
    console.error('ERROR: no identity found. Enroll/start coderalphie first.');
    process.exit(1);
  }

  const config = getConfigManager().getConfig();
  const meshEndpoint = buildMeshEndpoint(config);
  const historyByPeer = await loadHistory();
  const peers = new Map<string, PeerState>();
  let activePeer = '';
  let lastInboundPeer = '';
  let saveTimer: NodeJS.Timeout | null = null;

  const scheduleSave = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void saveHistory(historyByPeer).catch((error) => {
        console.warn(`[${nowIso()}] history_save_failed:`, error);
      });
    }, 300);
  };

  const upsertPeer = (next: PeerState): void => {
    const prev = peers.get(next.id);
    peers.set(next.id, {
      ...next,
      lastSeen: Math.max(prev?.lastSeen || 0, next.lastSeen),
      status: next.status === 'unknown' ? prev?.status || 'unknown' : next.status,
      trustScore: next.trustScore ?? prev?.trustScore ?? 0.5,
      verified: next.verified ?? prev?.verified ?? false,
      endpoint: next.endpoint || prev?.endpoint || '',
      tpmBacked: next.tpmBacked ?? prev?.tpmBacked ?? null,
    });
  };

  const appendHistory = (peer: string, entry: ChatRecord): void => {
    const existing = historyByPeer.get(peer) || [];
    existing.push(entry);
    if (existing.length > MAX_HISTORY_PER_PEER) {
      existing.splice(0, existing.length - MAX_HISTORY_PER_PEER);
    }
    historyByPeer.set(peer, existing);
    scheduleSave();
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: 'ralphie-chat> ',
  });

  const printAndRePrompt = (line: string): void => {
    console.log(line);
    rl.prompt(true);
  };

  const meshClient = new MeshClient({
    endpoint: meshEndpoint,
    identity: {
      device_id: identity.device_id,
      public_key: identity.public_key,
      hardware_serial: identity.hardware_serial,
      certificate_serial: identity.certificate_serial,
      trust_score: identity.trust_score,
      enrolled_at: identity.enrolled_at,
      tpm_backed: identity.tpm_backed,
    },
    reconnectIntervalMs: config.c2.reconnect_interval_ms,
    maxReconnectIntervalMs: Math.max(config.c2.reconnect_interval_ms * 12, 30000),
    heartbeatIntervalMs: 30000,
    connectTimeoutMs: 10000,
    onConnected: async () => {
      printAndRePrompt(`[${nowIso()}] mesh_connected endpoint=${meshEndpoint}`);
    },
    onDisconnected: async (reason) => {
      printAndRePrompt(`[${nowIso()}] mesh_disconnected reason=${reason}`);
    },
    onNodePresence: async (presence: MeshNodePresence) => {
      if (presence.deviceId === identity.device_id) {
        return;
      }
      upsertPeer({
        id: presence.deviceId,
        status: 'online',
        trustScore: presence.trustScore,
        verified: presence.tpmBacked,
        endpoint: presence.endpoint,
        tpmBacked: presence.tpmBacked,
        lastSeen: presence.lastSeen.getTime(),
      });
    },
    onEnvelope: async (envelope: MessageEnvelope) => {
      if (envelope.type !== 'presence' || envelope.from === identity.device_id) {
        return;
      }
      const payload =
        typeof envelope.payload === 'object' && envelope.payload !== null
          ? (envelope.payload as Record<string, unknown>)
          : {};
      upsertPeer({
        id: envelope.from,
        status: parseStatus(payload.status),
        trustScore: clampTrust(payload.trustScore, 0.5),
        verified: envelope.trust_status === 'verified',
        endpoint: typeof payload.endpoint === 'string' ? payload.endpoint : '',
        tpmBacked: null,
        lastSeen: envelope.timestamp,
      });
    },
    onChatMessage: async (message: MeshChatMessage) => {
      lastInboundPeer = message.from;
      if (!activePeer) {
        activePeer = message.from;
      }
      appendHistory(message.from, {
        id: message.id,
        direction: 'in',
        peer: message.from,
        content: message.content,
        timestamp: message.timestamp.getTime(),
        verified: message.verified,
      });
      printAndRePrompt(
        `[${message.timestamp.toISOString()}] IN ${message.from} ${message.verified ? '[verified]' : '[unverified]'}: ${message.content}`,
      );
    },
    onAckMessage: async (ack: MeshAckMessage) => {
      appendHistory(ack.recipientId, {
        id: ack.id,
        direction: 'ack',
        peer: ack.recipientId,
        content: ack.originalMessageId,
        timestamp: ack.timestamp.getTime(),
        verified: true,
        delivered: ack.delivered,
        reason: ack.reason,
      });
      printAndRePrompt(
        `[${ack.timestamp.toISOString()}] ACK ${ack.recipientId} delivered=${ack.delivered ? 'yes' : 'no'} ${ack.reason || ''}`.trim(),
      );
    },
  });

  const sendMessage = async (recipient: string, content: string): Promise<void> => {
    const trimmedRecipient = recipient.trim();
    const trimmedContent = content.trim();
    if (!trimmedRecipient) {
      printAndRePrompt('ERROR: recipient is required');
      return;
    }
    if (!trimmedContent) {
      printAndRePrompt('ERROR: message cannot be empty');
      return;
    }
    const id = await meshClient.sendChatMessage(trimmedRecipient, trimmedContent);
    appendHistory(trimmedRecipient, {
      id,
      direction: 'out',
      peer: trimmedRecipient,
      content: trimmedContent,
      timestamp: Date.now(),
      verified: true,
    });
    printAndRePrompt(`[${nowIso()}] OUT ${trimmedRecipient}: ${trimmedContent}`);
  };

  const printHelp = (): void => {
    console.log('Commands:');
    console.log('  /help                     Show this help');
    console.log('  /whoami                   Show local node identity');
    console.log('  /peers                    List discovered peers');
    console.log('  /use <peer-id>            Set active peer for plain-text sends');
    console.log('  /to <peer-id> <message>   Send message to peer');
    console.log('  /reply <message>          Reply to last inbound sender');
    console.log('  /history [peer-id]        Show recent history');
    console.log('  /exit                     Quit');
    console.log('  <text>                    Send to active peer');
  };

  const printPeers = (): void => {
    if (peers.size === 0) {
      console.log('No peers discovered yet.');
      return;
    }
    console.log('Known peers:');
    Array.from(peers.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((peer) => {
        const activeFlag = activePeer === peer.id ? '*' : ' ';
        console.log(
          ` ${activeFlag} ${peer.id} status=${peer.status} trust=${peer.trustScore.toFixed(2)} verified=${peer.verified ? 'yes' : 'no'} tpm=${peer.tpmBacked === null ? 'unknown' : peer.tpmBacked ? 'yes' : 'no'} last_seen=${new Date(peer.lastSeen).toISOString()}`,
        );
      });
  };

  const printHistory = (peerId?: string): void => {
    const target = (peerId || activePeer || lastInboundPeer).trim();
    if (!target) {
      console.log('No peer selected and no inbound history yet.');
      return;
    }
    const entries = historyByPeer.get(target) || [];
    if (entries.length === 0) {
      console.log(`No history for ${target}`);
      return;
    }
    console.log(`History for ${target} (last ${Math.min(entries.length, 20)}):`);
    entries.slice(-20).forEach((item) => {
      console.log(`  ${historyLine(item)}`);
    });
  };

  const shutdown = async (): Promise<void> => {
    meshClient.stop();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await saveHistory(historyByPeer).catch(() => {
      // Ignore final save errors on shutdown.
    });
    rl.close();
  };

  rl.on('line', (input) => {
    void (async () => {
      const line = input.trim();
      if (!line) {
        rl.prompt();
        return;
      }

      if (line === '/help') {
        printHelp();
        rl.prompt();
        return;
      }
      if (line === '/whoami') {
        console.log(`device_id=${identity.device_id}`);
        console.log(`hardware_serial=${identity.hardware_serial}`);
        console.log(`trust_score=${identity.trust_score}`);
        console.log(`tpm_backed=${identity.tpm_backed}`);
        rl.prompt();
        return;
      }
      if (line === '/peers') {
        printPeers();
        rl.prompt();
        return;
      }
      if (line.startsWith('/use ')) {
        const peerId = line.slice('/use '.length).trim();
        if (!peerId) {
          printAndRePrompt('Usage: /use <peer-id>');
          return;
        }
        activePeer = peerId;
        printAndRePrompt(`Active peer set: ${activePeer}`);
        return;
      }
      if (line.startsWith('/to ')) {
        const rest = line.slice('/to '.length).trim();
        const firstSpace = rest.indexOf(' ');
        if (firstSpace <= 0) {
          printAndRePrompt('Usage: /to <peer-id> <message>');
          return;
        }
        const peerId = rest.slice(0, firstSpace).trim();
        const content = rest.slice(firstSpace + 1).trim();
        await sendMessage(peerId, content);
        return;
      }
      if (line.startsWith('/reply ')) {
        const content = line.slice('/reply '.length).trim();
        if (!lastInboundPeer) {
          printAndRePrompt('No inbound sender to reply to yet.');
          return;
        }
        await sendMessage(lastInboundPeer, content);
        return;
      }
      if (line.startsWith('/history')) {
        const peerId = line.slice('/history'.length).trim();
        printHistory(peerId || undefined);
        rl.prompt();
        return;
      }
      if (line === '/exit' || line === '/quit') {
        await shutdown();
        process.exit(0);
      }

      if (!activePeer) {
        printAndRePrompt('No active peer. Use /use <peer-id> or /to <peer-id> <message>.');
        return;
      }
      await sendMessage(activePeer, line);
    })().catch((error) => {
      printAndRePrompt(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });

  printHelp();
  console.log('');
  console.log(`Local identity: ${identity.device_id}`);
  console.log(`Mesh endpoint: ${meshEndpoint}`);
  meshClient.start();
  rl.prompt();
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
