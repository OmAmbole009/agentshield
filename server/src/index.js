const config = require('./config/env');
const { createApp } = require('./app');

const { app } = createApp();

const server = app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  AgentShield Security Platform running on port ${config.port}`);
  console.log(`🛡️  Environment: ${config.nodeEnv}`);
  console.log(`🛡️  Database: node:sqlite (${config.databasePath})`);
  console.log(`🛡️  Gnani Voice: ${config.gnani.enabled ? 'LIVE (' + config.gnani.modelStt + ')' : 'MOCK MODE (Safe Default)'}`);
  console.log(`🛡️  Credit Budget: ${config.gnani.creditBudget} (Reserve: ${config.gnani.creditReserve})`);
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down AgentShield server gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
