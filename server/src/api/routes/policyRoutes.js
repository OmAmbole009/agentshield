const express = require('express');

function createPolicyRouter({ db }) {
  const router = express.Router();

  /**
   * GET /api/policies
   * Lists all configured policies with parsed JSON rules.
   */
  router.get('/', (req, res, next) => {
    try {
      const rows = db.prepare('SELECT * FROM policies ORDER BY id ASC').all();
      const policies = rows.map(r => ({
        ...r,
        rules: JSON.parse(r.rules_json)
      }));
      res.json({ success: true, policies });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/policies/:id
   * Updates policy configuration.
   * Enforces that an untrusted agent cannot modify its own authorization policies!
   */
  router.put('/:id', (req, res, next) => {
    try {
      const policyId = req.params.id;
      const { enabled, rules } = req.body;

      // Verify administrative privilege
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Security Violation: Only authenticated administrators can modify security policies. AI agents are forbidden from altering policies.',
          errorCode: 'UNAUTHORIZED_POLICY_MODIFICATION'
        });
      }

      const existing = db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: `Policy "${policyId}" not found.`,
          errorCode: 'POLICY_NOT_FOUND'
        });
      }

      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be true or false.', errorCode: 'INVALID_POLICY_UPDATE' });
      }
      if (rules !== undefined && (!rules || typeof rules !== 'object' || Array.isArray(rules))) {
        return res.status(400).json({ success: false, error: 'rules must be a JSON object.', errorCode: 'INVALID_POLICY_UPDATE' });
      }
      const existingRules = JSON.parse(existing.rules_json);
      if (rules && Object.keys(rules).some(key => !Object.hasOwn(existingRules, key))) {
        return res.status(400).json({ success: false, error: 'rules contains an unsupported setting.', errorCode: 'INVALID_POLICY_UPDATE' });
      }
      if (rules && Object.entries(rules).some(([key, value]) => Array.isArray(existingRules[key]) ? !Array.isArray(value) : typeof value !== typeof existingRules[key])) {
        return res.status(400).json({ success: false, error: 'A rule value has the wrong type.', errorCode: 'INVALID_POLICY_UPDATE' });
      }
      const mergedRules = { ...existingRules, ...(rules || {}) };
      const positiveLimits = existing.action_type === 'TRANSFER_FUNDS'
        ? ['maxSingleAmount', 'stepUpThreshold']
        : existing.action_type === 'REQUEST_REFUND'
          ? ['maxAutoRefundAmount']
          : existing.action_type === 'ISSUE_REFUND'
            ? ['maxSingleAmount', 'stepUpThreshold']
            : [];
      for (const key of positiveLimits) {
        if (!Number.isFinite(mergedRules[key]) || mergedRules[key] <= 0) {
          return res.status(400).json({ success: false, error: `${key} must be a positive number.`, errorCode: 'INVALID_POLICY_UPDATE' });
        }
      }
      if (mergedRules.maxSingleAmount !== undefined && mergedRules.stepUpThreshold !== undefined && mergedRules.maxSingleAmount < mergedRules.stepUpThreshold) {
        return res.status(400).json({ success: false, error: 'The maximum amount must be at least the approval threshold.', errorCode: 'INVALID_POLICY_UPDATE' });
      }

      const newVersion = existing.version + 1;
      const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
      const newRulesJson = JSON.stringify(mergedRules);
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE policies 
        SET enabled = ?, rules_json = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(newEnabled, newRulesJson, newVersion, req.user.id, now, policyId);

      res.json({
        success: true,
        message: `Policy "${policyId}" updated to version ${newVersion}.`,
        policy: {
          id: policyId,
          enabled: newEnabled === 1,
          rules: JSON.parse(newRulesJson),
          version: newVersion,
          updatedBy: req.user.id,
          updatedAt: now
        }
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createPolicyRouter
};
