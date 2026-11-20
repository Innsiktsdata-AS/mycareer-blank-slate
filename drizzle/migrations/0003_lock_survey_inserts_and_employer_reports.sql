DROP POLICY IF EXISTS "Anyone can insert answers" ON public.survey_answers;
DROP POLICY IF EXISTS "Anyone can insert response" ON public.survey_responses;
DROP POLICY IF EXISTS "Anyone can insert respondent profile" ON public.respondent_profile;

REVOKE INSERT ON public.survey_answers FROM anon, authenticated;
REVOKE INSERT ON public.survey_responses FROM anon, authenticated;
REVOKE INSERT ON public.respondent_profile FROM anon, authenticated;

DROP POLICY IF EXISTS "Public can read employer reports" ON public.employer_reports;
REVOKE SELECT ON public.employer_reports FROM anon, authenticated;

GRANT ALL ON public.survey_answers TO service_role;
GRANT ALL ON public.survey_responses TO service_role;
GRANT ALL ON public.respondent_profile TO service_role;
GRANT ALL ON public.employer_reports TO service_role;