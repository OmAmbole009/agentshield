/**
 * Demo Authentication Middleware.
 * Defaults to primary demo user `usr_sarah_01` with customer role.
 * Allows simulating different users/agents via headers for security testing:
 *   - X-User-Id: e.g., 'usr_sarah_01' (retail customer) or 'usr_alex_03' (external attacker)
 *   - X-User-Role: e.g., 'customer', 'admin'
 *   - X-Tenant-Id: e.g., 'tenant_retail', 'tenant_external'
 *   - X-Agent-Id: e.g., 'voice-assistant-agent', 'untrusted-agent'
 */
function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'] || 'usr_sarah_01';
  const tenantId = req.headers['x-tenant-id'] || (userId === 'usr_alex_03' ? 'tenant_external' : 'tenant_retail');
  const role = req.headers['x-user-role'] || 'customer';
  const agentId = req.headers['x-agent-id'] || 'voice-assistant-agent';

  // Agent permissions
  let agentPermissions = [
    'accounts:read',
    'transfers:execute',
    'refunds:execute',
    'preferences:write'
  ];

  if (agentId === 'untrusted-agent') {
    agentPermissions = [];
  } else if (agentId === 'admin-agent') {
    agentPermissions = ['*'];
  }

  req.user = {
    id: userId,
    name: userId === 'usr_sarah_01' ? 'Sarah Connor' : (userId === 'usr_michael_02' ? 'Michael Scott' : 'Alex Thorne'),
    tenantId,
    role,
    permissions: role === 'admin' ? ['*'] : ['accounts:read', 'transfers:execute', 'preferences:write']
  };

  req.agent = {
    id: agentId,
    name: 'AgentShield Voice Assistant',
    permissions: agentPermissions
  };

  next();
}

module.exports = {
  authMiddleware
};
