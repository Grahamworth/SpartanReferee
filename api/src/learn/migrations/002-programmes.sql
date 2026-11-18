-- Programmes: the catalogue, each programme's versions (with their pass policy), the curriculum of each version (modules and lessons),
-- what each person is in each programme (programme roles) and enrolments (PRG-01..05, PER-03, PER-04, ASM-03).
-- A published version never changes: a fix is a new version (PRG-05). lineage_id ties a module or lesson to its copies in later versions.

CREATE TABLE {S}.programme (
  programme_id  NVARCHAR(32)   NOT NULL PRIMARY KEY,      -- ocr-referee, deka-judge: chosen when it's made, never changed
  title         NVARCHAR(120)  NOT NULL,
  category      NVARCHAR(40)   NOT NULL,                  -- referee, judge, other
  description   NVARCHAR(1000) NOT NULL DEFAULT '',
  owner_id      UNIQUEIDENTIFIER NULL REFERENCES {S}.person(person_id),
  status        NVARCHAR(16)   NOT NULL DEFAULT 'active', -- active, archived
  locales       NVARCHAR(200)  NOT NULL DEFAULT 'en',     -- the languages it's offered in, comma separated
  learner_role  NVARCHAR(60)   NOT NULL DEFAULT 'Learner',-- what a learner is in it: OCR Referee, DEKA Judge
  demo          BIT            NOT NULL DEFAULT 1,        -- demonstration content, not approved for real use (NFR-04, NFR-06)
  created_by    UNIQUEIDENTIFIER NULL,
  created_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE {S}.programme_version (
  version_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  programme_id      NVARCHAR(32)  NOT NULL REFERENCES {S}.programme(programme_id),
  edition           NVARCHAR(40)  NOT NULL,                 -- 2027
  state             NVARCHAR(16)  NOT NULL DEFAULT 'draft', -- draft, review, published, superseded, archived
  effective_date    DATE          NULL,
  -- the pass policy (ASM-03): each programme's own, placeholders until its owner sets them
  completion_rule   NVARCHAR(24)  NOT NULL DEFAULT 'lessons+assessment', -- lessons, assessment, lessons+assessment
  pass_mark         INT           NOT NULL DEFAULT 80,      -- percent
  max_attempts      INT           NULL,                     -- before waiting; null: unlimited
  retake_wait_hours INT           NOT NULL DEFAULT 0,
  validity_months   INT           NULL,                     -- how long a credential lasts; null: no expiry
  renewal_due_days  INT           NOT NULL DEFAULT 60,      -- "due" this many days before expiry
  qualification     NVARCHAR(120) NOT NULL,                 -- what completing it earns
  policy_note       NVARCHAR(400) NOT NULL DEFAULT '',
  created_by        UNIQUEIDENTIFIER NULL,
  created_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  submitted_by      UNIQUEIDENTIFIER NULL,
  submitted_at      DATETIME2     NULL,
  published_by      UNIQUEIDENTIFIER NULL,
  published_at      DATETIME2     NULL,
  CONSTRAINT programme_edition UNIQUE (programme_id, edition)
);

CREATE TABLE {S}.module (
  module_id      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lineage_id     UNIQUEIDENTIFIER NOT NULL,
  version_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.programme_version(version_id),
  code           NVARCHAR(40)   NULL,                    -- a short stable name, kept across versions: ocr-4
  seq            INT            NOT NULL,
  title          NVARCHAR(160)  NOT NULL,
  summary        NVARCHAR(1000) NOT NULL DEFAULT '',
  source_section NVARCHAR(80)   NULL,                    -- e.g. "2026 programme, section 4"
  required       BIT            NOT NULL DEFAULT 1
);
CREATE INDEX module_version ON {S}.module (version_id, seq);

CREATE TABLE {S}.lesson (
  lesson_id   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lineage_id  UNIQUEIDENTIFIER NOT NULL,
  code        NVARCHAR(40)   NULL,                       -- a short stable name, kept across versions: ocr-4-2
  module_id   UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.module(module_id),
  version_id  UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.programme_version(version_id),
  seq         INT            NOT NULL,
  title       NVARCHAR(160)  NOT NULL,
  summary     NVARCHAR(1000) NOT NULL DEFAULT '',
  minutes     INT            NOT NULL DEFAULT 5
);
CREATE INDEX lesson_module ON {S}.lesson (module_id, seq);

-- What a person is in a programme, apart from their global profile (PER-03): OCR Referee, grade, status
CREATE TABLE {S}.programme_role (
  person_id    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  programme_id NVARCHAR(32)  NOT NULL REFERENCES {S}.programme(programme_id),
  role         NVARCHAR(60)  NOT NULL,
  grade        NVARCHAR(40)  NULL,
  status       NVARCHAR(16)  NOT NULL DEFAULT 'active',
  since        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (person_id, programme_id)
);

CREATE TABLE {S}.enrolment (
  enrolment_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  programme_id NVARCHAR(32)  NOT NULL REFERENCES {S}.programme(programme_id),
  version_id   UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.programme_version(version_id),
  state        NVARCHAR(16)  NOT NULL DEFAULT 'active',  -- active, completed, withdrawn
  enrolled_by  UNIQUEIDENTIFIER NULL,
  enrolled_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  completed_at DATETIME2     NULL,
  CONSTRAINT enrolment_once UNIQUE (person_id, version_id)
);
CREATE INDEX enrolment_person ON {S}.enrolment (person_id);
