# ATLAS Agent Skills

ATLAS includes the NVIDIA skills catalog from the official upstream repository:

- Source: https://github.com/NVIDIA/skills
- Snapshot date: 2026-11-16
- Installed skill directories: 451
- Skill instructions: `.agents/skills/<skill-name>/SKILL.md`
- Generated runtime catalog: `cloudflare/generated-skill-catalog.js`

The complete skill folders are retained, including their reference material,
evaluation files, benchmark reports, skill cards, and detached signature files.
The NVIDIA trust anchor is stored at `.agents/nv-agent-root-cert.pem`.

## Rebuild ATLAS's runtime catalog

After adding, removing, or updating skills, run this from the repository root:

```bash
npm run skills:build
npm test
npm run build
```

The catalog builder reads the supported skill roots and generates the bounded
catalog consumed by the Cloudflare Worker. ATLAS routes only relevant skill
references for each request. Skill text is treated as untrusted reference data;
the Worker does not execute scripts bundled inside skill folders. A skill may
still describe external NVIDIA hardware, GPU runtimes, credentials, or services
that must be provisioned separately.

## Verify an NVIDIA skill signature

NVIDIA publishes detached OMS signatures. The catalog snapshot preserves those
signatures and the upstream trust anchor. To independently verify one skill,
use NVIDIA's `model-signing` package and the command documented upstream:

```bash
python -m pip install model-signing
model_signing verify certificate .agents/skills/<skill-name> \
  --signature .agents/skills/<skill-name>/skill.oms.sig \
  --certificate_chain .agents/nv-agent-root-cert.pem \
  --ignore_unsigned_files
```

Upstream verification guidance: https://github.com/NVIDIA/skills#verifying-skills
