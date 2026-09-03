<script lang="ts">
  let { label, summary, dot, href, icon: Icon } = $props();
</script>
<a {href} class="block rounded-xl border border-[#262b35] bg-[#171a21] p-3.5 hover:border-[#2f3544] no-underline">
  <div class="flex items-center gap-1.5">
    {#if Icon}<Icon size={14} strokeWidth={1.5} class="text-[#8b919c]" />{/if}
    <span class="h-2 w-2 rounded-full {dot==='up'?'bg-[#3ee08f]':dot==='down'?'bg-[#ff5d57]':'bg-[#8b919c]'}"></span>
    <span class="text-sm font-semibold text-white">{label}</span>
  </div>
  {#if summary}<div class="mt-1.5 text-xs text-[#8b919c]">{summary}</div>{/if}
</a>
