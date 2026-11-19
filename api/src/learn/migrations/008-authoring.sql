-- Programs (19 November 2026): editing a programme in place. A lesson's text, pictures, bullet points, narration, quick-check questions and
-- their translations are drafts (content_version, state 'draft', its body { slides, checks }) until a programme owner or an admin
-- publishes them. A new lesson order waits here the same way.
CREATE TABLE {S}.pending_order (
  version_id  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES {S}.programme_version(version_id),
  body        NVARCHAR(MAX)  NOT NULL,                      -- JSON [{ moduleId, lessons: [lessonId, ...] }] in the new order
  changed_by  UNIQUEIDENTIFIER NULL,
  changed_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
