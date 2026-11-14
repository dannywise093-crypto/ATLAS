# ATLAS Python execution: security boundary and rollout

## What this milestone does

- The Code Lab sends source to the authenticated Render gateway through the same-origin Vercel API.
- The gateway validates source, runs a separate Python process, captures stdout/stderr, exit status and duration, and enforces a wall-clock timeout plus best-effort POSIX CPU, address-space, file-size, descriptor and process limits.
- A narrow AST/import policy blocks common filesystem, process, network and dynamic-execution entry points.
- A failed runtime can be sent once to the configured model for a proposed repair. The proposed source is revalidated and executed again. The UI labels output verified only when the subprocess exits successfully.
- Policy rejections are not silently executed or auto-repaired.

## Important security limitation

This is a **restricted subprocess runner**, not a hardened hostile-code sandbox. Python's language/runtime is not designed to provide a complete security boundary against adversarial code. AST restrictions and resource limits are defense-in-depth, not a guarantee that a determined attacker cannot escape the restrictions or access resources available to the Render service account.

Before opening execution to the public or treating generated code as trusted, move execution into a separately administered sandbox service with a real isolation boundary (for example, disposable microVMs or a properly configured container runtime with non-root UID, read-only root filesystem, no service credentials, no network egress, seccomp/AppArmor, strict cgroups and per-run ephemeral storage). The model gateway must never share secrets or privileged files with the code runner. Do not run this service with production credentials in its environment.

## Limits in this implementation

- Source: 20,000 characters.
- Wall clock: 5 seconds per attempt.
- POSIX best-effort CPU: 6 seconds.
- Address space: 256 MiB.
- File size: 1 MB; open descriptors: 32; process count: 16 where supported.
- Captured stdout/stderr are truncated to 20,000 characters.
- One model-assisted repair attempt at most.
- Standard-library imports are allowlisted; third-party packages and network access are not supported.

The limits are intentionally conservative. They must be load-tested against the actual Render plan and deployment environment. If a platform does not support a particular POSIX limit, the runner continues with the remaining limits and wall-clock timeout.

## Deployment requirements

The existing Render service must deploy the updated server/main.py and include server/python_runner.py. The Vercel project must deploy api/execute.js and the updated vercel.json. The existing server-side gateway URL/token configuration is reused; no new client-side secrets are introduced.

A successful API response includes execution_verified: true only when the final Python subprocess actually completed with exit code 0 and did not time out. A model's predicted output is never treated as execution evidence.