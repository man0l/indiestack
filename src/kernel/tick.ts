import { PLUGINS } from "./catalog";
import { runPluginTicks } from "./plugin";
import { maybePrune, maybeRollup } from "./rollup";

export async function runTick(
  env: Env,
): Promise<{ checked: number; jobs: number; alerts: number }> {
  const t0 = Date.now();
  const now = Date.now();
  const stats = await runPluginTicks(PLUGINS, env, now);
  await maybeRollup(env, now);
  await maybePrune(env, now);
  const checked = stats.checked ?? 0;
  const jobs = stats.jobs ?? 0;
  const alerts = stats.alerts ?? 0;
  console.log(
    JSON.stringify({
      msg: "tick",
      checked,
      jobs,
      alerts,
      ms: Date.now() - t0,
    }),
  );
  return { checked, jobs, alerts };
}
