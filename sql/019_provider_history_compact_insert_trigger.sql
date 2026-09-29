-- Normalizes future provider_field_history inserts without changing existing
-- history. Apply only after confirming the column names against the live schema.
-- This migration contains no data cleanup and does not alter append-only rules.

CREATE OR REPLACE FUNCTION public.compact_provider_field_history_values()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.field_name IS DISTINCT FROM 'record_created'
     AND NEW.old_value IS NOT NULL
     AND jsonb_typeof(NEW.old_value) = 'object'
     AND NEW.old_value ? NEW.field_name THEN
    NEW.old_value := jsonb_build_object(NEW.field_name, NEW.old_value -> NEW.field_name);
  END IF;

  IF NEW.field_name IS DISTINCT FROM 'record_created'
     AND NEW.new_value IS NOT NULL
     AND jsonb_typeof(NEW.new_value) = 'object'
     AND NEW.new_value ? NEW.field_name THEN
    NEW.new_value := jsonb_build_object(NEW.field_name, NEW.new_value -> NEW.field_name);
  END IF;

  IF NEW.field_name = 'record_created' THEN
    NEW.old_value := NULL;
    NEW.new_value := jsonb_build_object('present', true);
  END IF;

  RETURN NEW;
END;
$$;

-- Install this trigger once, after checking that no trigger with this name
-- already exists. It is intentionally not made destructive/idempotent here.
CREATE TRIGGER compact_provider_field_history_values_before_insert
BEFORE INSERT ON public.provider_field_history
FOR EACH ROW
EXECUTE FUNCTION public.compact_provider_field_history_values();
