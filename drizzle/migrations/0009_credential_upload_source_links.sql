CREATE OR REPLACE FUNCTION public.career_atom_sources_from_credential_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_context IS DISTINCT FROM 'credential_upload' OR NEW.atom_ids IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.career_atom_sources (user_id, atom_id, document_id, origin, approved_at, approved_by)
  SELECT NEW.user_id, a.id, NEW.id, 'credential_upload', coalesce(NEW.created_at, now()), NEW.user_id
  FROM unnest(NEW.atom_ids) AS x(atom_id)
  JOIN public.career_atoms a ON a.id = x.atom_id AND a.user_id = NEW.user_id
  ON CONFLICT (atom_id, document_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_sources_from_credential_upload() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER career_atom_sources_from_credential_upload
AFTER INSERT OR UPDATE OF atom_ids, source_context ON public.documents
FOR EACH ROW
WHEN (NEW.source_context = 'credential_upload')
EXECUTE FUNCTION public.career_atom_sources_from_credential_upload();

INSERT INTO public.career_atom_sources (user_id, atom_id, document_id, origin, approved_at, approved_by)
SELECT d.user_id, a.id, d.id, 'credential_upload', d.created_at, d.user_id
FROM public.documents d
CROSS JOIN LATERAL unnest(d.atom_ids) AS x(atom_id)
JOIN public.career_atoms a ON a.id = x.atom_id AND a.user_id = d.user_id
WHERE d.source_context = 'credential_upload'
ON CONFLICT (atom_id, document_id) DO NOTHING;