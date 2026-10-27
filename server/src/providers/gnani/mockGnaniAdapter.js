class MockGnaniAdapter {
  constructor({ budgetGuard }) {
    this.budgetGuard = budgetGuard;
  }

  /**
   * High-fidelity simulated speech-to-text.
   */
  async transcribeAudio(audioBuffer, options = {}) {
    const startTime = Date.now();
    const languageCode = options.languageCode || 'en-IN';
    const mockPhrase = options.mockPhrase || 'Transfer $500 to recp_landlord_prop for monthly rent';

    const durationMs = Date.now() - startTime + 45; // simulate brief processing latency

    if (this.budgetGuard) {
      this.budgetGuard.recordUsage({
        provider: 'gnani-mock',
        operationType: 'stt',
        isMock: true,
        callStatus: 'SUCCESS',
        reportedCredits: null,
        estimatedCredits: 0,
        durationMs,
        metadata: { model: 'prisma-v2.5', languageCode, sampleRate: 16000 }
      });
    }

    return {
      transcript: mockPhrase,
      confidence: 0.97,
      languageCode,
      model: 'prisma-v2.5-mock',
      isMock: true,
      durationMs
    };
  }

  /**
   * High-fidelity simulated text-to-speech.
   */
  async synthesizeSpeech(text, options = {}) {
    const startTime = Date.now();
    const voice = options.voice || 'Nalini';
    const model = options.model || 'timbre-v2.5';
    const language = options.language || 'en-IN';

    // Generates a minimal valid RIFF/WAV header (44 bytes) for audio player testability
    const wavHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // Chunk size: 36 + data size (0)
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6d, 0x74, 0x20, // "fmt "
      0x10, 0x00, 0x00, 0x00, // Subchunk1Size: 16
      0x01, 0x00,             // AudioFormat: PCM (1)
      0x01, 0x00,             // NumChannels: Mono (1)
      0x80, 0x3e, 0x00, 0x00, // SampleRate: 16000 Hz
      0x00, 0x7d, 0x00, 0x00, // ByteRate: 32000 Bps
      0x02, 0x00,             // BlockAlign: 2
      0x10, 0x00,             // BitsPerSample: 16
      0x64, 0x61, 0x74, 0x61, // "data"
      0x00, 0x00, 0x00, 0x00  // Subchunk2Size: 0
    ]);

    const durationMs = Date.now() - startTime + 50;

    if (this.budgetGuard) {
      this.budgetGuard.recordUsage({
        provider: 'gnani-mock',
        operationType: 'tts',
        isMock: true,
        callStatus: 'SUCCESS',
        reportedCredits: null,
        estimatedCredits: 0,
        durationMs,
        metadata: { model, voice, language, characterCount: text.length }
      });
    }

    return {
      audioBase64: wavHeader.toString('base64'),
      mimeType: 'audio/wav',
      voice,
      model,
      text,
      isMock: true,
      durationMs
    };
  }

  /**
   * Simulated reasoning extraction for Evon v3.3
   */
  async inferReasoning(prompt, context = {}) {
    const { DeterministicIntentExtractor } = require('../../ai/deterministicExtractor');
    const extractor = new DeterministicIntentExtractor();
    const startTime = Date.now();
    const result = extractor.extract(prompt, context);
    const durationMs = Date.now() - startTime + 20;

    if (this.budgetGuard) {
      this.budgetGuard.recordUsage({
        provider: 'gnani-mock',
        operationType: 'llm',
        isMock: true,
        callStatus: 'SUCCESS',
        reportedCredits: null,
        estimatedCredits: 0,
        durationMs,
        metadata: { model: 'evon-v3.3', promptLength: prompt.length }
      });
    }

    return {
      actionType: result.actionType,
      payload: result.payload,
      confidence: result.confidence,
      isInjectionDetected: result.isInjectionDetected,
      model: 'evon-v3.3-mock',
      isMock: true
    };
  }
}

module.exports = {
  MockGnaniAdapter
};
