const { spawn } = require('node:child_process');
const path = require('node:path');

console.log('🚀 Starting AgentShield Development Environment...');

// 1. Start Backend Express Server
const server = spawn('node', ['server/src/index.js'], {
  stdio: 'inherit',
  shell: true
});

// 2. Start Frontend Vite Dev Server
const client = spawn('npm', ['--prefix', 'client', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true
});

const cleanup = () => {
  console.log('\nShutting down dev processes...');
  server.kill();
  client.kill();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
