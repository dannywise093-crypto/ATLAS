# ATLAS Voice Center

ATLAS Voice Center supports optional, user-initiated voice-to-voice turns.

## How it works

1. The microphone remains off by default.
2. The user taps **Speak to ATLAS** to start one speech-recognition turn.
3. The browser captures speech only for that active turn and produces a text transcript.
4. ATLAS sends the transcript through its normal chat gateway using voice-response style.
5. ATLAS speaks the reply through the authenticated `/api/tts` endpoint.
6. Recognition ends after the utterance or when the user taps **Finish & send**. The user can cancel the active turn.

Typed messages remain available in Voice Center and also receive spoken replies. The user can stop spoken playback at any time.

## Privacy and interaction rules

- Never start speech recognition automatically on page load, navigation, or after an AI response.
- Never keep the microphone open between turns or in the background.
- Request microphone access only after the user explicitly taps **Speak to ATLAS**.
- Do not record or persist raw microphone audio. Only the recognized text is added to the conversation.
- If speech recognition is unavailable or permission is denied, explain the issue and keep typed chat plus spoken replies available.
- Do not use Gemini Live or any always-on listening session for this experience.

## Browser compatibility

Speech input depends on the browser's `SpeechRecognition` or `webkitSpeechRecognition` implementation. Some Android WebViews do not expose this API; in those environments, the UI must report that voice input is unavailable rather than pretending the microphone works. Cloud TTS remains a separate `/api/tts` request and may be unavailable while the account's free Workers AI allocation is exhausted.

## Verification

Unit tests cover capability detection, explicit one-turn recognition setup, cloud TTS request handling, playback, and stop behavior. End-to-end microphone permission and spoken conversation must still be verified on a real supported browser/device.
