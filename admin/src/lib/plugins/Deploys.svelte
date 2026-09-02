<script lang="ts">
  import { onMount } from 'svelte';
  import { GitBranch, Rocket, RefreshCw, Plus, Trash2, Pause, Play, Zap, Link2, Link2Off } from 'lucide-svelte';
  import Badge from '../ui/badge.svelte';
  import Button from '../ui/button.svelte';
  import Card from '../ui/card.svelte';

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

  let targets: Target[] = $state([]);
  let github = $state({ connected: false, who: null as string | null });
  let vercel = $state({ connected: false, who: null as string | null });
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd: 'github' | 'vercel' | null = $state(null);
  let tokenInput = $state({ github: '', vercel: '' });

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

  async function api(action: string, body?: FormData | any) {
    busy = action;
    err = '';
    msg = '';
    try {
      const opts: RequestInit =
        body instanceof FormData
          ? { method: 'POST', body, headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { accept: 'application/json' } };
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

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
</script>

{#if msg}<div class="mb-3 rounded-lg border border-[#2f3544] bg-[#12180f] px-3 py-2 text-sm text-[#c8f542]">{msg}</div>{/if}
{#if err}<div class="mb-3 rounded-lg border border-[#ff5d57] bg-[#1a0e0e] px-3 py-2 text-sm text-[#ff5d57]">{err}</div>{/if}

<Card>
  <div class="mb-3 flex items-center justify-between">
    <span class="text-xs uppercase tracking-widest text-[#8b919c]">watching</span>
    <div class="flex gap-2">
      <Button variant="ghost" on:click={() => load()} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><RefreshCw size={13} /> refresh</span>
      </Button>
      {#if github.connected}
        <Button on:click={() => (showAdd = showAdd === 'github' ? null : 'github')} disabled={busy !== ''}>
          <span class="inline-flex items-center gap-1.5"><Plus size={13} /> github</span>
        </Button>
      {/if}
      {#if vercel.connected}
        <Button on:click={() => (showAdd = showAdd === 'vercel' ? null : 'vercel')} disabled={busy !== ''}>
          <span class="inline-flex items-center gap-1.5"><Plus size={13} /> vercel</span>
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
          {#if t.provider === 'github'}<GitBranch size={15} class="shrink-0 text-[#8b919c]" />{:else}<Rocket size={15} class="shrink-0 text-[#8b919c]" />{/if}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{t.name}</span>
              {#if !t.enabled}<Badge variant="muted">paused</Badge>{/if}
            </div>
            <div class="truncate text-xs text-[#8b919c]">
              {t.repo ?? `${t.project}${t.team ? ` @ ${t.team}` : ''}`} · every {t.interval_min}m
              {#if t.last_detail} · {t.last_detail}{/if}
              {#if t.last_error} · <span class="text-[#ff5d57]">{t.last_error}</span>{/if}
            </div>
          </div>
          <span class="hidden shrink-0 text-xs tabular-nums text-[#8b919c] sm:block">{ago(t.last_check_at)}</span>
          <Badge variant={t.enabled ? (t.status === 'down' ? 'destructive' : t.status === 'up' ? 'default' : 'muted') : 'muted'}>{t.status}</Badge>
          <div class="flex shrink-0 gap-1">
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white disabled:opacity-40"
              title="check now" disabled={busy !== ''} on:click={() => api(`/admin/deploys/targets/${t.id}/check`)}>
              <Zap size={13} />
            </button>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white"
              title={t.enabled ? 'pause' : 'resume'} on:click={() => api(`/admin/deploys/targets/${t.id}/toggle`)}>
              {#if t.enabled}<Pause size={13} />{:else}<Play size={13} />{/if}
            </button>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-[#ff5d57]"
              title="remove" on:click={() => api(`/admin/deploys/targets/${t.id}/delete`)}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Card>

{#if showAdd === 'github'}
  <Card>
    <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><GitBranch size={15} /> watch a GitHub repo</div>
    <form class="space-y-3" on:submit|preventDefault={(e) => {
      const fd = new FormData(e.currentTarget as HTMLFormElement);
      fd.set('provider', 'github');
      api('/admin/deploys/targets', fd).then(() => (showAdd = null));
    }}>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-[#8b919c]">repo (owner/repo)
          <input name="repo" placeholder="man0l/indiestack" required class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">name (optional)
          <input name="name" maxlength="40" placeholder="api deploys" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">interval minutes
          <input type="number" name="interval_min" min="5" max="60" value="5" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
      </div>
      <Button type="submit" disabled={busy !== ''}>watch deploys</Button>
    </form>
  </Card>
{/if}

{#if showAdd === 'vercel'}
  <Card>
    <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Rocket size={15} /> watch a Vercel project</div>
    <form class="space-y-3" on:submit|preventDefault={(e) => {
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
  </Card>
{/if}

<div class="mt-4 grid gap-3 sm:grid-cols-2">
  <div class="rounded-xl border border-[#262b35] bg-[#171a21] p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><GitBranch size={14} /> GitHub</div>
    {#if github.connected}
      <p class="mb-3 text-xs text-[#8b919c]">connected{github.who ? ` as ${github.who}` : ''}</p>
      <Button variant="ghost" on:click={() => api('/admin/deploys/github/disconnect')} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Link2Off size={13} /> disconnect</span>
      </Button>
    {:else}
      <p class="mb-3 text-xs text-[#8b919c]">
        <a class="text-[#c8f542] underline" target="_blank" rel="noopener"
          href="https://github.com/settings/personal-access-tokens/new?name=IndieStack%20deploys&description=Read-only%20deployment%20status%20for%20IndieStack&permissions%5Bdeployments%5D=read&expiration=none">create a pre-filled read-only token ↗</a>
        — Deployments: read-only, no expiration. Public repos work without a token (rate-shared).
      </p>
      <form class="flex gap-2" on:submit|preventDefault={(e) => {
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/github/connect', fd);
      }}>
        <input name="token" type="password" placeholder="github_pat_…" required class="flex-1 rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2 size={13} /> connect</span></Button>
      </form>
    {/if}
  </div>

  <div class="rounded-xl border border-[#262b35] bg-[#171a21] p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Rocket size={14} /> Vercel</div>
    {#if vercel.connected}
      <p class="mb-3 text-xs text-[#8b919c]">connected{vercel.who ? ` as ${vercel.who}` : ''}</p>
      <Button variant="ghost" on:click={() => api('/admin/deploys/vercel/disconnect')} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Link2Off size={13} /> disconnect</span>
      </Button>
    {:else}
      <p class="mb-3 text-xs text-[#8b919c]">
        <a class="text-[#c8f542] underline" target="_blank" rel="noopener" href="https://vercel.com/account/tokens">create a token ↗</a>
        — no prefill on Vercel: scope to your account or team. IndieStack only calls read endpoints.
      </p>
      <form class="flex gap-2" on:submit|preventDefault={(e) => {
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        api('/admin/deploys/vercel/connect', fd);
      }}>
        <input name="token" type="password" placeholder="paste token" required class="flex-1 rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        <Button type="submit" disabled={busy !== ''}><span class="inline-flex items-center gap-1.5"><Link2 size={13} /> connect</span></Button>
      </form>
    {/if}
  </div>
</div>
