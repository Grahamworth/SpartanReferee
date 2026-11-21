-- The Assistant (21 November 2026) and the full rulebook in Rules.
-- A rule reference keeps its short excerpt (what lessons and questions cite) and now its section's full text (body), from Spartan's
-- 2026 Rules of Competition and Officiating SOP, loaded by scripts/learn-rulebook.mjs from the copies on the admin's PC.
ALTER TABLE {S}.rule_ref ADD body NVARCHAR(MAX) NULL;
ALTER TABLE {S}.rule_ref ADD chapter NVARCHAR(200) NOT NULL CONSTRAINT rule_ref_chapter DEFAULT '';

-- Who may use the Assistant and what it may spend: one row. mode: off, all (every referee) or chosen (the people in assistant_access).
-- monthly_cap_gbp stops it for everyone once that month's spend (assistant_usage) reaches it.
CREATE TABLE {S}.assistant_setting (
  id              INT            NOT NULL PRIMARY KEY CONSTRAINT assistant_setting_one CHECK (id = 1),
  mode            NVARCHAR(10)   NOT NULL DEFAULT 'chosen',
  monthly_cap_gbp DECIMAL(9, 2)  NOT NULL DEFAULT 50,
  updated_by      UNIQUEIDENTIFIER NULL,
  updated_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
INSERT INTO {S}.assistant_setting (id) VALUES (1);

-- The people allowed when mode is chosen.
CREATE TABLE {S}.assistant_access (
  person_id  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES {S}.person(person_id),
  added_by   UNIQUEIDENTIFIER NULL,
  added_at   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

-- What each question cost (no question or answer text is kept): the model's tokens and the speech used, priced in pounds.
CREATE TABLE {S}.assistant_usage (
  usage_id       UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  person_id      UNIQUEIDENTIFIER NULL,
  at             DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  kind           NVARCHAR(12)   NOT NULL,   -- ask, listen (speech to text), speak (text to speech)
  input_tokens   INT            NOT NULL DEFAULT 0,
  cached_tokens  INT            NOT NULL DEFAULT 0,
  output_tokens  INT            NOT NULL DEFAULT 0,
  units          INT            NOT NULL DEFAULT 0,   -- speech: seconds heard or characters spoken
  cost_gbp       DECIMAL(12, 6) NOT NULL DEFAULT 0
);
CREATE INDEX assistant_usage_at ON {S}.assistant_usage (at);
