# ATLAS Voice Assistant

## User experience

The Voice Center provides an opt-in hands-free conversation session. The user starts the session with a deliberate tap, grants microphone permission through the browser, speaks naturally, and pauses. ATLAS submits the recognized sentence to the selected model, receives its response, reads it aloud using an English (United Kingdom) voice when one is available, then resumes listening.

Voice requests use the same active ATLAS conversation and model gateway as typed requests. A voice-session flag activates a concise, composed, British-English butler persona that addresses the user as "sir" and avoids visual formatting that is awkward when spoken. The implementation is inspired by the requested fictional style; it does not claim to be the fictional character.

## Current platform support

The current implementation uses the browser Web Speech APIs:
- Speech recognition: `SpeechRecognition` or `webkitSpeechRecognition`.
- Spoken output: `speechSynthesis` and `SpeechSynthesisUtterance`.

Support varies by browser and operating system. Microphone access requires the user to start the session and approve the browser permission. The user can stop the session at any time. Speech recognition may rely on the browser or operating-system speech service; the app does not promise offline transcription.

## Android APK limitation

Capacitor Android WebView does not consistently expose the browser SpeechRecognition API. The Voice Center detects missing support and explains the limitation instead of pretending the microphone is active. A native Android speech-recognition Capacitor adapter is required for dependable hands-free recognition in APK builds where the WebView lacks that API. The current change does not add that native adapter.

## Privacy and lifecycle

- No microphone capture begins before the user taps Start.
- Stop ends recognition and cancels speech playback.
- Navigating away from Voice Center stops the session.
- Recognition and speech playback are handled by the device/browser APIs.
- The recognized transcript is sent to the existing authenticated ATLAS chat gateway as the user's message and is retained in the same local conversation history as typed messages.
