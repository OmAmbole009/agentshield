const config = require('../../config/env');

class LiveGnaniAdapter {
  constructor({ budgetGuard }) {
    this.budgetGuard = budgetGuard;
    this.apiKey = config.gnani.apiKey;
    this.baseUrl = config.gnani.baseUrl || 'https://api.vachana.ai';
    this.timeoutMs = 5000;
  }

  /**
   * Performs live Speech-to-Text inference via Gnani Prisma v2.5
   * Endpoint: POST https://api.vachana.ai/stt/v3
   */
  async transcribeAudio(audioBuffer, options = {}) {
    // 1. Budget Guard Check
    const budgetCheck = this.budgetGuard.canMakeLiveCall('stt', 15);
    if (!budgetCheck.allowed) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-live',
          operationType: 'stt',
          isMock: false,
          callStatus: 'BLOCKED_BY_GUARD',
          metadata: { reason: budgetCheck.reason }
        });
      }
      throw new Error(`Gnani STT call blocked by budget guard: ${budgetCheck.reason}`);
    }

    const startTime = Date.now();
    const languageCode = options.languageCode || 'en-IN';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Build multipart form data using Node's standard FormData
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: options.mimeType || 'audio/wav' });
      formData.append('audio_file', blob, 'recording.wav');
      formData.append('language_code', languageCode);

      const response = await fetch(`${this.baseUrl}/stt/v3`, {
        method: 'POST',
        headers: {
          'X-API-Key-ID': this.apiKey
        },
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gnani STT API returned status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      // Parse reported usage from response or headers if present
      const reportedCredits = result.credits_used || result.usage?.credits || null;
      const estimatedCredits = reportedCredits ? null : 15;

      this.budgetGuard.recordUsage({
        provider: 'gnani-live',
        operationType: 'stt',
        isMock: false,
        callStatus: 'SUCCESS',
        reportedCredits,
        estimatedCredits,
        durationMs,
        metadata: { model: 'prisma-v2.5', languageCode, status: response.status }
      });

      return {
        transcript: result.transcript || result.text || '',
        confidence: result.confidence || 0.95,
        languageCode,
        model: 'prisma-v2.5',
        isMock: false,
        durationMs,
        reportedCredits
      };
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      this.budgetGuard.recordUsage({
        provider: 'gnani-live',
        operationType: 'stt',
        isMock: false,
        callStatus: 'FAILED',
        durationMs,
        metadata: { error: err.message, isTimeout: err.name === 'AbortError' }
      });
      throw err;
    }
  }

  /**
   * Performs live Text-to-Speech synthesis via Gnani Timbre (v2.5 / v3.0)
   */
  async synthesizeSpeech(text, options = {}) {
    const budgetCheck = this.budgetGuard.canMakeLiveCall('tts', 10);
    if (!budgetCheck.allowed) {
      if (this.budgetGuard) {
        this.budgetGuard.recordUsage({
          provider: 'gnani-live',
          operationType: 'tts',
          isMock: false,
          callStatus: 'BLOCKED_BY_GUARD',
          metadata: { reason: budgetCheck.reason }
        });
      }
      throw new Error(`Gnani TTS call blocked by budget guard: ${budgetCheck.reason}`);
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = {
        text,
        voice: options.voice || 'Nalini',
        model: options.model || config.gnani.modelTts || 'timbre-v2.5',
        language: options.language || 'en-IN',
        speed: 1.0,
        audio_config: {
          sample_rate: 16000,
          num_channels: 1,
          encoding: 'linear_pcm',
          container: 'wav'
        }
      };

      const response = await fetch(`${this.baseUrl}/api/v1/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key-ID': this.apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gnani TTS API returned status ${response.status}: ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const reportedCredits = response.headers.get('x-credits-used') ? parseFloat(response.headers.get('x-credits-used')) : null;

      this.budgetGuard.recordUsage({
        provider: 'gnani-live',
        operationType: 'tts',
        isMock: false,
        callStatus: 'SUCCESS',
        reportedCredits,
        estimatedCredits: reportedCredits ? null : 10,
        durationMs,
        metadata: { voice: payload.voice, model: payload.model, length: text.length }
      });

      return {
        audioBase64: audioBuffer.toString('base64'),
        mimeType: 'audio/wav',
        voice: payload.voice,
        model: payload.model,
        isMock: false,
        durationMs,
        reportedCredits
      };
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      this.budgetGuard.recordUsage({
        provider: 'gnani-live',
        operationType: 'tts',
        isMock: false,
        callStatus: 'FAILED',
        durationMs,
        metadata: { error: err.message, isTimeout: err.name === 'AbortError' }
      });
      throw err;
    }
  }

  /**
   * Performs reasoning extraction via Gnani Evon v3.3
   */
  async inferReasoning(prompt, context = {}) {
    const budgetCheck = this.budgetGuard.canMakeLiveCall('llm', 20);
    if (!budgetCheck.allowed) {
      throw new Error(`Gnani Evon LLM call blocked: ${budgetCheck.reason}`);
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key-ID': this.apiKey
        },
        body: JSON.stringify({
          model: 'evon-v3.3',
          messages: [
            {
              role: 'system',
              content: 'You are an action extraction assistant. Extract structured banking action JSON.'
            },
            { role: 'user', content: prompt }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Evon reasoning returned ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      this.budgetGuard.recordUsage({
        provider: 'gnani-live',
        operationType: 'llm',
        isMock: false,
        callStatus: 'SUCCESS',
        reportedCredits: data.usage?.total_tokens || null,
        durationMs
      });

      return {
        actionType: parsed.actionType,
        payload: parsed.payload,
        confidence: 0.9,
        isMock: false
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}

module.exports = {
  LiveGnaniAdapter
};
