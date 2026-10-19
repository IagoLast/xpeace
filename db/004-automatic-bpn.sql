ALTER TABLE accounts ALTER COLUMN settings SET DEFAULT '{"enabled":false,"threshold":0.9,"allowlist":[]}';
UPDATE accounts SET settings=settings-'mode'-'block' WHERE settings ? 'mode' OR settings ? 'block';
