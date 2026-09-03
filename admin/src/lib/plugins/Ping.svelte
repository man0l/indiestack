<script lang="ts">
  import { onMount } from 'svelte';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Root as NSRoot, Option as NSOption, OptGroup as NSGroup } from '$lib/components/ui/native-select';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';

  type Monitor = {
    id: string;
    name: string;
    url: string;
    interval_min: number;
    enabled: number;
    status: string;
    last_check_at: number | null;
    last_status_code: number | null;
    last_latency_ms: number | null;
    last_error: string | null;
  };

  const statusDot = (m: Monitor) =>
    !m.enabled ? 'bg-muted-foreground' : m.status === 'up' ? 'bg-success' : m.status === 'down' ? 'bg-destructive' : 'bg-muted-foreground';

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  let monitors: Monitor[] = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let showAdd = $state(false);

  async function load() {
    loading = true;
    const r = await fetch('/api/monitors');
    if (r.ok) monitors = (await r.json()).monitors ?? [];
    loading = false;
  }

  onMount(load);

  async function api(action: string, body?: FormData) {
    busy = action;
    err = '';
    const r = await fetch(action, { method: 'POST', body, headers: { accept: 'application/json' } });
    const j = await r.json().catch(() => ({ ok: r.ok }));
    if (!j.ok) err = j.error ?? 'failed';
    else msg = j.msg ?? 'done';
    await load();
    busy = '';
  }
</script>

{#if msg}
  <Alert.Root class="mb-3 border-chart-1/40 bg-chart-1/10">
    <Alert.Description class="text-primary">{msg}</Alert.Description>
  </Alert.Root>
{/if}
{#if err}
  <Alert.Root class="mb-3" variant="destructive">
    <Alert.Description>{err}</Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Header>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <ActivityIcon />
        <Card.Title>monitors</Card.Title>
      </div>
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add monitor
        </Button>
      </div>
    </div>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if monitors.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Title>No monitors yet</Empty.Title>
          <Empty.Description>Add HTTP, TCP, DNS, SSL or a host check below.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each monitors as m (m.id)}
          <div class="flex items-center gap-3 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full {statusDot(m)}"></span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{m.name}</span>
                <span class="text-xs text-muted-foreground">paused</span>
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {m.url} · every {m.interval_min}m
                {#if m.last_error} · <span class="text-destructive">{m.last_error}</span>{/if}
              </div>
            </div>
            {#if m.last_status_code != null}<span class="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{m.last_status_code}</span>{/if}
            {#if m.last_latency_ms != null}<span class="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{m.last_latency_ms}ms</span>{/if}
            <span class="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{ago(m.last_check_at)}</span>
            <span class="rounded-full px-2 py-0.5 text-xs font-medium {m.enabled ? (m.status === 'up' ? 'bg-chart-2/20 text-success' : 'bg-destructive/20 text-destructive') : 'bg-muted text-muted-foreground'}">{m.enabled ? m.status : 'paused'}</span>
            <div class="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" title="edit" href={`/admin/monitors/${m.id}`}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon" title={m.enabled ? 'pause' : 'resume'} disabled={busy !== ''} onclick={() => api(`/admin/monitors/${m.id}/toggle`)}>
                {#if m.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
              </Button>
              <Button variant="ghost" size="icon" title="remove" disabled={busy !== ''} onclick={() => api(`/admin/monitors/${m.id}/delete`)}>
                <Trash2Icon />
              </Button>
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if showAdd}
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>new monitor</Card.Title>
      <Card.Description>First check runs immediately on add.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/monitors" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="kind">type</Field.FieldLabel>
            <NSRoot id="kind" name="kind">
                <NSGroup>
                  <NSOption value="http">HTTP(S)</NSOption>
                  <NSOption value="tcp">TCP port</NSOption>
                  <NSOption value="udp">UDP port (TCP probe)</NSOption>
                  <NSOption value="icmp">Host (TCP fallback)</NSOption>
                  <NSOption value="dns">DNS (DoH)</NSOption>
                  <NSOption value="ssl">SSL expiry</NSOption>
                  <NSOption value="domain">Domain expiry</NSOption>
                </NSGroup>
            </NSRoot>
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel for="url">target</Field.FieldLabel>
            <Input id="url" name="url" placeholder="https://example.com  or  example.com:22" required />
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel for="mname">name (optional)</Field.FieldLabel>
            <Input id="mname" name="name" maxlength={40} placeholder="api" />
          </Field.Field>
          <div class="flex gap-2">
            <Field.Field class="flex-1">
              <Field.FieldLabel for="interval">interval minutes</Field.FieldLabel>
              <Input id="interval" name="interval_min" type="number" min="1" max="60" value="5" />
            </Field.Field>
            <Field.Field class="flex-1">
              <Field.FieldLabel for="expect">expected status (0 = any 2xx)</Field.FieldLabel>
              <Input id="expect" name="expect_status" type="number" min="0" max="599" value="0" />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.FieldLabel for="latency">slow if slower than ms (0 = off)</Field.FieldLabel>
            <Input id="latency" name="max_latency_ms" type="number" min="0" max="15000" value="0" />
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel for="keyword">keyword (optional)</Field.FieldLabel>
            <Input id="keyword" name="keyword" maxlength={80} placeholder="ok" />
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel for="kmode">keyword mode</Field.FieldLabel>
            <NSRoot id="kmode" name="keyword_mode">
                <NSGroup>
                  <NSOption value="exists">must contain</NSOption>
                  <NSOption value="absent">must not contain</NSOption>
                </NSGroup>
            </NSRoot>
          </Field.Field>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add monitor
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
{/if}
