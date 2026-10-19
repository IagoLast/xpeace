CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  username text NOT NULL,
  name text NOT NULL,
  tokens text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  session_version integer NOT NULL DEFAULT 1,
  settings jsonb NOT NULL DEFAULT '{"enabled":false,"mode":"review","threshold":0.9,"block":true,"allowlist":[]}',
  since_id text,
  mention_cursor text,
  mention_high_water text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync timestamptz,
  last_work_at timestamptz,
  last_error text,
  retry_at timestamptz
);
CREATE TABLE IF NOT EXISTS interactions (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id text NOT NULL,
  author_id text NOT NULL,
  username text NOT NULL,
  name text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  direct_reply boolean NOT NULL DEFAULT false,
  decision jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','allowed','review','ignored','sending','replied','blocked','error')),
  reply_id text,
  attempted_at timestamptz,
  block_requested boolean NOT NULL DEFAULT false,
  error text,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS interactions_recent ON interactions(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS opt_outs (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  PRIMARY KEY (account_id, author_id)
);
CREATE TABLE IF NOT EXISTS cleanup_jobs (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kinds text[] NOT NULL,
  before_date text NOT NULL,
  status text NOT NULL DEFAULT 'scanning' CHECK (status IN ('scanning','ready','running','completed','cancelled','error')),
  phase text NOT NULL,
  cursor text,
  scanned integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cleanup_one_active ON cleanup_jobs(account_id) WHERE status IN ('scanning','ready','running');
CREATE TABLE IF NOT EXISTS cleanup_items (
  job_id uuid NOT NULL REFERENCES cleanup_jobs(id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tweets','replies','likes')),
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error')),
  error text,
  PRIMARY KEY (job_id, id, kind)
);
CREATE TABLE IF NOT EXISTS locks (
  id text PRIMARY KEY,
  owner text NOT NULL,
  expires_at timestamptz NOT NULL
);
