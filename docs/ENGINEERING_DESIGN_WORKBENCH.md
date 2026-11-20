# NEXORA Engineering Design Workbench

The Engineering Studio is a first implementation slice connecting the NEXORA model gateway to an engineering concept workflow.

## Current workflow

1. The user supplies an engineering idea, discipline and optional constraints.
2. NEXORA requests a structured concept package covering the project brief, research and sources, architecture, calculations, materials/manufacturing, validation/safety and next iteration.
3. The existing chat gateway performs request-time web retrieval when its live-research classifier detects a research request. Sources are included only when retrieval returns them; snippets are not proof that full pages were independently verified.
4. The user can request a separate FLUX.1 schnell concept illustration through the authenticated Cloudflare Worker gateway.
5. The report and generated image can be saved from the mobile-friendly interface.

## Image generation architecture

- Browser: `src/EngineeringStudio.jsx`
- Same-origin authenticated Pages proxy: `functions/api/engineering/visual.js`
- Worker endpoint: `POST /api/engineering/visual` in `cloudflare/worker.js`
- Model: `@cf/black-forest-labs/flux-1-schnell` through the existing Workers AI binding.
- The Pages proxy requires the existing server-side `ATLAS_GATEWAY_TOKEN`; no provider key is exposed to browser code.
- The Pages proxy limits image requests per client IP. The Worker applies its own gateway rate limit and validates prompt length.

## Important engineering limitations

This first slice produces a research-backed concept report and an AI visual illustration. It does not yet generate editable parametric CAD, STEP/STL solids, dimensionally accurate manufacturing drawings, validated simulation results, or a production-ready bill of materials. A rendered image is not CAD geometry. Engineering calculations and assumptions must be independently checked; safety-critical systems require qualified engineering review, applicable-code checks and physical validation before manufacture or operation.

## Deployment and verification

The feature branch needs GitHub Actions/build verification and a live Cloudflare Pages + Worker smoke test. The Worker image route requires the existing Workers AI binding to be deployed. Cloudflare account model availability, quota and pricing apply. No secrets or account settings are changed by this branch.
