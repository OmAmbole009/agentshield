const { DeterministicIntentExtractor } = require('./deterministicExtractor');
const { validateActionPayload } = require('../registry/actions');

class IntentExtractor {
  constructor({ deterministicOnly = false, liveLlmProvider = null } = {}) {
    this.deterministicExtractor = new DeterministicIntentExtractor();
    this.liveLlmProvider = liveLlmProvider;
    this.deterministicOnly = deterministicOnly;
  }

  /**
   * Extracts and strictly validates structured action proposal from user text.
   * Treats all LLM output as untrusted!
   *
   * @param {string} text
   * @param {Object} context - { userId, defaultAccountId }
   * @returns {Promise<Object>} { actionType, payload, validation, isInjectionDetected, rawText, extractorSource }
   */
  async extractProposal(text, context = {}) {
    let rawProposal = null;
    let source = 'deterministic';

    // 1. Try external provider if configured and not deterministicOnly
    if (!this.deterministicOnly && this.liveLlmProvider && typeof this.liveLlmProvider.inferReasoning === 'function') {
      try {
        const llmResult = await this.liveLlmProvider.inferReasoning(text, context);
        if (llmResult && llmResult.actionType && llmResult.payload) {
          rawProposal = llmResult;
          source = 'live_llm';
        }
      } catch (err) {
        console.warn('Live LLM provider failed, falling back to deterministic extractor:', err.message);
        rawProposal = null;
      }
    }

    // 2. Use deterministic extractor as fallback or primary
    if (!rawProposal) {
      rawProposal = this.deterministicExtractor.extract(text, context);
      source = 'deterministic';
    }

    // 3. Strict schema validation
    const validation = validateActionPayload(rawProposal.actionType, rawProposal.payload);

    return {
      actionType: rawProposal.actionType,
      payload: rawProposal.payload,
      validation,
      isInjectionDetected: !!rawProposal.isInjectionDetected,
      rawText: text,
      extractorSource: source,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  IntentExtractor
};
