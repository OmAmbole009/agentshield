const express = require('express');

function createGatewayRouter({ securityGateway }) {
  const router = express.Router();

  /**
   * POST /api/gateway/process
   * Main entrypoint for natural language (text or audio base64) or direct action proposals.
   */
  router.post('/process', async (req, res, next) => {
    try {
      const {
        text,
        audioBase64,
        audioOptions,
        actionType,
        payload,
        generateAudio,
        idempotencyKey,
        asrConfidence,
        voiceBiometricScore,
        sessionId
      } = req.body;

      let audioBuffer = null;
      if (audioBase64) {
        audioBuffer = Buffer.from(audioBase64, 'base64');
      }

      let directAction = null;
      if (actionType && payload) {
        directAction = { actionType, payload };
      }

      const result = await securityGateway.processRequest({
        text,
        audioBuffer,
        audioOptions,
        directAction,
        user: req.user,
        agent: req.agent,
        idempotencyKey,
        generateAudio: !!generateAudio,
        asrConfidence: asrConfidence !== undefined ? Number(asrConfidence) : null,
        voiceBiometricScore: voiceBiometricScore !== undefined ? Number(voiceBiometricScore) : null,
        sessionId: sessionId || req.headers['x-session-id'] || null
      });

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/gateway/verify
   * Submits a step-up verification code for a pending challenge and completes execution.
   */
  router.post('/verify', async (req, res, next) => {
    try {
      const { challengeId, code, actionType, payload, idempotencyKey } = req.body;

      if (!challengeId || !code) {
        return res.status(400).json({
          success: false,
          error: 'Missing required challengeId or verification code.',
          errorCode: 'MISSING_VERIFICATION_PARAMS'
        });
      }

      const result = await securityGateway.verifyAndExecute({
        challengeId,
        code,
        actionType,
        payload,
        user: req.user,
        agent: req.agent,
        idempotencyKey
      });

      if (!result.success) {
        return res.status(403).json(result);
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/reject', (req, res, next) => {
    try {
      const { challengeId } = req.body;
      if (typeof challengeId !== 'string' || !challengeId) {
        return res.status(400).json({ success: false, error: 'Missing challengeId.', errorCode: 'MISSING_CHALLENGE_ID' });
      }
      const result = securityGateway.rejectPendingApproval({ challengeId, user: req.user, agent: req.agent });
      return res.status(result.success ? 200 : 404).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createGatewayRouter
};
