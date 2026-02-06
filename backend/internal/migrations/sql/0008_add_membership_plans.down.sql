-- Reverse membership plans migration

ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_version_id;
DROP TABLE IF EXISTS plan_versions;
DROP TABLE IF EXISTS membership_plans;
