import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Mic, Square } from 'lucide-react';

const MAX_RECORDING_MS = 20000;
const PREFERRED_AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
const STT_SAMPLE_RATE = 16000;

async function convertToWav(recordingBlob) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser cannot convert the recording to the WAV format required for speech recognition.');
  }

  const audioContext = new AudioContextConstructor();
  try {
    const decoded = await audioContext.decodeAudioData(await recordingBlob.arrayBuffer());
    const outputLength = Math.ceil(decoded.duration * STT_SAMPLE_RATE);
    if (!outputLength) throw new Error('No speech audio was captured. Please try recording again.');

    const samples = new Float32Array(outputLength);
    const sourceChannels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const scale = decoded.sampleRate / STT_SAMPLE_RATE;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      const sourcePosition = outputIndex * scale;
      const sourceIndex = Math.floor(sourcePosition);
      const fraction = sourcePosition - sourceIndex;
      let sample = 0;
      for (const channel of sourceChannels) {
        const first = channel[Math.min(sourceIndex, channel.length - 1)] || 0;
        const second = channel[Math.min(sourceIndex + 1, channel.length - 1)] || 0;
        sample += first + (second - first) * fraction;
      }
      samples[outputIndex] = sample / sourceChannels.length;
    }

    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, STT_SAMPLE_RATE, true);
    view.setUint32(28, STT_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([wav], { type: 'audio/wav' });
  } finally {
    await audioContext.close();
  }
}

export default function VoiceRecorder({ disabled = false, userId, agentId, onTranscript }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [languageCode, setLanguageCode] = useState('en-IN');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function startRecording() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Voice recording is not supported by this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;
      const mimeType = PREFERRED_AUDIO_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setError('The recording could not be completed. Please try again.');
        setStatus('idle');
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.onstop = async () => {
        clearTimeout(timerRef.current);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) {
          setError('No audio was captured. Please try again.');
          setStatus('idle');
          return;
        }

        setStatus('processing');
        try {
          const wavBlob = await convertToWav(blob);
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read the recorded audio.'));
            reader.readAsDataURL(wavBlob);
          });
          const base64Start = dataUrl.indexOf(',');
          const response = await fetch('/api/provider/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(userId ? { 'X-User-Id': userId } : {}),
              ...(agentId ? { 'X-Agent-Id': agentId } : {})
            },
            body: JSON.stringify({
              audioBase64: dataUrl.slice(base64Start + 1),
              audioOptions: {
                mimeType: 'audio/wav',
                languageCode
              }
            })
          });
          const result = await response.json();
          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Speech recognition failed. Please try again.');
          }
          onTranscript(result);
        } catch (recordingError) {
          setError(recordingError.message || 'Could not process the recorded audio.');
        } finally {
          setStatus('idle');
        }
      };
      recorder.start();
      setStatus('recording');
      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (recordingError) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStatus('idle');
      setError(recordingError.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to use voice input.'
        : recordingError.message || 'Could not start microphone recording.');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        <select
          className="input"
          aria-label="Speech language"
          value={languageCode}
          disabled={disabled || status !== 'idle'}
          onChange={event => setLanguageCode(event.target.value)}
          style={{ width: 'auto', minWidth: 130, padding: '7px 8px' }}
        >
          <option value="en-IN">English (India)</option>
          <option value="hi-IN">Hindi</option>
          <option value="en-US">English (US)</option>
        </select>
      </label>
      <button
        type="button"
        className={`btn ${status === 'recording' ? 'btn-danger' : 'btn-secondary'}`}
        disabled={disabled || status === 'processing'}
        aria-label={status === 'recording' ? 'Stop voice recording' : 'Start voice recording'}
        title={status === 'recording' ? 'Stop recording' : 'Record a voice request (up to 20 seconds)'}
        onClick={status === 'recording' ? stopRecording : startRecording}
      >
        {status === 'recording' ? <Square size={16} /> : <Mic size={16} />}
        <span>{status === 'recording' ? 'Stop' : status === 'processing' ? 'Transcribing…' : 'Voice'}</span>
      </button>
    </div>
    {error && <small role="alert" style={{ color: 'var(--color-deny)', maxWidth: 240, display: 'flex', gap: 4 }}>
      <AlertCircle size={13} />{error}
    </small>}
  </div>;
}
