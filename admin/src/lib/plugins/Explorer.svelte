<script lang="ts">
  import { onMount } from 'svelte';
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Root as NSRoot, Option as NSOption, OptGroup as NSGroup } from '$lib/components/ui/native-select';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import CloudIcon from '@lucide/svelte/icons/cloud';
  import SearchSelect from './SearchSelect.svelte';

  type LogEvent = { key: string; ts: number; level: string | null; message: string; data: unknown; source_id?: string; source_name?: string };

  let events: LogEvent[] = $state([]);
  let sources: Array<{ id: string; name: string }> = $state([]);
  let loading = $state(true);
  let err = $state('');
  let source = $state('');
  let level = $state('');
  let q = $state('');
  let expanded = $state<Record<string, boolean>>({});
  let ready = $state(false);
  let cfConnected = $state(false);
  let cfAccount = $state('');
  let cfScripts: string[] = $state([]);
  let cfMapping: Record<string, { source: string; quiet: boolean }> = $state({});
  let quietHttp = $state(true);
  let cfPickWorker = $state('');
  let cfPickSource = $state('');
  let cfError = $state('');
  let vercelConnected = $state(false);
  let vTeam = $state('');
  let vTeams: Array<{ id: string; slug: string }> = $state([]);
  let vProjects: Array<{ id: string; name: string }> = $state([]);
  let vMapping: VMap = $state({});
  let vPickProject = $state('');
  let vPickSource = $state('');
  let vSync: { at: number; synced: number; error: string | null } | null = $state(null);
  let vLoading = $state(false);
  let ghConnected = $state(false);
  let ghRepos: Array<{ full_name: string; private: boolean; pushed_at: string }> = $state([]);
  let ghMapping: Record<string, { source: string; quiet?: boolean }> = $state({});
  let ghPickRepo = $state('');
  let ghPickSource = $state('');
  let ghSync: { at: number; synced: number; error: string | null } | null = $state(null);
  let ghLoading = $state(false);

  const time = (ts: number) => new Date(ts).toISOString().slice(5, 16).replace('T', ' ');
  const localTime = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  async function load() {
    loading = true;
    err = '';
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (source) qs.set('source', source);
      if (level) qs.set('level', level);
      if (q.trim()) qs.set('q', q.trim());
      const r = await fetch(`/api/logevents?${qs}`);
      if (r.ok) {
        const j = await r.json();
        events = j.events ?? [];
        sources = j.sources ?? [];
      } else err = 'failed to load events';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  async function loadCf(fresh = false) {
    try {
      const r = await fetch(`/api/cfworkers${fresh ? '?fresh=1' : ''}`);
      if (!r.ok) return;
      const j = await r.json();
      cfConnected = j.connected ?? false;
      cfAccount = j.account ?? '';
      cfScripts = j.scripts ?? [];
      cfMapping = j.mapping ?? {};
    } catch {
      cfConnected = false;
    }
  }

  async function loadGh() {
    ghLoading = true;
    try {
      const r = await fetch('/api/githubrepos');
      if (!r.ok) return;
      const j = await r.json();
      ghConnected = j.connected ?? false;
      ghRepos = j.repos ?? [];
      ghMapping = j.mapping ?? {};
      ghSync = j.sync ?? null;
    } catch {
      ghConnected = false;
    } finally {
      ghLoading = false;
    }
  }

  type GhMap = Record<string, { source: string; quiet: boolean }>;

  const ghQuiet = (entry: { quiet?: boolean } | string): boolean =>
    typeof entry === 'string' ? false : (entry.quiet ?? false);

  async function saveGhMapping(repo: string, sourceId: string, pref?: { quiet?: boolean }) {
    cfError = '';
    const next: GhMap = {};
    for (const [k, v] of Object.entries(ghMapping)) {
      next[k] = typeof v === 'string' ? { source: v, quiet: false } : { source: v.source, quiet: v.quiet ?? false };
    }
    if (sourceId) {
      const prev = next[repo];
      next[repo] = { source: sourceId, quiet: pref?.quiet ?? prev?.quiet ?? false };
    } else delete next[repo];
    const r = await fetch('/admin/github/mapping', {
      method: 'POST',
      body: JSON.stringify({ mappings: next }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    const j = await r.json().catch(() => ({ ok: r.ok }));
    if (!j.ok) cfError = j.error ?? 'failed to save mapping';
    else {
      ghMapping = next;
      await load();
    }
  }

  onMount(async () => {
    await loadCf();
    await loadV();
    await loadGh();
    await load();
    ready = true;
  });

  // Dropdown changes apply immediately; search typing debounces.
  $effect(() => {
    source;
    level;
    if (!ready) return;
    const t = setTimeout(() => void load(), 60);
    return () => clearTimeout(t);
  });
  $effect(() => {
    q;
    if (!ready) return;
    const t = setTimeout(() => void load(), 400);
    return () => clearTimeout(t);
  });

  async function loadV() {
    vLoading = true;
    try {
      const qs = vTeam && vTeam !== '__personal' ? `?team=${encodeURIComponent(vTeam)}` : '';
      const r = await fetch(`/api/vercelprojects${qs}`);
      if (!r.ok) return;
      const j = await r.json();
      vProjects = j.projects ?? [];
      vTeams = j.teams ?? vTeams;
      vMapping = j.mapping ?? vMapping;
      vSync = j.sync ?? null;
      vercelConnected = j.connected ?? false;
      // Keep teams referenced by existing mappings selectable even if the teams call failed.
      for (const e of Object.values(vMapping)) {
        const t = typeof e === 'string' ? null : (e.team ?? null);
        if (t && !vTeams.some((x) => x.id === t)) vTeams = [...vTeams, { id: t, slug: t }];
      }
      if (!vTeam) {
        const fromMap = Object.values(vMapping)
          .map((e) => (typeof e === 'string' ? null : (e.team ?? null)))
          .find((t) => t && vTeams.some((x) => x.id === t));
        if (fromMap) vTeam = fromMap;
        else if (vTeams.length === 1) vTeam = vTeams[0].id;
        else if (vTeams.length === 0) vTeam = '__personal';
        if (vTeam && vTeam !== '__personal') {
          vLoading = false;
          await loadV();
          return;
        }
      }
    } catch {
      vercelConnected = false;
    } finally {
      vLoading = false;
    }
  }

  type VMap = Record<string, { source: string; team: string | null; quiet: boolean }>;

  const vTeamLabel = (entry: { source: string; team: string | null; quiet?: boolean } | string): string | null => {
    const t = typeof entry === 'string' ? null : (entry.team ?? null);
    if (!t) return null;
    return vTeams.find((x) => x.id === t)?.slug ?? `${t.slice(0, 12)}…`;
  };

  const vQuiet = (entry: { quiet?: boolean } | string): boolean =>
    typeof entry === 'string' ? false : (entry.quiet ?? false);

  async function saveVMapping(project: string, sourceId: string, pref?: { quiet?: boolean }) {
    cfError = '';
    const next: VMap = {};
    for (const [pid, v] of Object.entries(vMapping)) {
      next[pid] =
        typeof v === 'string'
          ? { source: v, team: null, quiet: false }
          : { source: v.source, team: v.team ?? null, quiet: v.quiet ?? false };
    }
    const prev = next[project];
    // New mappings need a team scope; quiet-toggles on existing ones reuse the stored scope.
    if (sourceId && !vTeam && !prev) {
      cfError = 'pick a team first — scope is required for mapping';
      return;
    }
    if (sourceId) {
      const team = vTeam ? (vTeam === '__personal' ? null : vTeam) : (prev?.team ?? null);
      next[project] = {
        source: sourceId,
        team,
        quiet: pref?.quiet ?? prev?.quiet ?? false,
      };
    } else delete next[project];
    const r = await fetch('/admin/vercel/mapping', {
      method: 'POST',
      body: JSON.stringify({ mappings: next }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    const j = await r.json().catch(() => ({ ok: r.ok }));
    if (!j.ok) cfError = j.error ?? 'failed to save mapping';
    else {
      vMapping = next;
      await load();
    }
  }

  async function saveMapping(worker: string, pref: { source: string; quiet: boolean }) {
    cfError = '';
    const next = { ...cfMapping };
    if (pref.source) next[worker] = pref;
    else delete next[worker];
    const r = await fetch('/admin/cloudflare/mapping', {
      method: 'POST',
      body: JSON.stringify({ mappings: next }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    const j = await r.json().catch(() => ({ ok: r.ok }));
    if (!j.ok) cfError = j.error ?? 'failed to save mapping';
    else {
      cfMapping = next;
      await load();
    }
  }

  const lvlVariant = (l: string | null) =>
    l === 'error' || l === 'fatal' ? 'destructive' : l === 'warn' || l === 'warning' ? 'secondary' : 'outline';
</script>

<Card.Root>
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <ScrollTextIcon />
        <Card.Title>log manager</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={() => { loadCf(); loadGh(); load(); }}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
      </div>
    </div>
    <Card.Description>Filter, search, expand JSON, and tail. Events live 24h in D1; provider logs sync in every few minutes.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if cfConnected}
      <div class="mb-3 rounded-xl border border-border bg-card p-3">
        <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <CloudIcon size={14} />
            <span>cloudflare workers{cfAccount ? ` · ${cfAccount.slice(0, 8)}…` : ''} → log names</span>
        </div>
        {#if Object.keys(cfMapping).length}
          <div class="mb-2 flex flex-col gap-1">
            {#each Object.entries(cfMapping) as [worker, pref] (worker)}
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-mono">{worker}</span>
                <span class="shrink-0 text-muted-foreground">→</span>
                <span class="shrink-0 truncate font-medium">{sources.find((s) => s.id === pref.source)?.name ?? pref.source}</span>
                <button
                  type="button"
                  title={pref.quiet ? 'Hiding infra noise (GET/POST lines, cron heartbeats) — click to include them' : 'Including infra noise (GET/POST lines, cron heartbeats) — click to hide'}
                  aria-pressed={pref.quiet}
                  class="shrink-0 rounded-md border px-1.5 py-0.5 {pref.quiet ? 'border-border text-muted-foreground' : 'border-border text-foreground'}"
                  onclick={() => saveMapping(worker, { ...pref, quiet: !pref.quiet })}
                >
                  {pref.quiet ? 'quiet' : 'noisy'}
                </button>
                <button
                  type="button"
                  title={`unmap ${worker}`}
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => saveMapping(worker, { source: '', quiet: false })}
                  aria-label={`unmap ${worker}`}
                >✕</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if cfScripts.length === 0}
          <p class="text-xs text-muted-foreground">No workers found in this account.</p>
        {:else}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <SearchSelect
              items={cfScripts.filter((w) => !cfMapping[w]).map((w) => ({ value: w, label: w }))}
              value={cfPickWorker}
              placeholder="Pick a worker…"
              emptyText="All workers mapped."
              ariaLabel="worker to map"
              onSelect={(v) => (cfPickWorker = v)}
            />
            <SearchSelect
              items={sources.map((s) => ({ value: s.id, label: s.name }))}
              value={cfPickSource}
              placeholder="Pick a log name…"
              emptyText="Create a log source first."
              ariaLabel="log source to map to"
              onSelect={(v) => (cfPickSource = v)}
            />
            <div class="flex flex-col justify-center gap-1">
              <Button
                disabled={!cfPickWorker || !cfPickSource}
                onclick={() => {
                  saveMapping(cfPickWorker, { source: cfPickSource, quiet: quietHttp });
                  cfPickWorker = '';
                  cfPickSource = '';
                }}
              >
                <PlusIcon data-icon="inline-start" /> map
              </Button>
              <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Skip the worker's GET/POST request logs and cron heartbeat lines — keep app logs and errors">
                <input type="checkbox" bind:checked={quietHttp} class="size-3.5 accent-current" />
                hide http + cron noise
              </label>
            </div>
          </div>
        {/if}
        {#if cfError}<p class="mt-2 text-xs text-destructive">{cfError}</p>{/if}
      </div>
    {/if}
    {#if vercelConnected}
      <div class="mb-3 rounded-xl border border-border bg-card p-3">
        <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>vercel projects → log names</span>
        </div>
        <div class="mb-2">
          <SearchSelect
            items={[{ value: '__personal', label: 'Personal account' }, ...vTeams.filter((t) => t.id !== '__personal').map((t) => ({ value: t.id, label: t.slug }))]}
            value={vTeam}
            placeholder="Pick a team first (required)…"
            emptyText="No teams visible."
            ariaLabel="vercel team scope"
            onSelect={(v) => {
              vTeam = v;
              vPickProject = '';
              loadV();
            }}
          />
          {#if !vTeam}<p class="mt-1 text-xs text-destructive">Team scope is required before mapping.</p>{/if}
        </div>
        {#if Object.keys(vMapping).length}
          <div class="mb-2 flex flex-col gap-1">
            {#each Object.entries(vMapping) as [pid, entry] (pid)}
              {@const vsid = typeof entry === 'string' ? entry : entry.source}
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-mono">{vProjects.find((p) => p.id === pid)?.name ?? pid}</span>
                {#if vTeamLabel(entry)}
                  <span class="shrink-0 rounded border border-border px-1 text-muted-foreground">@{vTeamLabel(entry)}</span>
                {:else}
                  <span class="shrink-0 rounded border border-destructive/50 px-1 text-destructive" title="mapped without a team scope — remap it">unscoped</span>
                {/if}
                <span class="shrink-0 text-muted-foreground">→</span>
                <span class="shrink-0 truncate font-medium">{sources.find((s) => s.id === vsid)?.name ?? vsid}</span>
                <button
                  type="button"
                  title={vQuiet(entry) ? 'Quiet: only warnings + errors sync — click to include info chatter' : 'Noisy: all levels sync — click to keep only warnings + errors'}
                  aria-pressed={vQuiet(entry)}
                  class="shrink-0 rounded-md border px-1.5 py-0.5 {vQuiet(entry) ? 'border-border text-muted-foreground' : 'border-border text-foreground'}"
                  onclick={() => saveVMapping(pid, vsid, { quiet: !vQuiet(entry) })}
                >
                  {vQuiet(entry) ? 'quiet' : 'noisy'}
                </button>
                <button
                  type="button"
                  title={`unmap ${pid}`}
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => saveVMapping(pid, '')}
                  aria-label={`unmap ${pid}`}
                >✕</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if vLoading}
          <p class="text-xs text-muted-foreground">loading projects…</p>
        {:else if !vTeam}
          <p class="text-xs text-muted-foreground">Pick a team above to list its projects.</p>
        {:else if vProjects.length === 0}
          <p class="text-xs text-muted-foreground">No projects in this scope.</p>
        {:else}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <SearchSelect
              items={vProjects.filter((p) => !vMapping[p.id]).map((p) => ({ value: p.id, label: p.name }))}
              value={vPickProject}
              placeholder="Pick a project…"
              emptyText="All projects mapped."
              ariaLabel="project to map"
              onSelect={(v) => (vPickProject = v)}
            />
            <SearchSelect
              items={sources.map((s) => ({ value: s.id, label: s.name }))}
              value={vPickSource}
              placeholder="Pick a log name…"
              emptyText="Create a log source first."
              ariaLabel="log source to map to"
              onSelect={(v) => (vPickSource = v)}
            />
            <Button
              disabled={!vTeam || !vPickProject || !vPickSource}
              onclick={() => {
                saveVMapping(vPickProject, vPickSource);
                vPickProject = '';
              }}
            >
              <PlusIcon data-icon="inline-start" /> map
            </Button>
          </div>
        {/if}
        {#if vSync}
          <p class="mt-2 text-xs text-muted-foreground">
            {#if vSync.error}
              <span class="text-destructive">last sync failed: {vSync.error}</span>
            {:else}
              last sync {vSync.at ? localTime(vSync.at) : 'never'} · {vSync.synced} new event(s)
            {/if}
          </p>
        {/if}
      </div>
    {/if}
    {#if ghConnected}
      <div class="mb-3 rounded-xl border border-border bg-card p-3">
        <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>github actions → log names</span>
        </div>
        <p class="mb-2 text-xs text-muted-foreground">Maps a repo to a log source; the tick pulls recent workflow runs and failed-job lines every few minutes. Needs a token with Actions: read.</p>
        {#if Object.keys(ghMapping).length}
          <div class="mb-2 flex flex-col gap-1">
            {#each Object.entries(ghMapping) as [repo, entry] (repo)}
              {@const gsid = typeof entry === 'string' ? entry : entry.source}
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-mono">{repo}</span>
                <span class="shrink-0 text-muted-foreground">→</span>
                <span class="shrink-0 truncate font-medium">{sources.find((s) => s.id === gsid)?.name ?? gsid}</span>
                <button
                  type="button"
                  title={ghQuiet(entry) ? 'Quiet: only warnings + errors sync — click to include info chatter' : 'Noisy: all levels sync — click to keep only warnings + errors'}
                  aria-pressed={ghQuiet(entry)}
                  class="shrink-0 rounded-md border px-1.5 py-0.5 {ghQuiet(entry) ? 'border-border text-muted-foreground' : 'border-border text-foreground'}"
                  onclick={() => saveGhMapping(repo, gsid, { quiet: !ghQuiet(entry) })}
                >
                  {ghQuiet(entry) ? 'quiet' : 'noisy'}
                </button>
                <button
                  type="button"
                  title={`unmap ${repo}`}
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => saveGhMapping(repo, '')}
                  aria-label={`unmap ${repo}`}
                >✕</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if ghLoading}
          <p class="text-xs text-muted-foreground">loading repos…</p>
        {:else if ghRepos.length === 0}
          <p class="text-xs text-muted-foreground">No repos visible to the token.</p>
        {:else}
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <SearchSelect
              items={ghRepos.filter((r) => !ghMapping[r.full_name]).map((r) => ({ value: r.full_name, label: r.full_name }))}
              value={ghPickRepo}
              placeholder="Pick a repo…"
              emptyText="All repos mapped."
              ariaLabel="repo to map"
              onSelect={(v) => (ghPickRepo = v)}
            />
            <SearchSelect
              items={sources.map((s) => ({ value: s.id, label: s.name }))}
              value={ghPickSource}
              placeholder="Pick a log name…"
              emptyText="Create a log source first."
              ariaLabel="log source to map to"
              onSelect={(v) => (ghPickSource = v)}
            />
            <Button
              disabled={!ghPickRepo || !ghPickSource}
              onclick={() => {
                saveGhMapping(ghPickRepo, ghPickSource);
                ghPickRepo = '';
              }}
            >
              <PlusIcon data-icon="inline-start" /> map
            </Button>
          </div>
        {/if}
        {#if ghSync}
          <p class="mt-2 text-xs text-muted-foreground">
            {#if ghSync.error}
              <span class="text-destructive">last sync failed: {ghSync.error}</span>
            {:else}
              last sync {ghSync.at ? localTime(ghSync.at) : 'never'} · {ghSync.synced} new event(s)
            {/if}
          </p>
        {/if}
      </div>
    {/if}
    <form
      class="mb-3 grid gap-2 sm:grid-cols-4"
      onsubmit={(e) => {
        e.preventDefault();
        load();
      }}
    >
      <NSRoot name="source" bind:value={source} aria-label="source">
        <NSGroup>
          <NSOption value="">all sources</NSOption>
          {#each sources as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
        </NSGroup>
      </NSRoot>
      <NSRoot name="level" bind:value={level} aria-label="level">
        <NSGroup>
          <NSOption value="">all levels</NSOption>
          <NSOption value="error">error</NSOption>
          <NSOption value="warn">warn</NSOption>
          <NSOption value="info">info</NSOption>
        </NSGroup>
      </NSRoot>
      <Input bind:value={q} placeholder="search…" aria-label="search" />
      <Button type="submit">
        <SearchIcon data-icon="inline-start" /> filter
      </Button>
    </form>
    {#if err}
      <Alert.Root class="mb-3" variant="destructive">
        <Alert.Description>{err}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if events.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No events</Empty.Title>
          <Empty.Description>Nothing matches — widen the filter or wait for ingest.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each events as e (e.key)}
          <div class="rounded-lg py-2">
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
              onclick={() => (expanded = { ...expanded, [e.key]: !expanded[e.key] })}
              aria-expanded={Boolean(expanded[e.key])}
            >
              <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{time(e.ts)}</span>
              {#if e.level}<Badge variant={lvlVariant(e.level)}>{e.level}</Badge>{/if}
              <span class="shrink-0 truncate text-xs text-muted-foreground">{e.source_name ?? sources.find((s) => s.id === e.source_id)?.name ?? ''}</span>
              <span class="min-w-0 flex-1 basis-48 truncate text-sm">{e.message}</span>
            </button>
            {#if expanded[e.key]}
              <pre class="mt-2 max-h-64 overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">{JSON.stringify(e.data, null, 2)}</pre>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
