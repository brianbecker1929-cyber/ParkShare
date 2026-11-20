// This review shares an existing TEST custom environment. Its private URL
// setting must never change the accepted review's APP_URL or production.
export function deploymentAppUrl(env) {
  const clockReview = env.VERCEL_ENV === 'preview'
    && env.VERCEL_PROJECT_ID === 'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC'
    && env.VERCEL_GIT_COMMIT_REF === 'fix/bug-005823-clock-change-nov18';
  if (!clockReview) return env.APP_URL;
  if (typeof env.CLOCK_CHANGE_REVIEW_APP_URL !== 'string' || !env.CLOCK_CHANGE_REVIEW_APP_URL.trim()) {
    throw new Error('Clock-change review APP_URL must be configured.');
  }
  return env.CLOCK_CHANGE_REVIEW_APP_URL;
}
