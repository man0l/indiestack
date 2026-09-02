<script lang="ts">
  let { children } = $props();
</script>

<div class="rounded-xl border border-[#262b35] bg-[#171a21] shadow-none">
  <div class="p-4">{@render children()}</div>
</div>
