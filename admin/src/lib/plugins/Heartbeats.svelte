<script lang="ts">
  import { onMount } from 'svelte';
  import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import PencilIcon from '@lucide/svelte/icons/pencil';
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

  type Heartbeat = {
    id: string;
    name: string;
    token: string;
    interval_min: number;
    grace_min: number;
    enabled: number;
    status: string;
    last_beat_at: number | null;
    last_error: string | null;
  };

  const statusDot = (h: Heartbeat) =>
    !h.enabled ? 'bg-muted-foreground' : h.status === 'up' ? 'bg-success' : h.status === 'down' ? 'bg-destructive' : 'bg-muted-foreground';

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const beatUrl = (token: string) => `${location.origin}/beat/${token}`;

  let heartbeats: Heartbeat[] = $state([]);
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

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/heartbeats');
      if (r.ok) heartbeats = (await r.json()).heartbeats ?? [];
      else err = 'failed to load heartbeats';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

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

<Card.Root>
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <HeartPulseIcon />
        <Card.Title>heartbeats</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add heartbeat
        </Button>
      </div>
    </div>
    <Card.Description>Your job pings us — we notice silence.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if heartbeats.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No heartbeats yet</Empty.Title>
          <Empty.Description>Add one below, then have your job POST the beat URL.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each heartbeats as h (h.id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {statusDot(h)}"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{h.name}</span>
                {#if !h.enabled}<span class="text-xs text-muted-foreground">paused</span>{/if}
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">
                POST {beatUrl(h.token)}
              </div>
              <div class="truncate text-xs text-muted-foreground">
                every {h.interval_min}m + {h.grace_min}m grace · last beat {ago(h.last_beat_at)}
                {#if h.last_error} · <span class="text-destructive">{h.last_error}</span>{/if}
              </div>
            </div>
            <Badge variant={h.enabled ? (h.status === 'up' ? 'success' : h.status === 'down' ? 'destructive' : 'outline') : 'secondary'}>{h.enabled ? h.status : 'paused'}</Badge>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" title="edit" href={`/admin/jobs/${h.id}`}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon" title={h.enabled ? 'pause' : 'resume'} disabled={busy !== ''} onclick={() => api(`/admin/jobs/${h.id}/toggle`)}>
                {#if h.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
              </Button>
              <ConfirmDelete
                title="Remove heartbeat?"
                description={`Stop watching ${h.name}. Missed-beat history stays.`}
                disabled={busy !== ''}
                onConfirm={() => api(`/admin/jobs/${h.id}/delete`)}
              />
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if showAdd}
<div bind:this={addAnchor} class="scroll-mt-24">
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>new heartbeat</Card.Title>
      <Card.Description>We hand you a beat URL to POST from your job.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/jobs" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="jname">name</Field.FieldLabel>
            <Input id="jname" name="name" maxlength={40} placeholder="nightly-backup" required />
          </Field.Field>
          <div class="grid gap-2 sm:grid-cols-2">
            <Field.Field>
              <Field.FieldLabel for="interval">expect a beat every (minutes)</Field.FieldLabel>
              <Input id="interval" name="interval_min" type="number" min="1" max="1440" value="60" />
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel for="grace">grace minutes</Field.FieldLabel>
              <Input id="grace" name="grace_min" type="number" min="0" max="120" value="2" />
            </Field.Field>
          </div>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add heartbeat
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}
