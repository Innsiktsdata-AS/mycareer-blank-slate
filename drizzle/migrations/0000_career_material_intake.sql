-- 1. Dedicated, unambiguous career-material intake mode for inbound aliases.
ALTER TABLE public.email_job_sources DROP CONSTRAINT IF EXISTS email_job_sources_intake_mode_check;
ALTER TABLE public.email_job_sources
  ADD CONSTRAINT email_job_sources_intake_mode_check
  CHECK (intake_mode = ANY (ARRAY['mailbox'::text, 'forwarding'::text, 'career_material'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS email_job_sources_one_career_material_per_user_idx
  ON public.email_job_sources (user_id) WHERE intake_mode = 'career_material';

-- 2. Owner-bound FK target on documents.
CREATE UNIQUE INDEX IF NOT EXISTS documents_id_user_id_key ON public.documents (id, user_id);

-- 3. Proposal → produced atom, and idempotency for career-material proposals.
ALTER TABLE public.atom_enrichment_proposals
  ADD COLUMN IF NOT EXISTS applied_atom_id uuid REFERENCES public.career_atoms(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS atom_enrichment_proposals_career_material_idem_unique
  ON public.atom_enrichment_proposals (user_id, source_record_id, source_hash)
  WHERE source_type = 'career_material'
    AND status = ANY (ARRAY['pending_review'::atom_enrichment_proposal_status,
                            'approved'::atom_enrichment_proposal_status,
                            'rejected'::atom_enrichment_proposal_status,
                            'needs_more_context'::atom_enrichment_proposal_status]);

-- 4. Intake state.
CREATE TABLE public.career_material_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('paste', 'email')),
  inbound_delivery_id uuid UNIQUE REFERENCES public.inbound_email_deliveries(id) ON DELETE SET NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  declared_type text CHECK (declared_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon')),
  ai_type text CHECK (ai_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','ukjent')),
  ai_confidence numeric CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_rationale text CHECK (ai_rationale IS NULL OR length(ai_rationale) <= 500),
  user_type text CHECK (user_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon')),
  effective_type text CHECK (effective_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','needs_type','completed','failed')),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 80),
  retryable boolean,
  attempt_count integer NOT NULL DEFAULT 0,
  claim_token text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  analysis_signature text,
  batch_id uuid REFERENCES public.atom_enrichment_batches(id) ON DELETE SET NULL,
  proposals_created integer NOT NULL DEFAULT 0,
  proposals_reused integer NOT NULL DEFAULT 0,
  items_dropped integer NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_material_intakes_document_owner_fkey
    FOREIGN KEY (document_id, user_id) REFERENCES public.documents(id, user_id) ON DELETE CASCADE,
  CONSTRAINT career_material_intakes_document_unique UNIQUE (document_id),
  CONSTRAINT career_material_intakes_content_unique UNIQUE (user_id, content_sha256),
  CONSTRAINT career_material_intakes_lease_check CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR status <> 'processing'
  )
);

GRANT SELECT ON public.career_material_intakes TO authenticated;
GRANT ALL ON public.career_material_intakes TO service_role;

ALTER TABLE public.career_material_intakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eier leser egne karrieremateriale-inntak"
  ON public.career_material_intakes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX career_material_intakes_user_created_idx
  ON public.career_material_intakes (user_id, created_at DESC);

CREATE TRIGGER set_career_material_intakes_updated_at
  BEFORE UPDATE ON public.career_material_intakes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. The stored original is immutable so every proposal stays traceable.
CREATE OR REPLACE FUNCTION public.career_material_original_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.source_context IN ('career_material_paste', 'career_material_email')
     AND (NEW.content_text IS DISTINCT FROM OLD.content_text
          OR NEW.source_context IS DISTINCT FROM OLD.source_context) THEN
    RAISE EXCEPTION 'Originalen til karrieremateriale kan ikke endres.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.career_material_original_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER career_material_original_guard
  BEFORE UPDATE OF content_text, source_context ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.career_material_original_guard();

-- 6. Atomic create: original document + intake in one transaction, idempotent.
CREATE OR REPLACE FUNCTION public.career_material_create(
  p_user_id uuid,
  p_channel text,
  p_title text,
  p_text text,
  p_content_sha256 text,
  p_declared_type text DEFAULT NULL,
  p_inbound_delivery_id uuid DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_truncated boolean DEFAULT false
)
RETURNS TABLE(status text, intake_id uuid, document_id uuid)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_intake public.career_material_intakes%ROWTYPE;
  v_doc uuid;
BEGIN
  IF p_channel NOT IN ('paste', 'email') THEN
    RAISE EXCEPTION 'invalid channel';
  END IF;
  IF p_text IS NULL OR length(btrim(p_text)) = 0 THEN
    RAISE EXCEPTION 'empty text';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('career_material|' || p_user_id::text || '|' || p_content_sha256, 0));

  IF p_inbound_delivery_id IS NOT NULL THEN
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
    source_context, documentation_category, documentation_subcategory,
    documentation_status, visibility, confidentiality_level
  ) VALUES (
    v_doc, v_doc, p_user_id, left(p_title, 200), 'annet', p_text, 'text/plain',
    CASE p_channel WHEN 'paste' THEN 'career_material_paste' ELSE 'career_material_email' END,
    'Karrieremateriale', p_declared_type, 'active', 'private', 'confidential'
  );

  INSERT INTO public.career_material_intakes (
    user_id, document_id, channel, inbound_delivery_id, content_sha256,
    declared_type, attachments, truncated
  ) VALUES (
    p_user_id, v_doc, p_channel, p_inbound_delivery_id, p_content_sha256,
    p_declared_type, COALESCE(p_attachments, '[]'::jsonb), COALESCE(p_truncated, false)
  )
  RETURNING * INTO v_intake;

  RETURN QUERY SELECT 'created'::text, v_intake.id, v_doc;
END;
$$;

-- 7. Processing lease.
CREATE OR REPLACE FUNCTION public.career_material_claim(
  p_intake_id uuid,
  p_user_id uuid,
  p_force boolean DEFAULT false,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(status text, claim_token text, attempt_number integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_row public.career_material_intakes%ROWTYPE;
  v_token text;
  v_lease integer := GREATEST(COALESCE(p_lease_seconds, 180), 30);
BEGIN
  SELECT * INTO v_row FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, 0;
    RETURN;
  END IF;

  IF v_row.status = 'processing' AND v_row.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::text, v_row.attempt_count;
    RETURN;
  END IF;

  IF NOT COALESCE(p_force, false) AND v_row.status IN ('completed', 'needs_type') THEN
    RETURN QUERY SELECT 'already_done'::text, NULL::text, v_row.attempt_count;
    RETURN;
  END IF;

  IF NOT COALESCE(p_force, false) AND v_row.status = 'failed' AND v_row.retryable IS FALSE THEN
    RETURN QUERY SELECT 'already_done'::text, NULL::text, v_row.attempt_count;
    RETURN;
  END IF;

  IF v_row.attempt_count >= 12 THEN
    RETURN QUERY SELECT 'attempt_limit'::text, NULL::text, v_row.attempt_count;
    RETURN;
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.career_material_intakes i
  SET status = 'processing',
      claim_token = v_token,
      lease_expires_at = now() + make_interval(secs => v_lease),
      attempt_count = i.attempt_count + 1,
      last_attempt_at = now(),
      error_code = NULL,
      retryable = NULL
  WHERE i.id = v_row.id;

  RETURN QUERY SELECT 'claimed'::text, v_token, v_row.attempt_count + 1;
END;
$$;

-- 8. Store analysis + proposals + finalize atomically under the lease.
CREATE OR REPLACE FUNCTION public.career_material_store_analysis(
  p_intake_id uuid,
  p_user_id uuid,
  p_claim_token text,
  p_ai_type text,
  p_ai_confidence numeric,
  p_ai_rationale text,
  p_effective_type text,
  p_input_signature text,
  p_prompt_version text,
  p_normalizer_version text,
  p_items jsonb,
  p_items_dropped integer DEFAULT 0
)
RETURNS TABLE(status text, batch_id uuid, created_count integer, reused_count integer, superseded_count integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_row public.career_material_intakes%ROWTYPE;
  v_title text;
  v_batch uuid;
  v_item jsonb;
  v_ref text;
  v_map jsonb := '{}'::jsonb;
  v_existing uuid;
  v_new uuid;
  v_deps uuid[];
  v_ids uuid[] := ARRAY[]::uuid[];
  v_created integer := 0;
  v_reused integer := 0;
  v_superseded integer := 0;
BEGIN
  SELECT * INTO v_row FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, 0, 0, 0;
    RETURN;
  END IF;
  IF v_row.status <> 'processing' OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid, 0, 0, 0;
    RETURN;
  END IF;

  UPDATE public.career_material_intakes i
  SET ai_type = p_ai_type,
      ai_confidence = p_ai_confidence,
      ai_rationale = left(p_ai_rationale, 500)
  WHERE i.id = v_row.id;

  IF p_effective_type IS NULL THEN
    UPDATE public.career_material_intakes i
    SET status = 'needs_type', claim_token = NULL, lease_expires_at = NULL,
        error_code = NULL, retryable = NULL, processed_at = now(), effective_type = NULL
    WHERE i.id = v_row.id;
    RETURN QUERY SELECT 'needs_type'::text, NULL::uuid, 0, 0, 0;
    RETURN;
  END IF;

  SELECT d.title INTO v_title FROM public.documents d
  WHERE d.id = v_row.document_id AND d.user_id = p_user_id;

  INSERT INTO public.atom_enrichment_batches (
    user_id, title, source_type, source_id, source_table, source_record_id,
    source_hash, input_signature, normalizer_version, context
  ) VALUES (
    p_user_id, left('Karrieremateriale: ' || COALESCE(v_title, ''), 200), 'career_material',
    v_row.document_id::text, 'documents', v_row.document_id, v_row.content_sha256,
    p_input_signature, p_normalizer_version,
    jsonb_build_object('intake_id', v_row.id, 'material_type', p_effective_type, 'prompt_version', p_prompt_version)
  )
  ON CONFLICT (user_id, source_table, source_id, input_signature) WHERE input_signature IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_batch;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS e(value) LOOP
    v_ref := v_item->>'local_ref';

    SELECT p.id INTO v_existing FROM public.atom_enrichment_proposals p
    WHERE p.user_id = p_user_id
      AND p.source_type = 'career_material'
      AND p.source_record_id = v_row.document_id
      AND p.source_hash = v_item->>'source_hash'
      AND p.status = ANY (ARRAY['pending_review'::atom_enrichment_proposal_status,
                                'approved'::atom_enrichment_proposal_status,
                                'rejected'::atom_enrichment_proposal_status,
                                'needs_more_context'::atom_enrichment_proposal_status])
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      IF v_ref IS NOT NULL THEN
        v_map := v_map || jsonb_build_object(v_ref, v_existing::text);
      END IF;
      v_ids := v_ids || v_existing;
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg((v_map->>t.dep)::uuid) FILTER (WHERE v_map ? t.dep), ARRAY[]::uuid[])
    INTO v_deps
    FROM jsonb_array_elements_text(COALESCE(v_item->'depends_on', '[]'::jsonb)) AS t(dep);

    INSERT INTO public.atom_enrichment_proposals (
      user_id, batch_id, proposal_action, target_atom_type, source_type, source_id,
      source_table, source_record_id, source_hash, proposal_payload, rationale,
      explanation, confidence, inferred, normalizer_version, prompt_version
    ) VALUES (
      p_user_id, v_batch, (v_item->>'proposal_action')::atom_enrichment_proposal_action,
      COALESCE(v_item->>'target_atom_type', 'career_atom'), 'career_material',
      v_row.document_id::text, 'documents', v_row.document_id, v_item->>'source_hash',
      COALESCE(v_item->'payload', '{}'::jsonb)
        || CASE WHEN cardinality(v_deps) > 0
                THEN jsonb_build_object('evidence_proposal_ids', to_jsonb(v_deps))
                ELSE '{}'::jsonb END,
      left(v_item->>'rationale', 1000), left(v_item->>'explanation', 1000),
      NULLIF(v_item->>'confidence', '')::numeric, true, p_normalizer_version, p_prompt_version
    )
    RETURNING id INTO v_new;

    IF v_ref IS NOT NULL THEN
      v_map := v_map || jsonb_build_object(v_ref, v_new::text);
    END IF;
    v_ids := v_ids || v_new;
    v_created := v_created + 1;
  END LOOP;

  UPDATE public.atom_enrichment_proposals p
  SET status = 'superseded'
  WHERE p.user_id = p_user_id
    AND p.source_type = 'career_material'
    AND p.source_record_id = v_row.document_id
    AND p.status = ANY (ARRAY['pending_review'::atom_enrichment_proposal_status,
                              'needs_more_context'::atom_enrichment_proposal_status])
    AND NOT (p.id = ANY (v_ids));
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  UPDATE public.career_material_intakes i
  SET status = 'completed', claim_token = NULL, lease_expires_at = NULL,
      error_code = NULL, retryable = NULL, processed_at = now(),
      batch_id = v_batch, analysis_signature = p_input_signature,
      effective_type = p_effective_type,
      proposals_created = v_created, proposals_reused = v_reused,
      items_dropped = GREATEST(COALESCE(p_items_dropped, 0), 0)
  WHERE i.id = v_row.id;

  UPDATE public.documents d
  SET documentation_subcategory = p_effective_type, ai_processed_at = now()
  WHERE d.id = v_row.document_id AND d.user_id = p_user_id;

  RETURN QUERY SELECT 'completed'::text, v_batch, v_created, v_reused, v_superseded;
END;
$$;

-- 9. Failure under the lease.
CREATE OR REPLACE FUNCTION public.career_material_fail(
  p_intake_id uuid,
  p_user_id uuid,
  p_claim_token text,
  p_error_code text,
  p_retryable boolean
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.career_material_intakes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.status <> 'processing' OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'lease_lost';
  END IF;
  UPDATE public.career_material_intakes i
  SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
      error_code = left(p_error_code, 80), retryable = p_retryable, processed_at = now()
  WHERE i.id = v_row.id;
  RETURN 'failed';
END;
$$;

-- 10. User correction of document type.
CREATE OR REPLACE FUNCTION public.career_material_set_type(
  p_intake_id uuid,
  p_user_id uuid,
  p_type text
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.career_material_intakes%ROWTYPE;
BEGIN
  IF p_type NOT IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon') THEN
    RAISE EXCEPTION 'invalid type';
  END IF;
  SELECT * INTO v_row FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.status = 'processing' AND v_row.lease_expires_at > now() THEN
    RETURN 'in_progress';
  END IF;
  UPDATE public.career_material_intakes i
  SET user_type = p_type, status = 'queued', claim_token = NULL, lease_expires_at = NULL,
      error_code = NULL, retryable = NULL
  WHERE i.id = v_row.id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.career_material_create(uuid, text, text, text, text, text, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_claim(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_store_analysis(uuid, uuid, text, text, numeric, text, text, text, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_fail(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_set_type(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_material_create(uuid, text, text, text, text, text, uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_claim(uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_store_analysis(uuid, uuid, text, text, numeric, text, text, text, text, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_fail(uuid, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_set_type(uuid, uuid, text) TO service_role;