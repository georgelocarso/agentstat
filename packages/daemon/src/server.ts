import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, CollectorConfig } from '@agentstat/shared';
import { SessionRegistry } from './registry.js';
import { TokenAuth } from './auth.js';

export function createServer(config: CollectorConfig, registry: SessionRegistry, auth: TokenAuth) {
  const app: Express = express();

  app.use(cors());
  app.use(express.json());

  // SSE client connections
  const sseClients = new Set<Response>();

  // Broadcast updates to all SSE subscribers
  registry.on('session_update', (snapshot) => {
    const payload = `data: ${JSON.stringify({ type: 'session_update', data: snapshot })}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  });

  registry.on('session_deleted', (sessionId) => {
    const payload = `data: ${JSON.stringify({ type: 'session_deleted', data: { sessionId } })}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  });

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      activeSessions: registry.getAllSessions().length,
      lanMode: auth.isLanMode(),
    });
  });

  // Ingest events from PTY runners or native hooks (requires auth if remote)
  app.post('/api/events', auth.middleware(), (req: Request, res: Response) => {
    const event: AgentEvent = req.body;
    if (!event || !event.sessionId || !event.state) {
      res.status(400).json({ error: 'Missing required event fields (sessionId, state)' });
      return;
    }

    const snapshot = registry.recordEvent(event);
    res.status(200).json({ status: 'ok', snapshot });
  });

  // Get all session snapshots (requires auth if remote)
  app.get('/api/sessions', auth.middleware(), (req: Request, res: Response) => {
    res.json({
      sessions: registry.getAllSessions(),
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time SSE Stream (requires auth if remote)
  app.get('/api/events/stream', auth.middleware(), (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);

    // Initial snapshot burst
    const initialData = JSON.stringify({
      type: 'initial_snapshot',
      data: registry.getAllSessions(),
    });
    res.write(`data: ${initialData}\n\n`);

    // Keep-alive heartbeat every 15s
    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Serve static Web HUD assets if built
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../web/dist'),
    path.resolve(process.cwd(), 'packages/web/dist'),
  ];

  const staticDir = candidatePaths.find((p) => fs.existsSync(p));
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    app.get('/', (req: Request, res: Response) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Agent Status Daemon</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem;">
          <h1>Agent Status Daemon (Port ${config.port})</h1>
          <p>Local collector is running in background.</p>
          <p>Web HUD production build not found. Run <code>pnpm --filter @agentstat/web run build</code>.</p>
        </body>
        </html>
      `);
    });
  }

  return app;
}
