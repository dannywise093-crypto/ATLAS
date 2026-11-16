# ATLAS NVIDIA skill and specialist orchestrator

## What this adds

ATLAS Copilot can route a request to relevant installed skill references and specialist roles instead of hard-coding cuOpt as its only skill. The catalog is generated from Markdown skill files and contains each skill's name, description, tags, source path, and a bounded instruction excerpt.

Supported skill source directories:

- `.agents/skills/`
- `.claude/skills/`
- `agent/skills/`
- `agents/skills/`

The generator deduplicates by normalized skill name. It does not install skills or create third-party agent accounts.

## Build the catalog

After installing skills in the repository workspace, run:

```bash
npm run skills:build
```

Then commit `cloudflare/generated-skill-catalog.js` with the source skill files (where redistribution is permitted). The checked-in seed catalog contains only the cuOpt skill; regenerate it in the Codespace to include all installed NVIDIA skills.

## Routing behavior

The router ranks skills using the request text, skill name, description, and tags, then selects up to four matching references. It also identifies relevant specialist roles such as AI/ML, CUDA/GPU, numerical optimization, robotics/simulation, computer vision, and software engineering. Only selected references are added to the Copilot system context, keeping prompts bounded.

The current implementation is a **single-model orchestrator with specialist roles**, not 451 independent model processes. Separate autonomous agents, tool permissions, durable sessions, and agent-to-agent handoffs are future runtime work.

## Safety and execution boundaries

Skill files are external instructions and are treated as untrusted reference data. ATLAS must not let a skill override system rules, request secrets, or claim that a tool/runtime was used when it was not. A skill is not itself a solver, GPU, API credential, or installed runtime.

For cuOpt specifically, the skill provides modeling guidance. Actual optimization execution still requires a separately provisioned NVIDIA cuOpt runtime and secured server-side adapter.

## Verification

```bash
npm run skills:build
npm test
npm run build
```

The generated catalog should be reviewed before committing. Do not commit secrets, local environment files, or unlicensed third-party skill content.
