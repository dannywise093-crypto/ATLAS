# ATLAS Voice Assistant

## User experience

Opening Voice Center starts a foreground wake-word session automatically and requests microphone permission if needed. No microphone activation button is shown. While ATLAS remains open in the foreground, it waits for the spoken wake word “ATLAS”. The user can say “ATLAS” followed by a request, or say “ATLAS” and then give the request. ATLAS submits the request to the selected model, reads the response aloud, and returns to wake-word standby.

Voice requests use the same active ATLAS conversation and model gateway as typed requests. A voice-session flag activates a concise, composed, British-English butler persona that addresses the user as "sir" and avoids visual formatting that is awkward when spoken. The implementation is inspired by the requested fictional style; it does not claim to be the fictional character.

## Current platform support

The current implementation uses the browser Web Speech APIs and a foreground wake-word state machine:
- Speech recognition: `SpeechRecognition` or `webkitSpeechRecognition`.
- Spoken output: `speechSynthesis` and `SpeechSynthesisUtterance`. Spoken text is cleaned of Markdown markers before playback. A deeper named British voice is preferred when the device exposes one; otherwise the best available British English voice is selected.

Support varies by browser and operating system. Microphone access is requested when Voice Center opens. Recognition is paused while speech synthesis is playing, then restarted once playback finishes. This avoids competing browser microphone and audio playback sessions on Android. Voice interruption during playback is not supported by this single-owner browser audio lifecycle. Speech recognition may rely on the browser or operating-system speech service; the app does not promise offline transcription.

## Android APK limitation

Capacitor Android WebView does not consistently expose the browser SpeechRecognition API. The Voice Center detects missing support and explains the limitation instead of pretending the microphone is active. A native Android speech-recognition Capacitor adapter and foreground service are still required for dependable wake-word recognition in APK builds where the WebView lacks that API, and for background or locked-screen listening. This change does not add that native adapter or claim background listening.

## Privacy and lifecycle

- Microphone capture begins only after the user opens Voice Center and approves the operating-system/browser permission.
- Leaving Voice Center ends recognition and cancels speech playback.
- The session is limited to the foreground Voice Center page.
- Recognition and speech playback are handled by the device/browser APIs.
- The recognized transcript is sent to the existing authenticated ATLAS chat gateway as the user's message and is retained in the same local conversation history as typed messages.
