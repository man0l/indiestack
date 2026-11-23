<script lang="ts">
  import { onMount } from 'svelte';
  import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import UnplugIcon from '@lucide/svelte/icons/unplug';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Root as NSRoot, Option as NSOption } from '$lib/components/ui/native-select';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import ConfirmDelete from './ConfirmDelete.svelte';

  type Day = { day: string; impressions: number; searchImpressions: number; downloads: number; searchDownloads: number };
  type App = {
    id: string;
    appleId: string;
    name: string;
    siteId: string | null;
    status: 'pending' | 'ready' | 'error';
    lastSyncAt: number | null;
    lastDiscoverAt: number | null;
    lastError: string | null;
    instances: { queued: number; done: number; failed: number };
    totals30: { impressions: number; searchImpressions: number; downloads: number; searchDownloads: number };
    lastDay: string | null;
    days: Day[];
  };
  type Data = {
    connected: boolean;
    keyId: string | null;
    encrypted: boolean;
    maxApps: number;
    apps: App[];
    sites: Array<{ id: string; name: string }>;
  };

  const ASC_COLOR = 'oklch(0.66 0.14 245)';

  let data: Data | null = $state(null);
  let available: Array<{ appleId: string; name: string; bundleId: string }> = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let pickApple = $state('');
  let pickSite = $state('');

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
      const r = await fetch('/admin/appstore/data', { headers: { accept: 'application/json' } });
      if (r.ok) data = await r.json();
      else err = 'failed to load app store';
      if (data?.connected && data.apps.length < data.maxApps) await loadAvailable();
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  async function loadAvailable() {
    const r = await fetch('/admin/appstore/apps', { headers: { accept: 'application/json' } });
    const j = await r.json().catch(() => ({ ok: false, error: 'failed to list apps' }));
    if (!j.ok) {
      err = j.error ?? 'failed to list apps';
      return;
    }
    const tracked = new Set((data?.apps ?? []).map((a) => a.appleId));
    available = (j.apps ?? []).filter((a: { appleId: string }) => !tracked.has(a.appleId));
    if (!pickApple && available.length) pickApple = available[0].appleId;
    if (!pickSite && data?.sites.length) pickSite = data.sites[0].id;
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

  async function connect(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    if (await post('/admin/appstore/connect', new FormData(form))) form.reset();
  }

  async function addApp(e: SubmitEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('apple_id', pickApple);
    fd.set('name', available.find((a) => a.appleId === pickApple)?.name ?? pickApple);
    fd.set('site_id', pickSite);
    pickApple = '';
    await post('/admin/appstore/app', fd);
  }

  async function relink(app: App, siteId: string) {
    const fd = new FormData();
    fd.set('site_id', siteId);
    await post(`/admin/appstore/app/${app.id}/link`, fd);
  }

  const bars = (days: Day[]) => {
    const max = Math.max(1, ...days.map((d) => d.searchImpressions));
    return days.map((d, i) => ({ d, x: i * 8, h: Math.max(1, (d.searchImpressions / max) * 36) }));
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
        <SmartphoneIcon />
        <Card.Title>app store</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        {#if data?.apps.length}
          <Button variant="secondary" size="sm" onclick={() => post('/admin/appstore/sync')} disabled={busy !== ''}>
            <RefreshCwIcon data-icon="inline-start" /> sync now
          </Button>
        {/if}
      </div>
    </div>
    <Card.Description>
      Search impressions and downloads from App Store Connect, daily. Link an app to an analytics site and they show on that
      site's chart next to deploys. Apple reports run ~2–3 days behind.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading && !data}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-20 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if !data?.apps.length}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No apps tracked</Empty.Title>
          <Empty.Description>{data?.connected ? 'Pick an app below.' : 'Connect an App Store Connect API key below.'}</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-3">
        {#each data.apps as a (a.id)}
          <div class="rounded-xl border border-border bg-card p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold">{a.name}</span>
              <Badge variant={a.status === 'ready' ? 'success' : a.status === 'error' ? 'destructive' : 'secondary'}>
                {a.status === 'ready' ? 'syncing' : a.status === 'error' ? 'error' : 'waiting for Apple'}
              </Badge>
              <span class="text-xs text-muted-foreground">id {a.appleId}</span>
              <span class="ml-auto flex shrink-0 gap-1">
                <ConfirmDelete
                  title="Stop tracking app?"
                  description={`Remove ${a.name} and its App Store numbers from IndieStack. Nothing changes in App Store Connect.`}
                  disabled={busy !== ''}
                  onConfirm={() => post(`/admin/appstore/app/${a.id}/delete`)}
                />
              </span>
            </div>
            <p class="mb-2 text-xs text-muted-foreground">
              30 days: <b>{a.totals30.searchImpressions}</b> search impressions (<b>{a.totals30.impressions}</b> total) ·
              <b>{a.totals30.downloads}</b> downloads (<b>{a.totals30.searchDownloads}</b> from search)
              {#if a.lastDay}· latest day reported {a.lastDay}{/if}
            </p>
            {#if a.days.length}
              <svg viewBox={`0 0 ${Math.max(8, a.days.length * 8)} 40`} class="mb-2 h-10 w-full max-w-md" preserveAspectRatio="none" role="img" aria-label="search impressions per day, last 30 days">
                {#each bars(a.days) as b (b.d.day)}
                  <rect x={b.x + 1} y={40 - b.h} width="6" height={b.h} rx="1" fill={ASC_COLOR} opacity="0.6">
                    <title>{b.d.day} · {b.d.searchImpressions} search impressions · {b.d.downloads} downloads</title>
                  </rect>
                {/each}
              </svg>
            {/if}
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>chart on site</span>
              <NSRoot size="sm" value={a.siteId ?? ''} onchange={(e) => relink(a, (e.currentTarget as HTMLSelectElement).value)} disabled={busy !== ''}>
                <NSOption value="">— none —</NSOption>
                {#each data.sites as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
              </NSRoot>
              <span>
                · {a.instances.done} report day(s) loaded{#if a.instances.queued} · {a.instances.queued} queued{/if}{#if a.instances.failed} · {a.instances.failed} failed{/if}
                {#if a.lastSyncAt}· last download {ago(a.lastSyncAt)}{/if}
                {#if a.lastDiscoverAt}· checked Apple {ago(a.lastDiscoverAt)}{/if}
              </span>
            </div>
            {#if a.lastError}<p class="mt-2 text-xs text-destructive">{a.lastError}</p>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if data?.connected && data.apps.length < data.maxApps}
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>track an app</Card.Title>
      <Card.Description>Adding an app asks Apple to start generating its reports. The first ones arrive within 24–48 h, then the last ~90 days backfill.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if available.length === 0}
        <p class="text-xs text-muted-foreground">No more apps visible to this key.</p>
      {:else}
        <form onsubmit={addApp}>
          <Field.FieldGroup>
            <Field.Field>
              <Field.FieldLabel>app</Field.FieldLabel>
              <NSRoot bind:value={pickApple}>
                {#each available as ap (ap.appleId)}<NSOption value={ap.appleId}>{ap.name} · {ap.bundleId}</NSOption>{/each}
              </NSRoot>
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel>show on analytics site</Field.FieldLabel>
              <NSRoot bind:value={pickSite}>
                <NSOption value="">— none —</NSOption>
                {#each data.sites as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
              </NSRoot>
            </Field.Field>
          </Field.FieldGroup>
          <Button type="submit" class="mt-4" disabled={busy !== '' || !pickApple}>
            <PlusIcon data-icon="inline-start" /> track app
          </Button>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}

<Card.Root class="mt-3">
  <Card.Header>
    <Card.Title>app store connect key</Card.Title>
    <Card.Description>
      {#if data?.connected}
        ✓ connected with key <b>{data.keyId}</b>{data.encrypted ? ' · sealed with APPSTORE_ENC_KEY' : ''}. Paste a new key to replace it.
      {:else}
        App Store Connect → Users and Access → Integrations → App Store Connect API → <b>Team Keys</b> → generate a key with the
        <b>Admin</b> role (needed once, to request reports; you can swap to a Sales-and-Reports key afterwards).
      {/if}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form onsubmit={connect}>
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="issuer_id">issuer id</Field.FieldLabel>
          <Input id="issuer_id" name="issuer_id" placeholder="57246542-96fe-1a63-e053-0824d011072a" autocomplete="off" required />
        </Field.Field>
        <Field.Field>
          <Field.FieldLabel for="key_id">key id</Field.FieldLabel>
          <Input id="key_id" name="key_id" placeholder="2X9R4HXF34" autocomplete="off" required />
        </Field.Field>
        <Field.Field>
          <Field.FieldLabel for="p8">private key (.p8)</Field.FieldLabel>
          <Textarea id="p8" name="p8" rows={4} placeholder="-----BEGIN PRIVATE KEY-----" autocomplete="off" spellcheck={false} />
          <Input name="p8_file" type="file" accept=".p8" />
          <Field.FieldDescription>Paste it or pick the AuthKey_….p8 file. It is stored in your D1 and never shown again.</Field.FieldDescription>
        </Field.Field>
      </Field.FieldGroup>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy !== ''}>
          <PlugIcon data-icon="inline-start" /> {data?.connected ? 'replace key' : 'connect'}
        </Button>
        {#if data?.connected}
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <UnplugIcon class="size-4" /> disconnect
            <ConfirmDelete
              title="Disconnect App Store?"
              description="Removes the key, every tracked app and all App Store numbers from IndieStack. Revoke the key in App Store Connect separately."
              confirmLabel="Disconnect"
              disabled={busy !== ''}
              onConfirm={() => post('/admin/appstore/disconnect')}
            />
          </span>
        {/if}
      </div>
    </form>
  </Card.Content>
</Card.Root>
