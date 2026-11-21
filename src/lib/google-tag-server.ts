import { gtmHeadSnippet, injectAfterHead, isAnalyticsHost } from "./analytics";

// Google-taggen settes inn rett etter <head> på karrierenmin.no, slik Google
// krever. Strømmen bufres bare til <head> er funnet; resten sendes uendret.
export function streamInjectAfterHead(
  body: ReadableStream<Uint8Array>,
  snippet: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  let done = false;
  const MAX_BUFFER = 64 * 1024;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (done) {
          controller.enqueue(chunk);
          return;
        }
        buffered += decoder.decode(chunk, { stream: true });
        const injected = injectAfterHead(buffered, snippet);
        if (injected !== buffered || buffered.length > MAX_BUFFER) {
          controller.enqueue(encoder.encode(injected));
          buffered = "";
          done = true;
        }
      },
      flush(controller) {
        if (!done) {
          buffered += decoder.decode();
          controller.enqueue(encoder.encode(injectAfterHead(buffered, snippet)));
        }
      },
    }),
  );
}

export function withGoogleTag(response: Response, request: Request): Response {
  const url = new URL(request.url);
  if (!isAnalyticsHost(url.hostname) || url.pathname.startsWith("/api/")) return response;
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  if (response.headers.get("content-encoding") || !response.body) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(streamInjectAfterHead(response.body, gtmHeadSnippet()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
