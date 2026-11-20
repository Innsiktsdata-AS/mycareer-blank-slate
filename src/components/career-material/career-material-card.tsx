// Karrieremateriale på /kilder: lim inn tekst, egen e-postadresse og status
// for analyse. Originalen lagres alltid først; forslag havner i
// godkjenningskøen og endrer ingenting i profilen før du godkjenner.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, FileText, Loader2, Mail, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  CAREER_MATERIAL_STATUS_LABELS,
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
  getCareerNotesAddress,
  processCareerMaterial,
  setCareerMaterialType,
  submitCareerMaterialPaste,
} from "@/lib/career-material/career-material.functions";
import {
  careerMaterialEmailFailuresQuery,
  careerMaterialIntakesQuery,
  careerMaterialKeys,
  type CareerMaterialIntakeView,
} from "@/lib/queries/career-material";
import { fmtDateTime } from "@/lib/format";

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
  const getAddressFn = useServerFn(getCareerNotesAddress);
  const createAddressFn = useServerFn(createCareerNotesAddress);

  const intakesQ = useQuery(careerMaterialIntakesQuery(uid));
  const failuresQ = useQuery(careerMaterialEmailFailuresQuery(uid));
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

  const createAddressM = useMutation({
    mutationFn: () => createAddressFn(),
    onSuccess: (res) => {
      if (!res.ok) toast.error("Kunne ikke opprette adressen.");
      void qc.invalidateQueries({ queryKey: ["career-notes-address", uid] });
    },
  });

  // E-post og typeendringer legger inntak i kø. De analyseres når du åpner
  // siden — ett om gangen, og hvert inntak bare én gang per besøk.
  const autoStarted = useRef(new Set<string>());
  useEffect(() => {
    if (processM.isPending) return;
    const next = (intakesQ.data ?? []).find(
      (r) => r.status === "queued" && !r.documentDeleted && !autoStarted.current.has(r.id),
    );
    if (!next) return;
    autoStarted.current.add(next.id);
    processM.mutate({ intakeId: next.id, force: false });
  }, [intakesQ.data, processM.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    {inboundRejectLabel(f.rejectReason)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
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
                    onProcess={(force) => processM.mutate({ intakeId: r.id, force })}
                    onSetType={(type) => setTypeM.mutate({ intakeId: r.id, type })}
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
            Videresend referater og notater til din private adresse. Bare teksten i e-posten
            analyseres — vedlegg lagres ikke og behandles ikke ennå.
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

function IntakeRow(props: {
  r: CareerMaterialIntakeView;
  busy: boolean;
  onProcess: (force: boolean) => void;
  onSetType: (type: CareerMaterialType) => void;
}) {
  const { r, busy, onProcess, onSetType } = props;
  const [typeChoice, setTypeChoice] = useState<string>(r.effectiveType ?? r.aiType ?? "");
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
            {r.channel === "email" ? "Mottatt på e-post" : "Limt inn"} · {fmtDateTime(r.createdAt)}
            {r.documentDeleted ? " · slettet fra arkivet" : ""}
          </p>
        </div>
        <Badge variant={statusVariant} className="shrink-0">
          {processing && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
          {
            CAREER_MATERIAL_STATUS_LABELS[
              processing ? "processing" : r.status === "processing" ? "queued" : r.status
            ]
          }
        </Badge>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
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
        {r.truncated && <p>E-posten var svært lang. Bare starten er lagret og analysert.</p>}
        {r.attachments.length > 0 && (
          <p>
            Vedlegg ikke behandlet:{" "}
            {r.attachments.map((a) => a.filename ?? a.content_type ?? "ukjent fil").join(", ")}
          </p>
        )}
        {r.status === "failed" && (
          <p className="text-destructive">{careerMaterialErrorLabel(r.errorCode)}</p>
        )}
        {r.status === "needs_type" && (
          <p className="text-foreground">
            KI var usikker på hva slags dokument dette er. Velg type, så lager vi forslag.
          </p>
        )}
      </div>

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
                !isCareerMaterialType(typeChoice) ||
                (typeChoice === r.effectiveType && r.status !== "needs_type")
              }
              onClick={() => isCareerMaterialType(typeChoice) && onSetType(typeChoice)}
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
      </div>
    </li>
  );
}
