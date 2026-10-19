CREATE TABLE IF NOT EXISTS billing_accounts (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  customer_id text UNIQUE,
  checkout_session_id text,
  checkout_attempt text,
  checkout_expires_at bigint
);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL,
  price_id text NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_account ON billing_subscriptions(account_id);
CREATE TABLE IF NOT EXISTS billing_usage (
  subscription_id text NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  x_requests integer NOT NULL DEFAULT 0 CHECK (x_requests >= 0),
  analyses integer NOT NULL DEFAULT 0 CHECK (analyses >= 0),
  cleanup integer NOT NULL DEFAULT 0 CHECK (cleanup >= 0),
  x_limit integer NOT NULL CHECK (x_limit > 0),
  analysis_limit integer NOT NULL CHECK (analysis_limit > 0),
  cleanup_limit integer NOT NULL CHECK (cleanup_limit > 0),
  PRIMARY KEY(subscription_id, period_start)
);
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
