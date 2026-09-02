<script lang="ts">
  let { overview, activeId, icons } = $props();
  const groups = ['monitoring','growth','distribute','system'];
  const labels: Record<string,string> = { monitoring:'monitoring', growth:'growth', distribute:'distribute', system:'system' };
</script>
<nav class="w-[220px] shrink-0 border-r border-[#262b35] bg-[#0c0d10] p-3 sticky top-0 h-dvh overflow-y-auto max-[820px]:w-auto max-[820px]:h-auto max-[820px]:sticky max-[820px]:flex max-[820px]:gap-2 max-[820px]:overflow-x-auto max-[820px]:whitespace-nowrap max-[820px]:border-b max-[820px]:border-r-0">
  <div class="font-bold tracking-tight mb-4">indiestack <span class="font-medium text-[#8b919c]">admin</span></div>
  <a href="/admin" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[#171a21] {activeId==='overview'?'bg-[#171a21] text-white':'text-[#a8adb7]'}">overview</a>
  {#each groups as g}
    {@const items = overview.filter((c:any)=>c.group===g)}
    {#if items.length}
      <div class="mt-3 mb-1 text-[10px] tracking-widest text-[#8b919c] uppercase">{labels[g]}</div>
      {#each items as c}{@const Icon=icons[c.label]}
        <a href={c.href} class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[#171a21] {activeId===c.id?'bg-[#171a21] text-white':'text-[#a8adb7]'}">
          {#if Icon}<Icon size={14} strokeWidth={1.5}/>{/if}
          <span class="h-1.5 w-1.5 rounded-full shrink-0 {c.dot==='up'?'bg-[#3ee08f]':c.dot==='down'?'bg-[#ff5d57]':'bg-[#8b919c]'}"></span>{c.label}
          {#if c.summary}<span class="ml-auto text-xs text-[#8b919c] tabular-nums">{c.summary}</span>{/if}
        </a>
      {/each}
    {/if}
  {/each}
  <div class="mt-3 mb-1 text-[10px] tracking-widest text-[#8b919c] uppercase">elsewhere</div>
  <a href="/" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#a8adb7] hover:bg-[#171a21]">status ↗</a>
  <a href="/agents.md" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#a8adb7] hover:bg-[#171a21]">/agents.md</a>
  <form method="post" action="/logout" class="mt-2"><button class="w-full rounded-lg border border-[#262b35] bg-transparent px-2 py-1.5 text-xs text-[#8b919c] hover:text-white">logout</button></form>
</nav>
