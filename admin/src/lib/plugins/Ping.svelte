<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, Plus, RefreshCw, Trash2, Pause, Play, Pencil, Zap } from 'lucide-svelte';
  import Badge from '../ui/badge.svelte';
  import Button from '../ui/button.svelte';
  import Card from '../ui/card.svelte';

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

  const ago = (ts: number | null) => {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
</script>

{#if msg}<div class="mb-3 rounded-lg border border-[#2f3544] bg-[#12180f] px-3 py-2 text-sm text-[#c8f542]">{msg}</div>{/if}
{#if err}<div class="mb-3 rounded-lg border border-[#ff5d57] bg-[#1a0e0e] px-3 py-2 text-sm text-[#ff5d57]">{err}</div>{/if}

<Card>
  <div class="mb-3 flex items-center justify-between">
    <span class="text-xs uppercase tracking-widest text-[#8b919c]">monitors</span>
    <div class="flex gap-2">
      <Button variant="ghost" on:click={() => load()} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><RefreshCw size={13} /> refresh</span>
      </Button>
      <Button on:click={() => (showAdd = !showAdd)} disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Plus size={13} /> add monitor</span>
      </Button>
    </div>
  </div>

  {#if loading}
    <p class="text-sm text-[#8b919c]">loading…</p>
  {:else if monitors.length === 0}
    <p class="text-sm text-[#8b919c]">No monitors yet. Add HTTP, TCP, DNS, SSL or a host check below.</p>
  {:else}
    <div class="divide-y divide-[#262b35]">
      {#each monitors as m (m.id)}
        <div class="flex items-center gap-3 py-3">
          <span class="h-2 w-2 shrink-0 rounded-full {m.enabled ? (m.status === 'up' ? 'bg-[#3ee08f]' : m.status === 'down' ? 'bg-[#ff5d57]' : 'bg-[#8b919c]') : 'bg-[#8b919c]'}"></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{m.name}</span>
              {#if !m.enabled}<Badge variant="muted">paused</Badge>{/if}
            </div>
            <div class="truncate text-xs text-[#8b919c]">
              {m.url} · every {m.interval_min}m
              {#if m.last_error} · <span class="text-[#ff5d57]">{m.last_error}</span>{/if}
            </div>
          </div>
          {#if m.last_status_code != null}<span class="hidden shrink-0 text-xs tabular-nums text-[#8b919c] sm:block">{m.last_status_code}</span>{/if}
          {#if m.last_latency_ms != null}<span class="hidden shrink-0 text-xs tabular-nums text-[#8b919c] sm:block">{m.last_latency_ms}ms</span>{/if}
          <span class="hidden shrink-0 text-xs tabular-nums text-[#8b919c] sm:block">{ago(m.last_check_at)}</span>
          <Badge variant={m.enabled ? (m.status === 'down' ? 'destructive' : m.status === 'up' ? 'default' : 'muted') : 'muted'}>{m.enabled ? m.status : 'paused'}</Badge>
          <div class="flex shrink-0 gap-1">
            <a class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white" title="edit" href={`/admin/monitors/${m.id}`}>
              <Pencil size={13} />
            </a>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-white disabled:opacity-40"
              title={m.enabled ? 'pause' : 'resume'} disabled={busy !== ''}
              on:click={() => api(`/admin/monitors/${m.id}/toggle`)}>
              {#if m.enabled}<Pause size={13} />{:else}<Play size={13} />{/if}
            </button>
            <button class="rounded-md p-1.5 text-[#8b919c] hover:bg-[#262b35] hover:text-[#ff5d57] disabled:opacity-40"
              title="remove" disabled={busy !== ''}
              on:click={() => api(`/admin/monitors/${m.id}/delete`)}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Card>

{#if showAdd}
  <Card>
    <form
      method="post"
      action="/admin/monitors"
      on:submit={() => setTimeout(load, 600)}
      class="space-y-3"
    >
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-[#8b919c]">type
          <select name="kind" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm">
            <option value="http">HTTP(S)</option>
            <option value="tcp">TCP port</option>
            <option value="udp">UDP port (TCP probe)</option>
            <option value="icmp">Host (TCP fallback)</option>
            <option value="dns">DNS (DoH)</option>
            <option value="ssl">SSL expiry</option>
            <option value="domain">Domain expiry</option>
          </select>
        </label>
        <label class="text-xs text-[#8b919c]">target
          <input name="url" placeholder="https://example.com  or  example.com:22" required class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">name (optional)
          <input name="name" maxlength="40" placeholder="api" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">interval minutes
          <input type="number" name="interval_min" min="1" max="60" value="5" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">expected status (0 = any 2xx)
          <input type="number" name="expect_status" min="0" max="599" value="0" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">slow if slower than ms (0 = off)
          <input type="number" name="max_latency_ms" min="0" max="15000" value="0" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">keyword (optional)
          <input name="keyword" maxlength="80" placeholder="ok" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
        </label>
        <label class="text-xs text-[#8b919c]">keyword mode
          <select name="keyword_mode" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm">
            <option value="exists">must contain</option>
            <option value="absent">must not contain</option>
          </select>
        </label>
      </div>
      <Button type="submit" disabled={busy !== ''}>
        <span class="inline-flex items-center gap-1.5"><Zap size={13} /> add monitor</span>
      </Button>
    </form>
  </Card>
{/if}
