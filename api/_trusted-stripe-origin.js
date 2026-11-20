// Trusted base URLs for Stripe checkout and Stripe Connect onboarding.
//
// Never build a payment or identity-verification redirect from untrusted
// Host / X-Forwarded-Host / X-Forwarded-Proto request headers. A deployment
// without a verified origin must fail closed instead of generating a link
// that sends a customer to an attacker-controlled website.

function verifiedHttpsOrigin(configured) {
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("APP_URL must be a valid absolute website origin.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be an HTTPS origin with no credentials, path, query or fragment.");
  }
  return url.origin;
}

const VERCEL_DEPLOYMENT_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/i;

function verifiedVercelOrigin(host) {
  const candidate = String(host ?? "").trim();
  if (!VERCEL_DEPLOYMENT_HOST.test(candidate)) {
    throw new Error("VERCEL_URL must be a verified *.vercel.app hostname.");
  }
  return `https://${candidate.toLowerCase()}`;
}

function localDevelopmentOrigin(host) {
  const candidate = String(host ?? "").trim().toLowerCase();
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/.exec(candidate);
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) {
    throw new Error("Development requests must use a localhost origin.");
  }
  return `http://${candidate}`;
}

export function trustedStripeReturnOrigin({
  appUrl,
  vercelUrl,
  nodeEnv,
  requestHost,
} = {}) {
  // An explicitly set but malformed APP_URL is a configuration error. Do not
  // silently downgrade to a preview URL or a spoofable request header.
  if (typeof appUrl === "string" && appUrl.trim()) {
    if (nodeEnv === "development" && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(appUrl.trim())) {
      const local = new URL(appUrl.trim());
      return localDevelopmentOrigin(local.host);
    }
    return verifiedHttpsOrigin(appUrl.trim());
  }
  if (vercelUrl != null && String(vercelUrl).trim()) {
    return verifiedVercelOrigin(vercelUrl);
  }
  // Only a local developer can use request headers as a fallback, and only
  // when the Host is strictly localhost. Do NOT accept forwarded headers.
  if (nodeEnv === "development") {
    return localDevelopmentOrigin(requestHost);
  }
  throw new Error("A trusted APP_URL or VERCEL_URL is required for Stripe redirects.");
}
