// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { documentByIdQuery, allDocumentsQuery } from "@/lib/queries/sub-resources";
import { supabase } from "@/lib/supabase";
import { AutoSaveInput, AutoSaveTextarea } from "@/components/auto-save";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { ArrowLeft, Download, Copy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { diffWords } from "diff";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/documents/$id")({
  component: DocumentDetail,
});

function DocumentDetail() {
  const { id: idParam } = Route.useParams();
  const id = (idParam ?? "").trim();
  const idReady = id.length > 0;
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const docQ = useQuery(documentByIdQuery(id));
  const allQ = useQuery(allDocumentsQuery());
  const [showDiff, setShowDiff] = useState(false);

  if (!idReady) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <EmptyState
          title="Ugyldig dokument-ID"
          description="Lenken mangler et dokument-ID. Gå tilbake og velg dokumentet på nytt."
        />
      </div>
    );
  }

  if (docQ.isError) {
    const message =
      docQ.error instanceof Error
        ? docQ.error.message
        : "En ukjent feil oppstod ved lasting av dokumentet.";
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/documents">
            <ArrowLeft className="h-4 w-4 mr-2" /> Tilbake
          </Link>
        </Button>
        <EmptyState
          title="Kunne ikke laste dokument"
          description={message}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => docQ.refetch()}>
              Prøv igjen
            </Button>
          }
        />
      </div>
    );
  }

  if (docQ.isSuccess && docQ.data === null) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/documents">
            <ArrowLeft className="h-4 w-4 mr-2" /> Tilbake
          </Link>
        </Button>
        <EmptyState title="Dokument ikke funnet" />
      </div>
    );
  }

  if (!docQ.data) {
    return (
      <div className="p-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const d = docQ.data;
  // Karrieremateriale: originalen er låst (også i databasen) for sporbarhet.
  const isCareerMaterial =
    typeof d.source_context === "string" && d.source_context.startsWith("career_material_");

  const save = (field: string) => async (v: string) => {
    const { error } = await (supabase.from("documents") as any).update({ [field]: v || null }).eq("id", id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const newVersion = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("documents").insert({
      user_id: user.id,
      title: d.title,
      document_type: d.document_type,
      content_text: d.content_text,
      application_id: d.application_id,
      is_base_version: d.is_base_version,
      tailored_for: d.tailored_for,
      version: (d.version ?? 1) + 1,
    }).select().single();
    if (error) return toast.error(error.message);
    navigate({ to: "/documents/$id", params: { id: data.id } });
  };

  const download = async () => {
    if (d.file_path) {
      const bucket = d.source_context === "career_material_attachment" ? "career-material" : "job-documents";
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(d.file_path, 60);
      if (error || !data) return toast.error(error?.message ?? "Kunne ikke hente fil");
      window.open(data.signedUrl, "_blank");
      return;
    }
    const blob = new Blob([d.content_text ?? ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${d.title}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const base = (allQ.data ?? []).find(
    (x) => x.is_base_version && x.document_type === d.document_type && x.id !== d.id
  );
  const diff = base && d.content_text && base.content_text
    ? diffWords(base.content_text, d.content_text)
    : null;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/documents"><ArrowLeft className="h-4 w-4 mr-2" /> Tilbake</Link>
      </Button>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Metadata</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">Type: {DOCUMENT_TYPE_LABELS[d.document_type]}</div>
            <div className="text-xs text-muted-foreground">Versjon: {d.version}</div>
            {d.file_name && (
              <div className="text-xs text-muted-foreground truncate">Fil: {d.file_name}</div>
            )}
            <AutoSaveInput label="Tittel" value={d.title} onSave={save("title")} />
            {isCareerMaterial ? (
              <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Karrieremateriale</p>
                <p>
                  {d.source_context === "career_material_attachment"
                    ? "Fra vedlegg i e-post. Teksten under er hentet automatisk fra filen; originalfilen kan lastes ned."
                    : d.source_context === "career_material_email"
                      ? "Mottatt på e-post."
                      : "Limt inn av deg."}{" "}
                  Originalen kan ikke endres, slik at forslag alltid kan spores tilbake hit.
                </p>
                <Link to="/kilder" className="underline underline-offset-2 hover:text-foreground">
                  Se analysestatus under Kilder
                </Link>
              </div>
            ) : (
              <>
                <AutoSaveInput label="Selskap" value={(d as any).company_name} onSave={save("company_name")} />
                <AutoSaveInput label="Tilpasset for" value={d.tailored_for} onSave={save("tailored_for")} />
                <AutoSaveTextarea label="Notater om tilpasning" value={d.customization_notes} onSave={save("customization_notes")} rows={3} />
              </>
            )}
            <div className="flex flex-col gap-2 pt-2">
              {!isCareerMaterial && (
                <Button size="sm" variant="outline" onClick={newVersion}><Copy className="h-4 w-4 mr-2" /> Ny versjon</Button>
              )}
              <Button size="sm" variant="outline" onClick={download}><Download className="h-4 w-4 mr-2" /> {d.file_path ? "Last ned fil" : "Last ned .txt"}</Button>
              {!d.is_base_version && base && (
                <Button size="sm" variant="outline" onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? "Skjul" : "Vis"} sammenligning med base
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Innhold</CardTitle></CardHeader>
          <CardContent>
            {showDiff && diff ? (
              <pre className="whitespace-pre-wrap text-sm font-mono rounded-md bg-muted p-3 max-h-[600px] overflow-auto">
                {diff.map((part, i) => (
                  <span
                    key={i}
                    className={
                      part.added ? "bg-emerald-200 dark:bg-emerald-900" :
                      part.removed ? "bg-rose-200 dark:bg-rose-900 line-through" : ""
                    }
                  >
                    {part.value}
                  </span>
                ))}
              </pre>
            ) : isCareerMaterial ? (
              <pre className="whitespace-pre-wrap font-sans text-sm rounded-md bg-muted p-3 max-h-[600px] overflow-auto">
                {d.content_text}
              </pre>
            ) : (
              <AutoSaveTextarea value={d.content_text} onSave={save("content_text")} rows={24} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
