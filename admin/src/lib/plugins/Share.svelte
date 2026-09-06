<script lang="ts">
  import { onMount } from 'svelte';
  import Share2Icon from '@lucide/svelte/icons/share-2';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import EyeOffIcon from '@lucide/svelte/icons/eye-off';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';

  type Share = { site_id: string; site_name: string; on: boolean; url: string | null };

  let shares: Share[] = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/shares');
      if (r.ok) shares = (await r.json()).shares ?? [];
      else err = 'failed to load shares';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function toggle(siteId: string) {
    busy = siteId;
    err = '';
    try {
      const r = await fetch(`/admin/share/${siteId}/toggle`, { method: 'POST', headers: { accept: 'application/json' } });
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
        <Share2Icon />
        <Card.Title>share</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
      </div>
    </div>
    <Card.Description>Share links are public: visitors see views, uniques, top paths, referrers and goals — never raw visitor data.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if shares.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No sites yet</Empty.Title>
          <Empty.Description>Add an analytics site first.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each shares as s (s.site_id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {s.on ? 'bg-success' : 'bg-muted-foreground'}"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{s.site_name}</span>
                {#if !s.on}<span class="text-xs text-muted-foreground">private</span>{/if}
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {#if s.url}<a class="text-primary underline" href={s.url} target="_blank" rel="noopener">{s.url}</a>{:else}no share link{/if}
              </div>
            </div>
            <Badge variant={s.on ? 'success' : 'secondary'}>{s.on ? 'public' : 'private'}</Badge>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" disabled={busy !== ''} onclick={() => toggle(s.site_id)}>
                {#if s.on}<EyeOffIcon data-icon="inline-start" /> make private{:else}<EyeIcon data-icon="inline-start" /> share publicly{/if}
              </Button>
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
