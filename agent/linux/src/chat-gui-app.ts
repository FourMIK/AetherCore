#!/usr/bin/env node

import * as http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import type { MessageEnvelope } from '@aethercore/shared';
import { MeshClient, type MeshAckMessage, type MeshChatMessage, type MeshNodePresence } from './c2/mesh-client';
import {
  MAX_HISTORY_PER_PEER,
  buildMeshEndpoint,
  clampTrust,
  loadHistory,
  nowIso,
  parseStatus,
  saveHistory,
  type ChatRecord,
  type PeerState,
} from './chat-common';
import { getConfigManager } from './device-management/configManager';
import { getDeviceIdentity } from './integration/onboarding';

interface LaunchOptions {
  host: string;
  port: number;
  noOpen: boolean;
}

interface SseEvent {
  type: string;
  ts: number;
  [key: string]: unknown;
}

const DEFAULT_HOST = process.env.CODERALPHIE_CHAT_GUI_HOST?.trim() || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.CODERALPHIE_CHAT_GUI_PORT || '41733');
const HTTP_BODY_LIMIT = 64 * 1024;

function parseLaunchOptions(argv: string[]): LaunchOptions {
  let host = DEFAULT_HOST;
  let port = Number.isFinite(DEFAULT_PORT) && DEFAULT_PORT > 0 ? DEFAULT_PORT : 41733;
  let noOpen = process.env.CODERALPHIE_CHAT_GUI_OPEN === '0';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-open') {
      noOpen = true;
      continue;
    }
    if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length).trim() || host;
      continue;
    }
    if (arg === '--host' && argv[i + 1]) {
      host = argv[i + 1].trim() || host;
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        port = parsed;
      }
      continue;
    }
    if (arg === '--port' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        port = parsed;
      }
      i += 1;
    }
  }

  return { host, port, noOpen };
}

function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function openInBrowser(url: string): boolean {
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!hasDisplay) {
    return false;
  }

  const appCommands: Array<{ command: string; args: string[] }> = [
    { command: 'chromium-browser', args: [`--app=${url}`] },
    { command: 'chromium', args: [`--app=${url}`] },
    { command: 'xdg-open', args: [url] },
    { command: 'gio', args: ['open', url] },
    { command: 'sensible-browser', args: [url] },
  ];

  for (const entry of appCommands) {
    if (!commandExists(entry.command)) {
      continue;
    }
    const child = spawn(entry.command, entry.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  }
  return false;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > HTTP_BODY_LIMIT) {
        reject(new Error('request_body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (error) => reject(error));
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!parsed || typeof parsed !== 'object') {
          resolve({});
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('invalid_json'));
      }
    });
  });
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodeRalphie Chat GUI</title>
  <style>
    :root {
      --bg-0: #f4f7f3;
      --bg-1: #e6f0eb;
      --panel: #ffffff;
      --border: #d5e0dc;
      --text: #112018;
      --muted: #567063;
      --primary: #066f5d;
      --primary-soft: #d6f2ea;
      --accent: #c96b1c;
      --danger: #b42318;
      --success: #027a48;
      --shadow: 0 16px 40px rgba(17, 32, 24, 0.08);
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      color: var(--text);
      font-family: "IBM Plex Sans", "Noto Sans", "DejaVu Sans", sans-serif;
      background:
        radial-gradient(circle at 20% 10%, rgba(6, 111, 93, 0.18), transparent 42%),
        radial-gradient(circle at 85% 0%, rgba(201, 107, 28, 0.15), transparent 40%),
        linear-gradient(145deg, var(--bg-0), var(--bg-1));
      min-height: 100vh;
    }
    .shell {
      max-width: 1200px;
      margin: 24px auto;
      padding: 16px;
    }
    .topbar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 18px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
    }
    .title {
      margin: 0;
      font-size: 26px;
      font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
      letter-spacing: 0.2px;
    }
    .subtitle {
      margin: 4px 0 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .pill-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #f9fcfb;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
    }
    .pill.online {
      background: #e7f8ef;
      color: var(--success);
      border-color: #b7e4c7;
    }
    .pill.offline {
      background: #fef3f2;
      color: var(--danger);
      border-color: #fecdca;
    }
    .layout {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 16px;
      min-height: 76vh;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-title {
      margin: 0;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: #f8fbfa;
      font-size: 13px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }
    #peerList {
      margin: 0;
      padding: 10px;
      list-style: none;
      max-height: calc(76vh - 64px);
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .peer-item {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      cursor: pointer;
      background: #fff;
      transition: all 120ms ease;
    }
    .peer-item:hover {
      border-color: #9ec6bb;
      transform: translateY(-1px);
    }
    .peer-item.active {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .peer-id {
      font-size: 13px;
      font-weight: 700;
      word-break: break-all;
    }
    .peer-meta {
      margin-top: 5px;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chat-wrap {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 100%;
    }
    .chat-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      background: #f8fbfa;
    }
    .peer-banner {
      margin: 0;
      font-weight: 700;
      font-size: 14px;
    }
    .event-log {
      font-size: 12px;
      color: var(--muted);
      max-width: 50%;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #messages {
      padding: 14px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 50vh;
      background:
        linear-gradient(180deg, rgba(6, 111, 93, 0.03), transparent 200px),
        #fff;
    }
    .msg {
      max-width: min(78%, 760px);
      border-radius: 14px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      word-wrap: break-word;
    }
    .msg.in {
      align-self: flex-start;
      background: #f7faf8;
    }
    .msg.out {
      align-self: flex-end;
      background: #e8f6f1;
      border-color: #a8d5c9;
    }
    .msg.ack {
      align-self: center;
      background: #fff7ed;
      border-color: #fed7aa;
      color: #9a3412;
      font-size: 12px;
      max-width: 90%;
    }
    .msg-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .msg-content {
      white-space: pre-wrap;
      line-height: 1.35;
      font-size: 14px;
    }
    .compose {
      padding: 12px;
      border-top: 1px solid var(--border);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      background: #f8fbfa;
    }
    #messageInput {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 120ms ease;
      background: #fff;
    }
    #messageInput:focus {
      border-color: var(--primary);
    }
    #sendBtn {
      border: none;
      border-radius: 12px;
      background: linear-gradient(140deg, var(--primary), #0a8c72);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      min-width: 120px;
      cursor: pointer;
      padding: 0 14px;
    }
    #sendBtn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .empty {
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 12px;
      text-align: center;
      background: #fbfdfc;
      font-size: 13px;
    }
    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }
      #peerList {
        max-height: 32vh;
      }
      .event-log {
        max-width: 100%;
      }
      .topbar {
        flex-direction: column;
        align-items: flex-start;
      }
      .pill-row {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div>
        <h1 class="title">CodeRalphie Chat GUI</h1>
        <p class="subtitle" id="identityLine">Loading identity...</p>
      </div>
      <div class="pill-row">
        <span class="pill" id="meshEndpoint">endpoint: --</span>
        <span class="pill offline" id="meshState">offline</span>
      </div>
    </header>
    <div class="layout">
      <section class="panel">
        <h2 class="panel-title">Discovered Peers</h2>
        <ul id="peerList"></ul>
      </section>
      <section class="panel chat-wrap">
        <div class="chat-head">
          <p class="peer-banner" id="activePeer">No peer selected</p>
          <p class="event-log" id="eventLog">Waiting for mesh events...</p>
        </div>
        <div id="messages"></div>
        <form class="compose" id="composeForm">
          <input id="messageInput" type="text" placeholder="Type a message..." autocomplete="off" />
          <button id="sendBtn" type="submit">Send</button>
        </form>
      </section>
    </div>
  </div>
  <script>
    (function () {
      var state = {
        activePeer: '',
        peers: [],
        entries: [],
        status: null,
        eventNote: 'Waiting for mesh events...'
      };

      var peerList = document.getElementById('peerList');
      var messages = document.getElementById('messages');
      var activePeerLabel = document.getElementById('activePeer');
      var eventLog = document.getElementById('eventLog');
      var meshState = document.getElementById('meshState');
      var meshEndpoint = document.getElementById('meshEndpoint');
      var identityLine = document.getElementById('identityLine');
      var composeForm = document.getElementById('composeForm');
      var messageInput = document.getElementById('messageInput');
      var sendBtn = document.getElementById('sendBtn');

      function request(path, init) {
        return fetch(path, init).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok) {
              var message = payload && payload.error ? payload.error : 'request_failed';
              throw new Error(message);
            }
            return payload;
          });
        });
      }

      function escapeText(value) {
        return value == null ? '' : String(value);
      }

      function setEventNote(message) {
        state.eventNote = message;
        eventLog.textContent = message;
      }

      function renderStatus() {
        if (!state.status) {
          identityLine.textContent = 'Loading identity...';
          meshEndpoint.textContent = 'endpoint: --';
          meshState.textContent = 'offline';
          meshState.className = 'pill offline';
          return;
        }
        identityLine.textContent = 'Local identity: ' + escapeText(state.status.device_id);
        meshEndpoint.textContent = 'endpoint: ' + escapeText(state.status.mesh_endpoint);
        var online = Boolean(state.status.connected);
        meshState.textContent = online ? 'connected' : 'reconnecting';
        meshState.className = online ? 'pill online' : 'pill offline';
      }

      function renderPeers() {
        peerList.innerHTML = '';
        if (!state.peers.length) {
          var empty = document.createElement('li');
          empty.className = 'empty';
          empty.textContent = 'No peers discovered yet.';
          peerList.appendChild(empty);
          return;
        }
        state.peers.forEach(function (peer) {
          var item = document.createElement('li');
          item.className = 'peer-item' + (state.activePeer === peer.id ? ' active' : '');
          item.onclick = function () { selectPeer(peer.id, true); };

          var id = document.createElement('div');
          id.className = 'peer-id';
          id.textContent = peer.id;
          item.appendChild(id);

          var meta = document.createElement('div');
          meta.className = 'peer-meta';
          meta.textContent =
            'status=' + peer.status +
            ' trust=' + Number(peer.trustScore || 0).toFixed(2) +
            ' verified=' + (peer.verified ? 'yes' : 'no');
          item.appendChild(meta);

          peerList.appendChild(item);
        });
      }

      function renderMessages() {
        activePeerLabel.textContent = state.activePeer
          ? 'Conversation with ' + state.activePeer
          : 'No peer selected';

        messages.innerHTML = '';
        if (!state.activePeer) {
          var noPeer = document.createElement('div');
          noPeer.className = 'empty';
          noPeer.textContent = 'Select a peer to view and send messages.';
          messages.appendChild(noPeer);
          return;
        }
        if (!state.entries.length) {
          var noMessages = document.createElement('div');
          noMessages.className = 'empty';
          noMessages.textContent = 'No history with this peer yet.';
          messages.appendChild(noMessages);
          return;
        }

        state.entries.forEach(function (entry) {
          var row = document.createElement('article');
          row.className = 'msg ' + entry.direction;

          if (entry.direction === 'ack') {
            row.textContent =
              'ACK delivered=' + (entry.delivered ? 'yes' : 'no') +
              (entry.reason ? ' (' + entry.reason + ')' : '');
            messages.appendChild(row);
            return;
          }

          var head = document.createElement('div');
          head.className = 'msg-head';
          var role = document.createElement('span');
          role.textContent = entry.direction === 'out' ? 'you' : entry.peer;
          var ts = document.createElement('span');
          ts.textContent = new Date(entry.timestamp).toLocaleTimeString();
          head.appendChild(role);
          head.appendChild(ts);
          row.appendChild(head);

          var content = document.createElement('div');
          content.className = 'msg-content';
          content.textContent = entry.content;
          row.appendChild(content);

          messages.appendChild(row);
        });

        messages.scrollTop = messages.scrollHeight;
      }

      function refreshStatus() {
        return request('/api/status').then(function (payload) {
          state.status = payload;
          if (!state.activePeer && payload.active_peer) {
            state.activePeer = payload.active_peer;
          }
          renderStatus();
        }).catch(function (error) {
          setEventNote('status error: ' + error.message);
        });
      }

      function refreshPeers() {
        return request('/api/peers').then(function (payload) {
          state.peers = payload.peers || [];
          if (!state.activePeer && state.peers.length) {
            state.activePeer = state.peers[0].id;
          }
          renderPeers();
        }).catch(function (error) {
          setEventNote('peer refresh error: ' + error.message);
        });
      }

      function refreshHistory() {
        if (!state.activePeer) {
          state.entries = [];
          renderMessages();
          return Promise.resolve();
        }
        return request('/api/history?peer=' + encodeURIComponent(state.activePeer)).then(function (payload) {
          state.entries = payload.entries || [];
          renderMessages();
        }).catch(function (error) {
          setEventNote('history refresh error: ' + error.message);
        });
      }

      function selectPeer(peerId, announce) {
        state.activePeer = peerId;
        renderPeers();
        renderMessages();
        if (!peerId) {
          return;
        }
        request('/api/active-peer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: peerId })
        }).catch(function (error) {
          setEventNote('active peer update failed: ' + error.message);
        });
        refreshHistory();
        if (announce) {
          setEventNote('Active peer: ' + peerId);
        }
      }

      function sendCurrentMessage() {
        var message = messageInput.value.trim();
        if (!message) {
          return;
        }
        sendBtn.disabled = true;
        request('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: state.activePeer, message: message })
        }).then(function () {
          messageInput.value = '';
          refreshHistory();
          setEventNote('Message sent');
        }).catch(function (error) {
          setEventNote('send failed: ' + error.message);
        }).finally(function () {
          sendBtn.disabled = false;
          messageInput.focus();
        });
      }

      function connectEvents() {
        var events = new EventSource('/api/events');
        events.onmessage = function (event) {
          var payload = {};
          try {
            payload = JSON.parse(event.data);
          } catch (error) {
            return;
          }

          if (payload.type === 'chat') {
            if (!state.activePeer && payload.peerId) {
              state.activePeer = payload.peerId;
            }
            refreshHistory();
            refreshPeers();
            setEventNote('Inbound from ' + payload.peerId);
            return;
          }
          if (payload.type === 'ack') {
            refreshHistory();
            setEventNote('Delivery ACK: ' + (payload.delivered ? 'yes' : 'no'));
            return;
          }
          if (payload.type === 'peer_update') {
            refreshPeers();
            return;
          }
          if (payload.type === 'connected' || payload.type === 'disconnected') {
            refreshStatus();
            refreshPeers();
            setEventNote(payload.type === 'connected' ? 'Mesh connected' : 'Mesh reconnecting');
            return;
          }
        };
        events.onerror = function () {
          setEventNote('event stream reconnecting...');
        };
      }

      composeForm.addEventListener('submit', function (event) {
        event.preventDefault();
        sendCurrentMessage();
      });

      Promise.all([refreshStatus(), refreshPeers()])
        .then(function () {
          if (state.activePeer) {
            return refreshHistory();
          }
          renderMessages();
        })
        .finally(function () {
          connectEvents();
          setInterval(refreshStatus, 15000);
          setInterval(refreshPeers, 12000);
        });
    })();
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const launchOptions = parseLaunchOptions(process.argv.slice(2));
  const identity = getDeviceIdentity();
  if (!identity) {
    console.error('ERROR: no identity found. Enroll/start coderalphie first.');
    process.exit(1);
  }

  const config = getConfigManager().getConfig();
  const meshEndpoint = buildMeshEndpoint(config);
  const historyByPeer = await loadHistory();
  const peers = new Map<string, PeerState>();
  const sseClients = new Set<http.ServerResponse>();
  let activePeer = '';
  let lastInboundPeer = '';
  let meshConnected = false;
  let lastDisconnectReason = 'never_connected';
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

  const pushEvent = (event: SseEvent): void => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
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
      meshConnected = true;
      pushEvent({
        type: 'connected',
        ts: Date.now(),
      });
    },
    onDisconnected: async (reason) => {
      meshConnected = false;
      lastDisconnectReason = reason;
      pushEvent({
        type: 'disconnected',
        ts: Date.now(),
        reason,
      });
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
      pushEvent({
        type: 'peer_update',
        ts: Date.now(),
        peerId: presence.deviceId,
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
      pushEvent({
        type: 'peer_update',
        ts: Date.now(),
        peerId: envelope.from,
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
      pushEvent({
        type: 'chat',
        ts: Date.now(),
        peerId: message.from,
        messageId: message.id,
      });
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
      pushEvent({
        type: 'ack',
        ts: Date.now(),
        peerId: ack.recipientId,
        delivered: ack.delivered,
        reason: ack.reason,
      });
    },
  });

  const sendMessage = async (recipient: string, content: string): Promise<string> => {
    const trimmedRecipient = recipient.trim();
    const trimmedContent = content.trim();
    if (!trimmedRecipient) {
      throw new Error('recipient_required');
    }
    if (!trimmedContent) {
      throw new Error('message_required');
    }
    const id = await meshClient.sendChatMessage(trimmedRecipient, trimmedContent);
    activePeer = trimmedRecipient;
    appendHistory(trimmedRecipient, {
      id,
      direction: 'out',
      peer: trimmedRecipient,
      content: trimmedContent,
      timestamp: Date.now(),
      verified: true,
    });
    return id;
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const method = request.method || 'GET';
      const parsed = new URL(request.url || '/', `http://${launchOptions.host}:${launchOptions.port}`);
      const pathname = parsed.pathname;

      if (method === 'GET' && pathname === '/') {
        const html = renderHtml();
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-store',
        });
        response.end(html);
        return;
      }

      if (method === 'GET' && pathname === '/api/status') {
        sendJson(response, 200, {
          device_id: identity.device_id,
          mesh_endpoint: meshEndpoint,
          connected: meshConnected,
          last_disconnect_reason: lastDisconnectReason,
          active_peer: activePeer,
          last_inbound_peer: lastInboundPeer,
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/peers') {
        sendJson(response, 200, {
          peers: Array.from(peers.values()).sort((a, b) => a.id.localeCompare(b.id)),
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/history') {
        const requestedPeer = (parsed.searchParams.get('peer') || activePeer || lastInboundPeer).trim();
        sendJson(response, 200, {
          peer: requestedPeer,
          entries: requestedPeer ? historyByPeer.get(requestedPeer) || [] : [],
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/active-peer') {
        const body = await readJsonBody(request);
        const peerId = typeof body.peerId === 'string' ? body.peerId.trim() : '';
        activePeer = peerId;
        sendJson(response, 200, { ok: true, active_peer: activePeer });
        return;
      }

      if (method === 'POST' && pathname === '/api/send') {
        const body = await readJsonBody(request);
        const peerIdRaw = typeof body.peerId === 'string' ? body.peerId : '';
        const peerId = (peerIdRaw.trim() || activePeer || lastInboundPeer).trim();
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const messageId = await sendMessage(peerId, message);
        pushEvent({
          type: 'message_sent',
          ts: Date.now(),
          peerId,
          messageId,
        });
        sendJson(response, 200, {
          ok: true,
          message_id: messageId,
          peer: peerId,
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.write(': stream-open\n\n');
        response.write(`data: ${JSON.stringify({ type: 'hello', ts: Date.now() })}\n\n`);
        const keepalive = setInterval(() => {
          response.write(': ping\n\n');
        }, 20000);
        sseClients.add(response);

        request.on('close', () => {
          clearInterval(keepalive);
          sseClients.delete(response);
        });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message });
    });
  });

  const shutdown = async (): Promise<void> => {
    meshClient.stop();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    for (const client of sseClients) {
      client.end();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await saveHistory(historyByPeer).catch(() => {
      // Ignore final save errors during shutdown.
    });
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(launchOptions.port, launchOptions.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  meshClient.start();

  const uiUrl = `http://${launchOptions.host}:${launchOptions.port}`;
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   CODERALPHIE CHAT GUI APP                    ║');
  console.log('║        Pi-side mesh chat with desktop-style interface         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Local identity: ${identity.device_id}`);
  console.log(`Mesh endpoint: ${meshEndpoint}`);
  console.log(`GUI URL: ${uiUrl}`);

  if (launchOptions.noOpen) {
    console.log('Browser auto-open disabled (--no-open).');
  } else if (openInBrowser(uiUrl)) {
    console.log('Opened GUI in browser.');
  } else {
    console.log('Could not auto-open browser. Open this URL manually on the Pi:');
    console.log(`  ${uiUrl}`);
  }
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
