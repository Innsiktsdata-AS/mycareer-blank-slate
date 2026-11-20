CREATE OR REPLACE FUNCTION public.career_material_approve_proposal(
  p_proposal_id uuid, p_user_id uuid, p_edited_content text, p_reviewer_comment text,
  p_event_start date, p_event_end date, p_event_precision text, p_target_atom_id uuid)
RETURNS TABLE(status text, atom_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
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
    ON CONFLICT ON CONSTRAINT career_atom_sources_atom_id_document_id_key DO NOTHING;
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