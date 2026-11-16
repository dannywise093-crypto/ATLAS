# ATLAS Voice Assistant

## User experience

The Voice Center provides an opt-in wake-word session. The user enables listening once with a deliberate tap and grants microphone permission. While ATLAS remains open in the foreground, it waits for the spoken wake word “ATLAS”. The user can say “ATLAS” followed by a request, or say “ATLAS” and then give the request. ATLAS submits the request to the selected model, reads the response aloud, and returns to wake-word standby.

Voice requests use the same active ATLAS conversation and model gateway as typed requests. A voice-session flag activates a concise, composed, British-English butler persona that addresses the user as "sir" and avoids visual formatting that is awkward when spoken. The implementation is inspired by the requested fictional style; it does not claim to be the fictional character.

## Current platform support

The current implementation uses the browser Web Speech APIs and a foreground wake-word state machine:
- Speech recognition: `SpeechRecognition` or `webkitSpeechRecognition`.
- Spoken output: `speechSynthesis` and `SpeechSynthesisUtterance`. Spoken text is cleaned of Markdown markers before playback. A deeper named British voice is preferred when the device exposes one; otherwise the best available British English voice is selected.

Support varies by browser and operating system. Microphone access requires the user to enable the session once and approve the browser permission. The user can stop the session at any time. Recognition is restarted between utterances to keep wake-word standby active. Speech detected during playback cancels the current utterance and is treated as an interruption. Speech recognition may rely on the browser or operating-system speech service; the app does not promise offline transcription.

## Android APK limitation

Capacitor Android WebView does not consistently expose the browser SpeechRecognition API. The Voice Center detects missing support and explains the limitation instead of pretending the microphone is active. A native Android speech-recognition Capacitor adapter and foreground service are still required for dependable wake-word recognition in APK builds where the WebView lacks that API, and for background or locked-screen listening. This change does not add that native adapter or claim background listening.

## Privacy and lifecycle

- No microphone capture begins before the user explicitly enables wake-word listening.
- Stop ends recognition and cancels speech playback.
- The session remains active when navigating between ATLAS sections; Stop ends it.
- Recognition and speech playback are handled by the device/browser APIs.
- The recognized transcript is sent to the existing authenticated ATLAS chat gateway as the user's message and is retained in the same local conversation history as typed messages.
