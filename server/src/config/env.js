const path = require('node:path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databasePath: process.env.DATABASE_PATH || './data/agentshield.sqlite',
  jwtSecret: process.env.JWT_SECRET || 'demo-secret-agentshield-security-token-do-not-use-in-prod',
  verificationExpirySeconds: parseInt(process.env.VERIFICATION_CODE_EXPIRY_SECONDS || '300', 10),
  idempotencyWindowSeconds: parseInt(process.env.IDEMPOTENCY_WINDOW_SECONDS || '86400', 10),
  aiProvider: process.env.AI_MODEL_PROVIDER || 'deterministic',

  // Gnani platform configuration
  gnani: {
    enabled: process.env.GNANI_ENABLED === 'true',
    apiKey: process.env.GNANI_API_KEY || '',
    baseUrl: process.env.GNANI_BASE_URL || 'https://api.vachana.ai',
    sttEndpoint: process.env.GNANI_STT_ENDPOINT || 'https://api.vachana.ai/stt/v3',
    ttsEndpoint: process.env.GNANI_TTS_ENDPOINT || 'wss://api.vachana.ai/api/v1/tts',
    modelStt: process.env.GNANI_MODEL_STT || 'prisma-v2.5',
    modelTts: process.env.GNANI_MODEL_TTS || 'timbre-v2.5',
    modelLlm: process.env.GNANI_MODEL_LLM || 'evon-v3.3',
    creditBudget: parseInt(process.env.GNANI_CREDIT_BUDGET || '5000', 10),
    creditReserve: parseInt(process.env.GNANI_CREDIT_RESERVE || '1000', 10),
    autoRetry: process.env.GNANI_AUTO_RETRY === 'true'
  }
};

module.exports = config;
