-- Site Tracker Phase 1 (unit columns) + Phase 2 (versioned checklist templates).
-- See docs/client-discovery/SITE_TRACKER_UPDATE_SECTION_PLAN.md §Phase 1, §Phase 2.
--
-- Hand-written rather than `migrate diff`-generated: the diff also wanted to drop the
-- defaults on users.roles / project_members.roles / custom_options.updatedAt, drop
-- leases_brokerId_idx and rename custom_options_category_idx. That is PRE-EXISTING drift
-- between the migrations folder and schema.prisma, none of it belongs to this change,
-- and dropping a default on users.roles inside a "site tracker" migration would be a
-- booby trap. Left alone deliberately.

-- ── Phase 1: Site Tracker columns on the unit ───────────────────────────────
ALTER TABLE "units"
  ADD COLUMN "blockerStatus"   TEXT,
  ADD COLUMN "blockerReason"   TEXT,
  ADD COLUMN "blockerSince"    TIMESTAMP(3),
  ADD COLUMN "sitePriority"    TEXT,
  ADD COLUMN "workType"        TEXT,
  ADD COLUMN "templateId"      TEXT,
  ADD COLUMN "templateVersion" INTEGER;

CREATE INDEX "units_blockerStatus_deletedAt_idx" ON "units"("blockerStatus", "deletedAt");
CREATE INDEX "units_workType_idx"                ON "units"("workType");
CREATE INDEX "units_templateId_idx"              ON "units"("templateId");

-- Multi-assign site ownership.
CREATE TABLE "unit_assignees" (
    "unitId"       TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "assignedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    CONSTRAINT "unit_assignees_pkey" PRIMARY KEY ("unitId","userId")
);
CREATE INDEX "unit_assignees_userId_idx" ON "unit_assignees"("userId");

ALTER TABLE "unit_assignees" ADD CONSTRAINT "unit_assignees_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "unit_assignees" ADD CONSTRAINT "unit_assignees_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "unit_assignees" ADD CONSTRAINT "unit_assignees_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Phase 2: versioned templates ────────────────────────────────────────────
CREATE TABLE "checklist_templates" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "workType"    TEXT NOT NULL,
    "version"     INTEGER NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checklist_templates_workType_version_key" ON "checklist_templates"("workType","version");
CREATE INDEX "checklist_templates_workType_isActive_idx"       ON "checklist_templates"("workType","isActive");

CREATE TABLE "checklist_template_steps" (
    "templateId"         TEXT NOT NULL,
    "stepNo"             INTEGER NOT NULL,
    "label"              TEXT NOT NULL,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "checklist_template_steps_pkey" PRIMARY KEY ("templateId","stepNo")
);

ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checklist_template_steps" ADD CONSTRAINT "checklist_template_steps_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "units" ADD CONSTRAINT "units_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-stage scheduling (the subitem Timeline column, used on 17 of 540 rows upstream).
ALTER TABLE "unit_construction_stages"
  ADD COLUMN "startsOn" TIMESTAMP(3),
  ADD COLUMN "endsOn"   TIMESTAMP(3);

-- ── Seed the two real templates ─────────────────────────────────────────────
-- Transcribed from the client's live monday board (audit §5.1 and §5.3) with the
-- misspellings it documents corrected: "03 -Plumbing" (missing space), "17- Store front
-- glass" and "18- garage doors" (missing space, lowercase).
--
-- The board's automations actually seed a DIFFERENT 14-step list (audit §5.5) to every new
-- unit — one that drops Contracts, Stamped Permits, Topout, PEC Meter Release and all three
-- separate Finals. That list is drift, not intent, and is deliberately NOT seeded here.
INSERT INTO "checklist_templates" ("id","name","workType","version","isActive","createdAt","updatedAt") VALUES
  ('tmpl_interior_finishout_v1','Interior Finish-out','INTERIOR_FINISHOUT',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('tmpl_shell_v1',            'Ground-up Shell',    'SHELL',             1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "checklist_template_steps" ("templateId","stepNo","label","requiresInspection") VALUES
  ('tmpl_interior_finishout_v1', 1,'Contracts',                 false),
  ('tmpl_interior_finishout_v1', 2,'Timeline Calendar',         false),
  ('tmpl_interior_finishout_v1', 3,'Stamped Permits Printouts', false),
  ('tmpl_interior_finishout_v1', 4,'Rough Plumbing',            false),
  ('tmpl_interior_finishout_v1', 5,'Rough Mechanical',          false),
  ('tmpl_interior_finishout_v1', 6,'Framing',                   false),
  ('tmpl_interior_finishout_v1', 7,'Fire Sprinkler',            false),
  ('tmpl_interior_finishout_v1', 8,'Rough Electrical',          false),
  ('tmpl_interior_finishout_v1', 9,'Topout',                    false),
  ('tmpl_interior_finishout_v1',10,'Insulation',                false),
  ('tmpl_interior_finishout_v1',11,'Drywall',                   false),
  ('tmpl_interior_finishout_v1',12,'Flooring',                  false),
  ('tmpl_interior_finishout_v1',13,'Paint, Tape & Float',       false),
  ('tmpl_interior_finishout_v1',14,'Ceiling',                   false),
  ('tmpl_interior_finishout_v1',15,'Sprinkler Turn Downs',      false),
  ('tmpl_interior_finishout_v1',16,'Permanent Power Inspection',true),
  ('tmpl_interior_finishout_v1',17,'PEC Meter Release',         false),
  ('tmpl_interior_finishout_v1',18,'Punch List',                false),
  ('tmpl_interior_finishout_v1',19,'Plumbing Final',            true),
  ('tmpl_interior_finishout_v1',20,'Electrical Final',          true),
  ('tmpl_interior_finishout_v1',21,'Mechanical Final',          true),
  ('tmpl_interior_finishout_v1',22,'Final Inspection',          true),

  ('tmpl_shell_v1', 1,'Soil Compaction',              false),
  ('tmpl_shell_v1', 2,'Rebar Laying',                 false),
  ('tmpl_shell_v1', 3,'Plumbing – Underground',       true),
  ('tmpl_shell_v1', 4,'Concrete Pour / Foundation',   true),
  ('tmpl_shell_v1', 5,'Columns',                      false),
  ('tmpl_shell_v1', 6,'Roof Decking',                 false),
  ('tmpl_shell_v1', 7,'Truss Installation',           false),
  ('tmpl_shell_v1', 8,'Shell Framing',                false),
  ('tmpl_shell_v1', 9,'Dense Glass / Glazing',        false),
  ('tmpl_shell_v1',10,'Fire Sprinklers',              false),
  ('tmpl_shell_v1',11,'Electrical – Rough-In',        false),
  ('tmpl_shell_v1',12,'Plumbing – Rough-In',          false),
  ('tmpl_shell_v1',13,'Masonry',                      false),
  ('tmpl_shell_v1',14,'Electrical Wire Pulling',      false),
  ('tmpl_shell_v1',15,'Heater Installation',          false),
  ('tmpl_shell_v1',16,'Final Building / Finish-Out',  true),
  ('tmpl_shell_v1',17,'Store Front Glass',            false),
  ('tmpl_shell_v1',18,'Garage Doors',                 false);

-- ── Backfill provenance onto existing checklists ────────────────────────────
-- A unit is stamped ONLY when its ordered stage list matches a seeded template exactly,
-- after normalising away the "NN - " prefix, case, and punctuation (so "17 - Store front
-- glass" matches "Store Front Glass", and the en-dash in "Plumbing – Underground" is not
-- load-bearing).
--
-- Everything else is left NULL on purpose. Measured on this database before writing:
-- 14 units carry 5 DIFFERENT step lists — an 18-step shell list, a 10-step interior list,
-- an 8-step list, a 5-step list, and two single-stage stubs. Only the shell list is a
-- template we actually have. Inventing templates to retro-fit the other four would be
-- fabricating provenance we do not have; they surface in the drift report instead.
WITH unit_sig AS (
  SELECT "unitId",
         string_agg(
           lower(regexp_replace(
             regexp_replace(label, '^[[:space:]]*[0-9]+[[:space:]]*[-.][[:space:]]*', ''),
             '[^a-zA-Z0-9]+', '', 'g')),
           '|' ORDER BY "sortOrder")
         AS sig
  FROM "unit_construction_stages"
  GROUP BY "unitId"
),
tmpl_sig AS (
  SELECT t."id", t."version",
         string_agg(lower(regexp_replace(st."label", '[^a-zA-Z0-9]+', '', 'g')),
                    '|' ORDER BY st."stepNo")
         AS sig
  FROM "checklist_templates" t
  JOIN "checklist_template_steps" st ON st."templateId" = t."id"
  GROUP BY t."id", t."version"
)
UPDATE "units" u
   SET "templateId" = ts."id", "templateVersion" = ts."version"
  FROM unit_sig us
  JOIN tmpl_sig ts ON ts.sig = us.sig
 WHERE u."id" = us."unitId";

-- Work type follows from the template that matched, where one did.
UPDATE "units" u
   SET "workType" = t."workType"
  FROM "checklist_templates" t
 WHERE u."templateId" = t."id" AND u."workType" IS NULL;
