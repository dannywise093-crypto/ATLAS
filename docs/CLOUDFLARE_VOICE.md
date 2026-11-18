# ATLAS Cloudflare Voice

ATLAS Voice Center uses Cloudflare services for speech recognition, response generation, and speech playback. Gemini Live is not part of the voice path.

## Request flow

1. The microphone remains off until the user taps **Start voice conversation**.
2. The browser captures short utterances locally with MediaRecorder and detects pauses using Web Audio.
3. Audio is sent to the same-origin Pages Function `POST /api/transcribe`.
4. The Pages Function authenticates to the ATLAS Worker and forwards the multipart audio upload.
5. The Worker calls Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo` and returns the transcript.
6. ATLAS sends the transcript through the normal model gateway. NVIDIA remains primary when `NVIDIA_API_KEY` is configured; Cloudflare Workers AI remains the fallback and the default when NVIDIA is not configured.
7. The response is spoken using the existing Cloudflare Workers AI TTS route `@cf/deepgram/aura-2-en`.

## Privacy and limits

- Microphone permission is requested only after the user starts Voice Center.
- Leaving Voice Center or pressing Stop closes the recorder, stops microphone tracks, and closes the audio context.
- Audio segments are limited to 8 MB at the gateway and are not persisted by ATLAS.
- Voice transcription is performed by Cloudflare Workers AI. Speech playback also uses the existing Cloudflare TTS endpoint.
- Browser MediaRecorder and Web Audio are used only for local capture and voice-activity detection; they do not perform speech recognition.
- Workers AI usage is subject to the account's current Cloudflare allocation and pricing.

## Deployment

Deploy both the Cloudflare Pages project and the `atlas-model-gateway` Worker after reviewing this branch. The existing `ATLAS_GATEWAY_TOKEN` binding must remain configured on both sides. No Gemini secret is required by this voice flow. Keep `NVIDIA_API_KEY` configured if NVIDIA should remain the primary text model provider.
