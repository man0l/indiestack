<script lang="ts">
  type Annotation = {
    day: string;
    kind: 'commit' | 'deploy' | 'mention';
    label: string;
    sub: string;
    url: string | null;
  };

  let {
    days = [],
    annotations = [],
  }: {
    days: Array<{ day: string; views: number; uniques: number }>;
    annotations?: Annotation[];
  } = $props();

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

  const annOn = (day: string) => annotations.filter((a) => a.day === day);

  let hovered: string | null = $state(null);

  const ax = axis();
  const at = (d: string) => days.find((x) => x.day === d);
  const vvals = ax.map((d) => at(d)?.views ?? 0);
  const uvals = ax.map((d) => at(d)?.uniques ?? 0);
  const vmax = Math.max(...vvals, ...uvals, 1);
</script>

<div class="mb-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
  <span class="flex items-center gap-1.5"><span class="inline-block h-0.5 w-4 bg-primary"></span>views</span>
  <span class="flex items-center gap-1.5"><span class="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground"></span>uniques</span>
  {#each (Object.keys(KIND) as Array<keyof typeof KIND>) as k (k)}
    <span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-full" style="background: {KIND[k].color}"></span>{KIND[k].label}</span>
  {/each}
</div>
<div class="relative mb-3">
  <svg viewBox={`0 0 ${CHW} ${CHH}`} class="w-full" role="img" aria-label="visitors last 7 days with deploys and mentions">
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={CHP} x2={CHW - CHP} y1={CHP + g * (CHH - CHP * 2)} y2={CHP + g * (CHH - CHP * 2)} stroke="var(--border)" stroke-width="1" />
    {/each}
    <polyline points={line(vvals, vmax)} fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <polyline points={line(uvals, vmax)} fill="none" stroke="var(--muted-foreground)" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" />
    {#each vvals as v, i (ax[i])}
      <circle cx={xFor(i, vvals.length)} cy={CHH - CHP - (vmax === 0 ? 0 : (v / vmax) * (CHH - CHP * 2))} r="3" fill="var(--primary)">
        <title>{ax[i]} · {v} views / {uvals[i]} uniques</title>
      </circle>
    {/each}
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
        {ax[Math.max(0, hi)]} · {vvals[Math.max(0, hi)]} views / {uvals[Math.max(0, hi)]} uniques
      </div>
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
