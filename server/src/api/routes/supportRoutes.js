const express = require('express');
const { ACTION_TYPES } = require('../../registry/actions');

function createSupportRouter({ customerSupportService, securityGateway, db }) {
  const router = express.Router();

  /**
   * GET /api/support/customers
   * Lists customers for the active demo user (or all demo customers if requested).
   */
  router.get('/customers', (req, res, next) => {
    try {
      const showAll = req.query.all === 'true' || req.user?.role === 'admin';
      const customers = showAll
        ? db.prepare('SELECT * FROM customers ORDER BY id ASC').all()
        : customerSupportService.getUserCustomers(req.user.id);

      res.json({
        success: true,
        customers
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/support/customers/:id
   * Retrieves specific customer profile.
   */
  router.get('/customers/:id', (req, res, next) => {
    try {
      const profile = customerSupportService.getCustomerProfile({
        customerId: req.params.id,
        user: req.user
      });
      res.json({
        success: true,
        customer: profile
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/support/customers/:id/orders
   * Retrieves orders for a specific customer.
   */
  router.get('/customers/:id/orders', (req, res, next) => {
    try {
      const result = customerSupportService.getCustomerOrders({
        customerId: req.params.id,
        user: req.user
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
   * GET /api/support/orders
   * Lists orders for active user or all demo orders.
   */
  router.get('/orders', (req, res, next) => {
    try {
      const showAll = req.query.all === 'true' || req.user?.role === 'admin';
      const orders = showAll
        ? db.prepare(`
            SELECT o.*, c.name as customer_name, c.user_id 
            FROM orders o 
            JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.created_at DESC
          `).all()
        : customerSupportService.getUserOrders(req.user.id);

      const parsed = orders.map(ord => ({
        ...ord,
        items: JSON.parse(ord.items_json || '[]'),
        remainingRefundable: Math.round((ord.total_amount - ord.refunded_amount) * 100) / 100
      }));

      res.json({
        success: true,
        orders: parsed
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/support/orders/:id
   * Retrieves specific order details with refund history.
   */
  router.get('/orders/:id', (req, res, next) => {
    try {
      const details = customerSupportService.getOrderDetails({
        orderId: req.params.id,
        user: req.user
      });
      res.json({
        success: true,
        ...details
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/support/direct-refund
   * Direct API endpoint for refund processing.
   * CRITICAL SECURITY PRINCIPLE: Direct API calls must pass through the
   * Security Gateway's deterministic authorization policy!
   */
  router.post('/direct-refund', async (req, res, next) => {
    try {
      const { orderId, amount, reason, idempotencyKey } = req.body;

      const result = await securityGateway.processRequest({
        directAction: {
          actionType: ACTION_TYPES.ISSUE_REFUND,
          payload: { orderId, amount, reason, idempotencyKey }
        },
        user: req.user,
        agent: req.agent,
        idempotencyKey
      });

      if (result.decision === 'DENY') {
        return res.status(403).json({
          success: false,
          decision: result.decision,
          reasonCode: result.policyDecision?.reasonCode,
          error: result.policyDecision?.message || 'Direct API refund denied by policy engine.',
          policyId: result.policyDecision?.policyId
        });
      }

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createSupportRouter
};
