const config = require('../../config/env');
const { MockGnaniAdapter } = require('./mockGnaniAdapter');
const { LiveGnaniAdapter } = require('./liveGnaniAdapter');

class ResilientGnaniAdapter {
  constructor({ budgetGuard, liveAdapter = null, mockAdapter = null }) {
    this.budgetGuard = budgetGuard;
    this.liveAdapter = liveAdapter;
    this.mockAdapter = mockAdapter || new MockGnaniAdapter({ budgetGuard });
    this.timeoutMs = 5000;
  }

  async transcribeAudio(audioBuffer, options = {}) {
    if (!this.liveAdapter) {
      return this.mockAdapter.transcribeAudio(audioBuffer, options);
    }

    const budgetCheck = this.budgetGuard ? this.budgetGuard.canMakeLiveCall('stt', 15) : { allowed: true };
    if (!budgetCheck.allowed) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'stt',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { reason: budgetCheck.reason, fallback: true }
        });
      }
      return this.mockAdapter.transcribeAudio(audioBuffer, options);
    }

    try {
      return await this.liveAdapter.transcribeAudio(audioBuffer, options);
    } catch (err) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'stt',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { error: err.message, fallback: true }
        });
      }
      return this.mockAdapter.transcribeAudio(audioBuffer, options);
    }
  }

  async synthesizeSpeech(text, options = {}) {
    if (!this.liveAdapter) {
      return this.mockAdapter.synthesizeSpeech(text, options);
    }

    const budgetCheck = this.budgetGuard ? this.budgetGuard.canMakeLiveCall('tts', 10) : { allowed: true };
    if (!budgetCheck.allowed) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'tts',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { reason: budgetCheck.reason, fallback: true }
        });
      }
      return this.mockAdapter.synthesizeSpeech(text, options);
    }

    try {
      return await this.liveAdapter.synthesizeSpeech(text, options);
    } catch (err) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'tts',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { error: err.message, fallback: true }
        });
      }
      return this.mockAdapter.synthesizeSpeech(text, options);
    }
  }

  async inferReasoning(prompt, context = {}) {
    if (!this.liveAdapter) {
      return this.mockAdapter.inferReasoning(prompt, context);
    }

    const budgetCheck = this.budgetGuard ? this.budgetGuard.canMakeLiveCall('llm', 20) : { allowed: true };
    if (!budgetCheck.allowed) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'llm',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { reason: budgetCheck.reason, fallback: true }
        });
      }
      return this.mockAdapter.inferReasoning(prompt, context);
    }

    try {
      return await this.liveAdapter.inferReasoning(prompt, context);
    } catch (err) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-resilience',
          operationType: 'llm',
          isMock: true,
          callStatus: 'FALLBACK_TO_MOCK',
          metadata: { error: err.message, fallback: true }
        });
      }
      return this.mockAdapter.inferReasoning(prompt, context);
    }
  }
}

/**
 * Creates the appropriate Gnani voice & reasoning adapter based on configuration and budget.
 */
function createGnaniAdapter({ budgetGuard }) {
  const isLiveConfigured = config.gnani.enabled && !!config.gnani.apiKey;
  const mockAdapter = new MockGnaniAdapter({ budgetGuard });
  const liveAdapter = isLiveConfigured ? new LiveGnaniAdapter({ budgetGuard }) : null;

  return new ResilientGnaniAdapter({
    budgetGuard,
    liveAdapter,
    mockAdapter
  });
}

module.exports = {
  createGnaniAdapter,
  ResilientGnaniAdapter
};
