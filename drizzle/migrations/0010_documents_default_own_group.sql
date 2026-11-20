CREATE OR REPLACE FUNCTION public.documents_default_own_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.document_group_id IS NULL
     OR NEW.document_group_id = NEW.id
     OR NOT EXISTS (
       SELECT 1 FROM public.documents g
       WHERE g.id = NEW.document_group_id AND g.user_id = NEW.user_id
     ) THEN
    NEW.document_group_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.documents_default_own_group() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER documents_default_own_group
BEFORE INSERT ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.documents_default_own_group();