-- The final assessment (20 November 2026): at the end of every programme, 10 questions drawn from a large pool so no question repeats
-- across a person's attempts; 80% to pass; 3 attempts, then the whole programme is done again. Each is a setting per programme
-- (on or off, the pass mark, how many questions, how many attempts), changed in its Programme settings.
ALTER TABLE {S}.programme ADD
  assessment_on        BIT NOT NULL CONSTRAINT programme_assessment_on DEFAULT 1,
  assessment_pass_mark INT NOT NULL CONSTRAINT programme_assessment_pass DEFAULT 80,
  assessment_questions INT NOT NULL CONSTRAINT programme_assessment_questions DEFAULT 10,
  assessment_attempts  INT NOT NULL CONSTRAINT programme_assessment_attempts DEFAULT 3;

-- the questions an attempt drew from the pool, in order (JSON [question_id]); null for attempts before this, which had every question
ALTER TABLE {S}.attempt ADD question_ids NVARCHAR(MAX) NULL;

-- which part of the programme a question is about (its module), so a draw covers the whole programme
ALTER TABLE {S}.question ADD topic NVARCHAR(160) NULL;

-- doing the programme again: when it started over, and how many times. The lessons done before are kept in completion_archive
ALTER TABLE {S}.enrolment ADD restarted_at DATETIME2 NULL, restarts INT NOT NULL CONSTRAINT enrolment_restarts DEFAULT 0;

CREATE TABLE {S}.completion_archive (
  completion_id   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id       UNIQUEIDENTIFIER NOT NULL,
  enrolment_id    UNIQUEIDENTIFIER NOT NULL,
  programme_id    NVARCHAR(32)   NOT NULL,
  version_id      UNIQUEIDENTIFIER NOT NULL,
  lesson_id       UNIQUEIDENTIFIER NOT NULL,
  content_id      UNIQUEIDENTIFIER NOT NULL,
  content_version INT            NOT NULL,
  locale          NVARCHAR(8)    NOT NULL,
  preview         BIT            NOT NULL,
  completed_at    DATETIME2      NOT NULL,
  restart_no      INT            NOT NULL,
  archived_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX completion_archive_person ON {S}.completion_archive (person_id, programme_id);
