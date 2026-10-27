const express = require('express');

function createProviderRouter({ budgetGuard, gnaniAdapter }) {
  const router = express.Router();

  /**
   * GET /api/provider/usage
   * Telemetry on Gnani and AI provider calls, credits, and budget guard status.
   */
  router.get('/usage', (req, res, next) => {
    try {
      const summary = budgetGuard.getUsageSummary();
      res.json({
        success: true,
        summary
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/provider/test-speech
   * Explicit user-initiated voice synthesis test. Never called automatically.
   */
  router.post('/test-speech', async (req, res, next) => {
    try {
      const { text = 'AgentShield security gateway online.' } = req.body;
      const result = await gnaniAdapter.synthesizeSpeech(text, {
        voice: 'Nalini',
        model: 'timbre-v2.5'
      });
      res.json({
        success: true,
        result
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createProviderRouter
};
