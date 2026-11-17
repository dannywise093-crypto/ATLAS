# ATLAS Voice Center

ATLAS Voice Center uses a **typed-input, spoken-output** interaction.

## How it works

- The user types a message in Voice Center.
- ATLAS sends the message through the same configured ATLAS text-chat provider used by the main assistant.
- ATLAS speaks the resulting reply using the existing `/api/tts` speech endpoint.
- The user can stop speech playback at any time.
- Voice Center does not request microphone permission, capture audio, record speech, or use speech recognition.

## Privacy and provider boundaries

- Normal ATLAS text-chat routing remains unchanged.
- Voice Center does not use Gemini Live or send microphone audio to Google.
- Speech generation uses the configured ATLAS text-to-speech service. Its provider and data handling are determined by the server-side `/api/tts` implementation.
- Never put provider API keys in browser code or public environment variables.

## Deployment notes

Deploy the Pages application containing the Voice Center UI and existing `/api/tts` function. No Gemini Live token is required for this typed-input voice experience.

If spoken replies fail, check the Pages Function logs for `/api/tts`, verify the server-side speech provider configuration, and test audio playback on the target browser. Text chat should remain usable even if speech generation is unavailable.
