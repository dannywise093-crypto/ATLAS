# ATLAS AI — Version 1.0 prototype

A mobile-friendly React interface prototype for a future general-purpose Physical AI platform.

## What works in this prototype
- Responsive dashboard and navigation
- Local demo chat interface (responses are placeholders, not a connected AI model)
- Project notes stored in this browser using localStorage
- Local image preview (images are not uploaded or analyzed)
- Robotics status and safety information screens

## What is not connected yet
- Cloud AI provider / real model responses
- Server-side database and account authentication
- Live camera stream or AI image analysis
- Microphone / speech recognition / text-to-speech
- ROS 2, robot hardware, motors or sensors

The Robotics screen is informational only. This app cannot control physical hardware.

## Run locally
Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

## Build for deployment
```bash
npm run build
```
Production files are generated in `dist/`.

## Android test APK
A Capacitor Android wrapper and GitHub Actions workflow are included.
Open **Actions → Build ATLAS Android test APK → Run workflow**. When complete,
download the `atlas-ai-debug-apk` artifact. This is a debug/test APK, not a Play Store release.

## Safety
Do not connect this prototype directly to motors or actuators. Any future physical
control system should include an independent emergency stop, speed/force limits,
watchdogs, safe states and supervised testing. Never put API keys in frontend code.
