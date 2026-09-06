<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { cn } from '$lib/utils.js';

  let {
    items = [],
    value = '',
    placeholder = 'Select…',
    emptyText = 'No matches.',
    disabled = false,
    ariaLabel = 'select',
    onSelect,
  }: {
    items: Array<{ value: string; label: string }>;
    value?: string;
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    ariaLabel?: string;
    onSelect: (value: string) => void;
  } = $props();

  let open = $state(false);
  const label = $derived(items.find((i) => i.value === value)?.label ?? '');
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        {disabled}
        class="w-full justify-between font-normal"
        {...props}
      >
        <span class="truncate">{label || placeholder}</span>
        <ChevronsUpDownIcon class="opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start">
    <Command.Root label={ariaLabel}>
      <Command.Input placeholder="Search…" />
      <Command.List>
        <Command.Empty>{emptyText}</Command.Empty>
        <Command.Group>
          {#each items as item (item.value)}
            <Command.Item
              value={item.label}
              keywords={[item.value, item.label]}
              data-checked={value === item.value}
              onSelect={() => {
                onSelect(item.value);
                open = false;
              }}
            >
              <CheckIcon class={cn(value === item.value ? 'opacity-100' : 'opacity-0')} />
              {item.label}
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
