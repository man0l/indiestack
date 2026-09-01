import { isMuted, type Job } from "../kernel/types";
import { ago, esc, ghostLink, liveStatus, muteValue, page } from "../ui";

export function adminJobs(jobs: Job[], origin: string): string {
  const jobList =
    jobs.length === 0
      ? `<p class="sub">No heartbeats. Your job should POST the URL we give you.</p>`
      : jobs
          .map((j) => {
            const beat = `${origin}/beat/${j.token}`;
            const muted = isMuted(j.enabled, j.mute_until);
            return `<div class="row">
              <div class="dot ${esc(liveStatus(j.enabled, j.status, j.mute_until))}"></div>
              <div>
                <div class="name">${esc(j.name)} · every ${j.interval_min}m + ${j.grace_min}m grace${muted ? " · paused" : ""}</div>
                <div class="url">curl -fsS -X POST ${esc(beat)}</div>
                <div class="url">last beat ${esc(ago(j.last_beat_at))}${j.last_error ? ` · ${esc(j.last_error)}` : ""}</div>
              </div>
              <div class="actions">
                ${ghostLink(`/admin/jobs/${j.id}`, "edit")}
                <form method="post" action="/admin/jobs/${esc(j.id)}/toggle">
                  <button class="ghost" type="submit">${j.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/jobs/${esc(j.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  return `<h2>cron monitor</h2>
    <div class="list">${jobList}</div>
    <form class="card" method="post" action="/admin/jobs">
      <label>name
        <input type="text" name="name" maxlength="40" placeholder="nightly-backup" required/>
      </label>
      <label>expect a beat every (minutes)
        <input type="number" name="interval_min" min="1" max="1440" value="60"/>
      </label>
      <label>grace minutes
        <input type="number" name="grace_min" min="0" max="120" value="2"/>
      </label>
      <button type="submit">add heartbeat</button>
    </form>`;
}

export function statusJobs(jobs: Job[]): string {
  if (jobs.length === 0) return "";
  return `<h2>cron</h2><div class="list">${jobs
    .map((j) => {
      const muted = isMuted(j.enabled, j.mute_until);
      const dot = liveStatus(j.enabled, j.status, j.mute_until);
      return `<div class="row">
              <div class="dot ${esc(dot)}"></div>
              <div>
                <div class="name">${esc(j.name)}${muted ? " · paused" : ""}</div>
                <div class="url">heartbeat every ${j.interval_min}m · grace ${j.grace_min}m</div>
              </div>
              <div class="meta"><b>last beat</b><br/>${esc(ago(j.last_beat_at))}</div>
            </div>`;
    })
    .join("")}</div>`;
}

export function editJobPage(title: string, j: Job, origin: string): string {
  const beat = `${origin}/beat/${j.token}`;
  return page(
    `edit · ${j.name}`,
    `<header>
      <div class="brand">${esc(title)} <span>edit</span></div>
      <a href="/admin">back</a>
    </header>
    <p class="url">${esc(beat)}</p>
    <form class="card" method="post" action="/admin/jobs/${esc(j.id)}">
      <label>name
        <input type="text" name="name" maxlength="40" value="${esc(j.name)}" required/>
      </label>
      <label>expect a beat every (minutes)
        <input type="number" name="interval_min" min="1" max="1440" value="${j.interval_min}"/>
      </label>
      <label>grace minutes
        <input type="number" name="grace_min" min="0" max="120" value="${j.grace_min}"/>
      </label>
      <label>still-down nag minutes (0 = off)
        <input type="number" name="nag_min" min="0" max="1440" value="${j.nag_min ?? 0}"/>
      </label>
      <label>mute until UTC
        <input type="datetime-local" name="mute_until" value="${esc(muteValue(j.mute_until))}"/>
      </label>
      <div class="actions">
        <button type="submit">save</button>
        <a href="/admin">cancel</a>
      </div>
    </form>`,
  );
}
