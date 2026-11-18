-- The Learning & Competence platform (/learn): people, regions, roles and the audit log.
-- {S} is the schema: "learn" live, "learn_test" for the integration tests. Applied once, in order, by migrate.js.

CREATE TABLE {S}.region (
  region_id   NVARCHAR(32)  NOT NULL PRIMARY KEY,
  name        NVARCHAR(80)  NOT NULL,
  countries   NVARCHAR(400) NOT NULL DEFAULT ''   -- ISO 3166 codes, comma separated
);

-- the number in each person's public id (SR-000123)
CREATE SEQUENCE {S}.person_seq AS INT START WITH 1 INCREMENT BY 1;

-- One person across every programme (PER-01..06). Email is never the key.
CREATE TABLE {S}.person (
  person_id      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  public_id      NVARCHAR(16)  NOT NULL UNIQUE,        -- SR-000123
  legal_name     NVARCHAR(120) NOT NULL,
  preferred_name NVARCHAR(80)  NULL,
  email          NVARCHAR(254) NOT NULL,
  country        CHAR(2)       NULL,
  region_id      NVARCHAR(32)  NULL REFERENCES {S}.region(region_id),
  locale         NVARCHAR(8)   NOT NULL DEFAULT 'en',
  status         NVARCHAR(16)  NOT NULL DEFAULT 'active', -- active, suspended, merged
  synthetic      BIT           NOT NULL DEFAULT 1,        -- demo people; a real one is only an admin's own record
  merged_into    UNIQUEIDENTIFIER NULL,
  created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX person_email ON {S}.person (email);
CREATE INDEX person_region ON {S}.person (region_id);

-- How someone signs in, tied to their person (a Microsoft account today)
CREATE TABLE {S}.person_login (
  provider   NVARCHAR(16)  NOT NULL,
  subject    NVARCHAR(128) NOT NULL,
  person_id  UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (provider, subject)
);

-- What someone may administer, and where: global, one programme, or one region (NFR-01, ADM-02)
CREATE TABLE {S}.role_grant (
  grant_id     UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_id    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  role         NVARCHAR(32) NOT NULL,   -- global_admin, programme_owner, regional_coordinator, content_editor, assessor, technical_admin
  programme_id NVARCHAR(32) NULL,
  region_id    NVARCHAR(32) NULL REFERENCES {S}.region(region_id),
  granted_by   UNIQUEIDENTIFIER NULL,
  granted_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX role_grant_person ON {S}.role_grant (person_id);

-- Possible duplicates, flagged for a person with the right to merge, never merged silently (PER-05)
CREATE TABLE {S}.duplicate_flag (
  flag_id     UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  person_a    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  person_b    UNIQUEIDENTIFIER NOT NULL REFERENCES {S}.person(person_id),
  reason      NVARCHAR(200) NOT NULL,
  state       NVARCHAR(16)  NOT NULL DEFAULT 'open', -- open, merged, not_duplicate
  created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  decided_by  UNIQUEIDENTIFIER NULL,
  decided_at  DATETIME2 NULL
);

-- Every privileged change, append only (ADM-03). actor = who signed in; acting_as = the demo person they were viewing as.
CREATE TABLE {S}.audit_event (
  audit_id       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  actor_id       UNIQUEIDENTIFIER NULL,
  acting_as      UNIQUEIDENTIFIER NULL,
  action         NVARCHAR(64)  NOT NULL,
  entity_type    NVARCHAR(32)  NOT NULL,
  entity_id      NVARCHAR(64)  NOT NULL,
  summary        NVARCHAR(MAX) NOT NULL,   -- JSON: what changed, before and after
  programme_id   NVARCHAR(32)  NULL,
  region_id      NVARCHAR(32)  NULL,
  correlation_id NVARCHAR(40)  NULL,
  at             DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX audit_entity ON {S}.audit_event (entity_type, entity_id);
