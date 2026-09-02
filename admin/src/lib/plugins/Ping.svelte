<script lang="ts">
  import { onMount } from 'svelte';
  let monitors: any[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    const r = await fetch('/api/monitors');
    if (r.ok) monitors = (await r.json()).monitors ?? [];
    loading = false;
  });
</script>

{#if loading}
  <p class="text-sm text-[#8b919c]">loading…</p>
{:else}
  <div class="space-y-2">
    {#each monitors as m (m.id)}
      <div class="flex items-center gap-3 rounded-lg border border-[#262b35] bg-[#171a21] px-3 py-2">
        <span class="h-2 w-2 rounded-full {m.status === 'up' ? 'bg-[#3ee08f]' : m.status === 'down' ? 'bg-[#ff5d57]' : 'bg-[#8b919c]'}"></span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">{m.name} <span class="text-xs text-[#8b919c]">· every {m.interval_min}m</span></div>
          <div class="text-xs text-[#8b919c] truncate">{m.url}</div>
        </div>
        <span class="text-xs tabular-nums {m.status === 'down' ? 'text-[#ff5d57]' : 'text-[#8b919c]'}">{m.status}</span>
      </div>
    {:else}
      <p class="text-sm text-[#8b919c]">No monitors yet.</p>
    {/each}
  </div>
  <form method="post" action="/admin/monitors" class="mt-4 space-y-3 rounded-xl border border-[#262b35] bg-[#171a21] p-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-xs text-[#8b919c]">type
        <select name="kind" class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm">
          <option value="http">HTTP(S)</option><option value="tcp">TCP port</option><option value="icmp">Host</option><option value="dns">DNS</option>
        </select>
      </label>
      <label class="text-xs text-[#8b919c]">url
        <input name="url" placeholder="https://example.com" required class="mt-1 w-full rounded-lg border border-[#262b35] bg-[#0e1014] p-2 text-sm" />
      </label>
    </div>
    <button type="submit" class="rounded-lg bg-[#c8f542] px-3 py-1.5 text-sm font-semibold text-black">add monitor</button>
  </form>
{/if}
