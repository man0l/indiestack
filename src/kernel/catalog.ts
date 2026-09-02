import { agents } from "../agents/plugin";
import { aicrawl } from "../aicrawl/plugin";
import { analytics } from "../analytics/plugin";
import { backup } from "../backup/plugin";
import { explorer } from "../explorer/plugin";
import { goals } from "../goals/plugin";
import { heartbeat } from "../heartbeat/plugin";
import { integrations } from "../integrations/plugin";
import { logs } from "../logs/plugin";
import { ping } from "../ping/plugin";
import { revenue } from "../revenue/plugin";
import { share } from "../share/plugin";
import { signals } from "../signals/plugin";
import { templates } from "../templates/plugin";
import { widgets } from "../widgets/plugin";
import type { Plugin } from "./plugin";

/** Register a plugin here. Kernel mounts its routes, admin slots, and tick. Do not edit ui.ts.
 *  explorer hard-depends on logs; widgets/revenue/signals/aicrawl/goals/share depend on
 *  analytics — keep deps earlier in this list (a plugin's `deps` field documents this).
 *  agents exposes /agents.md, /agent/status.json and /mcp/<token> (reads other plugins'
 *  tables directly — keep it after them). */
export const PLUGINS: Plugin[] = [
  templates,
  ping,
  heartbeat,
  integrations,
  logs,
  explorer,
  analytics,
  widgets,
  revenue,
  signals,
  aicrawl,
  goals,
  share,
  agents,
  backup,
];
