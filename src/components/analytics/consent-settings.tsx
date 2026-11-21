import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearConsent,
  isAnalyticsHost,
  readConsent,
  withdrawConsent,
  type AnalyticsConsent,
} from "@/lib/analytics";

/** Lar besøkende se og endre samtykket til analyse på personvernsiden. */
export function ConsentSettings() {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setConsent(readConsent());
    setReady(isAnalyticsHost(window.location.hostname));
  }, []);
  if (!ready) return null;
  return (
    <div className="not-prose mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        Ditt valg nå:{" "}
        {consent === "granted" ? "analyse godtatt" : consent === "denied" ? "bare nødvendige" : "ikke valgt"}
        .
      </span>
      {consent === "granted" ? (
        <Button size="sm" variant="outline" onClick={() => withdrawConsent()}>
          Trekk tilbake samtykke
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            clearConsent();
            window.location.reload();
          }}
        >
          Endre valg
        </Button>
      )}
    </div>
  );
}
