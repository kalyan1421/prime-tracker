-- Construction stage names become a managed CustomOption category.
--
-- Before this, a stage name was free text and the picker's options were DERIVED at read
-- time from labels already recorded in the same project. On a project nobody had typed
-- stages into, the picker had nothing to offer and collapsed to a bare text box; "Track a
-- unit" dead-ended for the same reason. Where it had been used, free text had produced
-- four overlapping numbering schemes ("01 - Soil Compaction" / "01 - Permits" /
-- "01 - Contracts" / "01 - Grading") plus two junk rows, so nothing grouped in a rollup.
--
-- CustomOption already backs project_status, project_phase, unit_type and thirteen more,
-- and the very same Add-a-stage modal already reads construction_stage_status and
-- construction_inspection_status from it. Stage name was the one field never wired up.

-- ---------------------------------------------------------------------------
-- 1. The grouping key on the stage row.
-- ---------------------------------------------------------------------------
-- `label` stays and stays populated: the rollup, the Site Tracker grid, the daily-log
-- joins and the exports all read it, and mirroring it costs one UPDATE on rename versus
-- rewriting every one of those queries.
ALTER TABLE "unit_construction_stages" ADD COLUMN "stageValue" TEXT;
CREATE INDEX "unit_construction_stages_stageValue_idx" ON "unit_construction_stages"("stageValue");

-- ---------------------------------------------------------------------------
-- 2. Seed the canonical list, ACTIVE.
-- ---------------------------------------------------------------------------
-- Seeded as ordinary rows, not SYSTEM_DEFAULTS: system options cannot be renamed,
-- reordered or removed, and these are the client's vocabulary to change.
--
-- The leading "NN - " is dropped deliberately. sortOrder carries the sequence now, and
-- the hand-typed numbers are exactly what let four different lists collide on "01".
INSERT INTO "custom_options" ("id","category","value","label","color","sortOrder","isSystem","isActive","createdById")
SELECT gen_random_uuid()::text, 'construction_stage', v.value, v.label, NULL, v.ord, false, true, 'system'
FROM (VALUES
  ('SOIL_COMPACTION',           'Soil Compaction',            0),
  ('REBAR_LAYING',              'Rebar Laying',               1),
  ('SLAB_POUR',                 'Slab Pour',                  2),
  ('CONCRETE_POUR_FOUNDATION',  'Concrete Pour / Foundation', 3),
  ('COLUMNS',                   'Columns',                    4),
  ('ROOF_DECKING',              'Roof Decking',               5),
  ('TRUSS_INSTALLATION',        'Truss Installation',         6),
  ('SHELL_FRAMING',             'Shell Framing',              7),
  ('DENSE_GLASS_GLAZING',       'Dense Glass / Glazing',      8),
  ('FIRE_SPRINKLERS',           'Fire Sprinklers',            9),
  ('ELECTRICAL_ROUGH_IN',       'Electrical – Rough-In',     10),
  ('PLUMBING_ROUGH_IN',         'Plumbing – Rough-In',       11),
  ('MASONRY',                   'Masonry',                   12),
  ('ELECTRICAL_WIRE_PULLING',   'Electrical Wire Pulling',   13),
  ('HEATER_INSTALLATION',       'Heater Installation',       14),
  ('FINAL_BUILDING_FINISH_OUT', 'Final Building / Finish-Out',15),
  ('STORE_FRONT_GLASS',         'Store Front Glass',         16),
  ('GARAGE_DOORS',              'Garage Doors',              17)
) AS v(value,label,ord)
ON CONFLICT ("category","value") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Link existing stage rows to the canonical list, and adopt its wording.
-- ---------------------------------------------------------------------------
-- Matched on the label with any "NN - " prefix stripped, case-insensitively, so
-- "17 - Store front glass" lands on "Store Front Glass".
UPDATE "unit_construction_stages" s
SET "stageValue" = o."value",
    "label"      = o."label"
FROM "custom_options" o
WHERE o."category" = 'construction_stage'
  AND o."isActive" = true
  AND lower(btrim(regexp_replace(s."label", '^[0-9]+[[:space:]]*[-–—.)][[:space:]]*', ''))) = lower(o."label");

-- ---------------------------------------------------------------------------
-- 4. Everything else that is actually in use, seeded INACTIVE.
-- ---------------------------------------------------------------------------
-- The rival sequences and the typos ("gjmmg", "srtage1"). Kept verbatim, numbers and all,
-- so history still resolves and so two rows that only differ by their number ("07 - Paint"
-- and "08 - Paint") do not silently merge into one. Inactive means the picker never offers
-- them again; Admin lists them as ad-hoc stages that can be promoted or left alone.
INSERT INTO "custom_options" ("id","category","value","label","color","sortOrder","isSystem","isActive","createdById")
SELECT gen_random_uuid()::text, 'construction_stage',
       btrim(upper(regexp_replace(t."label", '[^a-zA-Z0-9]+', '_', 'g')), '_'),
       t."label", NULL, 1000, false, false, 'system'
FROM (SELECT DISTINCT "label" FROM "unit_construction_stages" WHERE "stageValue" IS NULL) t
WHERE btrim(upper(regexp_replace(t."label", '[^a-zA-Z0-9]+', '_', 'g')), '_') <> ''
ON CONFLICT ("category","value") DO NOTHING;

UPDATE "unit_construction_stages" s
SET "stageValue" = o."value"
FROM "custom_options" o
WHERE s."stageValue" IS NULL
  AND o."category" = 'construction_stage'
  AND o."isActive" = false
  AND o."label" = s."label";

-- ---------------------------------------------------------------------------
-- 5. The same treatment for per-building templates.
-- ---------------------------------------------------------------------------
-- Templates are no longer a picker source, but their items are still stage names and
-- should read the same as everywhere else.
UPDATE "construction_stage_template_items" t
SET "label" = o."label"
FROM "custom_options" o
WHERE o."category" = 'construction_stage'
  AND o."isActive" = true
  AND lower(btrim(regexp_replace(t."label", '^[0-9]+[[:space:]]*[-–—.)][[:space:]]*', ''))) = lower(o."label");
