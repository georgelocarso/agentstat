import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from './server.js';
import { SessionRegistry } from './registry.js';
import { TokenAuth } from './auth.js';
import type { AgentEvent } from '@agentstat/shared';

describe('Collector Server API', () => {
  let registry: SessionRegistry;
  let auth: TokenAuth;
  let app: any;

  beforeEach(() => {
    registry = new SessionRegistry(1000, 2000);
    auth = new TokenAuth(false, 'test-secret-token');
    app = createServer(
      {
        port: 4111,
        host: '127.0.0.1',
        lan: false,
        token: 'test-secret-token',
        staleTimeoutMs: 1000,
        purgeTimeoutMs: 2000,
      },
      registry,
      auth
    );
  });

  afterEach(() => {
    registry.stop();
  });

  it('responds with health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.activeSessions).toBe(0);
  });

  it('ingests agent events and lists sessions', async () => {
    const testEvent: AgentEvent = {
      eventId: 'evt_1',
      sessionId: 'agy_sess_test',
      agentType: 'agy',
      state: 'working',
      project: 'order-service',
      displayPath: '~/repos/order-service',
      timestamp: new Date().toISOString(),
    };

    const postRes = await request(app).post('/api/events').send(testEvent);
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('ok');
    expect(postRes.body.snapshot.sessionId).toBe('agy_sess_test');

    const listRes = await request(app).get('/api/sessions');
    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions).toHaveLength(1);
    expect(listRes.body.sessions[0].state).toBe('working');
  });

  it('enforces token authentication when LAN mode is active', async () => {
    const lanAuth = new TokenAuth(true, 'secret-123');
    const lanApp = createServer(
      {
        port: 4111,
        host: '0.0.0.0',
        lan: true,
        token: 'secret-123',
        staleTimeoutMs: 1000,
        purgeTimeoutMs: 2000,
      },
      registry,
      lanAuth
    );

    // Without token: 401
    const unauthRes = await request(lanApp).get('/api/sessions');
    expect(unauthRes.status).toBe(401);

    // With query token: 200
    const queryRes = await request(lanApp).get('/api/sessions?token=secret-123');
    expect(queryRes.status).toBe(200);

    // With bearer token: 200
    const bearerRes = await request(lanApp)
      .get('/api/sessions')
      .set('Authorization', 'Bearer secret-123');
    expect(bearerRes.status).toBe(200);
  });

  it('updates session metadata via PATCH and bulk POST', async () => {
    const testEvent: AgentEvent = {
      eventId: 'evt_meta',
      sessionId: 'sess_meta_1',
      agentType: 'agy',
      state: 'working',
      project: 'meta-project',
      displayPath: '~/repos/meta-project',
      timestamp: new Date().toISOString(),
    };

    await request(app).post('/api/events').send(testEvent);

    // PATCH pinned
    const patchRes = await request(app)
      .patch('/api/sessions/sess_meta_1')
      .send({ pinned: true, archived: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.session.pinned).toBe(true);
    expect(patchRes.body.session.archived).toBe(false);

    // Bulk archive
    const bulkRes = await request(app)
      .post('/api/sessions/bulk')
      .send({ ids: ['sess_meta_1'], action: 'archive' });
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.updatedCount).toBe(1);

    const checkRes = await request(app).get('/api/sessions');
    expect(checkRes.body.sessions[0].archived).toBe(true);
  });
});
