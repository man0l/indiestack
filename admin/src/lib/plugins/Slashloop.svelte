<script lang="ts">
  import { onMount } from 'svelte';
  import RepeatIcon from '@lucide/svelte/icons/repeat';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import UnplugIcon from '@lucide/svelte/icons/unplug';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Root as NSRoot, Option as NSOption } from '$lib/components/ui/native-select';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import ConfirmDelete from './ConfirmDelete.svelte';

  type Lane = {
    lane: string;
    label: string;
    siteId: string | null;
    accounts: number;
    views30: number;
    days: Array<{ day: string; views: number }>;
  };
  type Data = {
    connected: boolean;
    server: string;
    user: string | null;
    encrypted: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
    defaultSiteId: string | null;
    lanes: Lane[];
    sites: Array<{ id: string; name: string }>;
  };

  const SOCIAL_COLOR = 'oklch(0.65 0.2 350)';

  let data: Data | null = $state(null);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let defSite = $state('');

  const ago = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  async function load() {
    loading = true;
    try {
      const r = await fetch('/admin/slashloop/data', { headers: { accept: 'application/json' } });
      if (r.ok) data = await r.json();
      else err = 'failed to load slashloop';
      defSite = data?.defaultSiteId ?? '';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function post(action: string, body?: FormData) {
    busy = action;
    err = '';
    msg = '';
    try {
      const r = await fetch(action, { method: 'POST', body, headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else msg = j.msg ?? 'done';
      await load();
      return Boolean(j.ok);
    } catch (e) {
      err = String(e);
      return false;
    } finally {
      busy = '';
    }
  }

  async function connect() {
    busy = 'connect';
    err = '';
    try {
      const r = await fetch('/admin/slashloop/connect', { method: 'POST', headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({ ok: false, error: 'failed to start sign-in' }));
      if (j.ok && j.url) location.href = j.url;
      else err = j.error ?? 'failed to start sign-in';
    } catch (e) {
      err = String(e);
    } finally {
      busy = '';
    }
  }

  async function relink(l: Lane, siteId: string) {
    const fd = new FormData();
    fd.set('lane', l.lane);
    fd.set('site_id', siteId);
    await post('/admin/slashloop/lane', fd);
  }

  async function saveDefault(applyAll: boolean) {
    const fd = new FormData();
    fd.set('site_id', defSite);
    if (applyAll) fd.set('apply_all', '1');
    await post('/admin/slashloop/default-site', fd);
  }

  const bars = (days: Lane['days']) => {
    const max = Math.max(1, ...days.map((d) => d.views));
    return days.map((d, i) => ({ d, x: i * 8, h: Math.max(1, (d.views / max) * 36) }));
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
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <RepeatIcon />
        <Card.Title>slashloop</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        {#if data?.connected}
          <Button variant="secondary" size="sm" onclick={() => post('/admin/slashloop/sync')} disabled={busy !== ''}>
            <RefreshCwIcon data-icon="inline-start" /> sync now
          </Button>
        {/if}
      </div>
    </div>
    <Card.Description>
      Social views from your Slashloop accounts, grouped by lane. Link a lane to an analytics site and its views show on that
      site's chart next to deploys, commits and website views. Synced hourly.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading && !data}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-20 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if !data?.lanes.length}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No lanes yet</Empty.Title>
          <Empty.Description>
            {data?.connected ? 'Nothing synced yet — try sync now.' : 'Connect Slashloop below.'}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-3">
        {#each data.lanes as l (l.lane)}
          <div class="rounded-xl border border-border bg-card p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold">{l.label}</span>
              <Badge variant={l.siteId ? 'success' : 'secondary'}>{l.siteId ? 'on chart' : 'not linked'}</Badge>
              <span class="text-xs text-muted-foreground">{l.accounts} account{l.accounts === 1 ? '' : 's'}</span>
            </div>
            <p class="mb-2 text-xs text-muted-foreground">30 days: <b>{l.views30}</b> views gained</p>
            {#if l.days.length}
              <svg viewBox={`0 0 ${Math.max(8, l.days.length * 8)} 40`} class="mb-2 h-10 w-full max-w-md" preserveAspectRatio="none" role="img" aria-label="views per day, last 30 days">
                {#each bars(l.days) as b (b.d.day)}
                  <rect x={b.x + 1} y={40 - b.h} width="6" height={b.h} rx="1" fill={SOCIAL_COLOR} opacity="0.6">
                    <title>{b.d.day} · {b.d.views} views</title>
                  </rect>
                {/each}
              </svg>
            {/if}
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>chart on site</span>
              <NSRoot size="sm" value={l.siteId ?? ''} onchange={(e) => relink(l, (e.currentTarget as HTMLSelectElement).value)} disabled={busy !== ''}>
                <NSOption value="">— none —</NSOption>
                {#each data.sites as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
              </NSRoot>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {#if data?.lastSyncAt || data?.lastError}
      <p class="mt-3 text-xs text-muted-foreground">
        {#if data.lastSyncAt}last sync {ago(data.lastSyncAt)}{/if}
        {#if data.lastError}<span class="text-destructive"> · {data.lastError}</span>{/if}
      </p>
    {/if}
  </Card.Content>
</Card.Root>

{#if data?.sites.length}
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>default site</Card.Title>
      <Card.Description>New lanes land on this site's chart. With a single analytics site, that one is used automatically.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel>analytics site</Field.FieldLabel>
          <NSRoot bind:value={defSite}>
            <NSOption value="">— none —</NSOption>
            {#each data.sites as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
          </NSRoot>
        </Field.Field>
      </Field.FieldGroup>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onclick={() => saveDefault(false)} disabled={busy !== ''}>save</Button>
        {#if data.lanes.length}
          <Button size="sm" variant="secondary" onclick={() => saveDefault(true)} disabled={busy !== ''}>save and apply to every lane</Button>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
{/if}

<Card.Root class="mt-3">
  <Card.Header>
    <Card.Title>slashloop account</Card.Title>
    <Card.Description>
      {#if data?.connected}
        ✓ connected{data.user ? ` as ${data.user}` : ''} via {data.server}{data.encrypted ? ' · tokens sealed with SLASHLOOP_ENC_KEY' : ''}.
      {:else}
        Signs in on Slashloop with the same Google login your MCP agents use, then comes back here. IndieStack only reads
        <code>get_social_stats</code>; nothing is posted or spent.
      {/if}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="flex flex-wrap gap-2">
      <Button onclick={connect} disabled={busy !== ''}>
        <PlugIcon data-icon="inline-start" /> {data?.connected ? 'reconnect' : 'connect slashloop'}
      </Button>
      {#if data?.connected}
        <span class="flex items-center gap-1 text-xs text-muted-foreground">
          <UnplugIcon class="size-4" /> disconnect
          <ConfirmDelete
            title="Disconnect Slashloop?"
            description="Revokes IndieStack's Slashloop session and removes every lane and social view number from IndieStack. Nothing changes in Slashloop."
            confirmLabel="Disconnect"
            disabled={busy !== ''}
            onConfirm={() => post('/admin/slashloop/disconnect')}
          />
        </span>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
