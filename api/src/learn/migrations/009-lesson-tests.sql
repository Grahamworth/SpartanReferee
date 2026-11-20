-- Lesson tests (20 November 2026): the questions at the end of a lesson ("Finish and test") can be taken again, and the lesson redone,
-- until every answer is right. Every attempt is kept, so an assessor sees how each person is doing: how many tries, how many right
-- first time (Assessing). answers is JSON [{ key, choice, right }].
CREATE TABLE {S}.lesson_test (
  test_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id      UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  lesson_id      UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.lesson(lesson_id),
  programme_id   NVARCHAR(32)   NOT NULL,
  version_id     UNIQUEIDENTIFIER NOT NULL,
  attempt_no     INT            NOT NULL,
  right_count    INT            NOT NULL,
  question_count INT            NOT NULL,
  passed         BIT            NOT NULL,                   -- every answer right
  answers        NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  at             DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX lesson_test_person ON {S}.lesson_test (person_id, lesson_id);
CREATE INDEX lesson_test_programme ON {S}.lesson_test (programme_id, at);

-- the quick checks answered before this, from the audit log (each kept its score, not its answers)
INSERT INTO {S}.lesson_test (test_id, person_id, lesson_id, programme_id, version_id, attempt_no, right_count, question_count, passed, answers, at)
SELECT NEWID(), x.person_id, l.lesson_id, v.programme_id, l.version_id,
       ROW_NUMBER() OVER (PARTITION BY x.person_id, l.lesson_id ORDER BY x.at), x.r, x.n, CASE WHEN x.r = x.n THEN 1 ELSE 0 END, '[]', x.at
FROM (SELECT COALESCE(a.acting_as, a.actor_id) AS person_id, TRY_CONVERT(UNIQUEIDENTIFIER, a.entity_id) AS lesson_id,
             TRY_CONVERT(INT, JSON_VALUE(a.summary, '$.right')) AS r, TRY_CONVERT(INT, JSON_VALUE(a.summary, '$.of')) AS n, a.at
      FROM {S}.audit_event a WHERE a.action = 'lesson.check' AND a.entity_type = 'lesson') x
JOIN {S}.lesson l ON l.lesson_id = x.lesson_id
JOIN {S}.programme_version v ON v.version_id = l.version_id
JOIN {S}.person p ON p.person_id = x.person_id
WHERE x.r IS NOT NULL AND x.n IS NOT NULL AND x.n > 0;
