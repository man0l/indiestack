<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  let {
    children,
    variant = 'default',
    type = 'button',
    disabled = false,
    title = '',
  }: { children?: any; variant?: 'default' | 'ghost' | 'destructive'; type?: string; disabled?: boolean; title?: string } = $props();
  const dispatch = createEventDispatcher();
  const base = 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold cursor-pointer disabled:opacity-40';
  const variants: Record<string, string> = {
    default: 'bg-[#c8f542] text-[#111]',
    ghost: 'bg-transparent text-[#eef0f4] border border-[#262b35]',
    destructive: 'bg-transparent text-[#ff5d57] border border-[#262b35]',
  };
</script>

<button {type} {disabled} {title} class="{base} {variants[variant]}" on:click={(e) => dispatch('click', e)}>
  {@render children?.()}
</button>
