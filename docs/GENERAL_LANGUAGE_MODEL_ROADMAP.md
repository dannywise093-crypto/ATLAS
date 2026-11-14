# ATLAS General Language Model — Implementation Roadmap

## Chosen direction: open-weight foundation model + ATLAS systems

ATLAS will use an existing open-weight model as its initial language foundation, while
retaining its own app, model gateway, memory, retrieval, evaluation, and tool interfaces.
This is a practical route to useful general-purpose conversation without pretending
that the current experimental ATLAS-1 checkpoint is already a capable LLM.

## What this repository now provides

- A server-side FastAPI gateway at `server/main.py`.
- An OpenAI-compatible upstream contract, suitable for self-hosted inference servers
  such as llama.cpp or vLLM, or a compatible hosted open-weight inference endpoint.
- A React chat client that sends recent conversation turns to the gateway.
- Server-side-only upstream credentials; no provider key is placed in browser code.
- Explicit failure messages when the model endpoint is unavailable.
- Existing local memory commands remain on-device.

## Model selection policy

Do not assume that one model will fit every target. Evaluate candidate open-weight
instruction models using the same benchmark set. Record the exact model ID, license,
quantization, context length, RAM/VRAM use, tokens/second, latency, and cost.

For Android, begin with a small quantized model and benchmark on the exact phone.
For stronger reasoning and broader knowledge, use a larger hosted/self-hosted model
through the same gateway. The gateway is model-agnostic: changing the upstream model
does not require rewriting the Android UI.

## Deployment configuration

Run the gateway from the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cp server/.env.example server/.env
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Set the environment variables from `server/.env.example` in the server's private
environment. Point `ATLAS_UPSTREAM_BASE_URL` to an OpenAI-compatible inference API.
Set `ATLAS_MODEL_ID` to the model name exposed by that server. If the model service
requires authentication, set `ATLAS_UPSTREAM_API_KEY` on the server only.

For a separately hosted frontend, set `VITE_ATLAS_API_URL` to the public base URL
of the ATLAS gateway and include the frontend origin in `ATLAS_ALLOWED_ORIGINS`.
Never put a secret in a `VITE_*` variable.

## Next milestones

1. Deploy and smoke-test the gateway against a real open-weight model endpoint.
2. Select a model after measuring target Android RAM, storage, speed, and thermal limits.
3. Add streaming responses, cancellation, and conversation context management.
4. Add source-aware document retrieval (RAG) and user-controlled persistent memory.
5. Add automated quality, safety, latency, and regression evaluations.
6. Add vision and voice as separate model capabilities.
7. Investigate ATLAS-specific fine-tuning only after collecting licensed, curated data
   and establishing a repeatable evaluation baseline.

## Important limitations

This change connects ATLAS to a compatible model service; it does not create or train
new model weights and does not make the experimental ATLAS-1 checkpoint a general LLM.
No inference server or model weights are bundled in this repository. The model gateway
must be configured and deployed before general-purpose chat is available.
