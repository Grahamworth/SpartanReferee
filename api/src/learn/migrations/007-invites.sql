-- Invites (19 November 2026): everyone joins by an admin's invite, emailed with a link. The admin says what type of user they are (their
-- roles) and which programmes they must do, with a date to complete them by; the person registers from the link with their name,
-- region and language, signing in with Google, Microsoft or a code emailed to the invited address.

CREATE TABLE {S}.invite (
  invite_id     UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  email         NVARCHAR(254)  NOT NULL,
  token_hash    CHAR(64)       NOT NULL,                   -- sha256 of the link's token: the token itself is only in the email
  legal_name    NVARCHAR(120)  NULL,                       -- when the admin knows it; the person confirms it
  region_id     NVARCHAR(32)   NULL,                       -- likewise
  grants        NVARCHAR(2000) NOT NULL DEFAULT '[]',      -- JSON [{ role, programmeId, regionId }]: their user type
  programmes    NVARCHAR(2000) NOT NULL DEFAULT '[]',      -- JSON [{ id, due }]: enrolled when they register
  message       NVARCHAR(1000) NOT NULL DEFAULT '',
  state         NVARCHAR(16)   NOT NULL DEFAULT 'pending', -- pending, accepted, revoked
  invited_by    UNIQUEIDENTIFIER NULL,
  created_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at    DATETIME2      NOT NULL,
  sent_count    INT            NOT NULL DEFAULT 0,
  last_sent_at  DATETIME2      NULL,
  send_error    NVARCHAR(300)  NULL,
  accepted_at   DATETIME2      NULL,
  person_id     UNIQUEIDENTIFIER NULL
);
CREATE UNIQUE INDEX invite_token ON {S}.invite (token_hash);
CREATE INDEX invite_email ON {S}.invite (email, state);

-- a programme's complete-by date for one person (from their invite, or a reminder), and when they were last reminded
ALTER TABLE {S}.enrolment ADD due_date DATE NULL;
ALTER TABLE {S}.enrolment ADD reminded_at DATETIME2 NULL;
