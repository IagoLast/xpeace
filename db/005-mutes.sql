-- Keep historical blocks intact. Only new work requests a mute.
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS mute_requested boolean NOT NULL DEFAULT false;
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS reply_text text;
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_status_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_status_check CHECK (status IN ('pending','allowed','review','ignored','sending','replied','blocked','muted','error'));
