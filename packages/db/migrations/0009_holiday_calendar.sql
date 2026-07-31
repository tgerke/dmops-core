-- 0009_holiday_calendar: a study's holiday calendar assignment (ADR-0016).
-- One nullable column, nothing else: the calendar itself is a governed repo
-- file (calendars/*.yaml), read at compute time like the taxonomy — not
-- synced into a table. NULL means the weekday-only counting the v1.1
-- elapsed-time definitions shipped with; an id with no matching file fails
-- the refresh (fail-closed, ADR-0005) rather than silently computing
-- weekday-only numbers under a holiday-aware definition.
ALTER TABLE "study" ADD COLUMN "calendar" text;
