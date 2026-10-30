import { pathToFileURL } from "node:url";

export const QA_PROJECT = "heqxirlsorcztsawaldg";
export const QA_PREVIEW = "https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app";

export function validateWorkerEnvironment(env) {
  if (env.VERCEL_ENV !== "preview"
      || env.VERCEL_PROJECT_ID !== "prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC"
      || env.VERCEL_GIT_COMMIT_REF !== "qa/recovery-preflight-oct27"
      || env.SUPABASE_URL !== `https://${QA_PROJECT}.supabase.co`
      || env.APP_URL?.replace(/\/$/, "") !== QA_PREVIEW
      || !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || "")) {
    throw new Error("QA worker isolation guard refused this environment");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_ANON_KEY || !env.CRON_SECRET
      || env.CRON_SECRET.length < 16 || env.CRON_SECRET.length > 512) {
    throw new Error("QA worker credentials are not configured");
  }
}

export async function configureWorkers(env, request = fetch) {
  validateWorkerEnvironment(env);
  let response;
  try {
    // pg_net is a managed schema. Refuse to queue privileged HTTP headers
    // unless PostgREST explicitly confirms it is outside the exposed API schemas.
    const exposure = await request(`https://${QA_PROJECT}.supabase.co/rest/v1/http_request_queue?select=id&limit=0`, {
      headers: {apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Accept-Profile": "net"},
      signal: AbortSignal.timeout(20000),
    });
    const denial = await exposure.json();
    if (exposure.status !== 406 || denial.code !== "PGRST106") throw new Error("Network schema must remain private");
    response = await request(`https://${QA_PROJECT}.supabase.co/rest/v1/rpc/configure_qa_recovery_preview_workers`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({p_cron_secret: env.CRON_SECRET}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Request failed");
    const result = await response.json();
    if (result.configured !== true || result.workers !== 2) throw new Error("Unexpected response");
  } catch {
    // Never print API response bodies, headers, credentials or network errors.
    throw new Error("QA worker configuration failed");
  }
  return {configured: true, workers: 2};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.info("QA Preview workers configured", JSON.stringify(await configureWorkers(process.env)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
