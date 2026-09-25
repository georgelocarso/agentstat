import { Command } from 'commander';
import { createServer } from './server.js';
import { SessionRegistry } from './registry.js';
import { TokenAuth } from './auth.js';
import { PtyWrapper } from './runner/pty-wrapper.js';
import type { CollectorConfig } from '@agentstat/shared';
import os from 'node:os';

const program = new Command();

program
  .name('hud')
  .description('Agent Status - Real-time monitoring daemon and HUD for coding agents')
  .version('0.1.0');

// hud start: Start the collector daemon
program
  .command('start')
  .description('Start the local Agent Status collector daemon')
  .option('-p, --port <number>', 'Port to listen on', '4111')
  .option('--lan', 'Expose on 0.0.0.0 for LAN access with token authentication', false)
  .option('--token <token>', 'Custom bearer token for remote dashboard access')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const lan = !!options.lan;
    const host = lan ? '0.0.0.0' : '127.0.0.1';

    const config: CollectorConfig = {
      port,
      host,
      lan,
      token: options.token,
      staleTimeoutMs: 60 * 60 * 1000,
      purgeTimeoutMs: 60 * 60 * 1000,
    };

    const auth = new TokenAuth(lan, options.token);
    const registry = new SessionRegistry(config.staleTimeoutMs, config.purgeTimeoutMs);
    const app = createServer(config, registry, auth);

    // Start automatic agy session transcript watcher
    const { TranscriptWatcher } = await import('./watcher/transcript-watcher.js');
    const watcher = new TranscriptWatcher(registry);
    watcher.start();
    const { CodexRolloutWatcher } = await import('./watcher/codex-rollout-watcher.js');
    const codexWatcher = new CodexRolloutWatcher(registry);
    codexWatcher.start();

    const server = app.listen(port, host, () => {
      console.log(`\n\x1b[36m⚡ [agentstat] Collector Daemon running on http://${host}:${port}\x1b[0m`);
      if (lan) {
        console.log(`\x1b[33m🔑 Remote / LAN Access URL:\x1b[0m`);
        console.log(`   http://localhost:${port}/?token=${auth.getToken()}`);
        const ifaces = os.networkInterfaces();
        for (const [name, addrs] of Object.entries(ifaces)) {
          for (const addr of addrs || []) {
            if (addr.family === 'IPv4' && !addr.internal) {
              console.log(`   http://${addr.address}:${port}/?token=${auth.getToken()} (${name})`);
            }
          }
        }
      } else {
        console.log(`   Dashboard: http://127.0.0.1:${port}`);
      }
      console.log(`\x1b[90mPress Ctrl+C to terminate the daemon.\x1b[0m\n`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\x1b[31mError: Port ${port} is already in use by another process or existing agentstat daemon.\x1b[0m`);
        console.error(`You can specify a different port: \x1b[33mpnpm --filter @agentstat/daemon run dev -- --port 4112\x1b[0m`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });
  });

// hud run -- <cmd>: Intercept agent lifecycle in PTY
program
  .command('run')
  .description('Run a command wrapped in the PTY sniffer (e.g., hud run -- agy)')
  .allowUnknownOption(true)
  .option('--daemon <url>', 'URL of collector daemon', 'http://127.0.0.1:4111')
  .option('--token <token>', 'Auth token for collector daemon')
  .argument('<command...>', 'The agent command to execute')
  .action(async (commandParts, options) => {
    const [command, ...args] = commandParts;
    const runner = new PtyWrapper({
      command,
      args,
      daemonUrl: options.daemon,
      token: options.token,
    });

    const exitCode = await runner.start(command, args);
    process.exit(exitCode);
  });

// hud status: Check daemon status and list active sessions
program
  .command('status')
  .description('List active sessions from the collector daemon')
  .option('--daemon <url>', 'URL of collector daemon', 'http://127.0.0.1:4111')
  .action(async (options) => {
    try {
      const res = await fetch(`${options.daemon}/api/sessions`);
      if (!res.ok) {
        console.error(`Error querying daemon: HTTP ${res.status}`);
        process.exit(1);
      }
      const data: any = await res.json();
      const sessions = data.sessions || [];
      if (sessions.length === 0) {
        console.log('No active sessions.');
        return;
      }
      console.table(
        sessions.map((s: any) => ({
          ID: s.sessionId,
          State: s.state,
          Project: s.project,
          Branch: s.gitBranch || '-',
          Started: new Date(s.startedAt).toLocaleTimeString(),
          Prompt: s.promptSnippet || '-',
        }))
      );
    } catch {
      console.error(`Could not connect to Agent Status daemon at ${options.daemon}. Is it running?`);
      process.exit(1);
    }
  });

// If no command is provided, default to starting the collector daemon
if (process.argv.length <= 2) {
  process.argv.push('start');
}

program.parse(process.argv);
