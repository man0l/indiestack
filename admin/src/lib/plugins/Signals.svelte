<script lang="ts">
  import { onMount } from 'svelte';
  import RadioIcon from '@lucide/svelte/icons/radio';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import SaveIcon from '@lucide/svelte/icons/save';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Root as NSRoot, Option as NSOption, OptGroup as NSGroup } from '$lib/components/ui/native-select';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import ConfirmDelete from './ConfirmDelete.svelte';

  type Watcher = {
    id: string;
    source: string;
    query: string;
    last_poll_at: number | null;
    last_status: string | null;
  };
  type Signal = { source: string; title: string; author: string | null; url: string | null; ts: number };

  let watchers: Watcher[] = $state([]);
  let signals: Signal[] = $state([]);
  let sites: Array<{ id: string; name: string }> = $state([]);
  let keys = $state({ x: false, redditId: false, redditSecret: false });
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd = $state(false);

  let addAnchor: HTMLElement | null = $state(null);

  $effect(() => {
    if (showAdd && addAnchor) {
      addAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      addAnchor.querySelector('input, select')?.focus({ preventScroll: true });
    }
  });

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const bad = (w: Watcher) =>
    Boolean(w.last_status && !w.last_status.startsWith('ok') && !w.last_status.startsWith('no'));

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/signals');
      if (r.ok) {
        const j = await r.json();
        watchers = j.watchers ?? [];
        signals = j.signals ?? [];
        sites = j.sites ?? [];
        keys = j.keys ?? keys;
      } else err = 'failed to load signals';
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
        <RadioIcon />
        <Card.Title>signals</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add watcher
        </Button>
      </div>
    </div>
    <Card.Description>External events — GitHub commits, X mentions, Reddit mentions. Watchers poll every 15 min on the tick.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if watchers.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No watchers</Empty.Title>
          <Empty.Description>Watch a repo for commits or a keyword for mentions.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each watchers as w (w.id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {bad(w) ? 'bg-destructive' : 'bg-success'}"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{w.source} · {w.query}</span>
                <Badge variant="secondary">{w.source}</Badge>
              </div>
              <div class="truncate text-xs text-muted-foreground">
                polled {ago(w.last_poll_at)}{w.last_status ? ` · ${w.last_status}` : ''}
              </div>
            </div>
            <div class="ml-auto flex shrink-0 gap-1">
              <ConfirmDelete
                title="Remove watcher?"
                description={`Stop watching ${w.source} · ${w.query}. Collected signals stay.`}
                disabled={busy !== ''}
                onConfirm={() => api(`/admin/signals/${w.id}/delete`)}
              />
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if signals.length > 0 && !loading}
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>recent signals</Card.Title>
    </Card.Header>
    <Card.Content>
      <div class="flex flex-col gap-1">
        {#each signals as s (s.url ?? s.title)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2">
            <span class="size-2 shrink-0 rounded-full bg-success"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="truncate text-sm font-medium">{s.source} · {s.title}</div>
              <div class="truncate text-xs text-muted-foreground">
                {s.author ?? ''}{s.url ? ' · ' : ''}{#if s.url}<a class="text-primary underline" href={s.url} target="_blank" rel="noopener">open</a>{/if} · {ago(s.ts)}
              </div>
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    </Card.Content>
  </Card.Root>
{/if}

{#if showAdd}
<div bind:this={addAnchor} class="scroll-mt-24">
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>new watcher</Card.Title>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/signals" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          {#if sites.length}
            <Field.Field>
              <Field.FieldLabel for="site">site</Field.FieldLabel>
              <NSRoot id="site" name="site_id">
                <NSGroup>
                  {#each sites as s (s.id)}<NSOption value={s.id}>{s.name}</NSOption>{/each}
                </NSGroup>
              </NSRoot>
            </Field.Field>
          {:else}
            <p class="text-sm text-muted-foreground">Add an analytics site first.</p>
          {/if}
          <div class="grid gap-2 sm:grid-cols-2">
            <Field.Field>
              <Field.FieldLabel for="source">source</Field.FieldLabel>
              <NSRoot id="source" name="source">
                <NSGroup>
                  <NSOption value="github">GitHub commits (owner/repo)</NSOption>
                  <NSOption value="x">X mentions (needs bearer key)</NSOption>
                  <NSOption value="reddit">Reddit mentions (needs app id/secret)</NSOption>
                </NSGroup>
              </NSRoot>
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel for="query">query</Field.FieldLabel>
              <Input id="query" name="query" maxlength={80} placeholder="man0l/indiestack · indiestack · @manol_ai" required />
            </Field.Field>
          </div>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add watcher
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}

<Card.Root class="mt-3">
  <Card.Header>
    <Card.Title>api keys</Card.Title>
    <Card.Description>
      X {keys.x ? '✓ key configured' : '⚠ key not configured yet — add it below'} · Reddit {keys.redditId && keys.redditSecret ? '✓ configured' : '⚠ add app id/secret below'} · GitHub reuses the deploy token.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        api('/admin/signals/keys', new FormData(e.currentTarget as HTMLFormElement));
      }}
    >
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="xb">X bearer token</Field.FieldLabel>
          <Input id="xb" name="signals_x_bearer" type="password" placeholder={keys.x ? '•••••• (saved)' : 'paste…'} />
        </Field.Field>
        <div class="grid gap-2 sm:grid-cols-2">
          <Field.Field>
            <Field.FieldLabel for="rid">Reddit client id</Field.FieldLabel>
            <Input id="rid" name="signals_reddit_client_id" placeholder="script-type app" />
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel for="rsec">Reddit client secret</Field.FieldLabel>
            <Input id="rsec" name="signals_reddit_client_secret" type="password" placeholder={keys.redditSecret ? '•••••• (saved)' : 'paste…'} />
          </Field.Field>
        </div>
      </Field.FieldGroup>
      <Button type="submit" class="mt-4" variant="secondary" disabled={busy !== ''}>
        <SaveIcon data-icon="inline-start" /> save keys
      </Button>
    </form>
  </Card.Content>
</Card.Root>
