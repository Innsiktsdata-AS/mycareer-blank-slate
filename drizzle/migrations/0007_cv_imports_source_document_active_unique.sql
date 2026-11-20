CREATE UNIQUE INDEX IF NOT EXISTS cv_imports_source_document_active_uniq
  ON public.cv_imports(source_document_id)
  WHERE source_document_id IS NOT NULL AND status <> 'failed';