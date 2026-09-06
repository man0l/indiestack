<script lang="ts">
  import { onMount } from 'svelte';
  import TargetIcon from '@lucide/svelte/icons/target';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
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
  import { Root as NSRoot, Option as NSOption, OptGroup as NSGroup } from '$lib/components/ui/native-select';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import ConfirmDelete from './ConfirmDelete.svelte';

  type GoalRow = {
    id: string;
    name: string;
    kind: string;
    target: string;
    site_name: string;
    s7: { converted: number; uniques: number; rate: number | null };
    s30: { converted: number; uniques: number; rate: number | null };
    top: string;
  };

  let goals: GoalRow[] = $state([]);
  let sites: Array<{ id: string; name: string }> = $state([]);
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

  const rate = (r: number | null) => (r == null ? '—' : `${r}%`);

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/goals');
      if (r.ok) {
        const j = await r.json();
        goals = j.goals ?? [];
        sites = j.sites ?? [];
      } else err = 'failed to load goals';
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
        <TargetIcon />
        <Card.Title>goals</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add goal
        </Button>
      </div>
    </div>
    <Card.Description>Event goals match df.track('name') events; path goals match a page path. Rate is uniques who converted over all uniques.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-12 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else if goals.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No goals yet</Empty.Title>
          <Empty.Description>Track events with df.track('signup') and measure conversion.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-1">
        {#each goals as g (g.id)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2.5">
            <span class="size-2 shrink-0 rounded-full bg-success"></span>
            <div class="min-w-0 flex-1 basis-48">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{g.name}</span>
                <Badge variant="secondary">{g.kind}</Badge>
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {g.target} · {g.site_name} · 7d {g.s7.converted}/{g.s7.uniques} · 30d {g.s30.converted}/{g.s30.uniques}{g.top ? ` · top: ${g.top}` : ''}
              </div>
            </div>
            <span class="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{rate(g.s30.rate)} · 30d</span>
            <div class="ml-auto flex shrink-0 gap-1">
              <ConfirmDelete
                title="Remove goal?"
                description={`Delete the ${g.name} goal. Past conversions stay in history.`}
                disabled={busy !== ''}
                onConfirm={() => api(`/admin/goals/${g.id}/delete`)}
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
      <Card.Title>new goal</Card.Title>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/goals" onsubmit={() => setTimeout(load, 600)}>
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
          {/if}
          <Field.Field>
            <Field.FieldLabel for="gname">name</Field.FieldLabel>
            <Input id="gname" name="name" maxlength={40} placeholder="signups" required />
          </Field.Field>
          <div class="grid gap-2 sm:grid-cols-2">
            <Field.Field>
              <Field.FieldLabel for="kind">type</Field.FieldLabel>
              <NSRoot id="kind" name="kind">
                <NSGroup>
                  <NSOption value="event">event — df.track('name')</NSOption>
                  <NSOption value="path">path — a page visit</NSOption>
                </NSGroup>
              </NSRoot>
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel for="target">target (event name, or path like /signup)</Field.FieldLabel>
              <Input id="target" name="target" maxlength={120} placeholder="signup · /pricing" required />
            </Field.Field>
          </div>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add goal
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}
