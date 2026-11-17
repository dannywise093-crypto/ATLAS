# ATLAS Reference-Voice TTS

## Status

The application-side adapter is implemented on the `feature/atlas-reference-voice-tts`
branch. It is not active in production until a self-hosted TTS service is deployed,
the reference voice is installed on that service, and the Cloudflare Worker secrets
below are configured.

The existing React audio player and `/api/tts` browser contract are unchanged.
The Pages Function continues to proxy requests to the authenticated ATLAS Worker.

## Request flow

1. `src/voiceInterface.js` posts `{ "text": "..." }` to the same-origin `/api/tts`.
2. `functions/api/tts.js` forwards the request to the ATLAS Cloudflare Worker.
3. If `ATLAS_VOICE_CLONE_URL` and `ATLAS_VOICE_CLONE_TOKEN` are configured on the
   Worker, it calls the private self-hosted ATLAS Pocket TTS adapter endpoint.
4. The Worker streams the returned audio to the existing browser player.
5. If the clone URL is not configured, the existing Cloudflare built-in voice
   remains the temporary fallback. If a clone URL is configured without a token,
   the Worker fails closed rather than silently switching to another voice.

The reference audio is intended to be installed on the self-hosted TTS server as
the voice named `atlas-reference`. It is not sent from the browser on every request.

## Required Worker secrets / variables

Configure these on the **Cloudflare Worker** (not as public `VITE_*` variables):

- `ATLAS_VOICE_CLONE_URL`: base URL of the private self-hosted TTS service, for
  example `https://your-private-tts-host.example`.
- `ATLAS_VOICE_CLONE_TOKEN`: bearer token accepted by that service.

The service must implement:

`POST /v1/audio/speech`

Request body:

```json
{
  "input": "Text ATLAS should speak",
  "voice": "file://atlas-reference",
  "language_id": "en",
  "response_format": "wav"
}
```

It must return a WAV response with an `audio/wav` content type. The service currently
supports WAV only; it rejects MP3 requests rather than returning WAV under an MP3
contract. The Worker keeps the service token server-side and never returns it to the browser.

## Reference audio preparation

Use the user's approved reference recording. Store it only on the private TTS host.
If the selected engine expects WAV, convert the source recording to a clean mono
WAV file at the sample rate required by that engine, then install it as
`atlas-reference.wav` in the configured voice directory. Do not commit the audio
sample, speaker embeddings, model weights, or access tokens to this repository.

Before public launch, restrict the TTS service to authenticated requests, keep
its network ingress private where possible, set request-size and concurrency
limits, and monitor compute usage.

## Hosting note

The selected engine for this zero-budget prototype is **Kyutai Pocket TTS**.
It accepts a reference audio file, runs on CPU, and exposes a local HTTP server.
The Python API loads a voice state from a local audio file and generates speech.
The ATLAS wrapper in `voice-service/` exposes the authenticated endpoint used by
the Cloudflare Worker. Pocket TTS generates WAV natively, so ATLAS returns WAV
rather than adding an MP3 transcoding dependency. Its model inference method is not
thread-safe, so the service serializes generation requests around its single in-memory model.

Official documentation:
- https://github.com/kyutai-labs/pocket-tts
- https://kyutai-labs.github.io/pocket-tts/CLI%20Commands/serve/
- https://kyutai-labs.github.io/pocket-tts/API%20Reference/python-api/

Pocket TTS can run on CPU, but actual speed and memory use depend on the host.
That does not guarantee a free hosted instance has sufficient memory or stays
awake. Test the service on the intended host before routing production traffic.

## Verification

Run:

```bash
npm test
npm run build
```

The Worker tests cover authenticated reference-voice routing, MP3 passthrough,
and the missing-token fail-closed case. A successful test does not mean a real
voice service has been deployed or that the reference voice has been installed.
