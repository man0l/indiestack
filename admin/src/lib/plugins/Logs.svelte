<script lang="ts">
  import { onMount } from 'svelte';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import ConfirmDelete from './ConfirmDelete.svelte';
  import CloudIcon from '@lucide/svelte/icons/cloud';
  import SearchSelect from './SearchSelect.svelte';

  type LogSource = {
    id: string;
    name: string;
    token: string;
    enabled: number;
  };

  const ingestUrl = (token: string) => `${location.origin}/log/${token}`;

  let sources: LogSource[] = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd = $state(false);

  let addAnchor: HTMLElement | null = $state(null);

  $effect(() => {
    if (showAdd && addAnchor) {
      addAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      addAnchor.querySelector('input')?.focus({ preventScroll: true });
    }
  });
  let cfConnected = $state(false);
  let cfScripts: string[] = $state([]);
  let cfMapping: Record<string, string> = $state({});
  let cfLoading = $state(false);

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/logsources');
      if (r.ok) sources = (await r.json()).sources ?? [];
      else err = 'failed to load sources';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function loadCf() {
    cfLoading = true;
    try {
      const r = await fetch('/api/cfworkers');
      if (r.ok) {
        const j = await r.json();
        cfConnected = j.connected ?? false;
        cfScripts = j.scripts ?? [];
        cfMapping = j.mapping ?? {};
      }
    } catch {
      cfConnected = false;
    } finally {
      cfLoading = false;
    }
  }

  onMount(loadCf);

  async function saveMapping(worker: string, sourceId: string) {
    const next = { ...cfMapping };
    if (sourceId) next[worker] = sourceId;
    else delete next[worker];
    const r = await fetch('/admin/cloudflare/mapping', {
      method: 'POST',
      body: JSON.stringify({ mappings: next }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    const j = await r.json().catch(() => ({ ok: r.ok }));
    if (!j.ok) err = j.error ?? 'failed to save mapping';
    else {
      cfMapping = next;
      msg = j.msg ?? 'done';
    }
  }

  const sourceItems = $derived([
    { value: '', label: 'Not mapped' },
    ...sources.map((s) => ({ value: s.id, label: s.name })),
  ]);

  async function api(action: string, body?: FormData) {
    busy = action;
    err = '';
    try {
      const r = await fetch(action, { method: 'POST', body, headers: { accept: 'application/json' } });
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

{#if showAdd}
<div bind:this={addAnchor} class="scroll-mt-24">
  <Card.Root class="mb-3">
    <Card.Header>
      <Card.Title>new log source</Card.Title>
      <Card.Description>We hand you an ingest URL to POST JSON to.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/logs" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="sname">name</Field.FieldLabel>
            <Input id="sname" name="name" maxlength={40} placeholder="api-errors" required />
          </Field.Field>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add log source
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}

<Card.Root>
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <FileTextIcon />
        <Card.Title>logs</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add source
        </Button>
      </div>
    </div>
    <Card.Description
      >POST errors here — not access logs. Kept 24h in R2. Tail and search live in the <a
        class="text-primary underline"
        href="/admin/p/explorer">explorer</a
      >.</Card.Description
    >
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if sources.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No log sources yet</Empty.Title>
          <Empty.Description>Add one below, then POST JSON to its URL.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each sources as s (s.id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {s.enabled ? 'bg-success' : 'bg-muted-foreground'}"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{s.name}</span>
                {#if !s.enabled}<span class="text-xs text-muted-foreground">paused</span>{/if}
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">
                POST {ingestUrl(s.token)}
              </div>
            </div>
            <Badge variant={s.enabled ? 'success' : 'secondary'}>{s.enabled ? 'live' : 'paused'}</Badge>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" title="open" href={`/admin/logs/${s.id}`}>
                <FolderOpenIcon />
              </Button>
              <Button variant="ghost" size="icon" title={s.enabled ? 'pause' : 'resume'} disabled={busy !== ''} onclick={() => api(`/admin/logs/${s.id}/toggle`)}>
                {#if s.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
              </Button>
              <ConfirmDelete
                title="Remove log source?"
                description={`Delete ${s.name} and its last 24h of events. Apps posting to it will get errors.`}
                disabled={busy !== ''}
                onConfirm={() => api(`/admin/logs/${s.id}/delete`)}
              />
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
    </Card.Content>
</Card.Root>
