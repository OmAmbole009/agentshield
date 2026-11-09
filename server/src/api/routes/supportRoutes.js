const express = require('express');
const { ACTION_TYPES } = require('../../registry/actions');
const { transcribeAudioInput } = require('../../providers/gnani/audioInput');

function createSupportRouter({ customerSupportService, securityGateway, db, auditLogger, gnaniAdapter }) {
  const router = express.Router();

  router.post('/chat', async (req, res, next) => {
    try {
      const { audioBase64, audioOptions = {}, message, conversationId } = req.body;
      if (audioBase64 !== undefined && audioBase64 !== null) {
        const transcription = await transcribeAudioInput(gnaniAdapter, audioBase64, audioOptions);
        return res.json({ success: true, requiresConfirmation: true, ...transcription });
      }

      const result = customerSupportService.createConversation({
        user: req.user, conversationId, message
      });
      const event = result.metadata?.decision === 'DENY' ? 'SECURITY_BREACH_ATTEMPT' : 'SUPPORT_CONVERSATION';
      auditLogger.logEvent({
        requestId: `req_${result.conversationId}_${Date.now()}`, eventType: event,
        agentId: req.agent?.id, userId: req.user?.id,
        actionType: 'CUSTOMER_SUPPORT', decision: result.metadata?.decision || 'ALLOW',
        reasonCode: result.classification || 'SUPPORT_RESPONSE',
        payload: { conversationId: result.conversationId, orderId: result.order?.id, classification: result.classification }
      });
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  });

  router.get('/conversations/:id', (req, res, next) => {
    try {
      res.json({ success: true, ...customerSupportService.getConversation({ user: req.user, conversationId: req.params.id }) });
    } catch (err) { next(err); }
  });

  router.get('/admin/summary', (req, res, next) => {
    try {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Administrator role required.' });
      res.json({ success: true, summary: customerSupportService.getSupportAdminSummary() });
    } catch (err) { next(err); }
  });

  router.get('/tickets', (req, res, next) => {
    try {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Administrator role required.' });
      res.json({ success: true, tickets: customerSupportService.listSupportTickets() });
    } catch (err) { next(err); }
  });

  router.post('/tickets/:id/status', (req, res, next) => {
    try {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Administrator role required.' });
      const status = String(req.body.status || '').toUpperCase();
      if (!['IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be IN_PROGRESS, RESOLVED, or CLOSED.' });
      const ticket = customerSupportService.updateSupportTicket({ ticketId: req.params.id, status, reviewer: req.user });
      const owner = db.prepare('SELECT user_id FROM customers WHERE id = ?').get(ticket.customer_id);
      auditLogger.logEvent({ requestId: `req_ticket_${ticket.id}_${Date.now()}`, eventType: 'SUPPORT_TICKET_UPDATED', agentId: req.user.id, userId: owner?.user_id, actionType: 'SUPPORT_TICKET', decision: 'ALLOW', reasonCode: status, payload: { ticketId: ticket.id, category: ticket.category, status } });
      res.json({ success: true, ticket });
    } catch (err) { next(err); }
  });

  router.get('/refund-approvals', (req, res, next) => {
    try {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Administrator role required.' });
      res.json({ success: true, requests: customerSupportService.listRefundApprovals() });
    } catch (err) { next(err); }
  });

  router.post('/refund-approvals/:id/review', (req, res, next) => {
    try {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Administrator role required.' });
      const decision = String(req.body.decision || '').toUpperCase();
      if (!['APPROVE', 'REJECT'].includes(decision)) return res.status(400).json({ success: false, error: 'Decision must be APPROVE or REJECT.' });
      const result = customerSupportService.reviewRefundApproval({
        approvalId: req.params.id, reviewer: req.user, decision, note: req.body.note, securityGateway
      });
      auditLogger.logEvent({
        requestId: `req_review_${req.params.id}_${Date.now()}`, eventType: decision === 'APPROVE' ? 'HUMAN_APPROVAL_GRANTED' : 'HUMAN_APPROVAL_REJECTED',
        agentId: req.user.id, userId: result.user_id, actionType: 'ISSUE_REFUND',
        decision, reasonCode: 'ADMIN_REVIEW', payload: { approvalId: result.id, orderId: result.order_id, amount: result.amount, note: req.body.note }
      });
      res.json({ success: true, request: result });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/support/customers
   * Lists customers for the active demo user (or all demo customers if requested).
   */
  router.get('/customers', (req, res, next) => {
    try {
      const showAll = req.user?.role === 'admin';
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
      const showAll = req.user?.role === 'admin';
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
