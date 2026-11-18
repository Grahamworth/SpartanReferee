-- Assessment (step 4): each programme version's assessments and question bank, every attempt with its answers, score and the
-- exact question versions it used, assessors' decisions, and credentials (ASM-01..05, AT-04, AT-08, AT-10).

CREATE TABLE {S}.assessment (
  assessment_id  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lineage_id     UNIQUEIDENTIFIER NOT NULL,
  version_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.programme_version(version_id),
  title          NVARCHAR(160)  NOT NULL,
  description    NVARCHAR(1000) NOT NULL DEFAULT '',
  created_by     UNIQUEIDENTIFIER NULL,
  created_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

-- One question. A published version's questions never change; a new programme version copies them (same lineage).
-- options is JSON: [{ id, text, correct }]; clip (video items) is JSON: { anim: 'burpee', variant: 'noJump' }
CREATE TABLE {S}.question (
  question_id    UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lineage_id     UNIQUEIDENTIFIER NOT NULL,
  assessment_id  UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.assessment(assessment_id),
  version_no     INT            NOT NULL DEFAULT 1,
  seq            INT            NOT NULL,
  type           NVARCHAR(16)   NOT NULL,              -- single, multiple, video
  prompt         NVARCHAR(1000) NOT NULL,
  options        NVARCHAR(MAX)  NOT NULL,
  feedback       NVARCHAR(1000) NOT NULL DEFAULT '',
  clip           NVARCHAR(400)  NULL,
  rules          NVARCHAR(400)  NOT NULL DEFAULT '',   -- rule reference ids, comma separated (RUL-02)
  review_note    NVARCHAR(600)  NOT NULL DEFAULT '',   -- set when a linked rule is disputed or changing (RUL-04)
  needs_assessor BIT            NOT NULL DEFAULT 0,    -- an assessor confirms the answer, with the learner's reasons
  created_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX question_assessment ON {S}.question (assessment_id, seq);

-- One go at an assessment: the questions as they were, the answers, the score and the result (ASM-02). Learners never change it.
-- answers is JSON: [{ questionId, lineageId, versionNo, rules, type, chosen: [option ids], reason, correct (true/false/null), decided }]
CREATE TABLE {S}.attempt (
  attempt_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id         UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  enrolment_id      UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.enrolment(enrolment_id),
  assessment_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.assessment(assessment_id),
  version_id        UNIQUEIDENTIFIER NOT NULL,
  programme_id      NVARCHAR(32)   NOT NULL,
  started_at        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  submitted_at      DATETIME2      NULL,
  answers           NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  score             INT            NULL,
  max_score         INT            NULL,
  pass_mark         INT            NOT NULL,
  result            NVARCHAR(16)   NOT NULL DEFAULT 'open',   -- open, pending (an assessor's turn), pass, fail
  assessor_id       UNIQUEIDENTIFIER NULL,
  assessor_note     NVARCHAR(1000) NULL,
  decided_at        DATETIME2      NULL
);
CREATE INDEX attempt_person ON {S}.attempt (person_id, assessment_id);

-- The number in each demonstration credential's public id (DEMO-OCR-000001)
CREATE SEQUENCE {S}.credential_seq AS INT START WITH 1 INCREMENT BY 1;

-- A credential: earned on one programme version, with its own expiry. "due" and "expired" follow from the dates; the stored status
-- is active, suspended, superseded or revoked. Every one here is a DEMONSTRATION (ASM-04, ASM-05, NFR-04).
CREATE TABLE {S}.credential (
  credential_id  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  public_id      NVARCHAR(32)   NOT NULL UNIQUE,
  person_id      UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  programme_id   NVARCHAR(32)   NOT NULL REFERENCES {S}.programme(programme_id),
  version_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.programme_version(version_id),
  enrolment_id   UNIQUEIDENTIFIER NULL,
  attempt_id     UNIQUEIDENTIFIER NULL,
  qualification  NVARCHAR(120)  NOT NULL,
  issued_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at     DATETIME2      NULL,
  status         NVARCHAR(16)   NOT NULL DEFAULT 'active',
  status_reason  NVARCHAR(400)  NULL,
  demonstration  BIT            NOT NULL DEFAULT 1,
  issued_by      UNIQUEIDENTIFIER NULL,
  updated_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX credential_person ON {S}.credential (person_id, programme_id);
