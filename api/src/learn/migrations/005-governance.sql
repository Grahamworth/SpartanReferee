-- Governance (step 5): source documents, rule references with versions, what links to each rule, and review items raised when a
-- rule changes or the sources disagree (RUL-01..04, CNT-01, AT-07). Nothing published changes when a rule does: people review it.

-- A source document: the 2026 rulebook, the Officiating SOP, the online programme slides. approval says how far it can be relied on:
-- baseline (the 2026 edition, not approved for 2027), approved, draft.
CREATE TABLE {S}.rule_document (
  doc_id         NVARCHAR(40)   NOT NULL PRIMARY KEY,
  programme_id   NVARCHAR(32)   NOT NULL REFERENCES {S}.programme(programme_id),
  title          NVARCHAR(200)  NOT NULL,
  edition        NVARCHAR(40)   NOT NULL,
  approval       NVARCHAR(16)   NOT NULL DEFAULT 'baseline',
  note           NVARCHAR(600)  NOT NULL DEFAULT '',
  effective_date DATE           NULL,
  created_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

-- One version of one rule reference. rule_id stays the same across versions (OCR-2026-4.2.13); a change is a new version, a draft until
-- approved, which supersedes the one before (RUL-01).
CREATE TABLE {S}.rule_ref (
  rule_key       UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  rule_id        NVARCHAR(60)   NOT NULL,
  version_no     INT            NOT NULL,
  programme_id   NVARCHAR(32)   NOT NULL REFERENCES {S}.programme(programme_id),
  doc_id         NVARCHAR(40)   NOT NULL REFERENCES {S}.rule_document(doc_id),
  section        NVARCHAR(20)   NOT NULL,
  title          NVARCHAR(200)  NOT NULL,
  excerpt        NVARCHAR(MAX)  NOT NULL,
  citation       NVARCHAR(300)  NOT NULL DEFAULT '',
  effective_date DATE           NULL,
  state          NVARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft, approved, superseded
  change_note    NVARCHAR(600)  NOT NULL DEFAULT '',
  superseded_by  UNIQUEIDENTIFIER NULL,
  created_by     UNIQUEIDENTIFIER NULL,
  created_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  approved_by    UNIQUEIDENTIFIER NULL,
  approved_at    DATETIME2      NULL,
  CONSTRAINT rule_version_once UNIQUE (rule_id, version_no)
);

-- What teaches or tests a rule: a lesson's content version, a question, a handbook section; with the rule version it was written
-- against (RUL-02). Kept up to date as content and questions are saved.
CREATE TABLE {S}.rule_link (
  rule_id        NVARCHAR(60)   NOT NULL,
  rule_version   INT            NOT NULL,
  target_type    NVARCHAR(16)   NOT NULL,   -- content, question
  target_id      UNIQUEIDENTIFIER NOT NULL,
  lesson_id      UNIQUEIDENTIFIER NULL,
  version_id     UNIQUEIDENTIFIER NULL,     -- the programme version it belongs to
  linked_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (rule_id, target_type, target_id)
);

-- Something a person has to look at: a rule changed (what it affects is listed), or the sources disagree (RUL-03, RUL-04).
-- affected is JSON: [{ type, id, title, programmeVersion, edition, state }]
CREATE TABLE {S}.review_item (
  review_id      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  programme_id   NVARCHAR(32)   NOT NULL REFERENCES {S}.programme(programme_id),
  kind           NVARCHAR(16)   NOT NULL,   -- rule_change, dispute
  rule_id        NVARCHAR(60)   NULL,
  rule_key       UNIQUEIDENTIFIER NULL,     -- the draft version that raised it
  title          NVARCHAR(200)  NOT NULL,
  detail         NVARCHAR(MAX)  NOT NULL DEFAULT '',
  affected       NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  state          NVARCHAR(16)   NOT NULL DEFAULT 'open', -- open, resolved, dismissed
  created_by     UNIQUEIDENTIFIER NULL,
  created_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  resolved_by    UNIQUEIDENTIFIER NULL,
  resolved_at    DATETIME2      NULL,
  resolution     NVARCHAR(1000) NULL
);
CREATE INDEX review_programme ON {S}.review_item (programme_id, state);
