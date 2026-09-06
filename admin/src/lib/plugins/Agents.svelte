<script lang="ts">
  import { onMount } from 'svelte';
  import BotIcon from '@lucide/svelte/icons/bot';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
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

  type AgentToken = { id: string; name: string; token: string; enabled: number };

  let tokens: AgentToken[] = $state([]);
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
      const r = await fetch('/api/agents');
      if (r.ok) tokens = (await r.json()).tokens ?? [];
      else err = 'failed to load tokens';
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
        <BotIcon />
        <Card.Title>ai agents</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> mint token
        </Button>
      </div>
    </div>
    <Card.Description
      >Your stack speaks agent: public <a class="text-primary underline" href="/agents.md">/agents.md</a>, a
      status JSON, and MCP tools (overview, monitors, heartbeats, deploys, incidents, analytics).</Card.Description
    >
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if tokens.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No agent tokens</Empty.Title>
          <Empty.Description>Mint one, then point Claude, Cursor, or your own agent at the MCP URL.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each tokens as t (t.id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {t.enabled ? 'bg-success' : 'bg-muted-foreground'}"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{t.name}</span>
                {#if !t.enabled}<span class="text-xs text-muted-foreground">paused</span>{/if}
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">
                MCP {location.origin}/mcp/{t.token}
              </div>
            </div>
            <Badge variant={t.enabled ? 'success' : 'secondary'}>{t.enabled ? 'live' : 'paused'}</Badge>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" disabled={busy !== ''} onclick={() => api(`/admin/agents/${t.id}/toggle`)}>
                {#if t.enabled}<PauseIcon data-icon="inline-start" /> pause{:else}<PlayIcon data-icon="inline-start" /> resume{/if}
              </Button>
              <ConfirmDelete
                title="Revoke token?"
                description={`Revoke ${t.name}. Agents using it lose access immediately.`}
                confirmLabel="Revoke"
                disabled={busy !== ''}
                onConfirm={() => api(`/admin/agents/${t.id}/delete`)}
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
      <Card.Title>new agent token</Card.Title>
      <Card.Description>Read-only. Revoke replaces the token the agent knows.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/agents" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="aname">agent name</Field.FieldLabel>
            <Input id="aname" name="name" maxlength={40} placeholder="claude" required />
          </Field.Field>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> mint agent token
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}

<Card.Root class="mt-3">
  <Card.Content class="pt-6">
    <Button variant="secondary" href="/agents.md" target="_blank" rel="noopener">
      <BookOpenIcon data-icon="inline-start" /> open /agents.md
    </Button>
  </Card.Content>
</Card.Root>
