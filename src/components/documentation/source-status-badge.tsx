import { Link } from "@tanstack/react-router";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/lib/career-facts/source-status";

/** «Dokumentert» med lenke til kilden, eller «Kilde utilgjengelig». */
export function SourceStatusBadge({ status }: { status: SourceStatus | undefined }) {
  if (!status || status.kind === "none") return null;
  if (status.kind === "unavailable") {
    return (
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[11px] font-normal"
        title="Kilden er slettet eller ikke tilgjengelig. Opplysningen er beholdt."
      >
        Kilde utilgjengelig
      </Badge>
    );
  }
  return (
    <Link
      to="/documents/$id"
      params={{ id: status.documentId }}
      title="Kan spores til en kilde du har godkjent. Ikke en uavhengig bekreftelse."
      className={cn(
        badgeVariants({ variant: "secondary" }),
        "h-5 px-1.5 text-[11px] font-normal underline-offset-2 hover:underline",
      )}
    >
      Dokumentert{status.count > 1 ? ` (${status.count})` : ""}
    </Link>
  );
}
