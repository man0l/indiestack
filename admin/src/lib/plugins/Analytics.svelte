<script lang="ts">
  import { onMount } from 'svelte';
  import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import EyeOffIcon from '@lucide/svelte/icons/eye-off';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import ConfirmDelete from './ConfirmDelete.svelte';
  import SiteChart from './SiteChart.svelte';

  type Annotation = {
    day: string;
    kind: 'commit' | 'deploy' | 'mention';
    label: string;
    sub: string;
    url: string | null;
  };

  type SiteStats = {
    id: string;
    name: string;
    enabled: number;
    idMode: 'daily' | 'persistent';
    totals: { views: number; uniques: number };
    days: Array<{ day: string; views: number; uniques: number }>;
    topPaths: Array<{ path: string; views: number }>;
    topRefs: Array<{ ref: string; views: number }>;
    topCountries: Array<{ country: string; views: number }>;
    annotations: Annotation[];
    share: { on: boolean; url: string | null };
    snippet: string;
  };

  let sites: SiteStats[] = $state([]);
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
      const r = await fetch('/api/analytics');
      if (r.ok) sites = (await r.json()).sites ?? [];
      else err = 'failed to load analytics';
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

  const KIND = {
    commit: { color: 'var(--primary)', label: 'commits' },
    deploy: { color: 'var(--success)', label: 'deploys' },
    mention: { color: 'var(--warning)', label: 'mentions' },
  } as const;

  const annOn = (s: SiteStats, day: string) => s.annotations.filter((a) => a.day === day);

  type Chart = { ax: string[]; vmax: number; vvals: number[]; uvals: number[] };

  const chart = (s: SiteStats): Chart => {
    const ax = axis();
    const at = (d: string) => s.days.find((x) => x.day === d);
    const vvals = ax.map((d) => at(d)?.views ?? 0);
    const uvals = ax.map((d) => at(d)?.uniques ?? 0);
    return { ax, vmax: Math.max(...vvals, ...uvals, 1), vvals, uvals };
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
        <ChartColumnIcon />
        <Card.Title>analytics</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
        <Button size="sm" onclick={() => (showAdd = !showAdd)} disabled={busy !== ''}>
          <PlusIcon data-icon="inline-start" /> add site
        </Button>
      </div>
    </div>
    <Card.Description>Cookie-free pageviews. One D1 write per view, capped 2,000 views/site/day. 30-day retention.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-32 rounded-lg" />
        <Skeleton class="h-32 rounded-lg" />
      </div>
    {:else if sites.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No sites</Empty.Title>
          <Empty.Description>Add one, pick a visitor-ID mode, paste the snippet.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-4">
        {#each sites as s (s.id)}
          <div class="rounded-xl border border-border bg-card p-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold">{s.name}</span>
              {#if !s.enabled}<Badge variant="secondary">paused</Badge>{/if}
              <Badge variant={s.share.on ? 'success' : 'secondary'}>{s.share.on ? 'public' : 'private'}</Badge>
              <Badge variant="outline" title={s.idMode === 'persistent' ? 'Returning visitors recognized across days via first-party localStorage ID' : 'Cookie-free daily-rotating visitor hash'}>
                {s.idMode === 'persistent' ? 'persistent id' : 'cookie-free'}
              </Badge>
              <span class="ml-auto flex shrink-0 gap-1">
                {#if s.share.on && s.share.url}
                  <Button variant="ghost" size="icon" title="open public chart" href={s.share.url} target="_blank" rel="noopener">
                    <ExternalLinkIcon />
                  </Button>
                {/if}
                <Button variant="ghost" size="icon" title={s.share.on ? 'make private' : 'share publicly'} disabled={busy !== ''} onclick={() => api(`/admin/share/${s.id}/toggle`)}>
                  {#if s.share.on}<EyeOffIcon />{:else}<EyeIcon />{/if}
                </Button>
                <Button variant="ghost" size="icon" title={s.enabled ? 'pause' : 'resume'} disabled={busy !== ''} onclick={() => api(`/admin/analytics/${s.id}/toggle`)}>
                  {#if s.enabled}<PauseIcon />{:else}<PlayIcon />{/if}
                </Button>
                <ConfirmDelete
                  title="Remove site?"
                  description={`Delete ${s.name} and its stats. The snippet will stop recording.`}
                  disabled={busy !== ''}
                  onConfirm={() => api(`/admin/analytics/${s.id}/delete`)}
                />
              </span>
            </div>
            <p class="mb-2 text-xs text-muted-foreground">7 days: <b>{s.totals.views}</b> views · <b>{s.totals.uniques}</b> uniques</p>
            <SiteChart days={s.days} annotations={s.annotations} />
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">top paths</div>
                {#if s.topPaths.length === 0}<span class="text-xs text-muted-foreground">—</span>{:else}
                  {#each s.topPaths as p (p.path)}<div class="truncate text-xs text-muted-foreground">{p.path} · {p.views}</div>{/each}
                {/if}
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">top referrers</div>
                {#if s.topRefs.length === 0}<span class="text-xs text-muted-foreground">—</span>{:else}
                  {#each s.topRefs as r (r.ref)}<div class="truncate text-xs text-muted-foreground">{r.ref} · {r.views}</div>{/each}
                {/if}
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">countries</div>
                {#if s.topCountries.length === 0}<span class="text-xs text-muted-foreground">—</span>{:else}
                  {#each s.topCountries as c (c.country)}<div class="truncate text-xs text-muted-foreground">{c.country} · {c.views}</div>{/each}
                {/if}
              </div>
            </div>
            <div class="mt-2 truncate font-mono text-xs text-muted-foreground">{s.snippet}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if showAdd}
<div bind:this={addAnchor} class="scroll-mt-24">
  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>new site</Card.Title>
      <Card.Description>Pick how visitors are counted before you paste the snippet.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="post" action="/admin/analytics" onsubmit={() => setTimeout(load, 600)}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="name">site name</Field.FieldLabel>
            <Input id="name" name="name" maxlength={40} placeholder="marketing site" required />
          </Field.Field>
          <Field.Field>
            <Field.FieldLabel>visitor id mode</Field.FieldLabel>
            <div class="flex flex-col gap-2">
              <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 has-[:checked]:border-ring">
                <input type="radio" name="mode" value="daily" checked class="mt-0.5 size-4 accent-current" />
                <span class="flex flex-col gap-1">
                  <span class="text-sm font-medium">cookie-free (daily)</span>
                  <span class="text-xs text-muted-foreground">
                    Nothing is stored in the visitor's browser — a salted daily-rotating hash counts uniques.
                    Returning visitors are <b>not</b> linked across days. Safest default: no cookie-policy mention needed in most cases.
                  </span>
                </span>
              </label>
              <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 has-[:checked]:border-ring">
                <input type="radio" name="mode" value="persistent" class="mt-0.5 size-4 accent-current" />
                <span class="flex flex-col gap-1">
                  <span class="text-sm font-medium">persistent id (localStorage)</span>
                  <span class="text-xs text-muted-foreground">
                    A random ID is kept in the visitor's localStorage (no cookies), so returning visitors are
                    recognized across days. <b>Advised:</b> mention analytics storage in your site's privacy
                    or cookie policy — some jurisdictions treat it like a cookie.
                  </span>
                </span>
              </label>
            </div>
          </Field.Field>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <ZapIcon data-icon="inline-start" /> add site
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
{/if}
