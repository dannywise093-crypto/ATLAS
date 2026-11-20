-- NVIDIA Deep Research LangGraph checkpoint metadata schema for Cloudflare D1.
-- R2 stores immutable typed payloads; D1 stores indexes and verified object descriptors.
-- Apply to a dedicated D1 database. This file is not part of the shared ATLAS knowledge migrations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_checkpoint_thread_tombstones (
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, thread_id)
);

CREATE TABLE IF NOT EXISTS research_checkpoint_threads (
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  head_checkpoint_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (tenant_id, thread_id, checkpoint_ns)
);

CREATE TABLE IF NOT EXISTS research_checkpoints (
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint_type TEXT NOT NULL,
  checkpoint_r2_key TEXT NOT NULL,
  checkpoint_sha256 TEXT NOT NULL CHECK (length(checkpoint_sha256) = 64),
  checkpoint_bytes INTEGER NOT NULL CHECK (checkpoint_bytes >= 0),
  metadata_type TEXT NOT NULL,
  metadata_r2_key TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL CHECK (length(metadata_sha256) = 64),
  metadata_bytes INTEGER NOT NULL CHECK (metadata_bytes >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  channel_versions_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, thread_id, checkpoint_ns, checkpoint_id),
  FOREIGN KEY (tenant_id, thread_id, checkpoint_ns)
    REFERENCES research_checkpoint_threads(tenant_id, thread_id, checkpoint_ns)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_checkpoints_history
  ON research_checkpoints(tenant_id, thread_id, checkpoint_ns, checkpoint_id DESC);
CREATE INDEX IF NOT EXISTS idx_research_checkpoints_parent
  ON research_checkpoints(tenant_id, thread_id, checkpoint_ns, parent_checkpoint_id);

CREATE TABLE IF NOT EXISTS research_checkpoint_writes (
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_path TEXT NOT NULL DEFAULT '',
  write_index INTEGER NOT NULL,
  channel TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_r2_key TEXT NOT NULL,
  value_sha256 TEXT NOT NULL CHECK (length(value_sha256) = 64),
  value_bytes INTEGER NOT NULL CHECK (value_bytes >= 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, thread_id, checkpoint_ns, checkpoint_id, task_id, write_index),
  FOREIGN KEY (tenant_id, thread_id, checkpoint_ns, checkpoint_id)
    REFERENCES research_checkpoints(tenant_id, thread_id, checkpoint_ns, checkpoint_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_checkpoint_writes_order
  ON research_checkpoint_writes(tenant_id, thread_id, checkpoint_ns, checkpoint_id, task_path, task_id, write_index);

CREATE TABLE IF NOT EXISTS research_checkpoint_r2_gc (
  object_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  not_before INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_research_checkpoint_r2_gc_due
  ON research_checkpoint_r2_gc(not_before, queued_at);
