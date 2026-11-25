<script lang="ts">
  type Annotation = {
    day: string;
    kind: 'commit' | 'deploy' | 'mention';
    label: string;
    sub: string;
    url: string | null;
  };

  type AppStoreDay = {
    day: string;
    impressions: number;
    searchImpressions: number;
    downloads: number;
    searchDownloads: number;
  };

  type SocialDay = { day: string; views: number; byLane: Record<string, number> };

  type CrawlDay = { day: string; total: number; byCategory: Record<string, number> };

  let {
    days = [],
    annotations = [],
    appstore = [],
    social = [],
    crawls = [],
  }: {
    days: Array<{ day: string; views: number; uniques: number }>;
    annotations?: Annotation[];
    appstore?: AppStoreDay[];
    social?: SocialDay[];
    crawls?: CrawlDay[];
  } = $props();

  // App Store search impressions are a different unit from pageviews, so they get
  // their own right-hand scale (bars) instead of sharing the line chart's.
  const ASC_COLOR = 'oklch(0.66 0.14 245)';
  // Slashloop social views: their own scale too (often 100x website views).
  const SOCIAL_COLOR = 'oklch(0.65 0.2 350)';
  // AI/search crawler fetches: own scale. Solid = live AI-answer fetches (someone
  // asked ChatGPT & co and it opened this page); faint = indexing/training crawls.
  const CRAWL_COLOR = 'oklch(0.7 0.14 290)';
  const CATEGORY: Record<string, string> = {
    answer_fetch: 'ai answers',
    search_index: 'search index',
    training: 'training',
    ai_crawler: 'unlabelled',
  };

  const KIND = {
    commit: { color: 'var(--primary)', label: 'commits' },
    deploy: { color: 'var(--success)', label: 'deploys' },
    mention: { color: 'var(--warning)', label: 'mentions' },
  } as const;

  const CHW = 700;
  const CHH = 200;
  const CHP = 28;

  /** Last 7 calendar days (oldest first) so markers land even on viewless days. */
  const axis = (): string[] => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  const line = (vals: number[], max: number) =>
    vals
      .map((v, i) => {
        const x = CHP + (i / Math.max(1, vals.length - 1)) * (CHW - CHP * 2);
        const y = CHH - CHP - (max === 0 ? 0 : (v / max) * (CHH - CHP * 2));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const xFor = (i: number, n: number) => CHP + (i / Math.max(1, n - 1)) * (CHW - CHP * 2);

  // Layer toggles, shared by every site's chart and remembered per browser.
  type Layer = 'web' | 'social' | 'appstore' | 'crawl' | 'deploy' | 'commit' | 'mention';
  const LAYERS_KEY = 'indiestack:chart-hidden';
  const readHidden = (): Layer[] => {
    try {
      const v = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  let hidden: Layer[] = $state(readHidden());
  const on = (l: Layer) => !hidden.includes(l);
  const toggle = (l: Layer) => {
    hidden = on(l) ? [...hidden, l] : hidden.filter((x) => x !== l);
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(hidden));
    } catch {
      // private mode: toggles still work for this page view
    }
  };
  $effect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === LAYERS_KEY) hidden = readHidden();
    };
    addEventListener('storage', sync);
    return () => removeEventListener('storage', sync);
  });

  const annOn = (day: string) => annotations.filter((a) => a.day === day && on(a.kind));

  let hovered: string | null = $state(null);

  const ax = axis();
  const at = (d: string) => days.find((x) => x.day === d);
  const vvals = ax.map((d) => at(d)?.views ?? 0);
  const uvals = ax.map((d) => at(d)?.uniques ?? 0);
  const vmax = Math.max(...vvals, ...uvals, 1);

  const asAt = (d: string) => appstore.find((x) => x.day === d);
  const hasAsc = $derived(appstore.length > 0);
  const svals = $derived(ax.map((d) => asAt(d)?.searchImpressions ?? 0));
  const dvals = $derived(ax.map((d) => asAt(d)?.downloads ?? 0));
  const smax = $derived(Math.max(...svals, 1));
  const lastAscDay = $derived(appstore.length ? appstore[appstore.length - 1].day : null);
  const barW = (CHW - CHP * 2) / Math.max(1, ax.length - 1) / 3;
  const barH = (v: number) => (v / smax) * (CHH - CHP * 2);

  const soAt = (d: string) => social.find((x) => x.day === d);
  const hasSocial = $derived(social.length > 0);
  const socvals = $derived(ax.map((d) => soAt(d)?.views ?? 0));
  const socmax = $derived(Math.max(...socvals, 1));
  const crAt = (d: string) => crawls.find((x) => x.day === d);
  const hasCrawl = $derived(crawls.length > 0);
  const crvals = $derived(ax.map((d) => crAt(d)?.total ?? 0));
  const ansvals = $derived(ax.map((d) => crAt(d)?.byCategory.answer_fetch ?? 0));
  const crmax = $derived(Math.max(...crvals, 1));
  const crH = (v: number) => (v / crmax) * (CHH - CHP * 2) * 0.6;
  const showCrawl = $derived(hasCrawl && on('crawl'));
  const showAsc = $derived(hasAsc && on('appstore'));
  const showSocial = $derived(hasSocial && on('social'));

  const chip = (l: Layer) =>
    `flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-opacity hover:bg-muted ${on(l) ? '' : 'opacity-40 line-through'}`;
</script>

<div class="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="group" aria-label="chart layers">
  <button type="button" class={chip('web')} aria-pressed={on('web')} onclick={() => toggle('web')} title="website views and uniques">
    <span class="inline-block h-0.5 w-4 bg-primary"></span>website views
    <span class="inline-block h-0 w-3 border-t-2 border-dashed border-muted-foreground"></span>uniques
  </button>
  {#if hasSocial}
    <button type="button" class={chip('social')} aria-pressed={on('social')} onclick={() => toggle('social')} title="Slashloop views gained, own scale">
      <span class="inline-block h-0.5 w-4" style="background: {SOCIAL_COLOR}"></span>social views
    </button>
  {/if}
  {#if hasAsc}
    <button type="button" class={chip('appstore')} aria-pressed={on('appstore')} onclick={() => toggle('appstore')} title="App Store search impressions (right scale) · ↓ downloads">
      <span class="inline-block h-2.5 w-2 rounded-sm" style="background: {ASC_COLOR}; opacity: 0.55"></span>app store
    </button>
  {/if}
  {#if hasCrawl}
    <button type="button" class={chip('crawl')} aria-pressed={on('crawl')} onclick={() => toggle('crawl')} title="AI & search crawler fetches, own scale · solid = live AI-answer fetches">
      <span class="inline-block h-2.5 w-2 rounded-sm" style="background: {CRAWL_COLOR}"></span>ai crawls
    </button>
  {/if}
  {#each (['deploy', 'commit', 'mention'] as const) as k (k)}
    <button type="button" class={chip(k)} aria-pressed={on(k)} onclick={() => toggle(k)}>
      <span class="inline-block size-2 rounded-full" style="background: {KIND[k].color}"></span>{KIND[k].label}
    </button>
  {/each}
</div>
<div class="relative mb-3">
  <svg viewBox={`0 0 ${CHW} ${CHH}`} class="w-full" role="img" aria-label="visitors last 7 days with deploys and mentions">
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={CHP} x2={CHW - CHP} y1={CHP + g * (CHH - CHP * 2)} y2={CHP + g * (CHH - CHP * 2)} stroke="var(--border)" stroke-width="1" />
    {/each}
    {#if showAsc}
      {#each ax as day, i (day)}
        {#if svals[i] > 0}
          <rect x={xFor(i, ax.length) - barW / 2} y={CHH - CHP - barH(svals[i])} width={barW} height={barH(svals[i])} rx="2" fill={ASC_COLOR} opacity="0.35" />
        {/if}
        {#if dvals[i] > 0}
          <text x={xFor(i, ax.length)} y={CHH - CHP - barH(svals[i]) - 4} text-anchor="middle" font-size="10" fill={ASC_COLOR}>↓{dvals[i]}</text>
        {/if}
      {/each}
      <text x={CHW - 2} y={CHP - 6} text-anchor="end" font-size="9" fill={ASC_COLOR}>{smax}</text>
    {/if}
    {#if showCrawl}
      {#each ax as day, i (day)}
        {#if crvals[i] > 0}
          <rect x={xFor(i, ax.length) + barW / 2 + 2} y={CHH - CHP - crH(crvals[i])} width={barW * 0.6} height={crH(crvals[i])} rx="2" fill={CRAWL_COLOR} opacity="0.3" />
        {/if}
        {#if ansvals[i] > 0}
          <rect x={xFor(i, ax.length) + barW / 2 + 2} y={CHH - CHP - crH(ansvals[i])} width={barW * 0.6} height={crH(ansvals[i])} rx="2" fill={CRAWL_COLOR} />
        {/if}
      {/each}
    {/if}
    {#if showSocial}
      <polyline points={line(socvals, socmax)} fill="none" stroke={SOCIAL_COLOR} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {#each socvals as v, i (ax[i])}
        <circle cx={xFor(i, socvals.length)} cy={CHH - CHP - (v / socmax) * (CHH - CHP * 2)} r="2.5" fill={SOCIAL_COLOR}>
          <title>{ax[i]} · {v} social views</title>
        </circle>
      {/each}
      <text x={CHP} y={CHP - 6} text-anchor="start" font-size="9" fill={SOCIAL_COLOR}>{socmax} social</text>
    {/if}
    {#if on('web')}
      <polyline points={line(vvals, vmax)} fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <polyline points={line(uvals, vmax)} fill="none" stroke="var(--muted-foreground)" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" />
      {#each vvals as v, i (ax[i])}
        <circle cx={xFor(i, vvals.length)} cy={CHH - CHP - (vmax === 0 ? 0 : (v / vmax) * (CHH - CHP * 2))} r="3" fill="var(--primary)">
          <title>{ax[i]} · {v} views / {uvals[i]} uniques</title>
        </circle>
      {/each}
    {/if}
    {#each ax as day, i (day)}
      {#each annOn(day) as a (a.label + a.sub)}
        <g>
          <title>{day} · {KIND[a.kind].label.slice(0, -1)} · {a.label}{a.sub ? ` — ${a.sub}` : ''}</title>
          <line x1={xFor(i, ax.length)} x2={xFor(i, ax.length)} y1={CHP} y2={CHH - CHP} stroke={KIND[a.kind].color} stroke-width="1" stroke-dasharray="3 3" opacity="0.7" />
          <circle cx={xFor(i, ax.length)} cy={CHP + 4} r="4" fill={KIND[a.kind].color} />
        </g>
      {/each}
    {/each}
    {#each ax as day, i (day)}
      <text x={xFor(i, ax.length)} y={CHH - 8} text-anchor="middle" font-size="10" fill="var(--muted-foreground)">{day.slice(5)}</text>
    {/each}
    {#each ax as day, i (day)}
      <rect
        x={i === 0 ? CHP : xFor(i, ax.length) - (xFor(1, ax.length) - xFor(0, ax.length)) / 2}
        y="0"
        width={(xFor(1, ax.length) - xFor(0, ax.length)) * (i === 0 || i === ax.length - 1 ? 0.75 : 1)}
        height={CHH}
        fill="transparent"
        onmouseenter={() => (hovered = day)}
        onmouseleave={() => (hovered = null)}
      />
    {/each}
  </svg>
  {#if hovered}
    {@const hi = ax.indexOf(hovered)}
    {@const hanns = hi >= 0 ? annOn(ax[hi]) : []}
    {@const hleft = Math.min(65, Math.max(0, (Math.max(0, hi) / Math.max(1, ax.length - 1)) * 100))}
    <div class="absolute top-0 z-10 w-64 max-w-[80%] rounded-xl border border-border bg-popover p-3 text-xs shadow-xl" style="left: {hleft}%">
      <div class="mb-1 font-semibold">
        {ax[Math.max(0, hi)]}{#if on('web')} · {vvals[Math.max(0, hi)]} views / {uvals[Math.max(0, hi)]} uniques{/if}
      </div>
      {#if showSocial}
        {@const so = soAt(ax[Math.max(0, hi)])}
        <div class="mb-1" style="color: {SOCIAL_COLOR}">
          {#if so}
            social · {so.views} views{#if Object.keys(so.byLane).length > 1} ({Object.entries(so.byLane)
                .sort((a, b) => b[1] - a[1])
                .map(([l, v]) => `${l} ${v}`)
                .join(' · ')}){:else if Object.keys(so.byLane).length === 1} · {Object.keys(so.byLane)[0]}{/if}
          {:else}
            social · no views gained
          {/if}
        </div>
      {/if}
      {#if showAsc}
        {@const as = asAt(ax[Math.max(0, hi)])}
        <div class="mb-1" style="color: {ASC_COLOR}">
          {#if as}
            app store · {as.searchImpressions} search / {as.impressions} total impressions · {as.downloads} downloads ({as.searchDownloads} from search)
          {:else if lastAscDay && ax[Math.max(0, hi)] > lastAscDay}
            app store · not reported yet (Apple lags 2–3 days)
          {:else}
            app store · no data
          {/if}
        </div>
      {/if}
      {#if showCrawl}
        {@const cr = crAt(ax[Math.max(0, hi)])}
        <div class="mb-1" style="color: {CRAWL_COLOR}">
          {#if cr}
            ai crawls · {cr.total} ({Object.entries(cr.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([c, v]) => `${CATEGORY[c] ?? c} ${v}`)
              .join(' · ')})
          {:else}
            ai crawls · none
          {/if}
        </div>
      {/if}
      {#if hanns.length === 0}
        <div class="text-muted-foreground">nothing else this day</div>
      {:else}
        <div class="flex flex-col gap-1.5">
          {#each hanns as a (a.label + a.sub)}
            <div class="flex items-start gap-1.5">
              <span class="mt-1 size-2 shrink-0 rounded-full" style="background: {KIND[a.kind].color}"></span>
              <div class="min-w-0">
                <div class="truncate font-medium">{a.label}</div>
                {#if a.sub}<div class="truncate text-muted-foreground">{a.sub}</div>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
