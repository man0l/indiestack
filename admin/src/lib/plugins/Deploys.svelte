<script lang="ts">
  import { onMount } from 'svelte';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import Link2Icon from '@lucide/svelte/icons/link-2';
  import Link2OffIcon from '@lucide/svelte/icons/link-2-off';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';

  type Target = {
    id: string;
    provider: 'github' | 'vercel';
    name: string;
    repo: string | null;
    project: string | null;
    team: string | null;
    interval_min: number;
    enabled: number;
    status: string;
    last_check_at: number | null;
    last_detail: string | null;
    last_error: string | null;
  };

  type Repo = { full_name: string; private: boolean; pushed_at: string };

  let targets: Target[] = $state([]);
  let github = $state({ connected: false, who: null as string | null });
  let vercel = $state({ connected: false, who: null as string | null });
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd: 'github' | 'vercel' | null = $state(null);

  // github repo picker
  let repos: Repo[] = $state([]);
  let reposLoading = $state(false);
  let reposError = $state('');
  let selected: string[] = $state([]);
  let repoFilter = $state('');
  let manualRepo = $state('');
  let interval = $state(5);

  $effect(() => {
    if (showAdd === 'github' && github.connected && repos.length === 0 && !reposLoading) loadRepos();
  });

  async function load() {
    const r = await fetch('/api/deploys');
    if (r.ok) {
      const j = await r.json();
      targets = j.targets ?? [];
      github = j.github;
      vercel = j.vercel;
    }
    loading = false;
  }

  onMount(load);

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
      else msg = j.msg ?? 'done';
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

{#if msg}<div class="mb-3 rounded-lg border border-[#2f3544] bg-[#12180f] px-3 py-2 text-sm text-[#c8f542]">{msg}</div>{/if}
{#if err}<div class="mb-3 rounded-lg border border-[#ff5d57] bg-[#1a0e0e] px-3 py-2 text-sm text-[#ff5d57]">{err}</div>{/if}

<Card.Root>
  <Card.Content>
  <div class="mb-3 flex items-center justify-between">
    <span class="text-xs uppercase tracking-widest text-[#8b919c]">watching</span>
    <div class="flex gap-2">
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
    </div>
  </div>

  {#if loading}
    <p class="text-sm text-[#8b919c]">loading…</p>
  {:else if targets.length === 0}
    <p class="text-sm text-[#8b919c]">
      Nothing watched yet. Connect {github.connected ? 'Vercel' : vercel.connected ? 'GitHub' : 'GitHub or Vercel'} below, then watch its production deployments.
    </p>
  {:else}
    <div class="divide-y divide-[#262b35]">
      {#each targets as t (t.id)}
        <div class="flex items-center gap-3 py-3">
          {#if t.provider === 'github'}<GitBranchIcon class="shrink-0 text-muted-foreground" />{:else}<RocketIcon class="shrink-0 text-muted-foreground" />{/if}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{t.name}</span>
              {#if !t.enabled}<Badge variant="secondary">paused</Badge>{/if}
            </div>
            <div class="truncate text-xs text-[#8b919c]">
              {t.repo ?? `${t.project}${t.team ? ` @ ${t.team}` : ''}`} · every {t.interval_min}m
              {#if t.last_detail} · {t.last_detail}{/if}
              {#if t.last_error} · <span class="text-[#ff5d57]">{t.last_error}</span>{/if}
            </div>
          </div>
          <span class="hidden shrink-0 text-xs tabular-nums text-[#8b919c] sm:block">{ago(t.last_check_at)}</span>
          <Badge variant={t.enabled ? (t.status === 'down' ? 'destructive' : t.status === 'up' ? 'default' : 'outline') : 'outline'}>{t.status}</Badge>
          <div class="flex shrink-0 gap-1">
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white disabled:opacity-40"
              title="check now" disabled={busy !== ''} onclick={() => api(`/admin/deploys/targets/${t.id}/check`)}>
              <ZapIcon />
            </button>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white"
              title={t.enabled ? 'pause' : 'resume'} onclick={() => api(`/admin/deploys/targets/${t.id}/toggle`)}>
              {#if t.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
            </button>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-[#ff5d57]"
              title="remove" onclick={() => api(`/admin/deploys/targets/${t.id}/delete`)}>
              <Trash2Icon />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
  </Card.Content>
</Card.Root>

{#if showAdd === 'github' && github.connected}
  <Card.Root>
  <Card.Content>
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-semibold text-white"><GitBranchIcon size={15} /> pick repos to watch</div>
      <Button variant="ghost" onclick={loadRepos} disabled={reposLoading}>
        <span class="inline-flex items-center gap-1.5"><RefreshCwIcon data-icon="inline-start" /> reload list</span>
      </Button>
    </div>

    {#if reposLoading}
      <p class="text-sm text-[#8b919c]">loading your repos…</p>
    {:else if reposError}
      <p class="mb-3 text-sm text-[#ff5d57]">{reposError}</p>
      <label class="text-xs text-[#8b919c]">or add one manually (owner/repo)
        <input bind:value={manualRepo} placeholder="man0l/indiestack" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
      </label>
    {:else if repos.length === 0}
      <p class="text-sm text-[#8b919c]">No repos visible for this token.</p>
    {:else}
      <input bind:value={repoFilter} placeholder="filter…" class="mb-2 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
      <div class="max-h-64 divide-y divide-[#262b35] overflow-y-auto rounded-lg border border-[#262b35]">
        {#each visibleRepos() as r (r.full_name)}
          <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-[#171a21]"
            onclick={() => toggleSelect(r.full_name)}>
            <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border {selected.includes(r.full_name) ? 'border-[#c8f542] bg-[#c8f542] text-black' : 'border-[#262b35]'}">
              {#if selected.includes(r.full_name)}<CheckIcon />{/if}
            </span>
            <span class="flex-1 truncate">{r.full_name}</span>
            {#if r.private}<Badge variant="secondary">private</Badge>{/if}
            <span class="text-xs tabular-nums text-[#8b919c]">{pushedAgo(r.pushed_at)}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="mt-3 flex items-center gap-3">
      <label class="text-xs text-[#8b919c]">interval
        <input type="number" bind:value={interval} min="5" max="60" class="ml-1 w-20 rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
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
      <span class="text-xs text-[#8b919c]">{repos.length} repos found · picks probe immediately</span>
    </div>
  </Card.Content>
</Card.Root>
{/if}

{#if showAdd === 'vercel' && vercel.connected}
  <Card.Root>
  <Card.Content>
    <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><RocketIcon size={15} /> watch a Vercel project</div>
    <form class="space-y-3" onsubmit={(e) => { e.preventDefault();
      const fd = new FormData(e.currentTarget as HTMLFormElement);
      fd.set('provider', 'vercel');
      api('/admin/deploys/targets', fd).then(() => (showAdd = null));
    }}>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-[#8b919c]">project id or name
          <input name="project" placeholder="prj_…  or  my-site" required class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">team id (optional)
          <input name="team" placeholder="team_…" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
      </div>
      <Button type="submit" disabled={busy !== ''}>watch deploys</Button>
    </form>
  </Card.Content>
</Card.Root>
{/if}

<Card.Root class="mt-4">
  <Card.Content>
    <div class="grid gap-3 sm:grid-cols-2">
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
          href="https://github.com/settings/personal-access-tokens/new?name=IndieStack%20deploys&description=Read-only%20deployment%20status%20for%20IndieStack&permissions%5Bdeployments%5D=read&expiration=none">create a pre-filled read-only token ↗</a>
        — Deployments: read-only, no expiration. Public repos work without a token (rate-shared).
      </p>
      <form class="flex gap-2" onsubmit={(e) => { e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/github/connect', fd);
      }}>
        <input name="token" type="password" placeholder="github_pat_…" required class="flex-1" />
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
      <form class="flex gap-2" onsubmit={(e) => { e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/vercel/connect', fd);
      }}>
        <input name="token" type="password" placeholder="paste token" required class="flex-1" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2Icon data-icon="inline-start" /> connect</span></Button>
      </form>
    {/if}
  </div>
</div>
  </Card.Content>
</Card.Root>
