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
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
  import CopyBlock from './CopyBlock.svelte';
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
    newReturn: { new: number; returning: number };
    days: Array<{ day: string; views: number; uniques: number }>;
    topPaths: Array<{ path: string; views: number }>;
    topRefs: Array<{ ref: string; views: number }>;
    topCountries: Array<{ country: string; views: number }>;
    sources: Array<{ source: string; views: number }>;
    campaigns: Array<{ campaign: string; views: number }>;
    filtered: number;
    crawls: Array<{ day: string; total: number; byCategory: Record<string, number> }>;
    crawlers: Crawler[];
    aiRefs: Array<{ source: string; views: number }>;
    keywords: Array<{ term: string; views: number }>;
    devices: Array<{ device: string; views: number }>;
    annotations: Annotation[];
    appstore: Array<{ day: string; impressions: number; searchImpressions: number; downloads: number; searchDownloads: number }>;
    social: Array<{ day: string; views: number; byLane: Record<string, number> }>;
    share: { on: boolean; url: string | null };
    snippet: string;
  };

  type Crawler = {
    crawler: string;
    category: string | null;
    verified: boolean;
    fetches: number;
  };

  // What each source bucket means, shown on hover.
  const SOURCE_HINT: Record<string, string> = {
    direct: 'no referrer and no UTM tag: typed URL, bookmark, app, or a link that strips the referrer',
    search: 'Google, Bing, DuckDuckGo & co',
    ai: 'a person clicked a link in ChatGPT, Perplexity, Gemini, Claude…',
    social: 'social referrer or utm_source=youtube/x/…',
    email: 'utm_medium=email/newsletter',
    campaign: 'other UTM-tagged links',
    other: 'any other referring site',
  };

  // Same hue as the chart's crawl bars; opacity steps mirror it (solid = live AI answers).
  const CRAWL_COLOR = 'oklch(0.7 0.14 290)';
  const CRAWL_CAT: Record<string, { label: string; alpha: number }> = {
    answer_fetch: { label: 'ai answers', alpha: 1 },
    search_index: { label: 'search', alpha: 0.6 },
    training: { label: 'training', alpha: 0.32 },
  };
  const crawlCats = (cs: Crawler[]) => {
    const n = new Map<string, number>();
    for (const c of cs) {
      const k = c.category && CRAWL_CAT[c.category] ? c.category : 'other';
      n.set(k, (n.get(k) ?? 0) + c.fetches);
    }
    return [...Object.keys(CRAWL_CAT), 'other']
      .filter((k) => n.get(k))
      .map((k) => ({ key: k, n: n.get(k)!, label: CRAWL_CAT[k]?.label ?? 'other', alpha: CRAWL_CAT[k]?.alpha ?? 0.15 }));
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
      if (r.ok) {
        const j = await r.json();
        sites = j.sites ?? [];
      } else err = 'failed to load analytics';
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

{#snippet panel(title: string, rows: Array<{ k: string; v: number; hint?: string }>)}
  {@const max = Math.max(1, ...rows.map((r) => r.v))}
  <div class="min-w-0">
    <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
    {#if rows.length === 0}<span class="text-xs text-muted-foreground">—</span>{:else}
      {#each rows as r (r.k)}
        <div class="relative flex items-center gap-3 rounded px-1.5 py-[3px] text-xs" title={r.hint ?? r.k}>
          <span class="absolute inset-y-0 left-0 rounded bg-muted/45" style="width: {(r.v / max) * 100}%"></span>
          <span class="relative truncate text-foreground/85">{r.k}</span>
          <span class="relative ml-auto shrink-0 tabular-nums text-muted-foreground">{r.v}</span>
        </div>
      {/each}
    {/if}
  </div>
{/snippet}

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
            <p class="mb-2 text-xs text-muted-foreground">
              last 7 days
              {#if s.idMode === 'persistent'}· <b>{s.newReturn.new}</b> new · <b>{s.newReturn.returning}</b> returning{/if}
              {#if s.filtered > 0}
                · <span title="Beacons from cloud / hosting / email-security networks (link scanners, headless renderers). Kept out of every number here.">{s.filtered} data-centre hits filtered</span>
              {/if}
            </p>
            <SiteChart days={s.days} annotations={s.annotations} appstore={s.appstore ?? []} social={s.social ?? []} crawls={s.crawls ?? []} />
            {#if s.crawlers?.length}
              {@const total = Math.max(1, s.crawlers.reduce((a, c) => a + c.fetches, 0))}
              {@const cats = crawlCats(s.crawlers)}
              <details class="group mb-4 rounded-lg border border-border/70 bg-muted/15">
                <summary class="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                  <span class="flex items-center gap-2">
                    <span class="font-medium text-foreground">{s.crawlers.length} crawlers</span>
                    <span class="tabular-nums text-muted-foreground">{total} fetches</span>
                  </span>
                  <span class="flex h-1.5 w-28 gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    {#each cats as c (c.key)}
                      <span class="h-full" style="width: {(c.n / total) * 100}%; background: {CRAWL_COLOR}; opacity: {c.alpha}"></span>
                    {/each}
                  </span>
                  <span class="flex flex-wrap items-center gap-x-3 text-muted-foreground">
                    {#each cats as c (c.key)}
                      <span class="flex items-center gap-1"><span class="inline-block size-1.5 rounded-full" style="background: {CRAWL_COLOR}; opacity: {c.alpha}"></span>{c.label} <span class="tabular-nums text-foreground">{c.n}</span></span>
                    {/each}
                  </span>
                  <span class="ml-auto flex items-center gap-1 text-muted-foreground group-open:hidden">
                    top: {s.crawlers.slice(0, 3).map((c) => c.crawler).join(', ')}
                    <ChevronDownIcon class="size-3.5" />
                  </span>
                  <span class="ml-auto hidden items-center gap-1 text-muted-foreground group-open:flex">hide <ChevronDownIcon class="size-3.5 rotate-180" /></span>
                </summary>
                <div class="grid gap-x-8 border-t border-border/60 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
                  {#each s.crawlers as c (c.crawler)}
                    <div class="flex items-center gap-2 py-0.5 text-xs" title={c.verified ? "fetch IP matched the vendor’s published ranges" : 'identified by user-agent only'}>
                      <span class="truncate text-foreground">{c.crawler}</span>
                      {#if c.verified}<BadgeCheckIcon class="size-3.5 shrink-0 text-success" aria-label="verified" />{/if}
                      <span class="ml-auto shrink-0 text-muted-foreground">{CRAWL_CAT[c.category ?? '']?.label ?? 'other'}</span>
                      <span class="w-8 shrink-0 text-right tabular-nums text-foreground">{c.fetches}</span>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
            <div class="grid gap-x-8 gap-y-5 sm:grid-cols-3">
              {@render panel('top paths', s.topPaths.map((p) => ({ k: p.path, v: p.views })))}
              {@render panel('top referrers', s.topRefs.map((r) => ({ k: r.ref, v: r.views })))}
              {@render panel('countries', s.topCountries.map((c) => ({ k: c.country, v: c.views })))}
              {@render panel('sources', s.sources.map((x) => ({ k: x.source, v: x.views, hint: SOURCE_HINT[x.source] })))}
              {@render panel('campaigns (utm)', s.campaigns.map((c) => ({ k: c.campaign, v: c.views })))}
              {@render panel('devices', s.devices.map((d) => ({ k: d.device, v: d.views })))}
              {#if s.aiRefs.length}{@render panel('ai referrals', s.aiRefs.map((a) => ({ k: a.source, v: a.views })))}{/if}
              {#if s.keywords.length}{@render panel('search keywords', s.keywords.map((k) => ({ k: k.term, v: k.views })))}{/if}
            </div>
            <details class="group mt-4 border-t border-border/60 pt-3">
              <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                tracking snippet <ChevronDownIcon class="size-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <CopyBlock label="paste into every page's <head>" text={s.snippet} copyLabel="copy snippet" />
            </details>
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
