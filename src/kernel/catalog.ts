import { heartbeat } from "../heartbeat/plugin";
import { logs } from "../logs/plugin";
import { ping } from "../ping/plugin";
import { templates } from "../templates/plugin";
import type { Plugin } from "./plugin";

/** Register a plugin here. Kernel mounts its routes, admin slots, and tick. Do not edit ui.ts. */
export const PLUGINS: Plugin[] = [templates, ping, heartbeat, logs];
