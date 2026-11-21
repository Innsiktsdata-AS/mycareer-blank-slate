import { describe, expect, it } from "vitest";
import { withGoogleTag } from "@/lib/google-tag-server";

function chunkedHtml(parts: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "content-length": "999" } });
}

const PAGE = ['<!DOCTYPE html><html lang="nb"><he', 'ad><meta charset="utf-8"><title>K</title></head>', "<body>hei</body></html>"];

describe("Google-taggen i sidehodet", () => {
  it("settes inn rett etter <head> på karrierenmin.no, også når <head> er delt mellom biter", async () => {
    const res = withGoogleTag(chunkedHtml(PAGE), new Request("https://karrierenmin.no/"));
    const html = await res.text();
    expect(html.startsWith('<!DOCTYPE html><html lang="nb"><head><script>')).toBe(true);
    expect(html.match(/gtm\.js\?id=GTM-M47S7FVV/g)?.length).toBe(1);
    expect(html.endsWith("<body>hei</body></html>")).toBe(true);
    expect(res.headers.get("content-length")).toBeNull();
  });
  it("settes også inn på www.karrierenmin.no", async () => {
    const html = await withGoogleTag(chunkedHtml(PAGE), new Request("https://www.karrierenmin.no/personvern")).text();
    expect(html).toContain("GTM-M47S7FVV");
  });
  it("settes ikke inn i forhåndsvisning, på lovable.app eller på /api", async () => {
    for (const url of ["http://localhost:8080/", "https://karrierenmin.lovable.app/", "https://karrierenmin.no/api/public/x"]) {
      const html = await withGoogleTag(chunkedHtml(PAGE), new Request(url)).text();
      expect(html).not.toContain("GTM-M47S7FVV");
    }
  });
});
