const http = require('node:http');
const port = Number(process.env.MOCK_LATTICE_PORT || 4010);
let entityTick = 0;
let taskTick = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

  if (req.method === 'POST' && url.pathname === '/api/v2/oauth/token') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ access_token: 'demo-env-token', expires_in: 1800, scope: 'lattice' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/entities') {
    entityTick += 1;
    const ts = Date.now();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      entities: [{
        entity_id: 'stealth-entity-01',
        source: 'lattice',
        source_update_time_ms: ts,
        signature_valid: true,
        verification_status: entityTick % 2 === 0 ? 'VERIFIED' : 'STATUS_UNVERIFIED',
        track: { lat: 33.98, lon: -118.42, speed: 12.4 }
      }]
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/tasks/listen-as-agent-stream') {
    taskTick += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      tasks: [{
        task_id: 'stealth-task-01',
        assigned_agent_id: 'agent-01',
        status: taskTick % 2 === 0 ? 'ACKNOWLEDGED' : 'QUEUED',
        status_version: taskTick,
        updated_at_ms: Date.now(),
        trust_posture: 'trusted'
      }]
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/objects') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      objects: [{
        object_id: 'stealth-obj-01',
        entity_id: 'stealth-entity-01',
        object_key: 'evidence/stealth-obj-01.json',
        media_type: 'application/json',
        metadata: { source: 'mock', kind: 'evidence' },
        created_at_ms: Date.now()
      }]
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/v2/objects/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop() || 'unknown');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      object_id: id,
      entity_id: 'stealth-entity-01',
      object_key: `evidence/${id}.json`,
      media_type: 'application/json',
      created_at_ms: Date.now()
    }));
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-lattice-rest] listening on http://127.0.0.1:${port}`);
});
