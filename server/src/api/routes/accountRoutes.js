const express = require('express');
const { seedDatabase } = require('../../db/seed');

function createAccountRouter({ bankingService, db }) {
  const router = express.Router();

  /**
   * GET /api/accounts
   */
  router.get('/', (req, res, next) => {
    try {
      const accounts = bankingService.getUserAccounts(req.user.id);
      res.json({ success: true, accounts });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/recipients
   */
  router.get('/recipients', (req, res, next) => {
    try {
      const recipients = bankingService.getUserRecipients(req.user.id);
      res.json({ success: true, recipients });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/transactions
   */
  router.get('/transactions', (req, res, next) => {
    try {
      const transactions = bankingService.getTransactionHistory(req.user.id);
      res.json({ success: true, transactions });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/db/reset
   * Re-seeds demo database to clean baseline.
   */
  router.post('/reset', (req, res, next) => {
    try {
      const result = seedDatabase(db);
      res.json({
        success: true,
        message: 'Demo database re-seeded successfully.',
        result
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createAccountRouter
};
