# Gnani AI Integration & Credit Budget Guard

AgentShield Voice integrates with **Gnani.ai** (`https://api.vachana.ai`) for telephonic speech recognition, expressive text-to-speech, and language reasoning.

---

## 1. Verified Gnani Specifications

| Capability | Model | Endpoint | Protocol / Format | Notes |
|:---|:---|:---|:---|:---|
| **Speech-to-Text (STT)** | **Prisma v2.5** | `POST https://api.vachana.ai/stt/v3` | REST Multipart (`audio_file`, `language_code`) | Optimized for Indian English & 11 Indic languages |
| **Realtime STT Stream** | **Prisma v2.5** | `WSS wss://api.vachana.ai/stt/v3/stream` | WebSocket PCM | Low-latency telephony audio streaming |
| **Text-to-Speech (TTS)** | **Timbre v2.5 / v3.0** | `POST https://api.vachana.ai/api/v1/tts` | REST / WebSocket JSON | Context-aware prosody & emotional cues |
| **Reasoning Model (LLM)** | **Evon v3.3** | `POST https://api.vachana.ai/v1/chat/completions`| REST JSON | 30B parameter foundational reasoning model |

### Authentication
All requests require the header:
```http
X-API-Key-ID: <your_gnani_api_key>
```

---

## 2. Conservative Credit Budget Guard

To protect your credit allocation under the **5,000 credit budget constraint**, AgentShield enforces strict local telemetry accounting:

- **Safe Default (`GNANI_ENABLED=false`):**
  Fresh installations default to mock mode. Zero billable calls occur on startup or during automated test runs.
- **Safety Reserve:**
  `GNANI_CREDIT_RESERVE=1000`. Billable calls automatically halt when consumed credits hit 4,000, safeguarding 1,000 credits from accidental exhaustion.
- **Authoritative vs Estimated Accounting:**
  When the provider returns reported credits in response headers/payloads, exact numbers are recorded. Otherwise, conservative local estimates are logged and clearly flagged as `isEstimatedOnly: true`.
- **Zero Automatic Billable Retries:**
  Provider timeouts and errors log a `PROVIDER_FAILURE` event and fail closed. AgentShield never performs hidden background retry loops.

---

## 3. Switching to Live Gnani Integration

To activate live calls against `api.vachana.ai`:

1. Open `.env`.
2. Configure your credentials:
   ```env
   GNANI_ENABLED=true
   GNANI_API_KEY=your_actual_vachana_api_key_here
   GNANI_CREDIT_BUDGET=5000
   GNANI_CREDIT_RESERVE=1000
   ```
3. Restart the server:
   ```bash
   node server/src/index.js
   ```
4. Verify the top bar status badge changes to **Gnani Voice: LIVE**.
