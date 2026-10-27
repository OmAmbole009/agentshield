const config = require('../../config/env');
const { MockGnaniAdapter } = require('./mockGnaniAdapter');
const { LiveGnaniAdapter } = require('./liveGnaniAdapter');

/**
 * Creates the appropriate Gnani voice & reasoning adapter based on configuration and budget.
 */
function createGnaniAdapter({ budgetGuard }) {
  const isLiveConfigured = config.gnani.enabled && !!config.gnani.apiKey;

  if (isLiveConfigured) {
    return new LiveGnaniAdapter({ budgetGuard });
  }

  return new MockGnaniAdapter({ budgetGuard });
}

module.exports = {
  createGnaniAdapter
};
