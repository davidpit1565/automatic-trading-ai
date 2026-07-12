/**
 * One-command start: launches the Revolut X read-only proxy and the
 * dashboard dev server together, so `npm start` is all a user needs.
 * Stopping (Ctrl+C) stops both.
 */

import { spawn } from 'node:child_process';

const children = [];

function launch(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code ?? 'signal'}) — shutting down.`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

function shutdown(code) {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting the AI Trading Assistant…');
console.log('  proxy      -> read-only Revolut X market data (needs .env for live data)');
console.log('  dashboard  -> http://localhost:5173');
console.log('Press Ctrl+C to stop both.\n');

launch('proxy', process.execPath, ['server/revxProxy.mjs']);
launch('dashboard', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite']);
