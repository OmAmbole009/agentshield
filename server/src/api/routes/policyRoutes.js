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

      const newVersion = existing.version + 1;
      const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
      const newRulesJson = rules ? JSON.stringify(rules) : existing.rules_json;
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
