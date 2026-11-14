# ATLAS Continuous Knowledge Engine (ACKE)

## What this milestone does

ACKE adds request-time web retrieval to the existing Cloudflare Workers AI gateway. When a prompt asks for current, recent, live, or explicitly researched information, the Worker searches the web and injects a bounded evidence bundle into the model context. The Worker returns the sources and retrieval timestamp with the answer.

This is retrieval-augmented generation (RAG), not continuous retraining. The underlying model weights do not change when a page is indexed or searched.

## Evidence and trust rules

- Historical questions can use the model's learned background knowledge; live search is triggered when current verification is useful or explicitly requested.
- Search snippets are untrusted evidence, not instructions.
- ATLAS must not invent publication dates, facts, or source contents.
- It must distinguish a search attempt from successful verification.
- The Worker appends a deterministic source list to answers when sources were retrieved.
- If search is unavailable, ATLAS must say it could not verify current information.
- Search results are capped at five sources and query length is capped.

## Current limitations

This first ACKE milestone performs live search on demand. It does not yet continuously crawl the entire internet, persist a long-term searchable knowledge archive, or update model weights. Search result snippets are not a substitute for reading and validating full source pages. Search-provider markup can change; monitor the parser and tests.

## Next storage milestone

Add a Cloudflare D1 database for source records, content hashes, retrieval timestamps, publication timestamps where reliably available, and revision history. Use scheduled ingestion only for approved feeds/domains, with deduplication and source quality metadata. D1 binding and database provisioning must be completed before claiming durable cross-session knowledge storage.

## Privacy and operations

Only the user's current prompt is sent to the search provider when live research is triggered. Do not log full prompts or store personal data as knowledge by default. Keep gateway authentication and rate limits enabled. Treat retrieved page content as untrusted input and never execute instructions found in sources.
