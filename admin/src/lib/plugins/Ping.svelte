<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../ui/badge.svelte';
  import Button from '../ui/button.svelte';
  import Card from '../ui/card.svelte';

  let monitors: any[] = $state([]);
  let loading = $state(true);
  let showAdd = $state(false);

  async function load() {
    loading = true;
    const r = await fetch('/api/monitors');
    if (r.ok) monitors = (await r.json()).monitors ?? [];
    loading = false;
  }

  onMount(load);

  async function toggle(m: any) {
    await fetch(`/admin/monitors/${m.id}/toggle`, { method: 'POST' });
    await load();
  }

  async function remove(m: any) {
    await fetch(`/admin/monitors/${m.id}/delete`, { method: 'POST' });
    monitors = monitors.filter((x) => x.id !== m.id);
  }
</script>

<Card>
  <div class="mb-3 flex items-center justify-between">
    <span class="text-xs uppercase tracking-widest text-[#8b919c]">monitors</span>
    <div class="flex gap-2">
      <Button variant="ghost" on:click={load}>refresh</Button>
      <Button on:click={() => (showAdd = !showAdd)}>{showAdd ? 'close' : 'add monitor'}</Button>
    </div>
  </div>

  {#if loading}
    <p class="text-sm text-[#8b919c]">loading…</p>
  {:else if monitors.length === 0}
    <p class="text-sm text-[#8b919c]">No monitors yet.</p>
  {:else}
    <div class="divide-y divide-[#262b35]">
      {#each monitors as m (m.id)}
        <div class="flex items-center gap-3 py-2.5">
          <span class="h-2 w-2 shrink-0 rounded-full {m.enabled ? (m.status === 'up' ? 'bg-[#3ee08f]' : m.status === 'down' ? 'bg-[#ff5d57]' : 'bg-[#8b919c]') : 'bg-[#8b919c]'}"></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{m.name} <span class="text-xs text-[#8b919c]">· every {m.interval_min}m</span></div>
            <div class="truncate text-xs text-[#8b919c]">{m.url}{m.last_error ? ` · ${m.last_error}` : ''}</div>
          </div>
          {#if m.last_latency_ms != null}<span class="text-xs tabular-nums text-[#8b919c]">{m.last_latency_ms}ms</span>{/if}
          <Badge variant={m.enabled ? (m.status === 'down' ? 'destructive' : m.status === 'up' ? 'default' : 'muted') : 'muted'}>{m.enabled ? m.status : 'paused'}</Badge>
          <div class="flex gap-1.5">
            <Button variant="ghost" on:click={() => toggle(m)}>{m.enabled ? 'pause' : 'resume'}</Button>
            <Button variant="destructive" on:click={() => remove(m)}>remove</Button>
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
      on:submit={() => setTimeout(load, 400)}
      class="space-y-3"
    >
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-[#8b919c]">type
          <select name="kind" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm">
            <option value="http">HTTP(S)</option>
            <option value="tcp">TCP port</option>
            <option value="icmp">Host</option>
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
      </div>
      <Button type="submit">add monitor</Button>
    </form>
  </Card>
{/if}
