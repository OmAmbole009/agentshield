/**
 * Demo Authentication Middleware.
 * Defaults to primary demo user `usr_sarah_01` with customer role.
 * Allows simulating different users/agents via headers for security testing:
 *   - X-User-Id: e.g., 'usr_sarah_01' (retail customer) or 'usr_alex_03' (external attacker)
 *   - X-User-Role: e.g., 'customer', 'admin'
 *   - X-Tenant-Id: e.g., 'tenant_retail', 'tenant_external'
 *   - X-Agent-Id: e.g., 'voice-assistant-agent', 'untrusted-agent'
 */
const DEMO_IDENTITIES = Object.freeze({
  usr_sarah_01: { name: 'Sarah Connor', tenantId: 'tenant_retail', role: 'customer' },
  usr_michael_02: { name: 'Michael Scott', tenantId: 'tenant_retail', role: 'customer' },
  usr_alex_03: { name: 'Alex Thorne', tenantId: 'tenant_external', role: 'customer' },
  usr_admin: { name: 'Security Admin', tenantId: 'tenant_retail', role: 'admin' }
});

function authMiddleware(req, res, next) {
  // Header-selected identities are a local demonstration convenience, not authentication.
  // Never run this identity shim in production; install a real authentication middleware.
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({
      success: false,
      error: 'Production authentication is not configured.',
      errorCode: 'AUTHENTICATION_NOT_CONFIGURED'
    });
  }

  const userId = req.headers['x-user-id'] || 'usr_sarah_01';
  const identity = DEMO_IDENTITIES[userId];
  if (!identity) {
    return res.status(401).json({
      success: false,
      error: 'Unknown demo identity.',
      errorCode: 'UNKNOWN_DEMO_IDENTITY'
    });
  }

  // Tenant and role are server-owned. Ignore caller-supplied X-Tenant-Id and X-User-Role.
  const { tenantId, role, name } = identity;
  const agentId = req.headers['x-agent-id'] || 'voice-assistant-agent';

  // Agent permissions
  let agentPermissions = [
    'accounts:read',
    'transfers:execute',
    'refunds:execute',
    'preferences:write',
    'customers:read',
    'orders:read',
    'subscriptions:write'
  ];

  if (agentId === 'untrusted-agent') {
    agentPermissions = [];
  } else if (agentId === 'support-readonly-agent') {
    agentPermissions = ['customers:read', 'orders:read'];
  } else if (agentId === 'admin-agent') {
    agentPermissions = ['*'];
  }

  req.user = {
    id: userId,
    name,
    tenantId,
    role,
    permissions: role === 'admin' ? ['*'] : ['accounts:read', 'transfers:execute', 'preferences:write', 'customers:read', 'orders:read']
  };

  req.agent = {
    id: agentId,
    name: agentId === 'customer-support-agent' ? 'AgentShield Customer Support Agent' : 'AgentShield Voice Assistant',
    permissions: agentPermissions
  };

  next();
}

module.exports = {
  authMiddleware,
  DEMO_IDENTITIES
};
