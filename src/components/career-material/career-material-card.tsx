// Karrieremateriale på /kilder: lim inn tekst, egen e-postadresse og status
// for analyse. Originalen lagres alltid først; forslag havner i
// godkjenningskøen og endrer ingenting i profilen før du godkjenner.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Copy,
  Download,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import {
  ATTACHMENT_MAX_PER_EMAIL,
  ATTACHMENT_STATUS_LABELS,
  CAREER_MATERIAL_STATUS_LABELS,
  OWN_MATERIAL_TYPES,
  RECOGNIZED_KIND_GUIDES,
  USER_NOTE_MAX,
  isRecognizedKind,
  attachmentHint,
  INTAKE_MAX_AUTO_ATTEMPTS,
  CAREER_MATERIAL_TYPES,
  CAREER_MATERIAL_TYPE_HINTS,
  CAREER_MATERIAL_TYPE_LABELS,
  PASTE_TEXT_MAX,
  PASTE_TEXT_MIN,
  PASTE_TITLE_MAX,
  PASTE_TITLE_MIN,
  careerMaterialErrorLabel,
  inboundRejectLabel,
  isCareerMaterialType,
  type CareerMaterialType,
} from "@/lib/career-material/contract";
import {
  createCareerNotesAddress,
  deleteCareerAttachment,
  deleteCareerMaterial,
  getCareerNotesAddress,
  processCareerMaterial,
  setCareerMaterialType,
  setCareerMaterialArchived,
  sendCareerMaterialToCvImport,
  submitCareerMaterialPaste,
} from "@/lib/career-material/career-material.functions";
import {
  careerMaterialAttachmentsQuery,
  careerMaterialEmailFailuresQuery,
  careerMaterialIntakesQuery,
  careerMaterialKeys,
  careerMaterialWorkerStateQuery,
  type CareerAttachmentView,
  type CareerMaterialIntakeView,
} from "@/lib/queries/career-material";
import { fmtDateTime } from "@/lib/format";
import { ARCHIVE_VCARD_FILENAME, buildArchiveVcard } from "@/lib/career-material/vcard";

const SELECT_BASE =
  "rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SELECT_CLASS = `h-9 w-full ${SELECT_BASE}`;

function typeLabel(v: string | null | undefined): string {
  if (!v) return "Ikke valgt";
  return CAREER_MATERIAL_TYPE_LABELS[v as CareerMaterialType] ?? v;
}

export function CareerMaterialCard() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const qc = useQueryClient();

  const submitFn = useServerFn(submitCareerMaterialPaste);
  const processFn = useServerFn(processCareerMaterial);
  const setTypeFn = useServerFn(setCareerMaterialType);
  const archiveFn = useServerFn(setCareerMaterialArchived);
  const getAddressFn = useServerFn(getCareerNotesAddress);
  const createAddressFn = useServerFn(createCareerNotesAddress);
  const deleteFn = useServerFn(deleteCareerMaterial);
  const deleteAttachmentFn = useServerFn(deleteCareerAttachment);

  const intakesQ = useQuery(careerMaterialIntakesQuery(uid));
  const failuresQ = useQuery(careerMaterialEmailFailuresQuery(uid));
  const attachmentsQ = useQuery(careerMaterialAttachmentsQuery(uid));
  const workerQ = useQuery(careerMaterialWorkerStateQuery(uid));
  const addressQ = useQuery({
    queryKey: ["career-notes-address", uid],
    enabled: !!uid,
    queryFn: () => getAddressFn(),
  });

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [declared, setDeclared] = useState<string>("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: careerMaterialKeys.intakes(uid) });
    void qc.invalidateQueries({ queryKey: careerMaterialKeys.attachments(uid) });
    void qc.invalidateQueries({ queryKey: ["atom-enrichment-proposals", uid] });
    void qc.invalidateQueries({ queryKey: ["review-inbox-counts", uid] });
  };

  const processM = useMutation({
    mutationFn: (input: { intakeId: string; force: boolean }) => processFn({ data: input }),
    onSuccess: (res) => {
      if (res.status === "completed") {
        toast.success(
          res.created > 0
            ? `${res.created} nye forslag venter på gjennomgang.`
            : "Analysen er ferdig. Ingen nye forslag.",
        );
      } else if (res.status === "needs_type") {
        toast.message("Velg dokumenttype før vi kan lage forslag.");
      } else if (res.status === "failed") {
        toast.error(careerMaterialErrorLabel(res.errorCode));
      } else if (res.status === "attempt_limit") {
        toast.error(careerMaterialErrorLabel("attempt_limit"));
      }
    },
    onError: () => toast.error("Kunne ikke starte analysen. Prøv igjen."),
    onSettled: refresh,
  });

  const submitM = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          title: title.trim(),
          text: text.trim(),
          declaredType: isCareerMaterialType(declared) ? declared : null,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.errorCode === "daily_limit"
            ? "Du har sendt inn mye i dag. Prøv igjen i morgen."
            : "Kunne ikke lagre teksten.",
        );
        return;
      }
      toast.success(
        res.status === "duplicate"
          ? "Denne teksten er allerede lagret i arkivet ditt."
          : "Originalen er lagret i arkivet ditt. Analysen starter nå.",
      );
      setTitle("");
      setText("");
      setDeclared("");
      refresh();
      if (res.status === "created") processM.mutate({ intakeId: res.intakeId, force: false });
    },
    onError: () => toast.error("Kunne ikke lagre teksten. Sjekk lengden og prøv igjen."),
  });

  const setTypeM = useMutation({
    mutationFn: (input: { intakeId: string; type: CareerMaterialType }) =>
      setTypeFn({ data: input }),
    onSuccess: (res, input) => {
      if (res.status === "ok") processM.mutate({ intakeId: input.intakeId, force: true });
      else if (res.status === "in_progress") toast.message("Analysen pågår allerede.");
      else toast.error("Kunne ikke endre dokumenttype.");
    },
    onSettled: refresh,
  });

  const archiveM = useMutation({
    mutationFn: (input: { intakeId: string; archived: boolean; note?: string }) =>
      archiveFn({ data: input }),
    onSuccess: (res, input) => {
      if (res.status === "ok")
        toast.success(input.archived ? "Beholdt i arkivet." : "Kilden krever handling igjen.");
      else if (res.status === "in_progress") toast.message("Analysen pågår. Prøv igjen straks.");
      else toast.error("Kunne ikke oppdatere kilden.");
    },
    onSettled: refresh,
  });

  const createAddressM = useMutation({
    mutationFn: () => createAddressFn(),
    onSuccess: (res) => {
      if (!res.ok) toast.error("Kunne ikke opprette adressen.");
      void qc.invalidateQueries({ queryKey: ["career-notes-address", uid] });
    },
  });

  // E-post og vedlegg analyseres av bakgrunnsjobben — du trenger ikke ha
  // siden åpen. Innlimt tekst analyseres straks du lagrer.
  const deleteM = useMutation({
    mutationFn: (input: { intakeId: string; removeApprovedAtoms: boolean }) =>
      deleteFn({ data: input }),
    onSuccess: (res) => {
      if (res.status === "deleted") {
        toast.success(
          res.removedAtoms > 0
            ? `Kilden er slettet, og ${res.removedAtoms} godkjente elementer er fjernet fra profilen.`
            : "Kilden og forslagene fra den er slettet.",
        );
      } else if (res.status === "not_found") toast.error("Fant ikke kilden.");
      else toast.error("Kunne ikke slette kilden. Prøv igjen.");
    },
    onError: () => toast.error("Kunne ikke slette kilden. Prøv igjen."),
    onSettled: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["career-atoms"] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const deleteAttachmentM = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachmentFn({ data: { attachmentId } }),
    onSuccess: (res) => {
      if (res.status === "deleted") toast.success("Vedlegget er fjernet.");
      else if (res.status === "has_source")
        toast.error("Vedlegget er en kilde. Slett kilden under Innsendt materiale.");
      else if (res.status === "in_progress") toast.message("Vedlegget behandles akkurat nå.");
      else toast.error("Kunne ikke fjerne vedlegget.");
    },
    onSettled: refresh,
  });

  const titleOk = title.trim().length >= PASTE_TITLE_MIN && title.trim().length <= PASTE_TITLE_MAX;
  const textLen = text.trim().length;
  const textOk = textLen >= PASTE_TEXT_MIN && textLen <= PASTE_TEXT_MAX;
  const busyId = processM.isPending ? processM.variables?.intakeId : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <CardTitle className="text-base">Karrieremateriale</CardTitle>
            <CardDescription className="max-w-prose">
              Stillingsinstrukser, prosjektnotater, medarbeidersamtaler, attester og prestasjoner.
              Originalen lagres privat i arkivet ditt. KI foreslår resultater og kompetanser med
              tekstutdrag fra kilden — ingenting legges i profilen før du har godkjent det.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (titleOk && textOk && !submitM.isPending) submitM.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cm-title">Tittel</Label>
              <Input
                id="cm-title"
                value={title}
                maxLength={PASTE_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="F.eks. Medarbeidersamtale våren 2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-type">Dokumenttype</Label>
              <select
                id="cm-type"
                className={SELECT_CLASS}
                value={declared}
                onChange={(e) => setDeclared(e.target.value)}
              >
                <option value="">La KI foreslå</option>
                {CAREER_MATERIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CAREER_MATERIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isCareerMaterialType(declared) && (
            <p className="text-xs text-muted-foreground">{CAREER_MATERIAL_TYPE_HINTS[declared]}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cm-text">Tekst</Label>
            <Textarea
              id="cm-text"
              rows={7}
              value={text}
              maxLength={PASTE_TEXT_MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder="Lim inn referatet, notatet eller beskrivelsen her."
            />
            <p className="text-xs text-muted-foreground">
              {textLen.toLocaleString("nb-NO")} / {PASTE_TEXT_MAX.toLocaleString("nb-NO")} tegn
              {textLen > 0 && textLen < PASTE_TEXT_MIN ? ` — minst ${PASTE_TEXT_MIN} tegn` : ""}
            </p>
          </div>
          <Button type="submit" size="sm" disabled={!titleOk || !textOk || submitM.isPending}>
            {submitM.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Lagre og analyser
          </Button>
        </form>

        <Separator />

        <EmailAddressSection
          loading={addressQ.isLoading}
          address={addressQ.data?.address ?? null}
          hasAlias={addressQ.data?.hasAlias ?? false}
          configured={addressQ.data?.receivingConfigured ?? false}
          creating={createAddressM.isPending}
          onCreate={() => createAddressM.mutate()}
        />

        {(failuresQ.data ?? []).length > 0 && (
          <Alert>
            <AlertDescription className="space-y-1 text-sm">
              <p className="font-medium">E-poster som ikke ble tatt imot</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {(failuresQ.data ?? []).map((f) => (
                  <li key={f.id}>
                    {f.at ? `${fmtDateTime(f.at)}: ` : ""}
                    {inboundRejectLabel(f.rejectReason, f.at)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {workerQ.data?.pausedReason && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm">
              Automatisk analyse er satt på pause (
              {workerQ.data.pausedReason === "configuration"
                ? "analysetjenesten er ikke riktig konfigurert"
                : "analysetjenesten avviste forespørslene"}
              {workerQ.data.pausedAt ? `, siden ${fmtDateTime(workerQ.data.pausedAt)}` : ""}). Den
              prøver ett dokument per minutt og fortsetter av seg selv når det lykkes. Synlig bare
              for administratorer.
            </AlertDescription>
          </Alert>
        )}

        {(attachmentsQ.data ?? []).length > 0 && (
          <AttachmentList
            items={attachmentsQ.data ?? []}
            deletingId={deleteAttachmentM.isPending ? (deleteAttachmentM.variables ?? null) : null}
            onDelete={(id) => deleteAttachmentM.mutate(id)}
          />
        )}

        {(intakesQ.data ?? []).length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Innsendt materiale</h3>
              <ul className="space-y-3">
                {(intakesQ.data ?? []).map((r) => (
                  <IntakeRow
                    key={r.id}
                    r={r}
                    busy={
                      busyId === r.id ||
                      (setTypeM.isPending && setTypeM.variables?.intakeId === r.id)
                    }
                    deleting={deleteM.isPending && deleteM.variables?.intakeId === r.id}
                    onProcess={(force) => processM.mutate({ intakeId: r.id, force })}
                    onSetType={(type) => setTypeM.mutate({ intakeId: r.id, type })}
                    archiving={archiveM.isPending && archiveM.variables?.intakeId === r.id}
                    onArchive={(archived, note) =>
                      archiveM.mutate({ intakeId: r.id, archived, ...(note ? { note } : {}) })
                    }
                    onDelete={(removeApprovedAtoms) =>
                      deleteM.mutate({ intakeId: r.id, removeApprovedAtoms })
                    }
                  />
                ))}
              </ul>
            </div>
          </>
        )}
        {intakesQ.isError && (
          <p className="text-sm text-destructive">Kunne ikke hente innsendt materiale.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CvImportAction(props: { intakeId: string; highlighted: boolean }) {
  const sendFn = useServerFn(sendCareerMaterialToCvImport);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: () => sendFn({ data: { intakeId: props.intakeId } }),
    onSuccess: (res) => {
      if (res.status === "created" || res.status === "exists") {
        setDone(true);
        toast.success(
          res.status === "exists"
            ? "CV-en er allerede sendt til CV-importen."
            : "CV-en er sendt til CV-importen. Fullfør gjennomgangen der.",
        );
      } else if (res.status === "unsupported") toast.error("Bare PDF og Word (.docx) kan sendes til CV-importen.");
      else if (res.status === "no_file") toast.error("Fant ikke filen i arkivet.");
      else toast.error("Kunne ikke sende CV-en. Prøv igjen.");
    },
  });
  if (done)
    return (
      <p className="text-xs text-muted-foreground">
        Sendt til CV-importen.{" "}
        <Link to="/onboarding" className="text-primary underline underline-offset-2">
          Fortsett i CV-importen
        </Link>
        . Profilen endres ikke før du har gått gjennom CV-en der.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {!confirm ? (
        <Button
          size="sm"
          variant={props.highlighted ? "secondary" : "ghost"}
          onClick={() => setConfirm(true)}
        >
          Dette er en CV — send til CV-import
        </Button>
      ) : (
        <>
          <span className="text-muted-foreground">
            Originalen blir liggende i arkivet. Ingenting endres i profilen før du går gjennom CV-en.
          </span>
          <Button size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            Send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Avbryt
          </Button>
        </>
      )}
    </div>
  );
}

function downloadArchiveVcard(address: string) {
  const card = buildArchiveVcard(address);
  if (!card) {
    toast.error("Kunne ikke lage kontaktkortet.");
    return;
  }
  const url = URL.createObjectURL(new Blob([card], { type: "text/vcard;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ARCHIVE_VCARD_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EmailAddressSection(props: {
  loading: boolean;
  address: string | null;
  hasAlias: boolean;
  configured: boolean;
  creating: boolean;
  onCreate: () => void;
}) {
  const { loading, address, hasAlias, configured, creating, onCreate } = props;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Send på e-post</h3>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      ) : !configured ? (
        <p className="text-sm text-muted-foreground">
          E-postmottak er ikke aktivert ennå. Når det er satt opp, får du en egen privat adresse her
          for karrierenotater. Jobbvarsler bruker en annen adresse.
        </p>
      ) : address ? (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Videresend referater, attester og notater til din private adresse. Teksten i e-posten og
            vedlegg i PDF eller Word (.docx) lagres og analyseres automatisk — du trenger ikke å
            åpne denne siden. Skannede PDF-er uten tekst kan vi ikke lese (ingen OCR). Høyst{" "}
            {ATTACHMENT_MAX_PER_EMAIL} vedlegg på inntil 10 MB per e-post.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1 text-xs">{address}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(address)
                  .then(() => toast.success("Adressen er kopiert"))
                  .catch(() => toast.error("Kunne ikke kopiere"))
              }
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Kopier
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadArchiveVcard(address)}>
              Last ned kontaktkort
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Denne adressen er bare for karrieremateriale. Jobbvarsler sendes til jobbvarsel-adressen
            din under Innstillinger.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Få en egen privat adresse du kan videresende karrierenotater til.
          </p>
          <Button size="sm" variant="outline" disabled={creating || hasAlias} onClick={onCreate}>
            {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            Opprett adresse
          </Button>
        </div>
      )}
    </div>
  );
}

async function openStoredFile(path: string) {
  const { data, error } = await supabase.storage.from("career-material").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Kunne ikke hente filen.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function AttachmentList(props: {
  items: CareerAttachmentView[];
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  const { items, deletingId, onDelete } = props;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Vedlegg fra e-post</h3>
      </div>
      <ul className="space-y-2">
        {items.map((a) => {
          const hint = attachmentHint(a);
          const done = a.status === "extracted" || a.status === "duplicate";
          const busy = a.status === "queued" || a.status === "processing";
          return (
            <li key={a.id} className="rounded-md border p-2.5 text-xs space-y-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm break-all">{a.filename ?? "Uten filnavn"}</p>
                  <p className="text-muted-foreground">
                    {fmtDateTime(a.createdAt)}
                    {a.sizeBytes != null ? ` · ${formatSize(a.sizeBytes)}` : ""}
                    {a.pageCount != null ? ` · ${a.pageCount} sider` : ""}
                  </p>
                </div>
                <Badge
                  variant={done ? "secondary" : busy ? "outline" : "destructive"}
                  className="shrink-0"
                >
                  {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
                  {ATTACHMENT_STATUS_LABELS[a.status]}
                </Badge>
              </div>
              {hint && !done && <p className="text-muted-foreground">{hint}</p>}
              <div className="flex flex-wrap gap-2">
                {a.documentId && done && (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                    <Link to="/documents/$id" params={{ id: a.documentId }}>
                      Åpne kilden
                    </Link>
                  </Button>
                )}
                {a.storagePath && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => void openStoredFile(a.storagePath!)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Last ned original
                  </Button>
                )}
                {!done && !busy && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={deletingId === a.id}
                    onClick={() => onDelete(a.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Fjern
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IntakeRow(props: {
  r: CareerMaterialIntakeView;
  busy: boolean;
  deleting: boolean;
  onProcess: (force: boolean) => void;
  onSetType: (type: CareerMaterialType) => void;
  onDelete: (removeApprovedAtoms: boolean) => void;
  archiving: boolean;
  onArchive: (archived: boolean, note?: string) => void;
}) {
  const { r, busy, deleting, onProcess, onSetType, onDelete, archiving, onArchive } = props;
  const [note, setNote] = useState(r.userNote ?? "");
  const archived = Boolean(r.archivedAt);
  const recognized = isRecognizedKind(r.aiRecognizedKind) ? r.aiRecognizedKind : null;
  const guide = recognized ? RECOGNIZED_KIND_GUIDES[recognized] : null;
  const [typeChoice, setTypeChoice] = useState<string>(r.effectiveType ?? r.aiType ?? "");
  const [confirmType, setConfirmType] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeAtoms, setRemoveAtoms] = useState(false);
  const processing = r.status === "processing" && r.leaseActive;
  const typeSource = r.userType
    ? "valgt av deg"
    : r.declaredType
      ? "oppgitt av deg"
      : r.effectiveType
        ? "KI-forslag"
        : null;
  const statusVariant =
    r.status === "failed" ? "destructive" : r.status === "completed" ? "secondary" : "outline";
  const activeApproved = r.approved.filter((a) => a.active);
  const chosenType = isCareerMaterialType(typeChoice) ? typeChoice : null;
  const chosenGivesSkills = chosenType ? OWN_MATERIAL_TYPES.has(chosenType) : true;

  const applyType = () => {
    if (!chosenType) return;
    if (activeApproved.length > 0 || r.pendingProposals > 0) setConfirmType(true);
    else onSetType(chosenType);
  };

  return (
    <li className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to="/documents/$id"
            params={{ id: r.documentId }}
            className="text-sm font-medium hover:underline break-words"
          >
            {r.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {r.sourceContext === "career_material_attachment"
              ? "Vedlegg i e-post"
              : r.channel === "email"
                ? "Mottatt på e-post"
                : "Limt inn"}{" "}
            · {fmtDateTime(r.createdAt)}
            {r.documentDeleted ? " · slettet fra arkivet" : ""}
          </p>
        </div>
        <Badge variant={statusVariant} className="shrink-0">
          {processing && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
          {archived
            ? "Arkivert"
            : CAREER_MATERIAL_STATUS_LABELS[
                processing ? "processing" : r.status === "processing" ? "queued" : r.status
              ]}
        </Badge>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        {r.status === "queued" && r.channel === "email" && (
          <p>Analyseres automatisk i bakgrunnen, vanligvis innen et par minutter.</p>
        )}
        {r.effectiveType && (
          <p>
            Dokumenttype: <span className="text-foreground">{typeLabel(r.effectiveType)}</span>
            {typeSource ? ` (${typeSource})` : ""}
          </p>
        )}
        {r.aiType && (
          <p>
            KI-klassifisering: {typeLabel(r.aiType)}
            {r.aiConfidence != null ? `, sikkerhet ${Math.round(r.aiConfidence * 100)} %` : ""}
            {r.aiRationale ? ` — ${r.aiRationale}` : ""}
          </p>
        )}
        {r.status === "completed" && (
          <p>
            {r.proposalsCreated > 0 ? `${r.proposalsCreated} nye forslag` : "Ingen nye forslag"}
            {r.proposalsReused > 0 ? `, ${r.proposalsReused} fantes fra før` : ""}
            {r.pendingProposals > 0 ? ` · ${r.pendingProposals} venter på deg` : ""}
          </p>
        )}
        {r.itemsDropped > 0 && (
          <p>
            {r.itemsDropped} funn ble forkastet fordi de ikke kunne spores til et ordrett utdrag i
            teksten.
          </p>
        )}
        {r.truncated && <p>Teksten var svært lang. Bare starten er lagret og analysert.</p>}
        {r.attachments.length > 0 && (
          <p>
            Vedlegg: {r.attachments.length} — se status under «Vedlegg fra e-post». Støttede filer
            blir egne kilder.
          </p>
        )}
        {r.status === "failed" && (
          <p className="text-destructive">
            {careerMaterialErrorLabel(r.errorCode)}
            {r.retryable && r.attemptCount < INTAKE_MAX_AUTO_ATTEMPTS
              ? " Vi prøver igjen automatisk."
              : ""}
          </p>
        )}
        {r.status === "needs_type" && !archived && !guide && (
          <p className="text-foreground">
            KI var usikker på hva slags dokument dette er. Velg en type som passer, eller behold
            dokumentet i arkivet. Du trenger ikke velge en type som ikke stemmer.
          </p>
        )}
      </div>

      {r.status === "needs_type" && !archived && guide && (
        <div className="rounded-md border border-dashed p-2 text-xs space-y-1">
          <p className="text-foreground">
            <span className="font-medium">KI-forslag:</span> dette ser ut som{" "}
            <span className="font-medium">{guide.label.toLowerCase()}</span>. Det er ikke en type
            som gir forslag her.
          </p>
          <p className="text-muted-foreground">{guide.explanation}</p>
          {guide.link && (
            <Link to={guide.link.to} className="text-primary underline underline-offset-2">
              {guide.link.label}
            </Link>
          )}
        </div>
      )}

      {r.filePath && (recognized === "cv" || r.status === "needs_type") && !archived && (
        <CvImportAction intakeId={r.id} highlighted={recognized === "cv"} />
      )}

      {(r.status === "needs_type" || r.status === "failed") && !archived && (
        <div className="space-y-1.5">
          <Label htmlFor={`note-${r.id}`} className="text-xs">
            Egen beskrivelse (valgfritt, f.eks. «Annet: lønnsslipp 2024»)
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`note-${r.id}`}
              value={note}
              maxLength={USER_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className="h-8 max-w-sm text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={archiving}
              onClick={() => onArchive(true, note.trim() || undefined)}
            >
              {archiving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Behold i arkivet
            </Button>
          </div>
        </div>
      )}

      {archived && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-xs">
          <p className="text-muted-foreground">
            Bare arkivert — krever ingen handling.
            {r.userNote ? ` Beskrivelse: ${r.userNote}` : ""} Du kan når som helst velge type og
            behandle den videre.
          </p>
          <Button size="sm" variant="ghost" disabled={archiving} onClick={() => onArchive(false)}>
            Angre arkivering
          </Button>
        </div>
      )}
      {r.approved.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
          <p className="font-medium text-foreground">
            Godkjent fra denne kilden ({r.approved.length})
          </p>
          <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
            {r.approved.slice(0, 6).map((a) => (
              <li key={a.atomId}>
                {a.content || "Uten tekst"}
                {a.active ? "" : " (fjernet fra profilen)"}
              </li>
            ))}
            {r.approved.length > 6 && <li>… og {r.approved.length - 6} til</li>}
          </ul>
          <p className="text-muted-foreground">
            Godkjente elementer blir liggende i profilen selv om du endrer dokumenttype.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {(r.status === "needs_type" || r.status === "completed" || r.status === "failed") && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`t-${r.id}`} className="text-xs">
                {r.status === "needs_type" ? "Velg dokumenttype" : "Endre dokumenttype"}
              </Label>
              <select
                id={`t-${r.id}`}
                className={`h-8 w-48 ${SELECT_BASE}`}
                value={typeChoice}
                onChange={(e) => setTypeChoice(e.target.value)}
              >
                <option value="">Velg …</option>
                {CAREER_MATERIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CAREER_MATERIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                processing ||
                !chosenType ||
                (typeChoice === r.effectiveType && r.status !== "needs_type")
              }
              onClick={applyType}
            >
              Bruk og analyser
            </Button>
          </div>
        )}
        {(r.status === "completed" || r.status === "failed" || r.status === "queued") && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || processing}
            onClick={() => onProcess(r.status !== "queued")}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {r.status === "failed"
              ? "Prøv igjen"
              : r.status === "queued"
                ? "Analyser nå"
                : "Analyser på nytt"}
          </Button>
        )}
        {r.pendingProposals > 0 && (
          <Button asChild size="sm">
            <Link to="/forslag/ai">Gå til forslag</Link>
          </Button>
        )}
        {r.filePath && (
          <Button size="sm" variant="ghost" onClick={() => void openStoredFile(r.filePath!)}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Original
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={deleting || processing}
          onClick={() => {
            setRemoveAtoms(false);
            setConfirmDelete(true);
          }}
        >
          {deleting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Slett
        </Button>
      </div>

      <AlertDialog open={confirmType} onOpenChange={setConfirmType}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Endre dokumenttype til {typeLabel(chosenType)}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {activeApproved.length > 0 && (
                  <p>
                    {activeApproved.length} elementer du allerede har godkjent fra denne kilden blir
                    liggende i profilen og vises fortsatt her. Typeendringen gjelder bare nye
                    forslag.
                  </p>
                )}
                {r.pendingProposals > 0 && (
                  <p>{r.pendingProposals} forslag som venter på deg erstattes av en ny analyse.</p>
                )}
                {!chosenGivesSkills && (
                  <p>
                    {typeLabel(chosenType)} regnes ikke som bevis på din egen kompetanse, så den nye
                    analysen gir bare hint — ikke nye kompetanser.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (chosenType) onSetType(chosenType);
              }}
            >
              Endre og analyser
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette «{r.title}»?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Originalen, analysen og alle forslag fra denne kilden slettes
                  {r.filePath ? ", sammen med originalfilen" : ""}. Dette kan ikke angres.
                </p>
                {activeApproved.length > 0 ? (
                  <p>
                    {activeApproved.length} elementer i profilen din er godkjent fra denne kilden.
                    De beholdes som standard, men mister koblingen til originalen.
                  </p>
                ) : (
                  <p>Ingen elementer i profilen din bygger på denne kilden.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {activeApproved.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={removeAtoms}
                onCheckedChange={(v) => setRemoveAtoms(v === true)}
                className="mt-0.5"
              />
              <span>Fjern også de {activeApproved.length} godkjente elementene fra profilen</span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(removeAtoms)}
            >
              Slett kilden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
