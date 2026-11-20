-- Lessons need a pass (20 November 2026): by default a lesson with a test counts as done only once a try has every answer right. A
-- programme's owner or an admin can turn that off in its Programme settings, so taking the test is enough (as before).
ALTER TABLE {S}.programme ADD lessons_need_pass BIT NOT NULL CONSTRAINT programme_lessons_need_pass DEFAULT 1;
