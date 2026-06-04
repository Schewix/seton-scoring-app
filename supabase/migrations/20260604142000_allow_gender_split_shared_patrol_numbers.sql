-- Shared category lookups like M-1 intentionally target both MH-1 and MD-1.
-- Uniqueness is already enforced by (event_id, patrol_code), so this stricter
-- index incorrectly blocks valid gender-specific patrol pairs.
drop index if exists public.patrols_event_category_number_unique_idx;
