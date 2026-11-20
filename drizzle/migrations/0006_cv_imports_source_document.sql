ALTER TABLE public.cv_imports
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cv_imports_source_document_idx ON public.cv_imports(source_document_id);