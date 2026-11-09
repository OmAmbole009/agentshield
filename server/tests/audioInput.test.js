const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decodeAudioInput, transcribeAudioInput } = require('../src/providers/gnani/audioInput');
const { extractConfidence, extractTranscript } = require('../src/providers/gnani/liveGnaniAdapter');

describe('Audio request validation', () => {
  it('accepts supported browser audio and defaults to en-IN', () => {
    const result = decodeAudioInput('AQIDBA==', { mimeType: 'audio/webm;codecs=opus' });
    assert.deepEqual(result.audioBuffer, Buffer.from([1, 2, 3, 4]));
    assert.equal(result.audioOptions.mimeType, 'audio/webm;codecs=opus');
    assert.equal(result.audioOptions.languageCode, 'en-IN');
  });

  it('rejects malformed, oversized, and unsupported audio before provider calls', () => {
    assert.throws(() => decodeAudioInput('not base64'), { code: 'INVALID_AUDIO' });
    assert.throws(() => decodeAudioInput('AQIDBA==', { mimeType: 'application/octet-stream' }), { code: 'UNSUPPORTED_AUDIO_FORMAT' });
    assert.throws(() => decodeAudioInput('AQIDBA==', { languageCode: '../en' }), { code: 'INVALID_AUDIO_LANGUAGE' });
    assert.throws(() => decodeAudioInput('A'.repeat(8 * 1024 * 1024 + 4)), { code: 'AUDIO_TOO_LARGE' });
  });

  it('only accepts an actual provider transcript and recognizes nested response shapes', async () => {
    const result = await transcribeAudioInput({
      async transcribeAudio() {
        return { transcript: '  What is my balance?  ', confidence: 0.94, isMock: false };
      }
    }, 'AQIDBA==', { mimeType: 'audio/webm' });
    assert.equal(result.transcript, 'What is my balance?');
    assert.equal(result.confidence, 0.94);

    await assert.rejects(
      transcribeAudioInput({
        async transcribeAudio() {
          return { transcript: 'An example request from a mock.', confidence: 0.99, isMock: true };
        }
      }, 'AQIDBA=='),
      { code: 'SPEECH_RECOGNITION_UNAVAILABLE' }
    );
    assert.equal(extractTranscript({ data: { results: [{ text: 'Nested recognized words' }] } }), 'Nested recognized words');
    assert.equal(extractTranscript({ message: 'not a transcript field' }), '');
    assert.equal(extractConfidence({ data: { results: [{ text: 'recognized words', confidence: 98 }] } }), 0.98);
    assert.equal(extractConfidence({ transcript: 'recognized words' }), null);
  });
});
