const express = require('express');
const cors = require('cors');
const path = require('node:path');
const config = require('./config/env');
const { getDb } = require('./db/connection');
const { initSchema } = require('./db/schema');
const { seedDatabase } = require('./db/seed');
const { PolicyEngine } = require('./policy/engine');
const { ChallengeService } = require('./verification/challengeService');
const { AuditLogger } = require('./audit/auditLogger');
const { BankingService } = require('./business/bankingService');
const { IntentExtractor } = require('./ai/intentExtractor');
const { BudgetGuard } = require('./providers/budgetGuard');
const { createGnaniAdapter } = require('./providers/gnani/gnaniAdapter');
const { SecurityGateway } = require('./gateway/securityGateway');

const { authMiddleware } = require('./api/middleware/authMiddleware');
const { errorHandler, rateLimiter } = require('./api/middleware/errorHandler');

const { createGatewayRouter } = require('./api/routes/gatewayRoutes');
const { createPolicyRouter } = require('./api/routes/policyRoutes');
const { createAuditRouter } = require('./api/routes/auditRoutes');
const { createProviderRouter } = require('./api/routes/providerRoutes');
const { createAccountRouter } = require('./api/routes/accountRoutes');
const { createScenariosRouter } = require('./api/routes/scenariosRoutes');

function createApp(customDb = null) {
  const app = express();
  const db = customDb || getDb();

  // Initialize schema if not present
  initSchema(db);

  // Instantiate core security components
  const policyEngine = new PolicyEngine(db);
  const challengeService = new ChallengeService(db);
  const auditLogger = new AuditLogger(db);
  const bankingService = new BankingService(db);
  const budgetGuard = new BudgetGuard(db);
  const gnaniAdapter = createGnaniAdapter({ budgetGuard });
  const intentExtractor = new IntentExtractor({ deterministicOnly: !config.gnani.enabled });

  const securityGateway = new SecurityGateway({
    db,
    policyEngine,
    challengeService,
    auditLogger,
    bankingService,
    intentExtractor,
    gnaniAdapter
  });

  // Global middlewares
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-Tenant-Id', 'X-User-Role', 'X-Agent-Id']
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(rateLimiter({ maxRequests: 200, windowSeconds: 60 }));
  app.use(authMiddleware);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'HEALTHY',
      service: 'AgentShield Security Platform',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'connected (node:sqlite)',
      gnani: {
        enabled: config.gnani.enabled,
        modelStt: config.gnani.modelStt,
        modelTts: config.gnani.modelTts,
        modelLlm: config.gnani.modelLlm
      }
    });
  });

  // Mount API routers
  app.use('/api/gateway', createGatewayRouter({ securityGateway }));
  app.use('/api/policies', createPolicyRouter({ db }));
  app.use('/api/audit', createAuditRouter({ auditLogger }));
  app.use('/api/provider', createProviderRouter({ budgetGuard, gnaniAdapter }));
  app.use('/api/accounts', createAccountRouter({ bankingService, db }));
  app.use('/api/scenarios', createScenariosRouter({ securityGateway, bankingService, db }));

  // Serve static client bundle if built
  const clientDist = path.resolve(process.cwd(), 'client/dist');
  app.use(express.static(clientDist));

  // Catch-all route to support client SPA routing
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    const indexHtml = path.join(clientDist, 'index.html');
    res.sendFile(indexHtml, (err) => {
      if (err) {
        res.status(200).send('AgentShield API Server Running. Client frontend is available in dev mode at http://localhost:5173');
      }
    });
  });

  // Central error handling
  app.use(errorHandler);

  return {
    app,
    db,
    securityGateway,
    policyEngine,
    challengeService,
    auditLogger,
    bankingService,
    budgetGuard,
    gnaniAdapter
  };
}

module.exports = {
  createApp
};
