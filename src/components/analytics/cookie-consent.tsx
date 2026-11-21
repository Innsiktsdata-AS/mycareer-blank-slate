import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { applyConsent, isAnalyticsHost, readConsent, writeConsent } from "@/lib/analytics";

/**
 * Samtykke til analyse-informasjonskapsler på karrierenmin.no.
 * Google-taggen står i <head>, men analyse-lagring slås først på etter «Godta».
 * Vises ikke i forhåndsvisning eller lokalt.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAnalyticsHost(window.location.hostname)) return;
    if (readConsent() === null) setOpen(true);
  }, []);

  if (!open) return null;

  const choose = (consent: "granted" | "denied") => {
    writeConsent(consent);
    applyConsent(consent);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Informasjonskapsler"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Vi bruker nødvendige informasjonskapsler for innlogging. Med ditt samtykke bruker vi også
          Google Analytics for å forstå hvordan nettsiden brukes.{" "}
          <Link to="/personvern" className="text-primary underline underline-offset-2">
            Les mer
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => choose("denied")}>
            Bare nødvendige
          </Button>
          <Button size="sm" onClick={() => choose("granted")}>
            Godta analyse
          </Button>
        </div>
      </div>
    </div>
  );
}
