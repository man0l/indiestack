import { esc, liveStatus } from "../ui";
import type { DeployTarget } from "./index";

export function adminDeploys(
  targets: DeployTarget[],
  github: { connected: boolean; who: string | null },
  vercel: { connected: boolean; who: string | null },
): string {
  const list =
    targets.length === 0
      ? `<p class="sub">Nothing connected. Connect GitHub or Vercel, then watch its production deployments.</p>`
      : targets
          .map((t) => {
            const what = t.provider === "github" ? t.repo : `${t.project}${t.team ? ` @ ${t.team}` : ""}`;
            const dot = liveStatus(t.enabled, t.status, t.mute_until);
            const extra = [t.last_detail ?? "", t.last_error ?? ""].filter(Boolean).join(" · ");
            return `<div class="row">
              <div class="dot ${esc(dot)}"></div>
              <div>
                <div class="name">${esc(t.name)} · ${esc(t.provider)} · every ${t.interval_min}m${t.enabled ? "" : " · paused"}</div>
                <div class="url">${esc(what ?? "")}${extra ? ` · ${esc(extra)}` : ""}</div>
              </div>
              <div class="actions">
                <form method="post" action="/admin/deploys/targets/${esc(t.id)}/toggle">
                  <button class="ghost" type="submit">${t.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/deploys/targets/${esc(t.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  const connect = (
    id: string,
    label: string,
    createUrl: string,
    createLabel: string,
    state: { connected: boolean; who: string | null },
    note?: string,
  ) =>
    state.connected
      ? `<form class="card" method="post" action="/admin/deploys/${id}/disconnect">
           <label>${esc(label)} — connected${state.who ? ` as <b>${esc(state.who)}</b>` : ""}</label>
           <button class="danger" type="submit">disconnect</button>
         </form>`
      : `<form class="card" method="post" action="/admin/deploys/${id}/connect">
           <label>${esc(label)} token — <a href="${esc(createUrl)}" target="_blank" rel="noopener">${esc(createLabel)} ↗</a>
             <input type="password" name="token" placeholder="${id === "github" ? "github_pat_… (fine-grained)" : "paste token"}" required/>
           </label>
           <button type="submit">connect ${esc(label)}</button>
           ${note ? `<p class="sub" style="margin:10px 0 0">${note}</p>` : ""}
         </form>`;

  const githubTokenUrl =
    "https://github.com/settings/personal-access-tokens/new" +
    "?name=IndieStack%20deploys" +
    "&description=Read-only%20deployment%20status%20for%20IndieStack" +
    "&permissions%5Bdeployments%5D=read" +
    "&expiration=none";
  const vercelTokenUrl = "https://vercel.com/account/tokens";

  const addGithub = github.connected
    ? `<form class="card" method="post" action="/admin/deploys/targets">
        <input type="hidden" name="provider" value="github"/>
        <label>repo (owner/repo)
          <input type="text" name="repo" placeholder="man0l/indiestack" required/>
        </label>
        <label>name (optional)
          <input type="text" name="name" maxlength="40" placeholder="api deploys"/>
        </label>
        <label>interval minutes
          <input type="number" name="interval_min" min="5" max="60" value="5"/>
        </label>
        <label>still-down nag minutes (0 = off)
          <input type="number" name="nag_min" min="0" max="1440" value="0"/>
        </label>
        <button type="submit">watch github deploys</button>
      </form>`
    : "";

  const addVercel = vercel.connected
    ? `<form class="card" method="post" action="/admin/deploys/targets">
        <input type="hidden" name="provider" value="vercel"/>
        <label>project id (or name)
          <input type="text" name="project" placeholder="prj_…" required/>
        </label>
        <label>team id (optional, for team projects)
          <input type="text" name="team" placeholder="team_…"/>
        </label>
        <label>name (optional)
          <input type="text" name="name" maxlength="40" placeholder="site deploys"/>
        </label>
        <label>interval minutes
          <input type="number" name="interval_min" min="5" max="60" value="5"/>
        </label>
        <button type="submit">watch vercel deploys</button>
      </form>`
    : "";

  return `<h2>deploys</h2>
    <div class="list">${list}</div>
    ${connect(
      "github",
      "GitHub",
      githubTokenUrl,
      "create a pre-filled read-only token",
      github,
      "The link pre-selects <b>Deployments: read-only</b> and <b>no expiration</b> — nothing expires, nothing else is granted. Prefer 30/90 days? Change Expiration in the form. Public repos work without any token (just slower); disconnect here revokes instantly.",
    )}
    ${addGithub}
    ${connect(
      "vercel",
      "Vercel",
      vercelTokenUrl,
      "create a token",
      vercel,
      "Vercel has no prefill: in the modal pick Scope → your account or team, and Expiration (no-expiration is fine — revoke here anytime). IndieStack only calls read endpoints.",
    )}
    ${addVercel}`;
}

export function statusDeploys(targets: DeployTarget[]): string {
  if (targets.length === 0) return "";
  const rows = targets
    .map((t) => {
      const dot = liveStatus(t.enabled, t.status, t.mute_until);
      const extra = [t.last_detail ?? "", t.last_error ?? ""].filter(Boolean).join(" · ");
      return `<div class="row">
        <div class="dot ${esc(dot)}"></div>
        <div>
          <div class="name">${esc(t.name)}${t.enabled ? "" : " · paused"}</div>
          <div class="url">${esc(t.provider)} · ${esc(extra || "waiting for first check")}</div>
        </div>
        <div class="meta"><b>${esc(dot)}</b></div>
      </div>`;
    })
    .join("");
  return `<h2>deploys</h2><div class="list">${rows}</div>`;
}
