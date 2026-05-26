/**
 * Cloudflare Pages middleware — adiciona/reforça headers de segurança no runtime.
 * _headers (estático) já cobre 95% dos casos; este middleware é cinto+suspensório
 * pra garantir headers em respostas dinâmicas (404, _redirects, etc).
 *
 * Lição reference_netlify_free_security_headers: CSP/HSTS/X-Frame/Permissions-Policy
 * tudo funciona no plano free.
 */
export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();

  const headers = new Headers(response.headers);

  // Hardening — força mesmo se _headers falhar.
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );

  // Header customizado pra debug/auditoria do build.
  const commitSha = (context.env as any)?.CF_PAGES_COMMIT_SHA ?? "dev";
  headers.set("X-Flowtype-Build", String(commitSha).slice(0, 8));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
