-- One credit budgets $0.005 of X activity at the published October 2026 rates.
-- Reserve the maximum page cost first, then release unused credits on success.
ALTER TABLE billing_usage ADD COLUMN IF NOT EXISTS x_credits integer NOT NULL DEFAULT 0 CHECK (x_credits >= 0);
ALTER TABLE billing_usage ADD COLUMN IF NOT EXISTS x_credit_limit integer NOT NULL DEFAULT 200 CHECK (x_credit_limit > 0);
