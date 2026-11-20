CREATE OR REPLACE FUNCTION public.career_material_source_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.source_context IN ('career_material_paste', 'career_material_email', 'career_material_attachment') THEN
    DELETE FROM public.atom_enrichment_proposals p
    WHERE p.user_id = OLD.user_id
      AND p.source_type = 'career_material'
      AND p.source_record_id = OLD.id;
    UPDATE public.career_material_attachments a
    SET source_deleted_at = now()
    WHERE a.document_id = OLD.id AND a.user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.career_material_source_delete_cleanup() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.career_material_storage_gc_candidates(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, storage_path text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT a.id, a.storage_path
  FROM public.career_material_attachments a
  WHERE a.storage_path IS NOT NULL
    AND (a.source_deleted_at IS NOT NULL OR (a.status = 'extracted' AND a.document_id IS NULL))
  ORDER BY COALESCE(a.source_deleted_at, a.updated_at)
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.career_material_storage_gc_done(p_ids uuid[])
RETURNS integer
LANGUAGE sql
SET search_path TO 'public'
AS $$
  WITH d AS (
    DELETE FROM public.career_material_attachments a
    WHERE a.id = ANY(p_ids)
      AND (a.source_deleted_at IS NOT NULL OR (a.status = 'extracted' AND a.document_id IS NULL))
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

REVOKE ALL ON FUNCTION public.career_material_storage_gc_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_storage_gc_done(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_material_storage_gc_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_storage_gc_done(uuid[]) TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.career_material_attachments FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.career_material_worker_state FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.career_material_intakes FROM authenticated, anon;
REVOKE ALL ON public.career_material_attachments FROM anon;
REVOKE ALL ON public.career_material_worker_state FROM anon;
REVOKE ALL ON public.career_material_intakes FROM anon;