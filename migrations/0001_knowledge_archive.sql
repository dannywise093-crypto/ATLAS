-- ATLAS durable knowledge archive (D1)
-- Stores public-source metadata and retrieved snippets only; never conversation prompts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  content_hash TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'snippet_only'
    CHECK (verification_status IN ('snippet_only', 'page_verified', 'rejected')),
  trust_score REAL NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_runs (
  id TEXT PRIMARY KEY,
  query_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'partial', 'failed')),
  source_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_last_seen
  ON knowledge_sources(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_publisher
  ON knowledge_sources(publisher);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source
  ON knowledge_chunks(source_id, chunk_index);
