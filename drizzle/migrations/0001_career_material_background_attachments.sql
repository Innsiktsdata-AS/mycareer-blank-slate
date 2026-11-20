-- Karrieremateriale: bakgrunnsbehandling, vedlegg (PDF/DOCX) og sletting.

-- 1. Originalen fra vedlegg er like låst som innlimt/e-post-original (tekst, kilde og fil).
CREATE OR REPLACE FUNCTION public.career_material_original_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.source_context IN ('career_material_paste', 'career_material_email', 'career_material_attachment')
     AND (NEW.content_text IS DISTINCT FROM OLD.content_text
          OR NEW.source_context IS DISTINCT FROM OLD.source_context
          OR NEW.file_path IS DISTINCT FROM OLD.file_path) THEN
    RAISE EXCEPTION 'Originalen til karrieremateriale kan ikke endres.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.career_material_original_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS career_material_original_guard ON public.documents;
CREATE TRIGGER career_material_original_guard
  BEFORE UPDATE OF content_text, source_context, file_path ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.career_material_original_guard();

-- 2. Vedleggskø.
CREATE TABLE public.career_material_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  inbound_delivery_id uuid NOT NULL REFERENCES public.inbound_email_deliveries(id) ON DELETE CASCADE,
  parent_intake_id uuid REFERENCES public.career_material_intakes(id) ON DELETE SET NULL,
  provider_email_id text NOT NULL CHECK (length(provider_email_id) BETWEEN 1 AND 128),
  provider_attachment_id text CHECK (provider_attachment_id IS NULL OR length(provider_attachment_id) BETWEEN 1 AND 128),
  position smallint NOT NULL CHECK (position >= 0 AND position < 100),
  filename text CHECK (filename IS NULL OR length(filename) <= 200),
  content_type text CHECK (content_type IS NULL OR length(content_type) <= 100),
  declared_size_bytes bigint CHECK (declared_size_bytes IS NULL OR declared_size_bytes >= 0),
  kind text CHECK (kind IS NULL OR kind IN ('pdf', 'docx')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'processing', 'extracted', 'duplicate', 'unsupported', 'too_large',
    'skipped_limit', 'no_text', 'unreadable', 'encrypted', 'failed')),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 80),
  retryable boolean,
  attempt_count integer NOT NULL DEFAULT 0,
  claim_token text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  storage_path text CHECK (storage_path IS NULL OR length(storage_path) <= 300),
  file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  page_count integer CHECK (page_count IS NULL OR page_count >= 0),
  extracted_chars integer CHECK (extracted_chars IS NULL OR extracted_chars >= 0),
  intake_id uuid REFERENCES public.career_material_intakes(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_material_attachments_delivery_position_key UNIQUE (inbound_delivery_id, position),
  CONSTRAINT career_material_attachments_lease_check CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR status <> 'processing'
  )
);

GRANT SELECT ON public.career_material_attachments TO authenticated;
GRANT ALL ON public.career_material_attachments TO service_role;

ALTER TABLE public.career_material_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eier leser egne karrieremateriale-vedlegg"
  ON public.career_material_attachments FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX career_material_attachments_user_created_idx
  ON public.career_material_attachments (user_id, created_at DESC);
CREATE INDEX career_material_attachments_due_idx
  ON public.career_material_attachments (next_attempt_at)
  WHERE status IN ('queued', 'processing', 'failed');
CREATE INDEX career_material_attachments_document_idx
  ON public.career_material_attachments (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX career_material_attachments_gc_idx
  ON public.career_material_attachments (source_deleted_at)
  WHERE source_deleted_at IS NOT NULL AND storage_path IS NOT NULL;

CREATE TRIGGER set_career_material_attachments_updated_at
  BEFORE UPDATE ON public.career_material_attachments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Arbeiderens tilstand: én lås (single-flight) og varig pause-årsak.
CREATE TABLE public.career_material_worker_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lease_owner text,
  lease_expires_at timestamptz,
  paused_reason text CHECK (paused_reason IS NULL OR paused_reason IN ('configuration', 'provider_blocked')),
  paused_at timestamptz,
  pause_error_code text CHECK (pause_error_code IS NULL OR length(pause_error_code) <= 80),
  last_run_at timestamptz,
  last_run_summary jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.career_material_worker_state TO authenticated;
GRANT ALL ON public.career_material_worker_state TO service_role;

ALTER TABLE public.career_material_worker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administratorer leser arbeiderstatus for karrieremateriale"
  ON public.career_material_worker_state FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.career_material_worker_acquire(p_owner text, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(acquired boolean, paused_reason text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_row public.career_material_worker_state%ROWTYPE;
BEGIN
  INSERT INTO public.career_material_worker_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_row FROM public.career_material_worker_state s WHERE s.id = 1 FOR UPDATE;
  IF v_row.lease_owner IS NOT NULL AND v_row.lease_expires_at > now() THEN
    RETURN QUERY SELECT false, v_row.paused_reason;
    RETURN;
  END IF;
  UPDATE public.career_material_worker_state s
  SET lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30)),
      updated_at = now()
  WHERE s.id = 1;
  RETURN QUERY SELECT true, v_row.paused_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.career_material_worker_release(
  p_owner text,
  p_summary jsonb,
  p_pause_reason text DEFAULT NULL,
  p_pause_error_code text DEFAULT NULL,
  p_clear_pause boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_owner text;
BEGIN
  SELECT lease_owner INTO v_owner FROM public.career_material_worker_state WHERE id = 1 FOR UPDATE;
  IF v_owner IS DISTINCT FROM p_owner THEN
    RETURN 'lease_lost';
  END IF;
  UPDATE public.career_material_worker_state
  SET lease_owner = NULL,
      lease_expires_at = NULL,
      last_run_at = now(),
      last_run_summary = p_summary,
      paused_reason = CASE
        WHEN p_pause_reason IS NOT NULL THEN p_pause_reason
        WHEN p_clear_pause THEN NULL
        ELSE paused_reason END,
      paused_at = CASE
        WHEN p_pause_reason IS NOT NULL THEN COALESCE(paused_at, now())
        WHEN p_clear_pause THEN NULL
        ELSE paused_at END,
      pause_error_code = CASE
        WHEN p_pause_reason IS NOT NULL THEN left(p_pause_error_code, 80)
        WHEN p_clear_pause THEN NULL
        ELSE pause_error_code END,
      updated_at = now()
  WHERE id = 1;
  RETURN 'ok';
END;
$$;

-- 4. Inntak som er klare for automatisk behandling (kø, utløpt lås, eller
--    feil som kan prøves igjen etter eksponentiell ventetid).
CREATE OR REPLACE FUNCTION public.career_material_due_intakes(p_limit integer DEFAULT 3)
RETURNS TABLE(intake_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT i.id, i.user_id
  FROM public.career_material_intakes i
  JOIN public.documents d ON d.id = i.document_id AND d.deleted_at IS NULL
  WHERE i.attempt_count < 6
    AND (
      i.status = 'queued'
      OR (i.status = 'processing' AND i.lease_expires_at < now())
      OR (i.status = 'failed' AND i.retryable IS TRUE
          AND COALESCE(i.last_attempt_at, i.created_at)
              + make_interval(secs => LEAST(3600, 60 * power(2, GREATEST(i.attempt_count - 1, 0))::int)) <= now())
    )
  ORDER BY i.created_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 20);
$$;

-- 5. Registrering av vedlegg fra én e-post (idempotent per e-post og posisjon).
CREATE OR REPLACE FUNCTION public.career_material_register_attachments(
  p_user_id uuid,
  p_inbound_delivery_id uuid,
  p_parent_intake_id uuid,
  p_provider_email_id text,
  p_items jsonb
)
RETURNS TABLE(registered integer, queued integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_registered integer := 0;
  v_queued integer := 0;
  v_status text;
  v_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inbound_email_deliveries d
    WHERE d.id = p_inbound_delivery_id AND d.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'delivery not owned';
  END IF;
  IF p_parent_intake_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.career_material_intakes i
    WHERE i.id = p_parent_intake_id AND i.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'intake not owned';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 25 THEN
    RAISE EXCEPTION 'invalid items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_status := COALESCE(v_item->>'status', 'queued');
    INSERT INTO public.career_material_attachments (
      user_id, inbound_delivery_id, parent_intake_id, provider_email_id, provider_attachment_id,
      position, filename, content_type, declared_size_bytes, kind, status, error_code, retryable
    ) VALUES (
      p_user_id, p_inbound_delivery_id, p_parent_intake_id, p_provider_email_id,
      NULLIF(v_item->>'provider_attachment_id', ''),
      (v_item->>'position')::smallint,
      left(v_item->>'filename', 200),
      left(v_item->>'content_type', 100),
      NULLIF(v_item->>'size_bytes', '')::bigint,
      NULLIF(v_item->>'kind', ''),
      v_status,
      left(NULLIF(v_item->>'error_code', ''), 80),
      CASE WHEN v_status = 'queued' THEN NULL ELSE false END
    )
    ON CONFLICT (inbound_delivery_id, position) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_registered := v_registered + v_rows;
    IF v_rows > 0 AND v_status = 'queued' THEN
      v_queued := v_queued + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_registered, v_queued;
END;
$$;

-- 6. Claim av neste vedlegg (SKIP LOCKED, eksponentiell ventetid ved feil).
CREATE OR REPLACE FUNCTION public.career_material_attachment_claim_next(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(
  id uuid, user_id uuid, inbound_delivery_id uuid, parent_intake_id uuid,
  provider_email_id text, provider_attachment_id text, filename text, content_type text,
  declared_size_bytes bigint, kind text, claim_token text, attempt_count integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_row public.career_material_attachments%ROWTYPE;
  v_token text;
BEGIN
  SELECT a.* INTO v_row
  FROM public.career_material_attachments a
  WHERE a.attempt_count < 6
    AND (
      (a.status = 'queued' AND a.next_attempt_at <= now())
      OR (a.status = 'processing' AND a.lease_expires_at < now())
      OR (a.status = 'failed' AND a.retryable IS TRUE AND a.next_attempt_at <= now())
    )
  ORDER BY a.next_attempt_at, a.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.career_material_attachments a
  SET status = 'processing',
      claim_token = v_token,
      lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30)),
      attempt_count = a.attempt_count + 1,
      last_attempt_at = now(),
      error_code = NULL,
      retryable = NULL
  WHERE a.id = v_row.id;

  RETURN QUERY SELECT v_row.id, v_row.user_id, v_row.inbound_delivery_id, v_row.parent_intake_id,
    v_row.provider_email_id, v_row.provider_attachment_id, v_row.filename, v_row.content_type,
    v_row.declared_size_bytes, v_row.kind, v_token, v_row.attempt_count + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.career_material_attachment_finish(
  p_id uuid,
  p_claim_token text,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_retryable boolean DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_file_sha256 text DEFAULT NULL,
  p_size_bytes bigint DEFAULT NULL,
  p_page_count integer DEFAULT NULL,
  p_extracted_chars integer DEFAULT NULL,
  p_intake_id uuid DEFAULT NULL,
  p_document_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.career_material_attachments%ROWTYPE;
BEGIN
  IF p_status NOT IN ('extracted', 'duplicate', 'unsupported', 'too_large', 'no_text', 'unreadable', 'encrypted', 'failed') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT * INTO v_row FROM public.career_material_attachments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_row.status <> 'processing' OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'lease_lost';
  END IF;
  IF p_intake_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.career_material_intakes i WHERE i.id = p_intake_id AND i.user_id = v_row.user_id
  ) THEN
    RAISE EXCEPTION 'intake not owned';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = p_document_id AND d.user_id = v_row.user_id
  ) THEN
    RAISE EXCEPTION 'document not owned';
  END IF;

  UPDATE public.career_material_attachments
  SET status = p_status,
      error_code = left(p_error_code, 80),
      retryable = CASE WHEN p_status = 'failed' THEN COALESCE(p_retryable, false) ELSE NULL END,
      next_attempt_at = CASE
        WHEN p_status = 'failed' AND COALESCE(p_retryable, false)
          THEN now() + make_interval(secs => LEAST(3600, 60 * power(2, GREATEST(v_row.attempt_count - 1, 0))::int))
        ELSE next_attempt_at END,
      claim_token = NULL,
      lease_expires_at = NULL,
      storage_path = COALESCE(p_storage_path, storage_path),
      file_sha256 = COALESCE(p_file_sha256, file_sha256),
      size_bytes = COALESCE(p_size_bytes, size_bytes),
      page_count = COALESCE(p_page_count, page_count),
      extracted_chars = COALESCE(p_extracted_chars, extracted_chars),
      intake_id = COALESCE(p_intake_id, intake_id),
      document_id = COALESCE(p_document_id, document_id)
  WHERE id = p_id;
  RETURN 'ok';
END;
$$;

-- 7. Opprettelse av original: valgfri kilde (vedlegg) og fil.
DROP FUNCTION IF EXISTS public.career_material_create(uuid, text, text, text, text, text, uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.career_material_create(
  p_user_id uuid,
  p_channel text,
  p_title text,
  p_text text,
  p_content_sha256 text,
  p_declared_type text DEFAULT NULL,
  p_inbound_delivery_id uuid DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_truncated boolean DEFAULT false,
  p_source_context text DEFAULT NULL,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_file_size_bytes bigint DEFAULT NULL
)
RETURNS TABLE(status text, intake_id uuid, document_id uuid)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_intake public.career_material_intakes%ROWTYPE;
  v_doc uuid;
  v_context text;
BEGIN
  IF p_channel NOT IN ('paste', 'email') THEN
    RAISE EXCEPTION 'invalid channel';
  END IF;
  IF p_text IS NULL OR length(btrim(p_text)) = 0 THEN
    RAISE EXCEPTION 'empty text';
  END IF;
  v_context := COALESCE(p_source_context,
    CASE p_channel WHEN 'paste' THEN 'career_material_paste' ELSE 'career_material_email' END);
  IF v_context NOT IN ('career_material_paste', 'career_material_email', 'career_material_attachment') THEN
    RAISE EXCEPTION 'invalid source context';
  END IF;
  IF v_context = 'career_material_attachment' AND (p_channel <> 'email' OR p_file_path IS NULL) THEN
    RAISE EXCEPTION 'attachment requires email channel and file';
  END IF;
  IF p_file_path IS NOT NULL AND split_part(p_file_path, '/', 1) <> p_user_id::text THEN
    RAISE EXCEPTION 'file path not owned';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('career_material|' || p_user_id::text || '|' || p_content_sha256, 0));

  -- Bare e-postteksten (ikke vedlegg) er bundet én-til-én til leveransen.
  IF p_inbound_delivery_id IS NOT NULL AND v_context = 'career_material_email' THEN
    SELECT * INTO v_intake FROM public.career_material_intakes i
    WHERE i.inbound_delivery_id = p_inbound_delivery_id AND i.user_id = p_user_id;
    IF FOUND THEN
      RETURN QUERY SELECT 'duplicate'::text, v_intake.id, v_intake.document_id;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_intake FROM public.career_material_intakes i
  WHERE i.user_id = p_user_id AND i.content_sha256 = p_content_sha256;
  IF FOUND THEN
    UPDATE public.documents d
    SET deleted_at = NULL, documentation_status = 'active'
    WHERE d.id = v_intake.document_id AND d.user_id = p_user_id AND d.deleted_at IS NOT NULL;
    RETURN QUERY SELECT 'duplicate'::text, v_intake.id, v_intake.document_id;
    RETURN;
  END IF;

  v_doc := gen_random_uuid();
  INSERT INTO public.documents (
    id, document_group_id, user_id, title, document_type, content_text, mime_type,
    file_path, file_name, file_size_bytes,
    source_context, documentation_category, documentation_subcategory,
    documentation_status, visibility, confidentiality_level
  ) VALUES (
    v_doc, v_doc, p_user_id, left(p_title, 200), 'annet', p_text,
    COALESCE(left(p_mime_type, 100), 'text/plain'),
    p_file_path, left(p_file_name, 200), p_file_size_bytes,
    v_context, 'Karrieremateriale', p_declared_type, 'active', 'private', 'confidential'
  );

  INSERT INTO public.career_material_intakes (
    user_id, document_id, channel, inbound_delivery_id, content_sha256,
    declared_type, attachments, truncated
  ) VALUES (
    p_user_id, v_doc, p_channel,
    CASE WHEN v_context = 'career_material_email' THEN p_inbound_delivery_id ELSE NULL END,
    p_content_sha256, p_declared_type, COALESCE(p_attachments, '[]'::jsonb), COALESCE(p_truncated, false)
  )
  RETURNING * INTO v_intake;

  RETURN QUERY SELECT 'created'::text, v_intake.id, v_doc;
END;
$$;

-- 8. Sletting av kilde: avledede forslag fjernes uansett slettevei, og
--    vedleggsfiler merkes for opprydding i lagringen.
CREATE OR REPLACE FUNCTION public.career_material_source_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER career_material_source_delete_cleanup
  BEFORE DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.career_material_source_delete_cleanup();

-- Sletter én kilde (dokument + inntak + forslag via trigger) og returnerer
-- filstiene som skal fjernes fra lagringen. Vedleggsradene som peker hit slettes.
CREATE OR REPLACE FUNCTION public.career_material_delete(p_intake_id uuid, p_user_id uuid)
RETURNS TABLE(status text, storage_paths text[])
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_doc uuid;
  v_paths text[];
BEGIN
  SELECT i.document_id INTO v_doc FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, ARRAY[]::text[];
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(a.storage_path) FILTER (WHERE a.storage_path IS NOT NULL), ARRAY[]::text[])
  INTO v_paths
  FROM public.career_material_attachments a
  WHERE a.user_id = p_user_id AND (a.document_id = v_doc OR a.intake_id = p_intake_id);

  DELETE FROM public.career_material_attachments a
  WHERE a.user_id = p_user_id AND (a.document_id = v_doc OR a.intake_id = p_intake_id);

  DELETE FROM public.documents d WHERE d.id = v_doc AND d.user_id = p_user_id;

  RETURN QUERY SELECT 'deleted'::text, v_paths;
END;
$$;

-- Sletter én vedleggsrad uten tilhørende kilde (f.eks. ulesbar PDF).
CREATE OR REPLACE FUNCTION public.career_material_attachment_delete(p_id uuid, p_user_id uuid)
RETURNS TABLE(status text, storage_path text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_row public.career_material_attachments%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.career_material_attachments a
  WHERE a.id = p_id AND a.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text;
    RETURN;
  END IF;
  IF v_row.status = 'processing' AND v_row.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::text;
    RETURN;
  END IF;
  IF v_row.document_id IS NOT NULL AND v_row.source_deleted_at IS NULL THEN
    RETURN QUERY SELECT 'has_source'::text, NULL::text;
    RETURN;
  END IF;
  DELETE FROM public.career_material_attachments a WHERE a.id = p_id;
  RETURN QUERY SELECT 'deleted'::text, v_row.storage_path;
END;
$$;

-- Opprydding av filer der kilden er slettet utenom appens sletteflyt.
CREATE OR REPLACE FUNCTION public.career_material_storage_gc_candidates(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, storage_path text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT a.id, a.storage_path
  FROM public.career_material_attachments a
  WHERE a.source_deleted_at IS NOT NULL AND a.storage_path IS NOT NULL
  ORDER BY a.source_deleted_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.career_material_storage_gc_done(p_ids uuid[])
RETURNS integer
LANGUAGE sql
SET search_path TO 'public'
AS $$
  WITH d AS (
    DELETE FROM public.career_material_attachments a
    WHERE a.id = ANY(p_ids) AND a.source_deleted_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

-- 9. Kun tjenesterollen kan kalle de nye funksjonene.
REVOKE ALL ON FUNCTION public.career_material_worker_acquire(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_worker_release(text, jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_due_intakes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_register_attachments(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_attachment_claim_next(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_attachment_finish(uuid, text, text, text, boolean, text, text, bigint, integer, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_create(uuid, text, text, text, text, text, uuid, jsonb, boolean, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_attachment_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_storage_gc_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_storage_gc_done(uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.career_material_worker_acquire(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_worker_release(text, jsonb, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_due_intakes(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_register_attachments(uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_attachment_claim_next(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_attachment_finish(uuid, text, text, text, boolean, text, text, bigint, integer, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_create(uuid, text, text, text, text, text, uuid, jsonb, boolean, text, text, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_delete(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_attachment_delete(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_storage_gc_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_storage_gc_done(uuid[]) TO service_role;

-- 10. Lagring: hver bruker kan bare lese sine egne vedleggsfiler. Skriving og
--     sletting skjer bare fra serveren.
CREATE POLICY "Eier leser egne karrieremateriale-filer"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'career-material' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);