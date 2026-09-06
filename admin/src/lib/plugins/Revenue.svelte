<script lang="ts">
  import { onMount } from 'svelte';
  import BadgeDollarSignIcon from '@lucide/svelte/icons/badge-dollar-sign';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SaveIcon from '@lucide/svelte/icons/save';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';

  type Payment = { amount: string; from: string; detail: string; ts: number };

  let payments: Payment[] = $state([]);
  let totals = $state({ n: 0, label: '0.00 USD' });
  let bySource: Array<{ src: string; n: number; label: string }> = $state([]);
  let hasSecret = $state(false);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');

  const ago = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/revenue');
      if (r.ok) {
        const j = await r.json();
        payments = j.payments ?? [];
        totals = j.totals ?? totals;
        bySource = j.bySource ?? [];
        hasSecret = j.secret ?? false;
      } else err = 'failed to load revenue';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = 'secret';
    err = '';
    try {
      const r = await fetch('/admin/revenue/secret', {
        method: 'POST',
        body: new FormData(e.currentTarget as HTMLFormElement),
        headers: { accept: 'application/json' },
      });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else msg = j.msg ?? 'done';
      await load();
    } catch (e) {
      err = String(e);
    } finally {
      busy = '';
    }
  }
</script>

{#if msg}
  <Alert.Root class="mb-3 border-success/40 bg-success/10">
    <Alert.Title>Done</Alert.Title>
    <Alert.Description>{msg}</Alert.Description>
  </Alert.Root>
{/if}
{#if err}
  <Alert.Root class="mb-3" variant="destructive">
    <Alert.Title>Something went wrong</Alert.Title>
    <Alert.Description>{err}</Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <BadgeDollarSignIcon />
        <Card.Title>revenue</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load} disabled={busy !== ''}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
      </div>
    </div>
    <Card.Description>Payments attribute to the first referrer of the identified visitor.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-20 rounded-lg" />
        <Skeleton class="h-12 rounded-lg" />
      </div>
    {:else}
      <div class="rounded-xl border border-border bg-card p-4">
        <p class="mb-2 text-sm">30 days: <b>{totals.n}</b> payments · <b>{totals.label}</b> · by source:</p>
        {#if bySource.length === 0}
          <span class="text-xs text-muted-foreground">no payments yet</span>
        {:else}
          {#each bySource as r (r.src)}
            <div class="truncate text-xs text-muted-foreground">{r.src} · {r.n} payment(s) · {r.label}</div>
          {/each}
        {/if}
      </div>
      {#if payments.length === 0}
        <Empty.Root class="mt-3">
          <Empty.Header>
            <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
            <Empty.Title>No payments yet</Empty.Title>
            <Empty.Description>Connect Stripe below or POST to the revenue API.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <div class="mt-3 flex flex-col gap-1">
          {#each payments as p (p.ts + p.amount + p.detail)}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2">
              <span class="size-2 shrink-0 rounded-full bg-success"></span>
              <div class="min-w-0 flex-1 basis-48">
                <div class="truncate text-sm font-medium">{p.amount} · from {p.from}</div>
                <div class="truncate text-xs text-muted-foreground">{p.detail} · {ago(p.ts)}</div>
              </div>
            </div>
            <Separator />
          {/each}
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<Card.Root class="mt-3">
  <Card.Header>
    <Card.Title>stripe webhook</Card.Title>
    <Card.Description>{hasSecret ? '✓ signing secret configured' : 'Point a Stripe webhook at /stripe/<site token> for checkout.session.completed and invoice.paid. On your success page call df.identify("email").'}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form onsubmit={save}>
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="secret">signing secret (whsec_…)</Field.FieldLabel>
          <Input id="secret" name="secret" type="password" placeholder={hasSecret ? '•••••• (saved)' : 'whsec_…'} />
        </Field.Field>
      </Field.FieldGroup>
      <Button type="submit" class="mt-4" variant="secondary" disabled={busy !== ''}>
        <SaveIcon data-icon="inline-start" /> save secret
      </Button>
    </form>
  </Card.Content>
</Card.Root>
