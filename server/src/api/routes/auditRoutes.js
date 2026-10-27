const express = require('express');

function createAuditRouter({ auditLogger }) {
  const router = express.Router();

  /**
   * GET /api/audit
   * Searchable, filterable audit event explorer
   */
  router.get('/', (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const eventType = req.query.eventType || null;
      const decision = req.query.decision || null;
      const actionType = req.query.actionType || null;

      const events = auditLogger.getEvents({ limit, offset, eventType, decision, actionType });
      res.json({
        success: true,
        total: events.length,
        events
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/audit/verify-chain
   * Cryptographically verifies the SHA-256 hash chain across all historical audit records.
   */
  router.get('/verify-chain', (req, res, next) => {
    try {
      const report = auditLogger.verifyChainIntegrity();
      res.json({
        success: true,
        report
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createAuditRouter
};
