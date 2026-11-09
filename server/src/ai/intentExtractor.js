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
    const deterministicProposal = this.deterministicExtractor.extract(text, context);

    // Keep known prompt attacks out of the external model and avoid billable calls for empty audio.
    if (deterministicProposal.isInjectionDetected) {
      rawProposal = deterministicProposal;
    }

    // 1. Try external provider if configured and not deterministicOnly
    if (!rawProposal && text?.trim() && !this.deterministicOnly && this.liveLlmProvider && typeof this.liveLlmProvider.inferReasoning === 'function') {
      try {
        const llmResult = await this.liveLlmProvider.inferReasoning(text, context);
        if (llmResult && !llmResult.isMock && llmResult.actionType && llmResult.payload) {
          const llmValidation = validateActionPayload(llmResult.actionType, llmResult.payload);
          if (llmValidation.isValid) {
            rawProposal = llmResult;
            source = 'live_llm';
          }
        }
      } catch (err) {
        console.warn('Live LLM provider failed, falling back to deterministic extractor:', err.message);
      }
    }

    // 2. Use deterministic extractor as fallback or primary
    if (!rawProposal) {
      rawProposal = deterministicProposal;
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
