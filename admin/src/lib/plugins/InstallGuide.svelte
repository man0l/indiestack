<script lang="ts" module>
  export type Guide = {
    install: string;
    snippets: Array<{ id: string; label: string; file: string; code: string }>;
    prompt: string;
  };
</script>

<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import CheckIcon from '@lucide/svelte/icons/check';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import { Button } from '$lib/components/ui/button';
  import CopyBlock from './CopyBlock.svelte';

  let { guide, open: startOpen = false }: { guide: Guide; open?: boolean } = $props();

  let open = $state(startOpen);
  let stack = $state(guide.snippets[0]?.id ?? '');
  let showPrompt = $state(false);
  let promptCopied = $state(false);

  const current = $derived(guide.snippets.find((s) => s.id === stack) ?? guide.snippets[0]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(guide.prompt);
      promptCopied = true;
      setTimeout(() => (promptCopied = false), 1500);
    } catch {
      promptCopied = false;
    }
  }
</script>

<div class="mt-4 rounded-lg border border-border">
  <button
    type="button"
    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <ChevronRightIcon class="size-4 transition-transform {open ? 'rotate-90' : ''}" />
    install tracking
    <span class="ml-auto font-mono text-xs text-muted-foreground">npm i indiestack-ai-bots</span>
  </button>

  {#if open}
    <div class="border-t border-border px-3 pb-3">
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2">
        <span class="text-xs text-muted-foreground">Easiest: let your AI coding agent (Claude Code, Cursor…) install it in the site's repo.</span>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" onclick={() => (showPrompt = !showPrompt)}>{showPrompt ? 'hide' : 'view'}</Button>
          <Button size="sm" onclick={copyPrompt}>
            {#if promptCopied}
              <CheckIcon data-icon="inline-start" /> copied
            {:else}
              <SparklesIcon data-icon="inline-start" /> copy AI-agent prompt
            {/if}
          </Button>
        </div>
      </div>
      {#if showPrompt}
        <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">{guide.prompt}</pre>
      {/if}

      <div class="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">or by hand</div>
      <CopyBlock label="1. install the package" text={guide.install} />

      <div class="mt-3 text-xs text-muted-foreground">2. add it to your server entry point</div>
      <div class="mt-1 flex flex-wrap gap-1" role="tablist">
        {#each guide.snippets as s (s.id)}
          <Button
            variant={s.id === current?.id ? 'secondary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={s.id === current?.id}
            onclick={() => (stack = s.id)}>{s.label}</Button
          >
        {/each}
      </div>
      {#if current}
        <CopyBlock label={current.file} text={current.code} copyLabel="copy code" />
      {/if}

      <div class="mt-3 text-xs text-muted-foreground">
        3. deploy, then check with <code class="font-mono">curl -A "GPTBot/1.2" https://your-domain/</code> and refresh this card.
      </div>
    </div>
  {/if}
</div>
