/**
 * Build provenance, surfaced in the diagnostics panel (P9.2) so a bug report
 * can name the exact deployment it came from.
 *
 * Vercel populates these automatically. Locally they are absent, which is a
 * valid state — not an error.
 */

export type DeploymentEnv = 'production' | 'preview' | 'development';

export type BuildInfo = {
  readonly env: DeploymentEnv;
  /** Short commit SHA, or null when building outside Vercel. */
  readonly commit: string | null;
};

const DEPLOYMENT_ENVS: readonly string[] = ['production', 'preview', 'development'];

function isDeploymentEnv(value: string | undefined): value is DeploymentEnv {
  return value !== undefined && DEPLOYMENT_ENVS.includes(value);
}

export function getBuildInfo(): BuildInfo {
  const rawEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const rawSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

  return {
    env: isDeploymentEnv(rawEnv) ? rawEnv : 'development',
    commit: rawSha ? rawSha.slice(0, 7) : null,
  };
}

/** Human-readable one-liner for the diagnostics panel footer. */
export function formatBuildInfo(info: BuildInfo): string {
  return info.commit === null ? `${info.env} (local)` : `${info.env} @ ${info.commit}`;
}
