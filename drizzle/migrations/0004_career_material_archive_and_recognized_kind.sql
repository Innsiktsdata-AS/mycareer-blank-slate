ALTER TABLE public.career_material_intakes
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_note text,
  ADD COLUMN IF NOT EXISTS ai_recognized_kind text;

ALTER TABLE public.career_material_intakes
  ADD CONSTRAINT career_material_intakes_user_note_len CHECK (user_note IS NULL OR length(user_note) BETWEEN 1 AND 300),
  ADD CONSTRAINT career_material_intakes_recognized_kind_chk CHECK (ai_recognized_kind IS NULL OR ai_recognized_kind IN ('cv','kontaktliste','kursbevis','rolleendring','lonnsendring','faktura','annet'));

CREATE OR REPLACE FUNCTION public.career_material_set_recognized_kind(
  p_intake_id uuid, p_user_id uuid, p_claim_token text, p_kind text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('cv','kontaktliste','kursbevis','rolleendring','lonnsendring','faktura','annet') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  UPDATE public.career_material_intakes i
  SET ai_recognized_kind = p_kind
  WHERE i.id = p_intake_id AND i.user_id = p_user_id
    AND i.status = 'processing' AND i.claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN 'lease_lost'; END IF;
  RETURN 'ok';
END;$$;

CREATE OR REPLACE FUNCTION public.career_material_set_archived(
  p_intake_id uuid, p_user_id uuid, p_archived boolean, p_note text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_row public.career_material_intakes%ROWTYPE; v_note text;
BEGIN
  v_note := NULLIF(btrim(coalesce(p_note,'')), '');
  IF v_note IS NOT NULL AND length(v_note) > 300 THEN RAISE EXCEPTION 'note too long'; END IF;
  SELECT * INTO v_row FROM public.career_material_intakes i
  WHERE i.id = p_intake_id AND i.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.status IN ('queued','processing') THEN RETURN 'in_progress'; END IF;
  UPDATE public.career_material_intakes i
  SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
      user_note = CASE WHEN p_archived THEN v_note ELSE i.user_note END
  WHERE i.id = v_row.id;
  RETURN 'ok';
END;$$;

CREATE OR REPLACE FUNCTION public.career_material_set_type(p_intake_id uuid, p_user_id uuid, p_type text)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
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
      error_code = NULL, retryable = NULL, archived_at = NULL
  WHERE i.id = v_row.id;
  RETURN 'ok';
END;$$;

REVOKE ALL ON FUNCTION public.career_material_set_recognized_kind(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_material_set_archived(uuid,uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_material_set_recognized_kind(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_material_set_archived(uuid,uuid,boolean,text) TO service_role;