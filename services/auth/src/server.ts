import { createServer, IncomingMessage, ServerResponse } from 'http';
import AuthService from './index';

const PORT = parseInt(process.env.PORT || '3001', 10);
const authService = new AuthService();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function extractBearerToken(req: IncomingMessage): string {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return '';
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return '';
  }

  return token;
}

const server = createServer((req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'invalid request' });
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', service: 'auth' });
    return;
  }

  if (req.url === '/auth/validate' && req.method === 'POST') {
    const token = extractBearerToken(req);
    const authenticated = authService.authenticate(token);
    if (!authenticated) {
      sendJson(res, 401, { authenticated: false });
      return;
    }

    sendJson(res, 200, { authenticated: true });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AuthService] listening on ${PORT}`);
});
