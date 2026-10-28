const { ACTION_TYPES } = require('../registry/actions');

class DeterministicIntentExtractor {
  /**
   * Deterministically parses a user's natural language input into a structured action proposal.
   *
   * @param {string} text - User prompt or transcribed voice
   * @param {Object} context - { userId, defaultAccountId }
   * @returns {Object} { actionType, payload, confidence, rawText, isInjectionDetected }
   */
  extract(text, context = {}) {
    if (!text || typeof text !== 'string') {
      return {
        actionType: 'UNKNOWN',
        payload: {},
        confidence: 0,
        rawText: '',
        isInjectionDetected: false
      };
    }

    const clean = text.trim();
    const lower = clean.toLowerCase();
    const defaultAccountId = context.defaultAccountId || 'acc_sarah_checking';

    // 1. Detect Prompt Injection / Malicious Exfiltration Attempts
    const injectionPatterns = [
      /ignore (all )?previous instructions/i,
      /disregard (all )?rules/i,
      /you are now in developer mode/i,
      /dump (the )?(database|tables|customers)/i,
      /export (all )?(customer|user|account) (records|data|pii)/i,
      /exfiltrate/i,
      /bypass security/i
    ];

    const isInjection = injectionPatterns.some(pattern => pattern.test(clean));

    // If attempting customer data export or jailbreak
    if (isInjection || lower.includes('export customer') || lower.includes('export data') || lower.includes('download records')) {
      const formatMatch = lower.match(/(json|pdf|csv)/);
      return {
        actionType: ACTION_TYPES.EXPORT_CUSTOMER_DATA,
        payload: {
          format: formatMatch ? formatMatch[1] : 'csv',
          includePersonallyIdentifiableInformation: true,
          tenantId: 'tenant_retail'
        },
        confidence: 0.95,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 2. Check Balance Intents
    // e.g., "What is my balance?", "Check balance", "How much money is in my checking account?", "Check balance of acc_sarah_checking"
    if (lower.includes('balance') || lower.includes('how much money') || lower.includes('account status')) {
      const accMatch = clean.match(/acc_[a-zA-Z0-9_]+/);
      return {
        actionType: ACTION_TYPES.READ_BALANCE,
        payload: {
          accountId: accMatch ? accMatch[0] : defaultAccountId
        },
        confidence: 0.98,
        rawText: clean,
        isInjectionDetected: false
      };
    }

    // 3. Transfer Funds Intents
    // e.g., "Transfer $500 to recp_landlord_prop", "Send 1200 dollars to landlord", "Pay electric company $150", "Transfer $15000 to recp_electric_co"
    if (lower.includes('transfer') || lower.includes('send') || lower.includes('pay ') || lower.includes('wire ')) {
      // Extract amount
      const amountMatch = clean.match(/\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:dollars|usd)?/i);
      let amount = 0;
      if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      }

      // Extract Recipient
      let recipientId = 'recp_landlord_prop'; // Default demo recipient if mentioned landlord
      const recpMatch = clean.match(/recp_[a-zA-Z0-9_]+/);
      if (recpMatch) {
        recipientId = recpMatch[0];
      } else if (lower.includes('electric') || lower.includes('utility') || lower.includes('power')) {
        recipientId = 'recp_electric_co';
      } else if (lower.includes('unverified') || lower.includes('offshore') || lower.includes('apex')) {
        recipientId = 'recp_unverified_vendor';
      } else if (lower.includes('landlord') || lower.includes('rent') || lower.includes('northgate')) {
        recipientId = 'recp_landlord_prop';
      }

      const fromAccMatch = clean.match(/from\s+(acc_[a-zA-Z0-9_]+)/i);

      return {
        actionType: ACTION_TYPES.TRANSFER_FUNDS,
        payload: {
          fromAccountId: fromAccMatch ? fromAccMatch[1] : defaultAccountId,
          toRecipientId: recipientId,
          amount: amount || 0,
          memo: `Payment via AgentShield: ${clean.substring(0, 40)}`
        },
        confidence: 0.92,
        rawText: clean,
        isInjectionDetected: false
      };
    }

    // 4. Order Refund Requests (Customer Support)
    // e.g., "Refund $50 for order ord_sarah_101", "Issue refund $160 for ord_sarah_101", "Refund order ord_sarah_102 $1200"
    if ((lower.includes('refund') || lower.includes('reversal')) && (lower.includes('ord_') || lower.includes('order'))) {
      const ordMatch = clean.match(/ord_[a-zA-Z0-9_]+/);
      const orderId = ordMatch ? ordMatch[0] : (context.defaultOrderId || 'ord_sarah_101');

      // Strip order ID first to avoid capturing digits from order ID (e.g. ord_sarah_102)
      const textWithoutOrder = ordMatch ? clean.replace(ordMatch[0], '') : clean;
      const amountMatch = textWithoutOrder.match(/\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/i)
        || textWithoutOrder.match(/((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:dollars|usd)/i)
        || textWithoutOrder.match(/((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/);

      let amount = 50.00;
      if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      }

      return {
        actionType: ACTION_TYPES.ISSUE_REFUND,
        payload: {
          orderId,
          amount,
          reason: `Customer support request: ${clean.substring(0, 100)}`
        },
        confidence: 0.94,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 5. Account Transaction Refund Requests (Banking Legacy)
    // e.g., "Refund $50 for transaction tx_123", "Request refund 600 dollars"
    if (lower.includes('refund') || lower.includes('reversal')) {
      const amountMatch = clean.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      const txMatch = clean.match(/(?:transaction|tx)\s+([a-zA-Z0-9_]+)/i);

      return {
        actionType: ACTION_TYPES.REQUEST_REFUND,
        payload: {
          accountId: defaultAccountId,
          originalTransactionId: txMatch ? txMatch[1] : 'tx_demo_preseeded',
          amount: amountMatch ? parseFloat(amountMatch[1]) : 50.00,
          reason: clean.substring(0, 100)
        },
        confidence: 0.90,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 6. Customer Support: Get Customer Profile
    // e.g., "Get my customer profile", "Show profile for cust_sarah_01", "View customer details"
    if (lower.includes('profile') || lower.includes('customer details') || lower.includes('account profile')) {
      const custMatch = clean.match(/cust_[a-zA-Z0-9_]+/);
      return {
        actionType: ACTION_TYPES.GET_CUSTOMER_PROFILE,
        payload: {
          customerId: custMatch ? custMatch[0] : (context.defaultCustomerId || 'cust_sarah_01')
        },
        confidence: 0.96,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 7. Customer Support: Get Customer Orders
    // e.g., "Show my orders", "List orders", "Get orders for cust_sarah_01", "Order history"
    if (lower.includes('order') && (lower.includes('list') || lower.includes('show') || lower.includes('history') || lower.includes('get') || lower.includes('my orders'))) {
      const custMatch = clean.match(/cust_[a-zA-Z0-9_]+/);
      return {
        actionType: ACTION_TYPES.GET_CUSTOMER_ORDERS,
        payload: {
          customerId: custMatch ? custMatch[0] : (context.defaultCustomerId || 'cust_sarah_01')
        },
        confidence: 0.95,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 8. Customer Support: Update Subscription
    // e.g., "Change subscription to basic", "Upgrade subscription to enterprise", "Update plan to pro"
    if (lower.includes('subscription') || lower.includes('plan')) {
      const subMatch = clean.match(/sub_[a-zA-Z0-9_]+/);
      let newPlan = 'pro';
      if (lower.includes('enterprise')) newPlan = 'enterprise';
      else if (lower.includes('basic')) newPlan = 'basic';
      else if (lower.includes('pro')) newPlan = 'pro';

      return {
        actionType: ACTION_TYPES.UPDATE_SUBSCRIPTION,
        payload: {
          subscriptionId: subMatch ? subMatch[0] : (context.defaultSubscriptionId || 'sub_sarah_pro'),
          newPlan
        },
        confidence: 0.92,
        rawText: clean,
        isInjectionDetected: isInjection
      };
    }

    // 9. Update Preferences
    // e.g., "Enable email alerts and dark theme", "Set theme to light"
    if (lower.includes('preference') || lower.includes('theme') || lower.includes('alert') || lower.includes('notification')) {
      const preferences = {};
      if (lower.includes('dark')) preferences.theme = 'dark';
      if (lower.includes('light')) preferences.theme = 'light';
      if (lower.includes('email alert')) preferences.emailAlerts = true;
      if (lower.includes('sms alert')) preferences.smsAlerts = true;

      // In case prompt tries to inject restricted fields
      if (lower.includes('daily limit') || lower.includes('transfer limit')) {
        // This will be caught by Zod schema strict mode
        preferences.dailyTransferLimit = 999999;
      }

      return {
        actionType: ACTION_TYPES.UPDATE_PREFERENCE,
        payload: {
          accountId: defaultAccountId,
          preferences
        },
        confidence: 0.88,
        rawText: clean,
        isInjectionDetected: false
      };
    }

    // Unrecognized intent
    return {
      actionType: 'UNKNOWN',
      payload: { rawText: clean },
      confidence: 0.2,
      rawText: clean,
      isInjectionDetected: false
    };
  }
}

module.exports = {
  DeterministicIntentExtractor
};
