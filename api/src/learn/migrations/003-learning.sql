-- Learning (step 3): each lesson's content, per language and version, with its approval; the media settings that turn it into
-- narration; where each person is in a lesson; and completions, each tied to the exact content version and language
-- (LRN-02, LRN-04, LRN-05, LRN-07, NFR-05, NFR-06). Narration audio lives in blob storage, not here.

-- One version of a lesson's content in one language. English is the master; a translation points at the English it came from.
-- body is JSON: { slides: [{ heading, points: [..], narration, rules: [rule ids], figure, note }] }; narration is also the captions.
CREATE TABLE {S}.content_version (
  content_id      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  lesson_id       UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.lesson(lesson_id),
  locale          NVARCHAR(8)    NOT NULL,
  version_no      INT            NOT NULL,
  state           NVARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft, review, published, superseded
  translation_of  UNIQUEIDENTIFIER NULL,                     -- the English content version it translates
  body            NVARCHAR(MAX)  NOT NULL,
  source_hash     CHAR(64)       NOT NULL,                   -- sha256 of body: what exactly was approved and learned
  sources         NVARCHAR(1000) NOT NULL DEFAULT '',         -- where the content comes from (CNT-01)
  translated_by   NVARCHAR(80)   NULL,                       -- e.g. "Claude (machine), not reviewed"
  author_id       UNIQUEIDENTIFIER NULL,
  created_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  submitted_by    UNIQUEIDENTIFIER NULL,
  submitted_at    DATETIME2      NULL,
  approved_by     UNIQUEIDENTIFIER NULL,
  approved_at     DATETIME2      NULL,
  CONSTRAINT content_once UNIQUE (lesson_id, locale, version_no)
);
CREATE INDEX content_lesson ON {S}.content_version (lesson_id, locale, state);

-- Which media provider turns content into something to play, for everything ('default') or one programme: swapping it is
-- configuration only (LRN-04, AT-11). voices is JSON: { "en": "en-GB-RyanNeural", "es": "es-ES-ElviraNeural" }
CREATE TABLE {S}.media_config (
  scope       NVARCHAR(40)   NOT NULL PRIMARY KEY,
  provider    NVARCHAR(32)   NOT NULL,
  voices      NVARCHAR(1000) NOT NULL DEFAULT '{}',
  updated_by  UNIQUEIDENTIFIER NULL,
  updated_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Narration made for one slide of one content version, with one voice: kept so it's made once (the audio is in blob storage)
CREATE TABLE {S}.media_asset (
  asset_id    UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  content_id  UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.content_version(content_id),
  provider    NVARCHAR(32)   NOT NULL,
  voice       NVARCHAR(64)   NOT NULL,
  slide       INT            NOT NULL,
  blob        NVARCHAR(300)  NOT NULL,
  chars       INT            NOT NULL,
  created_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT media_once UNIQUE (content_id, provider, voice, slide)
);

-- Where someone is in a lesson: the bookmark (LRN-05)
CREATE TABLE {S}.lesson_progress (
  person_id   UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  lesson_id   UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.lesson(lesson_id),
  content_id  UNIQUEIDENTIFIER NOT NULL,
  locale      NVARCHAR(8)    NOT NULL,
  slide       INT            NOT NULL DEFAULT 0,
  updated_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (person_id, lesson_id)
);

-- A lesson completed: who, which programme version, which content version and language, when (LRN-07, NFR-05).
-- preview: done in a translation nobody has reviewed yet, which doesn't count towards a credential (NFR-06).
CREATE TABLE {S}.completion (
  completion_id   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id       UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  enrolment_id    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.enrolment(enrolment_id),
  programme_id    NVARCHAR(32)   NOT NULL,
  version_id      UNIQUEIDENTIFIER NOT NULL,
  lesson_id       UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.lesson(lesson_id),
  content_id      UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.content_version(content_id),
  content_version INT            NOT NULL,
  source_hash     CHAR(64)       NOT NULL,
  locale          NVARCHAR(8)    NOT NULL,
  preview         BIT            NOT NULL DEFAULT 0,
  completed_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT completion_once UNIQUE (person_id, lesson_id, locale)
);
CREATE INDEX completion_person ON {S}.completion (person_id, programme_id);
