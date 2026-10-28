const crypto = require('node:crypto');

class CustomerSupportService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Retrieves authorized customer profile.
   */
  getCustomerProfile({ customerId, user }) {
    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) {
      throw new Error(`Customer ${customerId} not found.`);
    }

    if (customer.user_id !== user.id && user.role !== 'admin') {
      throw new Error(`Unauthorized access to customer ${customerId}.`);
    }

    const subscriptions = this.db.prepare('SELECT * FROM subscriptions WHERE customer_id = ?').all(customerId);

    return {
      customerId: customer.id,
      userId: customer.user_id,
      tenantId: customer.tenant_id,
      name: customer.name,
      email: customer.email,
      tier: customer.tier,
      status: customer.status,
      subscriptions,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves orders for an authorized customer.
   */
  getCustomerOrders({ customerId, user }) {
    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) {
      throw new Error(`Customer ${customerId} not found.`);
    }

    if (customer.user_id !== user.id && user.role !== 'admin') {
      throw new Error(`Unauthorized access to customer orders for ${customerId}.`);
    }

    const orders = this.db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    const parsedOrders = orders.map(ord => ({
      ...ord,
      items: JSON.parse(ord.items_json || '[]'),
      remainingRefundable: Math.round((ord.total_amount - ord.refunded_amount) * 100) / 100
    }));

    return {
      customerId: customer.id,
      customerName: customer.name,
      orders: parsedOrders,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves order details with refund history.
   */
  getOrderDetails({ orderId, user }) {
    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    if (!customer || (customer.user_id !== user.id && user.role !== 'admin')) {
      throw new Error(`Unauthorized access to order ${orderId}.`);
    }

    const refunds = this.db.prepare('SELECT * FROM order_refunds WHERE order_id = ? ORDER BY created_at DESC').all(orderId);

    return {
      order: {
        ...order,
        items: JSON.parse(order.items_json || '[]'),
        remainingRefundable: Math.round((order.total_amount - order.refunded_amount) * 100) / 100
      },
      customer,
      refunds,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Executes an authorized refund with database transaction, atomic remaining check,
   * rollback protection, and idempotency key replay defense.
   */
  issueRefund({
    orderId,
    amount,
    reason = 'Customer requested refund',
    idempotencyKey = null,
    user,
    approvalId = null,
    simulateFailure = false
  }) {
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid refund amount: must be strictly positive numeric.');
    }

    // 1. Idempotency Check: if key already exists, return existing execution without double-refund
    if (idempotencyKey) {
      const existingRefund = this.db.prepare('SELECT * FROM order_refunds WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingRefund) {
        const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(existingRefund.order_id);
        return {
          isReplay: true,
          refund: existingRefund,
          order: order ? {
            ...order,
            remainingRefundable: Math.round((order.total_amount - order.refunded_amount) * 100) / 100
          } : null,
          message: 'Idempotent request: returning previous completed execution.'
        };
      }
    }

    const refundId = `ref_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    // 2. Atomic Database Transaction with Immediate Lock
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');

    try {
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      if (!customer || (customer.user_id !== user.id && user.role !== 'admin')) {
        throw new Error(`Unauthorized refund attempt: Order ${orderId} does not belong to authorized user.`);
      }

      if (order.status === 'REFUNDED' || order.status === 'CANCELLED') {
        throw new Error(`Order ${orderId} is ineligible for refund (status: ${order.status}).`);
      }

      const remainingRefundable = Math.round((order.total_amount - order.refunded_amount) * 100) / 100;
      if (numericAmount > remainingRefundable) {
        throw new Error(`Requested refund amount ($${numericAmount.toFixed(2)}) exceeds remaining refundable balance ($${remainingRefundable.toFixed(2)}).`);
      }

      // Simulated Backend Failure for Testing Rollback Safety
      if (simulateFailure) {
        throw new Error('SIMULATED_BACKEND_FAILURE: Upstream payment processor timeout during refund settlement.');
      }

      const newRefundedAmount = Math.round((order.refunded_amount + numericAmount) * 100) / 100;
      const newStatus = newRefundedAmount >= order.total_amount ? 'REFUNDED' : order.status;

      // Update Order Refunded Amount
      this.db.prepare(`
        UPDATE orders 
        SET refunded_amount = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(newRefundedAmount, newStatus, now, orderId);

      // Record Refund Transaction
      this.db.prepare(`
        INSERT INTO order_refunds (
          id, order_id, customer_id, amount, reason, status, idempotency_key, approval_id, created_at
        ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
      `).run(
        refundId,
        orderId,
        order.customer_id,
        numericAmount,
        reason,
        idempotencyKey || null,
        approvalId || null,
        now
      );

      this.db.exec('COMMIT;');

      return {
        isReplay: false,
        refund: {
          id: refundId,
          orderId,
          customerId: order.customer_id,
          amount: numericAmount,
          reason,
          status: 'COMPLETED',
          idempotencyKey,
          approvalId,
          executedAt: now
        },
        order: {
          id: order.id,
          totalAmount: order.total_amount,
          previousRefunded: order.refunded_amount,
          newRefunded: newRefundedAmount,
          remainingRefundable: Math.round((order.total_amount - newRefundedAmount) * 100) / 100,
          status: newStatus
        }
      };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Updates an authorized subscription plan.
   */
  updateSubscription({ subscriptionId, newPlan, cancelAtPeriodEnd = false, user }) {
    const sub = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
    if (!sub) {
      throw new Error(`Subscription ${subscriptionId} not found.`);
    }

    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(sub.customer_id);
    if (!customer || (customer.user_id !== user.id && user.role !== 'admin')) {
      throw new Error(`Unauthorized access to subscription ${subscriptionId}.`);
    }

    const planPrices = {
      basic: 9.99,
      pro: 29.99,
      enterprise: 99.99
    };

    const newPrice = planPrices[newPlan] || sub.price;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE subscriptions
      SET plan = ?, price = ?, cancel_at_period_end = ?, updated_at = ?
      WHERE id = ?
    `).run(newPlan, newPrice, cancelAtPeriodEnd ? 1 : 0, now, subscriptionId);

    const updated = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);

    return {
      subscription: updated,
      previousPlan: sub.plan,
      newPlan,
      updatedAt: now
    };
  }

  /**
   * Helper for UI: Get customers for user
   */
  getUserCustomers(userId) {
    return this.db.prepare('SELECT * FROM customers WHERE user_id = ?').all(userId);
  }

  /**
   * Helper for UI: Get orders for user
   */
  getUserOrders(userId) {
    return this.db.prepare(`
      SELECT o.*, c.name as customer_name 
      FROM orders o 
      JOIN customers c ON o.customer_id = c.id 
      WHERE c.user_id = ?
      ORDER BY o.created_at DESC
    `).all(userId);
  }
}

module.exports = {
  CustomerSupportService
};
