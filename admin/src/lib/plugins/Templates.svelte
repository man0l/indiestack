<script lang="ts">
  import { onMount } from 'svelte';
  import LayoutTemplateIcon from '@lucide/svelte/icons/layout-template';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import { Skeleton } from '$lib/components/ui/skeleton';

  type Template = { id: string; label: string; interval_min: number };

  let templates: Template[] = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');
  let host = $state('');

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/templates');
      if (r.ok) templates = (await r.json()).templates ?? [];
      else err = 'failed to load templates';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function apply(id: string) {
    if (!host.trim()) {
      err = 'enter a host first';
      return;
    }
    busy = id;
    err = '';
    try {
      const fd = new FormData();
      fd.set('host', host.trim());
      fd.set('id', id);
      const r = await fetch('/admin/templates', { method: 'POST', body: fd, headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else msg = j.msg ?? 'monitor added';
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
    <div class="flex items-center gap-2">
      <LayoutTemplateIcon />
      <Card.Title>templates</Card.Title>
    </div>
    <Card.Description>One host, one click. SSL uses Certificate Transparency (not the live edge cert). Host/UDP are TCP fallbacks.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-10 rounded-lg" />
        <Skeleton class="h-24 rounded-lg" />
      </div>
    {:else}
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="host">host</Field.FieldLabel>
          <Input id="host" bind:value={host} maxlength={120} placeholder="example.com" />
        </Field.Field>
      </Field.FieldGroup>
      <div class="mt-3 flex flex-wrap gap-2">
        {#each templates as t (t.id)}
          <Button variant="secondary" disabled={busy !== ''} onclick={() => apply(t.id)}>
            <PlusIcon data-icon="inline-start" /> {t.label}
          </Button>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
