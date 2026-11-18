-- ATLAS account identities used for authenticated, private services.
-- The Google subject is the stable provider identifier; email is mutable.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS atlas_users (
  google_sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atlas_users_email ON atlas_users(email);
