# ATLAS Agent Components

This directory contains agent source components that are versioned as part of the
ATLAS repository.

## NVIDIA Deep Researcher Agent

The complete NVIDIA Deep Researcher Agent source snapshot is vendored at
[`nvidia-deep-researcher/`](nvidia-deep-researcher/). It is a normal directory
inside the ATLAS Git tree, **not** a Git submodule, external checkout, or runtime
download.

That means a normal clone of ATLAS includes the full imported source automatically:

```bash
git clone https://github.com/dannywise093-crypto/ATLAS.git
cd ATLAS
ls agents/nvidia-deep-researcher
```

The imported project keeps its own Python package, lockfile, configurations,
frontends, deployment assets, documentation, tests, and upstream license notices.
Its Python dependencies are intentionally isolated from ATLAS's Node.js/Cloudflare
runtime. Do not add its dependency tree to the root `package.json` or attempt to
run the Python research service inside a Cloudflare Worker.

### Source ownership and updates

- The ATLAS repository is the source of truth for the checked-in copy.
- The upstream NVIDIA project is recorded in
  [`nvidia-deep-researcher/UPSTREAM.md`](nvidia-deep-researcher/UPSTREAM.md).
- Changes made to the ATLAS copy are committed to ATLAS like any other source.
- Upstream updates must be deliberately imported and reviewed; do not replace the
  directory blindly or overwrite ATLAS integration changes.
- Preserve `LICENSE`, `LICENSE-THIRD-PARTY`, and upstream notices when updating.

### Runtime status

Vendoring makes the complete source available to every ATLAS clone. It does not
install Python dependencies, provision model/search credentials, deploy the
research service, or connect it to the ATLAS gateway. Those are separate runtime
and integration steps documented in
[`nvidia-deep-researcher/ATLAS-INTEGRATION.md`](nvidia-deep-researcher/ATLAS-INTEGRATION.md).
