import "server-only";
import crypto from "node:crypto";

// Website-visitor tracking. The snippet is first-party — it runs on the
// customer's own site and reports to us — so there is no third-party cookie and
// no reverse-IP partner involved.
//
// Attribution is the part that matters for outbound: the click-tracking
// redirect appends a visit token to the destination, the snippet stores it, and
// every later page view from that browser is tied to the exact lead who clicked.

export const VISIT_PARAM = "mbn_visit";

/** Addresses are hashed with the app key and never stored raw: knowing a
 *  visitor returned is useful, holding their IP is a liability. */
export function hashIp(ip: string): string {
  if (!ip) return "";
  return crypto
    .createHmac("sha256", process.env.APP_ENCRYPTION_KEY ?? "")
    .update(ip)
    .digest("hex")
    .slice(0, 32);
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || headers.get("x-real-ip") || "";
}

/** Add the visit token to a tracked link's destination, preserving its query. */
export function withVisitToken(url: string, token: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(VISIT_PARAM, token);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function snippetFor(workspaceId: string, appUrl: string): string {
  // Deliberately dependency-free and tiny: customers paste this into a site we
  // do not control, so it must not assume a bundler, fetch polyfill or consent
  // library. Failures are swallowed — analytics must never break a page.
  return `(function(){
  try {
    var KEY = "mbn_visitor", VISIT = "mbn_visit_token";
    var store = window.localStorage;
    var visitor = store.getItem(KEY);
    if (!visitor) {
      visitor = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, function(c){
        return (c ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
      });
      store.setItem(KEY, visitor);
    }
    var params = new URLSearchParams(window.location.search);
    var fromLink = params.get("${VISIT_PARAM}");
    if (fromLink) store.setItem(VISIT, fromLink);
    var body = JSON.stringify({
      workspaceId: ${JSON.stringify(workspaceId)},
      visitorId: visitor,
      visitToken: store.getItem(VISIT) || "",
      url: window.location.href,
      referrer: document.referrer || ""
    });
    var endpoint = ${JSON.stringify(`${appUrl}/api/visitors/collect`)};
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    }
  } catch (e) {}
})();`;
}
