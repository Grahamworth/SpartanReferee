-- Keeping sharp (19 November 2026): quick checks at the end of a lesson, refreshers that bring them back when they're due (spaced
-- practice, and at once when a rule they cite changes), a weekly learning streak and badges. Practice only: none of it counts towards a
-- credential, which only the assessment gives.

-- A lesson's quick-check questions. check_key stays the same across programme versions (the lesson's code and a number), so what
-- someone has practised carries over. body is JSON: { prompt, options: [..], answer: <index>, feedback, rules: [rule ids] }
CREATE TABLE {S}.lesson_check (
  check_id    UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lesson_id   UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.lesson(lesson_id),
  check_key   NVARCHAR(60)   NOT NULL,
  seq         INT            NOT NULL,
  body        NVARCHAR(MAX)  NOT NULL,
  created_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT check_once UNIQUE (lesson_id, check_key)
);

-- Where each person is with each question: its box (0 to 5: each right answer moves it up, a wrong one back to 0) and when it's due
CREATE TABLE {S}.check_state (
  person_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  check_key     NVARCHAR(60)   NOT NULL,
  programme_id  NVARCHAR(32)   NOT NULL,
  box           INT            NOT NULL DEFAULT 0,
  answered      INT            NOT NULL DEFAULT 0,
  right_count   INT            NOT NULL DEFAULT 0,
  first_right   BIT            NOT NULL,
  last_right    BIT            NOT NULL,
  last_at       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  due_at        DATETIME2      NOT NULL,
  PRIMARY KEY (person_id, check_key)
);
CREATE INDEX check_due ON {S}.check_state (person_id, programme_id, due_at);

-- The days someone learned something (a lesson, a check, a refresher): the streak counts weeks with at least one
CREATE TABLE {S}.learning_day (
  person_id  UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  day        DATE           NOT NULL,
  PRIMARY KEY (person_id, day)
);

-- Badges, once earned, are kept (with when): ids like "ocr-referee:lessons" or "streak-4"
CREATE TABLE {S}.badge (
  person_id     UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  badge_id      NVARCHAR(80)   NOT NULL,
  programme_id  NVARCHAR(32)   NULL,
  earned_at     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (person_id, badge_id)
);
