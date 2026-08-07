CREATE TABLE IF NOT EXISTS skin_releases (
  skin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  min_app_version TEXT NOT NULL DEFAULT '1.0.0',
  manifest_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  package_key TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  package_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'preview', 'published', 'retired')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skin_id, version)
);

CREATE INDEX IF NOT EXISTS skin_releases_catalog_idx ON skin_releases(status, published_at DESC);
