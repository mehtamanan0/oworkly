-- Every Figma screenshot showing a worker (04 Worker Master's "Joined" column,
-- 28 Skill Profile's "Date of Joining" field) and the seeded SAP HR data
-- source's own mapped_fields list ("Date of Joining") assume this is a real,
-- synced worker attribute — but no column for it exists anywhere in the
-- schema. Rather than fabricate a display-only value or silently omit the
-- field the reference design calls for, add the column for real.
ALTER TABLE worker ADD COLUMN date_of_joining DATE;
