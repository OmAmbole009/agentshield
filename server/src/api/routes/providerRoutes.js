const express = require('express');
const { transcribeAudioInput } = require('../../providers/gnani/audioInput');

function createProviderRouter({ budgetGuard, gnaniAdapter }) {
  const router = express.Router();

  /**
   * GET /api/provider/usage and /api/provider/status
   * Telemetry on Gnani and AI provider calls, credits, and budget guard status.
   */
  const usageHandler = (req, res, next) => {
    try {
      const summary = budgetGuard.getUsageSummary();
      res.json({
        success: true,
        status: summary.status,
        provider: 'gnani',
        summary
      });
    } catch (err) {
      next(err);
    }
  };

  router.get('/usage', usageHandler);
  router.get('/status', usageHandler);

  router.post('/transcribe', async (req, res, next) => {
    try {
      const result = await transcribeAudioInput(
        gnaniAdapter,
        req.body.audioBase64,
        req.body.audioOptions
      );
      res.json({ success: true, ...result });
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
      if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
        return res.status(400).json({ success: false, error: 'Text must contain 1–1000 characters.', errorCode: 'INVALID_SPEECH_TEXT' });
      }
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
