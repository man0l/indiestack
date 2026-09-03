<script lang="ts">
  let { children, variant = 'default' } = $props<{ children?: any; variant?: 'default' | 'destructive' | 'muted' }>();
  const cls = variant === 'destructive' ? 'bg-[#ff5d57] text-white' : variant === 'muted' ? 'bg-[#262b35] text-[#8b919c]' : 'bg-[#262b35] text-[#eef0f4]';
</script>

<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {cls}">{@render children?.()}</span>
