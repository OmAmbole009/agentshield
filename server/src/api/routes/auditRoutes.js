const express = require('express');

function createAuditRouter({ auditLogger }) {
  const router = express.Router();

  const getEventsHandler = (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const eventType = req.query.eventType || null;
      const decision = req.query.decision || null;
      const actionType = req.query.actionType || null;
      const userId = req.user?.role === 'admin' ? null : req.user?.id;

      const events = auditLogger.getEvents({ limit, offset, eventType, decision, actionType, userId });
      res.json({
        success: true,
        total: events.length,
        events
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/audit and /api/audit/events
   * Searchable, filterable audit event explorer
   */
  router.get('/', getEventsHandler);
  router.get('/events', getEventsHandler);

  const verifyChainHandler = (req, res, next) => {
    try {
      const report = auditLogger.verifyChainIntegrity();
      res.json({
        success: true,
        valid: report.isChainValid,
        report
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/audit/verify-chain and /api/audit/verify
   * Cryptographically verifies the SHA-256 hash chain across all historical audit records.
   */
  router.get('/verify-chain', verifyChainHandler);
  router.get('/verify', verifyChainHandler);

  return router;
}

module.exports = {
  createAuditRouter
};
