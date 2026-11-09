const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const AUDIO_MIME_TYPE_PATTERN = /^audio\/(?:webm|ogg|mp4|wav|mpeg)(?:;[^;\s]+=[^;\s]+)*$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeAudioInput(audioBase64, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    const error = new Error('Audio options must be an object.');
    error.status = 400;
    error.code = 'INVALID_AUDIO_OPTIONS';
    throw error;
  }

  if (typeof audioBase64 !== 'string' || !audioBase64) {
    const error = new Error('Audio must be provided as valid base64 data.');
    error.status = 400;
    error.code = 'INVALID_AUDIO';
    throw error;
  }

  if (audioBase64.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3)) {
    const error = new Error('Audio exceeds the 6 MB limit.');
    error.status = 413;
    error.code = 'AUDIO_TOO_LARGE';
    throw error;
  }

  if (!BASE64_PATTERN.test(audioBase64)) {
    const error = new Error('Audio must be provided as valid base64 data.');
    error.status = 400;
    error.code = 'INVALID_AUDIO';
    throw error;
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) {
    const error = new Error(audioBuffer.length ? 'Audio exceeds the 6 MB limit.' : 'Audio recording is empty.');
    error.status = audioBuffer.length ? 413 : 400;
    error.code = audioBuffer.length ? 'AUDIO_TOO_LARGE' : 'EMPTY_AUDIO';
    throw error;
  }

  const mimeType = options.mimeType || 'audio/wav';
  if (typeof mimeType !== 'string' || !AUDIO_MIME_TYPE_PATTERN.test(mimeType)) {
    const error = new Error('Unsupported audio format. Use WebM, Ogg, MP4, WAV, or MPEG audio.');
    error.status = 400;
    error.code = 'UNSUPPORTED_AUDIO_FORMAT';
    throw error;
  }
  const languageCode = typeof options.languageCode === 'string' ? options.languageCode : 'en-IN';
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/i.test(languageCode)) {
    const error = new Error('Language code must be a language tag such as en-IN.');
    error.status = 400;
    error.code = 'INVALID_AUDIO_LANGUAGE';
    throw error;
  }

  return {
    audioBuffer,
    audioOptions: {
      ...options,
      mimeType,
      languageCode
    }
  };
}

async function transcribeAudioInput(gnaniAdapter, audioBase64, options) {
  const { audioBuffer, audioOptions } = decodeAudioInput(audioBase64, options);
  const result = await gnaniAdapter.transcribeAudio(audioBuffer, audioOptions);
  const transcript = typeof result?.transcript === 'string' ? result.transcript.trim() : '';
  if (result?.isMock || !transcript) {
    const error = new Error('Speech recognition is unavailable. Try again or type your request.');
    error.status = 503;
    error.code = 'SPEECH_RECOGNITION_UNAVAILABLE';
    throw error;
  }

  return {
    transcript,
    confidence: Number.isFinite(result.confidence) ? result.confidence : null,
    languageCode: result.languageCode || audioOptions.languageCode,
    model: result.model
  };
}

module.exports = {
  MAX_AUDIO_BYTES,
  decodeAudioInput,
  transcribeAudioInput
};
