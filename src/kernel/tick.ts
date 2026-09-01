import { scanHeartbeats } from "../heartbeat";
import { runPings } from "../ping/probe";
import { getSetting } from "./db";
import { maybePrune, maybeRollup } from "./rollup";

export async function runTick(env: Env): Promise<{ checked: number; jobs: number; alerts: number }> {
  const t0 = Date.now();
  const now = Date.now();
  const webhook = await getSetting(env.DB, "webhook_url");
  const pinged = await runPings(env, now, webhook);
  const hearts = await scanHeartbeats(env, now, webhook);
  await maybeRollup(env, now);
  await maybePrune(env, now);
  const alerts = pinged.alerts + hearts.alerts;
  console.log(
    JSON.stringify({
      msg: "tick",
      checked: pinged.checked,
      jobs: hearts.scanned,
      alerts,
      ms: Date.now() - t0,
    }),
  );
  return { checked: pinged.checked, jobs: hearts.scanned, alerts };
}
