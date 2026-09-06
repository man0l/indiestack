<script lang="ts">
  import MenuIcon from '@lucide/svelte/icons/menu';
  import { Button } from '$lib/components/ui/button';
  import * as Sheet from '$lib/components/ui/sheet';

  type NavCard = { id: string; label: string; group: string; summary: string; dot: string; href: string };
  type Nav = { title: string; activeId: string; cards: NavCard[] };

  function readNav(): Nav {
    try {
      const raw = document.getElementById('nav-data')?.textContent ?? '';
      const j = JSON.parse(raw) as Partial<Nav>;
      return { title: '', activeId: 'overview', cards: [], ...j, cards: j.cards ?? [] };
    } catch {
      return { title: '', activeId: 'overview', cards: [] };
    }
  }

  const nav = readNav();
  const groups = ['monitoring', 'growth', 'distribute', 'system'] as const;
  const groupLabel: Record<string, string> = {
    monitoring: 'monitoring',
    growth: 'growth',
    distribute: 'distribute',
    system: 'system',
  };

  let open = $state(false);
  let active = $state(nav.activeId);

  $effect(() => {
    const onNav = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) active = id;
      open = false;
    };
    window.addEventListener('admin-nav', onNav);
    return () => window.removeEventListener('admin-nav', onNav);
  });

  const dotClass = (d: string) =>
    d === 'up' ? 'bg-success' : d === 'down' ? 'bg-destructive' : 'bg-muted-foreground';
</script>

{#if nav.cards.length}
  <Sheet.Root bind:open>
    <Sheet.Trigger>
      {#snippet child({ props })}
        <Button variant="ghost" size="icon" aria-label="open menu" {...props}>
          <MenuIcon />
        </Button>
      {/snippet}
    </Sheet.Trigger>
    <Sheet.Content side="left" aria-label="admin navigation">
      <Sheet.Header>
        <Sheet.Title>{nav.title} <span class="text-muted-foreground">admin</span></Sheet.Title>
      </Sheet.Header>
      <nav class="flex flex-col gap-0.5 overflow-y-auto px-1 pb-6" aria-label="admin">
        <a
          href="/admin"
          aria-current={active === 'overview' ? 'page' : undefined}
          class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline hover:no-underline {active === 'overview' ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
        >
          overview
        </a>
        {#each groups as g (g)}
          {@const items = nav.cards.filter((c) => c.group === g)}
          {#if items.length}
            <div class="px-3 pt-4 pb-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{groupLabel[g]}</div>
            {#each items as c (c.id)}
              <a
                href={c.href}
                aria-current={active === c.id ? 'page' : undefined}
                class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline hover:no-underline {active === c.id ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
              >
                <span class="size-1.5 shrink-0 rounded-full {dotClass(c.dot)}"></span>
                <span class="truncate">{c.label}</span>
                {#if c.summary}<span class="ml-auto text-xs text-muted-foreground tabular-nums">{c.summary}</span>{/if}
              </a>
            {/each}
          {/if}
        {/each}
        <div class="px-3 pt-4 pb-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">elsewhere</div>
        <a href="/" class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline hover:no-underline text-muted-foreground hover:bg-muted hover:text-foreground">status ↗</a>
        <a href="/agents.md" class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline hover:no-underline text-muted-foreground hover:bg-muted hover:text-foreground">/agents.md</a>
        <form method="post" action="/logout" class="mt-2 px-1">
          <Button variant="ghost" type="submit" class="w-full justify-start">logout</Button>
        </form>
      </nav>
    </Sheet.Content>
  </Sheet.Root>
{/if}
