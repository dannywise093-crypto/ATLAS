# Cloudflare checkpoint storage provisioning

This procedure provisions the dedicated D1 and R2 resources required by the
NEXORA NVIDIA Deep Research LangGraph saver. It does not deploy the Worker or
switch the production checkpoint backend.

## Current account constraints

- R2 is not enabled for the connected Cloudflare account yet. Enable R2 in the
  Cloudflare Dashboard before running the bucket creation command.
- The only D1 database currently visible is `atlas-knowledge-archive`. It is
  reserved for the ATLAS knowledge project and MUST NOT be reused for research
  checkpoints.
- Create a dedicated database named `nexora-research-checkpoints` and a
  dedicated R2 bucket with the same name.

## 1. Enable R2

Open Cloudflare Dashboard → R2 Object Storage → Get started / Enable R2.
Complete any account setup or billing prompts. No R2 bucket can be created until
Cloudflare enables the account's R2 service.

## 2. Create dedicated resources and bindings

Run these commands from the repository root after authenticating Wrangler:

```sh
npx wrangler d1 create nexora-research-checkpoints \
  --binding RESEARCH_CHECKPOINTS_DB \
  --update-config \
  --config wrangler.research.jsonc

npx wrangler r2 bucket create nexora-research-checkpoints \
  --binding RESEARCH_CHECKPOINTS_BUCKET \
  --update-config \
  --config wrangler.research.jsonc
```

Wrangler should add the corresponding `d1_databases` and `r2_buckets`
entries to `wrangler.research.jsonc`. Confirm that the D1 database ID is the
newly created `nexora-research-checkpoints` database, not the ATLAS database.

## 3. Apply and verify the schema

```sh
npx wrangler d1 execute nexora-research-checkpoints \
  --remote \
  --file agents/nvidia-deep-researcher/deploy/checkpoint_schema.sql \
  --config wrangler.research.jsonc

npx wrangler d1 execute nexora-research-checkpoints \
  --remote \
  --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name" \
  --config wrangler.research.jsonc

npx wrangler r2 bucket list
```

The D1 result must include `research_checkpoint_threads`,
`research_checkpoints`, `research_checkpoint_writes`,
`research_checkpoint_thread_tombstones`, and `research_checkpoint_r2_gc`.
The R2 list must include `nexora-research-checkpoints`.

## 4. Configure the Worker only after resource verification

The Worker needs these bindings:

- `RESEARCH_CHECKPOINTS_DB` → dedicated D1 database
- `RESEARCH_CHECKPOINTS_BUCKET` → dedicated R2 bucket
- `RESEARCH_CHECKPOINT_COORDINATOR` → existing Durable Object binding

The container also needs the matching runtime values:

- `NEXORA_RESEARCH_CHECKPOINT_BACKEND=cloudflare`
- `DEEP_RESEARCHER_CHECKPOINT_DB=cloudflare://nexora`
- `NEXORA_RESEARCH_TENANT=nexora-prod`
- `NEXORA_RESEARCH_PUBLIC_URL=https://<deployed-worker-host>`

Keep the checkpoint backend on its existing default until D1/R2 bindings,
secrets, and the Worker endpoint have been verified. Do not put API tokens in
Wrangler `vars`; use Worker secrets for `NEXORA_RESEARCH_API_TOKEN` and the
NVIDIA/provider credentials.

## 5. Important remaining service dependency

This D1/R2 implementation covers LangGraph checkpoint state and serialized
payloads. The NVIDIA runtime still requires `NAT_JOB_STORE_DB_URL` for the
NAT job/report API. Moving that job/report store to Cloudflare is a separate
migration; therefore this checkpoint work alone does not make the entire
Deep Research service Cloudflare-only.

Do not deploy or enable the Cloudflare checkpoint backend in production until
the dedicated resources are provisioned and the live D1/R2 plus interruption /
restart tests pass. Production deployment also requires explicit approval.
