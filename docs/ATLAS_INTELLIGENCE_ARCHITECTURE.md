# ATLAS Intelligence Architecture — Foundation v0.2

## Mission
Build ATLAS as an original, modular personal AI system. The long-term ambition is broad conversational, reasoning, knowledge, creative and perceptual capability. This repository currently contains an early deterministic local assistant, not a frontier-scale model.

## Current working foundation
- React + Capacitor Android application.
- Local chat history and project notes stored in browser localStorage.
- Rule-based intent handling in `src/atlasCore.js`.
- Save, list and keyword-search project notes.
- A transparent roadmap response.
- Image selection is preview-only; no model analyzes the image.
- Voice, web retrieval, neural inference and robotics are not connected.

## Target architecture

### 1. Interaction layer
Android app, chat interface, and later speech input/output. This layer handles user experience and permissions; it should not contain secrets.

### 2. ATLAS Core
A model-independent coordinator that classifies requests, chooses a capability, tracks task state, and formats responses. Keep deterministic policy and safety checks separate from model-generated text.

### 3. Neural runtime
A replaceable inference interface for a compact quantized model. Before selecting a model, benchmark actual physical RAM, available storage, thermal behavior, token speed and battery use on the target phone. Extended/virtual RAM is not equivalent to physical RAM. Do not download or load a large model until the device budget is measured.

### 4. Memory and knowledge
Separate:
- Conversation history (what was said)
- User-approved memory (small persistent notes)
- Knowledge documents (retrievable sources with provenance)
- Model weights (learned parameters; not updated merely by saving a memory)

Memory must be inspectable, editable and deletable by the user. Retrieval should show which saved note or document informed an answer.

### 5. Perception
Image and audio processing should be independent modules with clear permission prompts and on-device privacy choices. Current image support is only a local preview.

### 6. Evaluation
Every capability needs repeatable tests for correctness, uncertainty, latency, offline behavior, privacy and failure handling. Never label a planned feature as operational.

### 7. Physical AI
Robotics stays disconnected while the project is software-only. Future integration must begin in simulation and require an independent safety controller, physical emergency stop, bounded movement, watchdogs and supervised testing. The language model must never be the sole safety mechanism.

## Development sequence
1. Foundation: core interfaces, memory behavior and tests.
2. Neural runtime: device benchmarking and small-model feasibility study.
3. Knowledge: local document indexing and source-aware retrieval.
4. Perception: privacy-conscious image and audio capabilities.
5. Evaluation: automated tests and performance reports.
6. Physical AI: simulation and safety review before any hardware connection.

## Immediate device checks
Record the exact CAMON 40 variant, physical RAM (separate from memory expansion), free storage and Android version. A 1–3B quantized model is only an investigation target, not a promise that it will run well. Actual feasibility depends on model architecture, context size, runtime overhead and available memory.

## Security
Never commit API keys, passwords, signing keys or personal data. Any cloud credentials or billing setup should be handled with a parent or guardian. Prefer local inference for offline privacy; if a cloud service is ever added, keep credentials on a secured server and explain what data leaves the phone.
