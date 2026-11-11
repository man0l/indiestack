<script lang="ts">
  import CopyIcon from '@lucide/svelte/icons/copy';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button';

  let { label, text, copyLabel = 'copy' }: { label: string; text: string; copyLabel?: string } = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<div class="mt-3">
  <div class="mb-1 flex items-center justify-between gap-2">
    <span class="text-xs text-muted-foreground">{label}</span>
    <Button variant="ghost" size="sm" onclick={copy}>
      {#if copied}
        <CheckIcon data-icon="inline-start" /> copied
      {:else}
        <CopyIcon data-icon="inline-start" /> {copyLabel}
      {/if}
    </Button>
  </div>
  <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">{text}</pre>
</div>
