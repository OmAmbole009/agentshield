const crypto = require('node:crypto');

class CustomerSupportService {
  constructor(db) {
    this.db = db;
  }

  parseOrderItems(itemsJson) {
    return JSON.parse(itemsJson || '[]').map(item => {
      const product = this.db.prepare('SELECT category,returnable,warranty_days FROM support_products WHERE sku = ?').get(item.sku);
      return {
        ...item,
        category: product?.category || null,
        returnable: product ? Boolean(product.returnable) : null,
        warrantyDays: product?.warranty_days ?? null
      };
    });
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
      items: this.parseOrderItems(ord.items_json),
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
        items: this.parseOrderItems(order.items_json),
        remainingRefundable: Math.round((order.total_amount - order.refunded_amount) * 100) / 100
      },
      customer,
      refunds,
      timestamp: new Date().toISOString()
    };
  }

  classifyProductIssue(text) {
    const value = String(text || '').toLowerCase();
    if (/swollen|overheat|overheating|smoke|burning smell|electric shock|sparking/.test(value)) return 'SAFETY_ESCALATION';
    if (/wrong item|wrong product|not what i ordered/.test(value)) return 'WRONG_ITEM';
    if (/missing|never arrived|not in (the )?box/.test(value)) return 'MISSING_ITEM';
    if (/damaged|cracked|broken in transit|arrived broken/.test(value)) return 'DAMAGE_REPORTED';
    if (/warranty|repair/.test(value)) return 'WARRANTY_REQUIRED';
    if (/defect|defective|not charging|won't charge|doesn't work|does not work|not working|still.*(work|charge|connect)/.test(value)) return 'DEFECT_REPORTED';
    if (/fixed|working now|resolved|it works/.test(value)) return 'ISSUE_RESOLVED';
    return 'TROUBLESHOOTING_REQUIRED';
  }

  evaluateRefundEligibility({ order, issue, requestedAmount }) {
    const policy = this.db.prepare("SELECT rules_json FROM policies WHERE action_type = 'ISSUE_REFUND'").get();
    const rules = policy ? JSON.parse(policy.rules_json) : {};
    const windowDays = Number(rules.returnWindowDays);
    const maxAmount = Number(rules.maxSingleAmount);
    const reasons = [];
    if (!order) return { decision: 'PENDING_VERIFICATION', reasons: ['Order details are not verified.'] };
    if (order.payment_status !== 'PAID') reasons.push('Payment is not confirmed as paid.');
    if (order.delivery_status !== 'DELIVERED' || order.status !== 'DELIVERED') reasons.push('Delivery must be confirmed before a standard return can be reviewed.');
    if (!order.purchase_date || !Number.isFinite(windowDays) || windowDays < 1) reasons.push('Purchase date or configured return policy is missing.');
    else {
      const ageDays = Math.floor((Date.now() - Date.parse(order.purchase_date)) / 86400000);
      if (ageDays > windowDays) reasons.push(`The configured ${windowDays}-day return period has passed; warranty review may still be available.`);
    }
    if (order.refunded_amount >= order.total_amount || order.status === 'REFUNDED') return { decision: 'ALREADY_PROCESSED', reasons: ['This order has already been fully refunded.'] };
    const amount = Number(requestedAmount);
    const remaining = Math.round((order.total_amount - order.refunded_amount) * 100) / 100;
    const items = order.items || JSON.parse(order.items_json || '[]');
    const products = items.map(item => this.db.prepare('SELECT * FROM support_products WHERE sku = ?').get(item.sku));
    if (!items.length || products.some(product => !product)) reasons.push('Product details could not be verified against the support catalog.');
    else if (products.some(product => !product.returnable)) reasons.push('This product category is marked non-returnable by the configured catalog policy; warranty review may still be available.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) reasons.push(`Requested amount must be positive and no more than $${remaining.toFixed(2)}.`);
    if (Number.isFinite(maxAmount) && amount > maxAmount) reasons.push(`The configured per-request refund limit is $${maxAmount.toFixed(2)}; a human exception review is required.`);
    if (!issue || !['DEFECT_REPORTED', 'DAMAGE_REPORTED', 'MISSING_ITEM', 'WRONG_ITEM'].includes(issue.classification)) reasons.push('A product issue must be verified before a refund can be reviewed.');
    if (reasons.length) return { decision: 'INELIGIBLE', reasons };
    const approvalThreshold = Number(rules.humanApprovalThreshold || 500);
    const approvalReason = amount >= approvalThreshold
      ? `High-value request meets the configured $${approvalThreshold.toFixed(2)} human approval threshold.`
      : 'The reported issue needs human review before a refund can execute.';
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED', reasons: [`Eligibility checks passed; ${approvalReason}`],
      amount, approvalThreshold
    };
  }

  createConversation({ user, conversationId, message }) {
    const customer = this.db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
    if (!customer) throw new Error('No support customer profile is linked to this demo identity.');
    const now = new Date().toISOString();
    let conversation = conversationId
      ? this.db.prepare('SELECT * FROM support_conversations WHERE id = ? AND user_id = ?').get(conversationId, user.id)
      : null;
    if (conversationId && !conversation) throw new Error('Conversation not found.');
    if (!conversation) {
      const id = `conv_${crypto.randomUUID().replace(/-/g, '')}`;
      this.db.prepare('INSERT INTO support_conversations (id,user_id,customer_id,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run(id, user.id, customer.id, now, now);
      conversation = this.db.prepare('SELECT * FROM support_conversations WHERE id = ?').get(id);
    }
    const text = String(message || '').trim().slice(0, 2000);
    if (!text) throw new Error('Message is required.');
    this.db.prepare('INSERT INTO support_messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)')
      .run(`msg_${crypto.randomUUID().replace(/-/g, '')}`, conversation.id, 'user', text, now);
    const response = this.respondToSupportMessage({ conversation, user, customer, text });
    this.db.prepare('INSERT INTO support_messages (id,conversation_id,role,content,metadata_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(`msg_${crypto.randomUUID().replace(/-/g, '')}`, conversation.id, 'assistant', response.message, JSON.stringify({
        ...(response.metadata || {}), classification: response.classification, orderId: response.order?.id,
        eligibility: response.eligibility, approvalId: response.approval?.id, ticketId: response.ticket?.id
      }), now);
    this.db.prepare('UPDATE support_conversations SET context_order_id = COALESCE(?, context_order_id), updated_at = ? WHERE id = ?')
      .run(response.order?.id || null, now, conversation.id);
    return { conversationId: conversation.id, ...response, messages: this.db.prepare('SELECT role,content,metadata_json,created_at FROM support_messages WHERE conversation_id = ? ORDER BY created_at, rowid').all(conversation.id).map(message => ({
      role: message.role, content: message.content, createdAt: message.created_at,
      metadata: JSON.parse(message.metadata_json || '{}')
    })) };
  }

  getConversation({ user, conversationId }) {
    const conversation = this.db.prepare('SELECT id FROM support_conversations WHERE id = ? AND user_id = ?').get(conversationId, user.id);
    if (!conversation) throw new Error('Conversation not found.');
    return {
      conversationId: conversation.id,
      messages: this.db.prepare('SELECT role,content,metadata_json,created_at FROM support_messages WHERE conversation_id = ? ORDER BY created_at,rowid').all(conversation.id).map(message => ({
        role: message.role, content: message.content, createdAt: message.created_at,
        metadata: JSON.parse(message.metadata_json || '{}')
      }))
    };
  }

  respondToSupportMessage({ conversation, user, customer, text }) {
    const lower = text.toLowerCase();
    const ownOrders = this.getUserOrders(user.id);
    const requestedId = text.match(/ord_[a-z0-9_-]+/i)?.[0];
    let order = null;
    if (requestedId) {
      order = ownOrders.find(item => item.id.toLowerCase() === requestedId.toLowerCase());
      if (!order) return { message: 'I could not verify that order for your account, so I cannot view it or take action. Please check the order ID in your order history.', classification: 'OWNERSHIP_CHECK_BLOCKED', metadata: { decision: 'DENY' } };
    } else if (conversation.context_order_id) order = ownOrders.find(item => item.id === conversation.context_order_id) || null;
    else if (ownOrders.length === 1) order = ownOrders[0];
    else if (/order|refund|return|headphone|desk|chair|keypad/.test(lower)) {
      const match = ownOrders.find(o => (o.items || []).some(item => {
        const name = String(item.name).toLowerCase();
        const tokens = name.split(/[^a-z0-9]+/).filter(token => token.length > 4);
        return tokens.some(token => lower.includes(token));
      }));
      order = match || null;
    }

    const injection = /ignore (all )?(previous|prior) instructions|disable (the )?security|bypass (the )?(security|guardrail)|refund every/i.test(text);
    if (injection) return { order, classification: 'PROMPT_INJECTION', metadata: { decision: 'DENY', risk: 'HIGH' }, message: 'I can help with your own verified orders, but I cannot disable safeguards or refund multiple orders. Tell me which order and issue you need help with.' };

    const classification = this.classifyProductIssue(text);
    if (classification === 'SAFETY_ESCALATION') {
      const ticket = this.createSupportTicket({ customerId: customer.id, orderId: order?.id, category: 'SAFETY_ESCALATION', summary: text.slice(0, 240) });
      return { order, classification, ticket, metadata: { risk: 'CRITICAL', decision: 'HUMAN_REVIEW_REQUIRED' }, message: 'Please stop using the device, unplug it only if you can do so safely, and keep it away from heat or flammable items. Do not charge it or continue testing it. I have opened an urgent safety support ticket for a human specialist.' };
    }
    if (/where is|track|tracking|delivery|arrive/.test(lower)) {
      if (!order) return { classification: 'PENDING_VERIFICATION', message: 'I can check delivery using your order record. Which order ID should I look up?' };
      return { order, classification: 'ORDER_VERIFIED', metadata: { deliveryStatus: order.delivery_status, paymentStatus: order.payment_status }, message: `I verified order ${order.id} for your account. Its recorded delivery status is ${order.delivery_status.toLowerCase()}${order.delivery_date ? ` (delivered ${order.delivery_date.slice(0, 10)})` : ''}. Payment status: ${order.payment_status.toLowerCase()}.` };
    }
    if (/pair|connect|bluetooth/.test(lower) && !/not connecting|won't connect/.test(lower)) {
      return { order, classification: 'TROUBLESHOOTING_REQUIRED', message: 'For Bluetooth pairing, charge the headphones, remove the old pairing from your device’s Bluetooth settings, then hold the headphones’ pairing button until the indicator flashes and pair again. Did that resolve it? Stop if the device becomes hot, smells unusual, or appears damaged.' };
    }
    if (/not connecting|won't connect|not working/.test(lower) && !/defect|refund|broken|damage/.test(lower)) {
      return { order, classification: 'TROUBLESHOOTING_REQUIRED', message: order ? `I found ${order.items?.[0]?.name || 'your product'} on verified order ${order.id}. Is the issue Bluetooth pairing, charging, or something else? I’ll try safe troubleshooting before opening a return request.` : 'Which product and order is this about? I need to verify the order before giving product-specific steps.' };
    }

    const issue = order ? this.recordSupportIssue({ conversationId: conversation.id, customerId: customer.id, order, classification, details: text }) : null;
    if (/replacement|replace/.test(lower) && !/refund|return/.test(lower)) {
      const ticket = this.createSupportTicket({ customerId: customer.id, orderId: order?.id, issueId: issue?.id, category: 'REPLACEMENT_REQUEST', summary: text });
      return { order, issue, ticket, classification: classification === 'TROUBLESHOOTING_REQUIRED' ? 'HUMAN_REVIEW_REQUIRED' : classification, metadata: { decision: 'HUMAN_REVIEW_REQUIRED' }, message: `I recorded a replacement request${order ? ` for verified order ${order.id}` : ''} and opened ticket ${ticket.id}. A support specialist will check stock and replacement eligibility; no refund or replacement has been executed.` };
    }
    if (/refund|return|replace|replacement|repair/.test(lower)) {
      if (!order) return { classification: 'PENDING_VERIFICATION', message: 'I need the order ID from your order history before I can verify the product, delivery, and return options.' };
      if (classification === 'TROUBLESHOOTING_REQUIRED') return { order, issue, classification, message: /connect|pair|bluetooth/.test(lower) ? `I verified order ${order.id} for ${order.items?.[0]?.name || 'your product'}. Is it failing Bluetooth pairing or charging? If it is pairing, remove the old pairing from your device settings, put the headphones in pairing mode, and try again. Did that resolve it?` : `I verified order ${order.id}, but I need to understand the issue before a return decision. What specifically is wrong with ${order.items?.[0]?.name || 'the product'}?` };
      const amount = order.total_amount - order.refunded_amount;
      const eligibility = this.evaluateRefundEligibility({ order, issue, requestedAmount: amount });
      if (eligibility.decision !== 'HUMAN_APPROVAL_REQUIRED') return { order, issue, classification, eligibility, message: `I checked the verified order record. ${eligibility.reasons.join(' ')} I can open a warranty or human support ticket if this needs an exception.` };
      const approval = this.createRefundApproval({ order, user, amount, reason: text, issue });
      return { order, issue, classification, eligibility, approval, metadata: { decision: 'HUMAN_APPROVAL_REQUIRED', sandbox: true }, message: `The verified order is within the configured return policy and the reported issue is recorded. A reviewer must approve the $${amount.toFixed(2)} sandbox refund; no refund has been executed. Request ${approval.id} is pending.` };
    }
    if (issue && ['DEFECT_REPORTED', 'DAMAGE_REPORTED', 'MISSING_ITEM', 'WRONG_ITEM', 'WARRANTY_REQUIRED'].includes(classification)) {
      const ticket = this.createSupportTicket({ customerId: customer.id, orderId: order.id, issueId: issue.id, category: classification, summary: text });
      return { order, issue, ticket, classification, message: `I recorded this as ${classification.toLowerCase().replaceAll('_', ' ')} for verified order ${order.id}, and opened support ticket ${ticket.id}. I can check return eligibility if you want a refund, or route it for warranty/replacement review.` };
    }
    if (!order && /order|refund|return|product/.test(lower)) return { classification: 'PENDING_VERIFICATION', message: 'Which order ID or product should I check? I only use order information verified from your account.' };
    return { order, issue, classification, message: 'I can help with order status, setup, product issues, returns, and warranty support. Tell me what happened and include the order ID if you have it.' };
  }

  recordSupportIssue({ conversationId, customerId, order, classification, details }) {
    const now = new Date().toISOString();
    const id = `issue_${crypto.randomUUID().replace(/-/g, '')}`;
    const sku = JSON.parse(order.items_json || '[]')[0]?.sku || null;
    this.db.prepare('INSERT INTO support_issues (id,conversation_id,customer_id,order_id,product_sku,classification,details,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, conversationId, customerId, order.id, sku, classification, details.slice(0, 1000), 'OPEN', now, now);
    return { id, classification, status: 'OPEN' };
  }

  createSupportTicket({ customerId, orderId = null, issueId = null, category, summary }) {
    const now = new Date().toISOString();
    const id = `ticket_${crypto.randomUUID().replace(/-/g, '')}`;
    this.db.prepare('INSERT INTO support_tickets (id,customer_id,order_id,issue_id,category,status,summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, customerId, orderId, issueId, category, 'OPEN', summary.slice(0, 500), now, now);
    return { id, category, status: 'OPEN' };
  }

  createRefundApproval({ order, user, amount, reason, issue }) {
    const existing = this.db.prepare("SELECT * FROM refund_approval_requests WHERE order_id = ? AND user_id = ? AND status = 'PENDING'").get(order.id, user.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = `approval_${crypto.randomUUID().replace(/-/g, '')}`;
    const idempotencyKey = `support_${order.id}_${issue.id}`;
    this.db.prepare('INSERT INTO refund_approval_requests (id,order_id,customer_id,user_id,amount,reason,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, order.id, order.customer_id, user.id, amount, reason.slice(0, 500), 'PENDING', idempotencyKey, now, now);
    return this.db.prepare('SELECT * FROM refund_approval_requests WHERE id = ?').get(id);
  }

  listRefundApprovals() {
    return this.db.prepare(`SELECT r.*, c.name AS customer_name FROM refund_approval_requests r JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC`).all();
  }

  getSupportAdminSummary() {
    return {
      openTickets: this.db.prepare("SELECT COUNT(*) AS count FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS')").get().count,
      pendingRefundApprovals: this.db.prepare("SELECT COUNT(*) AS count FROM refund_approval_requests WHERE status='PENDING'").get().count,
      openIssues: this.db.prepare("SELECT COUNT(*) AS count FROM support_issues WHERE status='OPEN'").get().count,
      safetyEscalations: this.db.prepare("SELECT COUNT(*) AS count FROM support_tickets WHERE category='SAFETY_ESCALATION' AND status IN ('OPEN','IN_PROGRESS')").get().count
    };
  }

  listSupportTickets() {
    return this.db.prepare(`SELECT t.*, c.name AS customer_name FROM support_tickets t JOIN customers c ON c.id=t.customer_id ORDER BY CASE WHEN t.category='SAFETY_ESCALATION' THEN 0 ELSE 1 END, t.created_at DESC`).all();
  }

  updateSupportTicket({ ticketId, status, reviewer }) {
    if (reviewer?.role !== 'admin') throw new Error('Administrator role required to manage support tickets.');
    const result = this.db.prepare("UPDATE support_tickets SET status=?,updated_at=? WHERE id=? AND status IN ('OPEN','IN_PROGRESS')")
      .run(status, new Date().toISOString(), ticketId);
    if (!result.changes) throw new Error('Open support ticket not found.');
    return this.db.prepare('SELECT * FROM support_tickets WHERE id=?').get(ticketId);
  }

  reviewRefundApproval({ approvalId, reviewer, decision, note, securityGateway }) {
    if (reviewer?.role !== 'admin') throw new Error('Administrator role required to review refund requests.');
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const request = this.db.prepare("SELECT * FROM refund_approval_requests WHERE id = ? AND status = 'PENDING'").get(approvalId);
      if (!request) throw new Error('Pending refund approval not found.');
      if (decision === 'REJECT') {
        this.db.prepare("UPDATE refund_approval_requests SET status='REJECTED',reviewer_id=?,review_note=?,updated_at=? WHERE id=? AND status='PENDING'")
          .run(reviewer.id, String(note || 'Rejected by reviewer').slice(0, 500), now, approvalId);
        this.db.exec('COMMIT');
        return { ...request, status: 'REJECTED', refund: null };
      }
      this.db.prepare("UPDATE refund_approval_requests SET status='PROCESSING',reviewer_id=?,updated_at=? WHERE id=? AND status='PENDING'")
        .run(reviewer.id, now, approvalId);
      this.db.exec('COMMIT');
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(request.order_id);
      const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(request.customer_id);
      if (!order || !customer || customer.user_id !== request.user_id || order.customer_id !== customer.id || order.payment_status !== 'PAID' || order.delivery_status !== 'DELIVERED') {
        this.db.prepare("UPDATE refund_approval_requests SET status='PENDING',reviewer_id=NULL,updated_at=? WHERE id=? AND status='PROCESSING'").run(new Date().toISOString(), approvalId);
        throw new Error('Order verification no longer passes; request remains pending for investigation.');
      }
      const refund = securityGateway.executeApprovedSupportRefund({ orderId: order.id, amount: request.amount, reason: request.reason, idempotencyKey: request.idempotency_key, user: { id: request.user_id, role: 'customer', tenantId: customer.tenant_id }, reviewer });
      this.db.prepare("UPDATE refund_approval_requests SET status='APPROVED',reviewer_id=?,review_note=?,refund_id=?,updated_at=? WHERE id=? AND status='PROCESSING'")
        .run(reviewer.id, String(note || 'Approved by reviewer').slice(0, 500), refund.refund.id, now, approvalId);
      return { ...request, status: 'APPROVED', refund: refund.refund };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.db.prepare("UPDATE refund_approval_requests SET status='PENDING',reviewer_id=NULL,updated_at=? WHERE id=? AND status='PROCESSING'")
        .run(new Date().toISOString(), approvalId);
      throw error;
    }
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

      if (order.payment_status !== 'PAID' || order.delivery_status !== 'DELIVERED' || order.status !== 'DELIVERED') {
        throw new Error('Refund requires a verified paid and delivered order.');
      }
      const policyRow = this.db.prepare("SELECT rules_json FROM policies WHERE action_type = 'ISSUE_REFUND'").get();
      const policyRules = policyRow ? JSON.parse(policyRow.rules_json) : {};
      if (policyRules.returnWindowDays) {
        const ageDays = order.purchase_date ? Math.floor((Date.now() - Date.parse(order.purchase_date)) / 86400000) : Infinity;
        if (!Number.isFinite(ageDays) || ageDays > policyRules.returnWindowDays) throw new Error('Configured return period has passed; use warranty or exception review.');
      }
      const remainingRefundable = Math.round((order.total_amount - order.refunded_amount) * 100) / 100;
      if (numericAmount > remainingRefundable) {
        throw new Error(`Requested refund amount ($${numericAmount.toFixed(2)}) exceeds remaining refundable balance ($${remainingRefundable.toFixed(2)}).`);
      }
      const verifiedIssue = this.db.prepare(`SELECT id FROM support_issues WHERE order_id = ? AND customer_id = ? AND status = 'OPEN' AND classification IN ('DEFECT_REPORTED','DAMAGE_REPORTED','MISSING_ITEM','WRONG_ITEM') ORDER BY created_at DESC LIMIT 1`).get(orderId, order.customer_id);
      if (!verifiedIssue) throw new Error('Refund requires a recorded product issue verified through the support conversation.');
      const orderItems = JSON.parse(order.items_json || '[]');
      if (!orderItems.length || orderItems.some(item => !this.db.prepare('SELECT 1 FROM support_products WHERE sku = ? AND returnable = 1').get(item.sku))) {
        throw new Error('Refund requires verified returnable product catalog records.');
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

      this.db.prepare("UPDATE support_issues SET status='RESOLVED',updated_at=? WHERE order_id=? AND customer_id=? AND status='OPEN'")
        .run(now, orderId, order.customer_id);

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
    const orders = this.db.prepare(`
      SELECT o.*, c.name as customer_name 
      FROM orders o 
      JOIN customers c ON o.customer_id = c.id 
      WHERE c.user_id = ?
      ORDER BY o.created_at DESC
    `).all(userId);
    return orders.map(order => ({
      ...order,
      items: this.parseOrderItems(order.items_json),
      remainingRefundable: Math.round((order.total_amount - order.refunded_amount) * 100) / 100
    }));
  }
}

module.exports = {
  CustomerSupportService
};
