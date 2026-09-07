<script lang="ts">
  import { onMount } from 'svelte';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import CloudIcon from '@lucide/svelte/icons/cloud';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import Link2Icon from '@lucide/svelte/icons/link-2';
  import Link2OffIcon from '@lucide/svelte/icons/link-2-off';
  import CheckIcon from '@lucide/svelte/icons/check';
  import SearchSelect from './SearchSelect.svelte';
  import ConfirmDelete from './ConfirmDelete.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Alert from '$lib/components/ui/alert';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';

  type Commit = { sha: string; msg: string; ts: number; url: string | null; merge: boolean };

  type Target = {
    id: string;
    provider: 'github' | 'vercel' | 'cloudflare';
    name: string;
    repo: string | null;
    project: string | null;
    team: string | null;
    account: string | null;
    interval_min: number;
    enabled: number;
    status: string;
    last_check_at: number | null;
    last_detail: string | null;
    last_error: string | null;
    site_id: string | null;
    commits: Commit[];
  };

  type Repo = { full_name: string; private: boolean; pushed_at: string };

  let targets: Target[] = $state([]);
  let sites: Array<{ id: string; name: string }> = $state([]);
  let github = $state({ connected: false, who: null as string | null });
  let vercel = $state({ connected: false, who: null as string | null });
  let cloudflare = $state({ connected: false, who: null as string | null });
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd: 'github' | 'vercel' | 'cfworkers' | null = $state(null);

  $effect(() => {
    if (showAdd) {
      requestAnimationFrame(() => {
        document.querySelector('[data-picker]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  });

  // vercel project picker
  let vProjects: Array<{ id: string; name: string }> = $state([]);
  let vSelected = $state('');
  let vTeam = $state('');
  let vLoading = $state(false);
  let vError = $state('');

  async function loadVProjects() {
    vLoading = true;
    vError = '';
    try {
      const qs = vTeam.trim() ? `?team=${encodeURIComponent(vTeam.trim())}` : '';
      const r = await fetch(`/api/vercelprojects${qs}`);
      const j = await r.json().catch(() => ({}));
      vProjects = j.projects ?? [];
      if (!r.ok || j.error) vError = j.error ?? 'failed to list projects';
    } catch (e) {
      vError = String(e);
    } finally {
      vLoading = false;
    }
  }

  $effect(() => {
    if (showAdd === 'vercel' && vercel.connected && vProjects.length === 0 && !vLoading) loadVProjects();
  });

  // cloudflare worker picker (deployments)
  let cfScriptsAll: string[] = $state([]);
  let cfSelectedDeploy: string[] = $state([]);
  let cfDeployFilter = $state('');
  let cfDeployInterval = $state(5);
  let cfAccount = $state('');

  async function loadCfDeployables(fresh = false) {
    try {
      const r = await fetch(`/api/cfworkers${fresh ? '?fresh=1' : ''}`);
      const j = await r.json().catch(() => ({}));
      cfScriptsAll = j.scripts ?? [];
      if (!cfAccount && j.account) cfAccount = j.account;
    } catch {
      cfScriptsAll = [];
    }
  }

  async function watchCfWorkers() {
    busy = 'cfbulk';
    err = '';
    try {
      const r = await fetch('/admin/deploys/targets/cfbulk', {
        method: 'POST',
        body: JSON.stringify({ account: cfAccount, scripts: cfSelectedDeploy, interval_min: cfDeployInterval }),
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else {
        msg = j.msg ?? 'done';
        cfSelectedDeploy = [];
        showAdd = null;
      }
      await load();
    } catch (e) {
      err = String(e);
    } finally {
      busy = '';
    }
  }

  function toggleCfDeploy(name: string) {
    cfSelectedDeploy = cfSelectedDeploy.includes(name)
      ? cfSelectedDeploy.filter((s) => s !== name)
      : [...cfSelectedDeploy, name];
  }

  // github repo picker
  let repos: Repo[] = $state([]);
  let repoFilter = $state('');
  let manualRepo = $state('');
  let interval = $state(5);
  let reposLoading = $state(false);
  let reposError = $state('');
  let selected: string[] = $state([]);

  async function connectCf(form: HTMLFormElement) {
    await api('/admin/deploys/cloudflare/connect', new FormData(form));
    if (cloudflare.connected) await loadCfDeployables();
  }

  $effect(() => {
    if (showAdd === 'github' && github.connected && repos.length === 0 && !reposLoading) loadRepos();
  });

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/deploys');
      if (r.ok) {
        const j = await r.json();
        targets = j.targets ?? [];
        sites = j.sites ?? [];
        github = j.github;
        vercel = j.vercel;
        cloudflare = j.cloudflare ?? cloudflare;
        if (cloudflare.connected) await loadCfDeployables();
      } else err = 'failed to load targets';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function linkSite(id: string, siteId: string) {
    busy = id;
    err = '';
    try {
      const r = await fetch(`/admin/deploys/targets/${id}/site`, {
        method: 'POST',
        body: JSON.stringify({ site_id: siteId || null }),
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else msg = j.msg ?? 'done';
      await load();
    } catch (e) {
      err = String(e);
    } finally {
      busy = '';
    }
  }

  async function loadRepos() {
    reposLoading = true;
    reposError = '';
    try {
      const r = await fetch('/admin/deploys/repos');
      const j = await r.json();
      if (!r.ok || j.error) reposError = j.error ?? 'failed to list repos';
      else repos = j.repos ?? [];
    } catch (e) {
      reposError = String(e);
    }
    reposLoading = false;
  }

  async function api(action: string, body?: FormData | any) {
    busy = action;
    err = '';
    msg = '';
    try {
      const opts: RequestInit =
        body instanceof FormData
          ? { method: 'POST', body, headers: { accept: 'application/json' } }
          : { method: 'POST', body: JSON.stringify(body), headers: { accept: 'application/json', 'content-type': 'application/json' } };
      const r = await fetch(action, opts);
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else msg = j.target?.last_detail ?? j.msg ?? 'done';
      await load();
    } catch (e) {
      err = String(e);
    } finally {
      busy = '';
    }
  }

  function toggleSelect(name: string) {
    selected = selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name];
  }

  function selectAllVisible() {
    const visible = visibleRepos();
    const allSelected = visible.every((r) => selected.includes(r.full_name));
    const names = visible.map((r) => r.full_name);
    selected = allSelected ? selected.filter((s) => !names.includes(s)) : [...new Set([...selected, ...names])];
  }

  function visibleRepos(): Repo[] {
    const f = repoFilter.toLowerCase();
    return f ? repos.filter((r) => r.full_name.toLowerCase().includes(f)) : repos;
  }

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const pushedAgo = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? ago(t) : '';
  };
</script>

{#if msg}
  <Alert.Root class="mb-3 border-success/40 bg-success/10">
    <Alert.Title>Done</Alert.Title>
    <Alert.Description>{msg}</Alert.Description>
  </Alert.Root>
{/if}
{#if err}
  <Alert.Root class="mb-3" variant="destructive">
    <Alert.Title>Something went wrong</Alert.Title>
    <Alert.Description>{err}</Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Content>
  <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <span class="text-xs uppercase tracking-widest text-muted-foreground">watching</span>
    <div class="flex flex-wrap gap-2">
      <Button variant="ghost" onclick={() => load()} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><RefreshCwIcon data-icon="inline-start" /> refresh</span>
      </Button>
      {#if github.connected}
        <Button onclick={() => (showAdd = showAdd === 'github' ? null : 'github')} disabled={busy !== ''}>
          <span class="inline-flex items-center gap-1.5"><PlusIcon data-icon="inline-start" /> add repos</span>
        </Button>
      {/if}
      {#if vercel.connected}
        <Button onclick={() => (showAdd = showAdd === 'vercel' ? null : 'vercel')} disabled={busy !== ''}>
          <span class="inline-flex items-center gap-1.5"><PlusIcon data-icon="inline-start" /> vercel</span>
        </Button>
      {/if}
      {#if cloudflare.connected}
        <Button onclick={() => (showAdd = showAdd === 'cfworkers' ? null : 'cfworkers')} disabled={busy !== ''}>
          <span class="inline-flex items-center gap-1.5"><PlusIcon data-icon="inline-start" /> workers</span>
        </Button>
      {/if}
    </div>
  </div>

  {#if loading}
    <p class="text-sm text-muted-foreground">loading…</p>
  {:else if targets.length === 0}
    <p class="text-sm text-muted-foreground">
      Nothing watched yet. Connect GitHub, Vercel or Cloudflare below, then track main-branch commits or production deploys.
    </p>
  {:else}
    <div class="divide-y divide-border">
      {#each targets as t (t.id)}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-4 py-6">
          {#if t.provider === 'github'}<GitBranchIcon class="shrink-0 self-start text-muted-foreground" />{:else if t.provider === 'cloudflare'}<CloudIcon class="shrink-0 self-start text-muted-foreground" />{:else}<RocketIcon class="shrink-0 self-start text-muted-foreground" />{/if}
          <div class="min-w-0 flex-1 basis-64">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{t.name}</span>
              {#if !t.enabled}<Badge variant="secondary">paused</Badge>{/if}
            </div>
            <div class="mt-0.5 truncate text-xs text-muted-foreground">
              {t.provider === 'github' ? t.repo : t.provider === 'cloudflare' ? t.project : `${t.project}${t.team ? ` @ ${t.team}` : ''}`} · every {t.interval_min}m
              {#if !t.commits?.length && t.last_detail} · {t.last_detail}{/if}
              {#if t.last_error} · <span class="text-destructive">{t.last_error}</span>{/if}
            </div>
          </div>
          <span class="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{ago(t.last_check_at)}</span>
          <Badge class="shrink-0" variant={t.enabled ? (t.status === 'down' ? 'destructive' : t.status === 'up' ? 'success' : 'outline') : 'secondary'}>{t.enabled ? (t.status === 'unknown' ? 'idle' : t.status) : 'paused'}</Badge>
          <div class="ml-auto flex shrink-0 gap-1">
            <Button variant="ghost" size="icon"
              title="check now" disabled={busy !== ''} onclick={() => api(`/admin/deploys/targets/${t.id}/check`)}>
              <ZapIcon />
            </Button>
            <Button variant="ghost" size="icon"
              title={t.enabled ? 'pause' : 'resume'} disabled={busy !== ''} onclick={() => api(`/admin/deploys/targets/${t.id}/toggle`)}>
              {#if t.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
            </Button>
            <ConfirmDelete
              title="Stop watching?"
              description={`Remove ${t.name} from deploy tracking.`}
              disabled={busy !== ''}
              onConfirm={() => api(`/admin/deploys/targets/${t.id}/delete`)}
            />
          </div>
          {#if t.commits?.length}
            <div class="flex min-w-full flex-col gap-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              {#each t.commits as c (c.sha + c.msg)}
                <div class="truncate font-mono text-xs text-muted-foreground">
                  {#if c.url}<a class="text-primary underline" href={c.url} target="_blank" rel="noopener">{c.sha}</a>{:else}<span class="text-foreground">{c.sha}</span>{/if}
                  {c.merge ? ' · merge' : ''} · {c.msg}
                </div>
              {/each}
            </div>
          {/if}
          {#if sites.length}
            <div class="flex min-w-full items-center gap-2">
              <label for={`site-${t.id}`} class="shrink-0 text-xs text-muted-foreground">chart site</label>
              <select
                id={`site-${t.id}`}
                class="w-auto max-w-56 truncate rounded-md border border-border bg-background px-1.5 py-1 text-xs"
                value={t.site_id ?? ''}
                disabled={busy !== ''}
                onchange={(e) => linkSite(t.id, (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">none</option>
                {#each sites as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
              </select>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  </Card.Content>
</Card.Root>

{#if showAdd === 'cfworkers' && cloudflare.connected}
  <Card.Root data-picker class="scroll-mt-24">
  <Card.Content>
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-semibold text-foreground"><CloudIcon size={15} /> pick workers to watch</div>
      <Button variant="ghost" onclick={() => loadCfDeployables(true)} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><RefreshCwIcon data-icon="inline-start" /> reload list</span>
      </Button>
    </div>
    <Input bind:value={cfDeployFilter} placeholder="filter…" class="mb-2 w-full" />
    {#if cfScriptsAll.length === 0}
      <p class="text-sm text-muted-foreground">No workers visible for this token.</p>
    {:else}
      {@const visibleCf = cfDeployFilter.trim() ? cfScriptsAll.filter((s) => s.toLowerCase().includes(cfDeployFilter.trim().toLowerCase())) : cfScriptsAll}
      <div class="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {#each visibleCf as name (name)}
          <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
            onclick={() => toggleCfDeploy(name)}>
            <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border {cfSelectedDeploy.includes(name) ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}">
              {#if cfSelectedDeploy.includes(name)}<CheckIcon />{/if}
            </span>
            <span class="flex-1 truncate font-mono text-xs">{name}</span>
          </button>
        {/each}
      </div>
    {/if}
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <label class="text-xs text-muted-foreground">interval
        <Input type="number" bind:value={cfDeployInterval} min="5" max="60" class="ml-1 w-20" />
      </label>
      <Button disabled={busy !== '' || cfSelectedDeploy.length === 0} onclick={watchCfWorkers}>
        watch {cfSelectedDeploy.length} worker(s)
      </Button>
      <span class="text-xs text-muted-foreground">{cfScriptsAll.length} workers found · picks probe immediately</span>
    </div>
  </Card.Content>
</Card.Root>
{/if}

{#if showAdd === 'github' && github.connected}  <Card.Root data-picker class="scroll-mt-24">
  <Card.Content>
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-semibold text-foreground"><GitBranchIcon size={15} /> pick repos to watch</div>
      <Button variant="ghost" onclick={loadRepos} disabled={reposLoading}>
        <span class="inline-flex items-center gap-1.5"><RefreshCwIcon data-icon="inline-start" /> reload list</span>
      </Button>
    </div>

    {#if reposLoading}
      <p class="text-sm text-muted-foreground">loading your repos…</p>
    {:else if reposError}
      <p class="mb-3 text-sm text-destructive">{reposError}</p>
      <label class="text-xs text-muted-foreground">or add one manually (owner/repo)
        <Input bind:value={manualRepo} placeholder="man0l/indiestack" class="mt-1 w-full" />
      </label>
    {:else if repos.length === 0}
      <p class="text-sm text-muted-foreground">No repos visible for this token.</p>
    {:else}
      <Input bind:value={repoFilter} placeholder="filter…" class="mb-2 w-full" />
      <div class="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {#each visibleRepos() as r (r.full_name)}
          <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
            onclick={() => toggleSelect(r.full_name)}>
            <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border {selected.includes(r.full_name) ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}">
              {#if selected.includes(r.full_name)}<CheckIcon />{/if}
            </span>
            <span class="flex-1 truncate text-sm font-medium text-foreground">{r.full_name}</span>
            {#if r.private}<Badge variant="secondary">private</Badge>{/if}
            <span class="text-xs tabular-nums text-muted-foreground">{pushedAgo(r.pushed_at)}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <label class="text-xs text-muted-foreground">interval
        <Input type="number" bind:value={interval} min="5" max="60" class="ml-1 w-20" />
      </label>
      <Button
        disabled={busy !== '' || (selected.length === 0 && !manualRepo)}
        onclick={() => {
          const list = manualRepo ? [...new Set([...selected, manualRepo])] : selected;
          api('/admin/deploys/targets/bulk', { repos: list, interval_min: interval }).then(() => {
            selected = [];
            manualRepo = '';
            showAdd = null;
          });
        }}
      >
        watch {selected.length + (manualRepo ? 1 : 0)} repo(s)
      </Button>
      <span class="text-xs text-muted-foreground">{repos.length} repos found · picks probe immediately</span>
    </div>
  </Card.Content>
</Card.Root>
{/if}

{#if showAdd === 'vercel' && vercel.connected}
  <Card.Root data-picker class="scroll-mt-24">
  <Card.Content>
    <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><RocketIcon size={15} /> watch a Vercel project</div>
    <form class="space-y-3" onsubmit={(e) => { e.preventDefault();
      if (!vSelected) { err = 'pick a project first'; return; }
      const fd = new FormData(e.currentTarget as HTMLFormElement);
      fd.set('provider', 'vercel');
      fd.set('project', vSelected);
      api('/admin/deploys/targets', fd).then(() => { showAdd = null; vSelected = ''; });
    }}>
      <input type="hidden" name="team" value={vTeam} />
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <div class="mb-1 text-xs text-muted-foreground">team id (optional — reloads list)</div>
          <div class="flex gap-2">
            <Input bind:value={vTeam} placeholder="team_…" class="flex-1" aria-label="vercel team id" />
            <Button type="button" variant="ghost" onclick={() => loadVProjects()} disabled={vLoading}>
              <RefreshCwIcon data-icon="inline-start" /> list
            </Button>
          </div>
        </div>
        <div>
          <div class="mb-1 text-xs text-muted-foreground">project</div>
          {#if vLoading}
            <p class="text-xs text-muted-foreground">loading projects…</p>
          {:else}
            <SearchSelect
              items={vProjects.map((p) => ({ value: p.id, label: p.name }))}
              value={vSelected}
              placeholder={vProjects.length ? 'Pick a project…' : 'No projects — check team id'}
              emptyText="No matching project."
              ariaLabel="vercel project"
              onSelect={(v) => (vSelected = v)}
            />
          {/if}
          {#if vError}<p class="mt-1 text-xs text-destructive">{vError}</p>{/if}
        </div>
      </div>
      <Button type="submit" disabled={busy !== '' || !vSelected}>watch deploys</Button>
    </form>
  </Card.Content>
</Card.Root>
{/if}

<Card.Root class="mt-4">
  <Card.Content>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  <div class="rounded-xl border border-border bg-card p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold"><GitBranchIcon /> GitHub</div>
    {#if github.connected}
      <p class="mb-3 text-xs text-muted-foreground">connected{github.who ? ` as ${github.who}` : ''}</p>
      <Button variant="ghost" onclick={() => api('/admin/deploys/github/disconnect')} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Link2OffIcon data-icon="inline-start" /> disconnect</span>
      </Button>
    {:else}
      <p class="mb-3 text-xs text-muted-foreground">
        <a class="text-primary underline" target="_blank" rel="noopener"
          href="https://github.com/settings/personal-access-tokens/new?name=IndieStack%20deploys&description=Read-only%20commit%20and%20Actions-log%20tracking%20for%20IndieStack&contents=read&actions=read&expires_in=none">create a pre-filled read-only token ↗</a>
        — Contents: read-only + Actions: read-only, no expiration. Public repos work without a token (rate-shared).
      </p>
      <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(e) => { e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/github/connect', fd);
      }}>
        <Input name="token" type="password" placeholder="github_pat_…" required class="flex-1" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2Icon data-icon="inline-start" /> connect</span></Button>
      </form>
    {/if}
  </div>

  <div class="rounded-xl border border-border bg-card p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold"><RocketIcon /> Vercel</div>
    {#if vercel.connected}
      <p class="mb-3 text-xs text-muted-foreground">connected{vercel.who ? ` as ${vercel.who}` : ''}</p>
      <Button variant="ghost" onclick={() => api('/admin/deploys/vercel/disconnect')} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Link2OffIcon data-icon="inline-start" /> disconnect</span>
      </Button>
    {:else}
      <p class="mb-3 text-xs text-muted-foreground">
        <a class="text-primary underline" target="_blank" rel="noopener" href="https://vercel.com/account/tokens">create a token ↗</a>
        — no prefill on Vercel: scope to your account or team. IndieStack only calls read endpoints.
      </p>
      <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(e) => { e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/vercel/connect', fd);
      }}>
        <Input name="token" type="password" placeholder="paste token" required class="flex-1" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2Icon data-icon="inline-start" /> connect</span></Button>
      </form>
    {/if}
  </div>

  <div class="rounded-xl border border-border bg-card p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold"><CloudIcon /> Cloudflare</div>
    {#if cloudflare.connected}
      <p class="mb-3 text-xs text-muted-foreground">connected{cloudflare.who ? ` · ${cloudflare.who}` : ''} · pick workers for logs on the <a class="text-primary underline" href="/admin/p/explorer">logs page</a></p>
      <Button variant="ghost" onclick={() => api('/admin/deploys/cloudflare/disconnect')} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Link2OffIcon data-icon="inline-start" /> disconnect</span>
      </Button>
    {:else}
      <p class="mb-3 text-xs text-muted-foreground">
        <a class="text-primary underline" target="_blank" rel="noopener"
          href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_observability%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=IndieStack%20workers">create a pre-filled token ↗</a>
        — Workers Scripts: read-only + Workers Observability (log queries need the write grant), all accounts. Pick workers below to watch deployments, and on the logs page for logs. IndieStack only reads the worker list, versions and recent logs.
      </p>
      <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(e) => { e.preventDefault();
        connectCf(e.currentTarget as HTMLFormElement);
      }}>
        <Input name="token" type="password" placeholder="paste token" required class="flex-1" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2Icon data-icon="inline-start" /> connect</span></Button>
      </form>
    {/if}
  </div>
</div>
  </Card.Content>
</Card.Root>
