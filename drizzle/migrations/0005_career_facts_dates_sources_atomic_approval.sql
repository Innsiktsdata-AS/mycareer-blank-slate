ALTER TABLE public.career_atoms
  ADD COLUMN IF NOT EXISTS event_start date,
  ADD COLUMN IF NOT EXISTS event_end date,
  ADD COLUMN IF NOT EXISTS event_precision text;
ALTER TABLE public.career_atoms
  ADD CONSTRAINT career_atoms_event_precision_chk CHECK (event_precision IS NULL OR event_precision IN ('day','month','year')),
  ADD CONSTRAINT career_atoms_event_order_chk CHECK (event_end IS NULL OR event_start IS NULL OR event_end >= event_start),
  ADD CONSTRAINT career_atoms_event_needs_precision_chk CHECK ((event_start IS NULL) = (event_precision IS NULL));

CREATE TABLE public.career_atom_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('proposal','credential_upload')),
  proposal_id uuid,
  source_quote text CHECK (source_quote IS NULL OR length(source_quote) <= 600),
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atom_id, document_id)
);
CREATE INDEX career_atom_sources_user_idx ON public.career_atom_sources(user_id);
CREATE INDEX career_atom_sources_document_idx ON public.career_atom_sources(document_id);
GRANT SELECT ON public.career_atom_sources TO authenticated;
GRANT ALL ON public.career_atom_sources TO service_role;
ALTER TABLE public.career_atom_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eier leser egne kildekoblinger" ON public.career_atom_sources
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Eksisterende filer brukeren selv har lastet opp til en kvalifikasjon.
INSERT INTO public.career_atom_sources (user_id, atom_id, document_id, origin, approved_at, approved_by)
SELECT d.user_id, a.id, d.id, 'credential_upload', d.created_at, d.user_id
FROM public.documents d
CROSS JOIN LATERAL unnest(d.atom_ids) AS x(atom_id)
JOIN public.career_atoms a ON a.id = x.atom_id AND a.user_id = d.user_id
WHERE d.source_context = 'credential_upload'
ON CONFLICT (atom_id, document_id) DO NOTHING;

-- Nye velgbare dokumenttyper.
ALTER TABLE public.career_material_intakes
  DROP CONSTRAINT career_material_intakes_ai_type_check,
  DROP CONSTRAINT career_material_intakes_declared_type_check,
  DROP CONSTRAINT career_material_intakes_effective_type_check,
  DROP CONSTRAINT career_material_intakes_user_type_check;
ALTER TABLE public.career_material_intakes
  ADD CONSTRAINT career_material_intakes_ai_type_check CHECK (ai_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','kursbevis','rolleendring','lonnsendring','ukjent')),
  ADD CONSTRAINT career_material_intakes_declared_type_check CHECK (declared_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','kursbevis','rolleendring','lonnsendring')),
  ADD CONSTRAINT career_material_intakes_effective_type_check CHECK (effective_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','kursbevis','rolleendring','lonnsendring')),
  ADD CONSTRAINT career_material_intakes_user_type_check CHECK (user_type IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','kursbevis','rolleendring','lonnsendring'));

CREATE OR REPLACE FUNCTION public.career_material_set_type(p_intake_id uuid, p_user_id uuid, p_type text)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_row public.career_material_intakes%ROWTYPE;
BEGIN
  IF p_type NOT IN ('stillingsinstruks','prosjektnotat','medarbeidersamtale','attest','prestasjon','kursbevis','rolleendring','lonnsendring') THEN
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
      error_code = NULL, retryable = NULL, archived_at = NULL
  WHERE i.id = v_row.id;
  RETURN 'ok';
END;$$;

-- Samlet, gjentakbar godkjenning for forslag fra karrieremateriale.
CREATE OR REPLACE FUNCTION public.career_material_approve_proposal(
  p_proposal_id uuid, p_user_id uuid, p_edited_content text, p_reviewer_comment text,
  p_event_start date, p_event_end date, p_event_precision text, p_target_atom_id uuid)
RETURNS TABLE(status text, atom_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_p public.atom_enrichment_proposals%ROWTYPE;
  v_payload jsonb;
  v_atom uuid;
  v_edited text := NULLIF(btrim(coalesce(p_edited_content,'')), '');
  v_ev_ids uuid[];
  v_resolved uuid[];
  v_content text;
  v_doc uuid;
BEGIN
  SELECT * INTO v_p FROM public.atom_enrichment_proposals p
  WHERE p.id = p_proposal_id AND p.user_id = p_user_id AND p.source_type = 'career_material'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF v_p.status = 'approved' THEN
    RETURN QUERY SELECT 'already_approved'::text, v_p.applied_atom_id; RETURN;
  END IF;
  IF v_p.status NOT IN ('pending_review','needs_more_context') THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::uuid; RETURN;
  END IF;
  IF v_edited IS NOT NULL AND (length(v_edited) < 2 OR length(v_edited) > 400) THEN
    RETURN QUERY SELECT 'invalid_edit'::text, NULL::uuid; RETURN;
  END IF;
  IF p_event_precision IS NOT NULL AND p_event_precision NOT IN ('day','month','year') THEN
    RETURN QUERY SELECT 'invalid_date'::text, NULL::uuid; RETURN;
  END IF;
  IF (p_event_start IS NULL) <> (p_event_precision IS NULL)
     OR (p_event_end IS NOT NULL AND (p_event_start IS NULL OR p_event_end < p_event_start)) THEN
    RETURN QUERY SELECT 'invalid_date'::text, NULL::uuid; RETURN;
  END IF;

  v_payload := coalesce(v_p.proposal_payload, '{}'::jsonb);
  v_doc := v_p.source_record_id;

  IF v_p.proposal_action = 'create_atom' AND p_target_atom_id IS NOT NULL THEN
    -- Kilden dokumenterer en eksisterende oppføring: ingen ny oppføring.
    SELECT a.id INTO v_atom FROM public.career_atoms a
    WHERE a.id = p_target_atom_id AND a.user_id = p_user_id AND a.is_active;
    IF v_atom IS NULL THEN RETURN QUERY SELECT 'target_not_found'::text, NULL::uuid; RETURN; END IF;
  ELSIF v_p.proposal_action = 'create_atom' THEN
    SELECT coalesce(array_agg(x::uuid), '{}') INTO v_ev_ids
    FROM jsonb_array_elements_text(coalesce(v_payload->'evidence_proposal_ids','[]'::jsonb)) x;
    IF array_length(v_ev_ids,1) > 0 THEN
      SELECT coalesce(array_agg(p.applied_atom_id), '{}') INTO v_resolved
      FROM public.atom_enrichment_proposals p
      WHERE p.id = ANY(v_ev_ids) AND p.user_id = p_user_id AND p.status = 'approved'
        AND p.applied_atom_id IS NOT NULL;
      IF coalesce(array_length(v_resolved,1),0) = 0 THEN
        RETURN QUERY SELECT 'needs_evidence'::text, NULL::uuid; RETURN;
      END IF;
    ELSE
      v_resolved := '{}';
    END IF;
    v_content := coalesce(v_edited, NULLIF(btrim(v_payload->>'content_no'),''));
    IF v_content IS NULL THEN RETURN QUERY SELECT 'invalid_payload'::text, NULL::uuid; RETURN; END IF;
    INSERT INTO public.career_atoms (
      user_id, atom_kind, atom_type, content_no, structured_data, source_type, source_ref,
      source_quote, evidence_atom_ids, confidence, user_confirmed, is_active,
      event_start, event_end, event_precision)
    VALUES (
      p_user_id, v_payload->>'atom_kind', v_payload->>'atom_type', v_content,
      coalesce(v_payload->'structured_data','{}'::jsonb)
        || CASE WHEN v_edited IS NOT NULL THEN '{"user_edited":true}'::jsonb ELSE '{}'::jsonb END,
      'career_material', coalesce(v_payload->>'source_ref', v_doc::text), v_payload->>'source_quote',
      v_resolved, 'inferred', true, true,
      p_event_start, p_event_end, p_event_precision)
    RETURNING id INTO v_atom;
  END IF;

  IF v_atom IS NOT NULL AND v_doc IS NOT NULL THEN
    INSERT INTO public.career_atom_sources (user_id, atom_id, document_id, origin, proposal_id, source_quote, approved_by)
    VALUES (p_user_id, v_atom, v_doc, 'proposal', v_p.id, left(v_payload->>'source_quote', 600), p_user_id)
    ON CONFLICT (atom_id, document_id) DO NOTHING;
  END IF;

  UPDATE public.atom_enrichment_proposals p
  SET status = 'approved', reviewed_at = now(), reviewed_by = p_user_id,
      reviewer_comment = NULLIF(btrim(coalesce(p_reviewer_comment,'')), ''),
      applied_atom_id = v_atom,
      diff = CASE WHEN v_edited IS NOT NULL
        THEN jsonb_build_object('edited_by_user', true, 'original_content_no', v_payload->>'content_no', 'content_no', v_edited)
        ELSE p.diff END
  WHERE p.id = v_p.id;

  RETURN QUERY SELECT CASE WHEN p_target_atom_id IS NOT NULL THEN 'linked' ELSE 'approved' END::text, v_atom;
END;$$;

REVOKE ALL ON FUNCTION public.career_material_approve_proposal(uuid,uuid,text,text,date,date,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_material_approve_proposal(uuid,uuid,text,text,date,date,text,uuid) TO service_role;