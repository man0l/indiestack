<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import SaveIcon from '@lucide/svelte/icons/save';
  import SendIcon from '@lucide/svelte/icons/send';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';
  import { Skeleton } from '$lib/components/ui/skeleton';

  let settings: Record<string, string> = $state({});
  let rollups: string[] = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let msg = $state('');
  let err = $state('');

  const val = (k: string) => settings[k] ?? '';

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/settings');
      if (r.ok) {
        const j = await r.json();
        settings = j.settings ?? {};
        rollups = j.rollups ?? [];
      } else err = 'failed to load settings';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function post(action: string, form: HTMLFormElement) {
    busy = action;
    err = '';
    try {
      const r = await fetch(action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' } });
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

{#if loading}
  <div class="flex flex-col gap-3">
    <Skeleton class="h-64 rounded-xl" />
    <Skeleton class="h-24 rounded-xl" />
  </div>
{:else}
  <Card.Root>
    <Card.Header>
      <div class="flex items-center gap-2">
        <SettingsIcon />
        <Card.Title>alert channels</Card.Title>
      </div>
      <Card.Description>One alert batch fans out to every configured channel.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          post('/admin/settings', e.currentTarget as HTMLFormElement);
        }}
      >
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="webhook">alert webhook (discord / slack / generic JSON)</Field.FieldLabel>
            <Input id="webhook" name="webhook_url" type="url" value={val('webhook_url')} placeholder="https://discord.com/api/webhooks/…" />
          </Field.Field>
          <div class="grid gap-2 sm:grid-cols-2">
            <Field.Field>
              <Field.FieldLabel for="tg">telegram bot token (optional)</Field.FieldLabel>
              <Input id="tg" name="telegram_bot_token" value={val('telegram_bot_token')} placeholder="123456:ABC-DEF…" />
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel for="tgchat">telegram chat id (optional)</Field.FieldLabel>
              <Input id="tgchat" name="telegram_chat_id" value={val('telegram_chat_id')} placeholder="123456789" />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.FieldLabel for="resend">resend api key (optional — email alerts)</Field.FieldLabel>
            <Input id="resend" name="resend_api_key" type="password" value={val('resend_api_key')} placeholder="re_…" />
          </Field.Field>
          <div class="grid gap-2 sm:grid-cols-2">
            <Field.Field>
              <Field.FieldLabel for="email">alert email (to, needs resend key)</Field.FieldLabel>
              <Input id="email" name="alert_email" type="email" value={val('alert_email')} placeholder="you@example.com" />
            </Field.Field>
            <Field.Field>
              <Field.FieldLabel for="from">alert email from (optional — resend domain)</Field.FieldLabel>
              <Input id="from" name="alert_from" type="email" value={val('alert_from')} placeholder="onboarding@resend.dev" />
            </Field.Field>
          </div>
        </Field.FieldGroup>
        <Button type="submit" class="mt-4" disabled={busy !== ''}>
          <SaveIcon data-icon="inline-start" /> save channels
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>test the channels</Card.Title>
      <Card.Description
        >{val('last_alert_error') ? `last error: ${val('last_alert_error')}` : 'No delivery errors recorded.'}</Card.Description
      >
    </Card.Header>
    <Card.Content>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          post('/admin/test-alert', e.currentTarget as HTMLFormElement);
        }}
      >
        <Button variant="secondary" type="submit" disabled={busy !== ''}>
          <SendIcon data-icon="inline-start" /> send test alert
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root class="mt-3">
    <Card.Header>
      <Card.Title>rollups</Card.Title>
      <Card.Description>Daily JSON lands in R2 after midnight UTC.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if rollups.length === 0}
        <p class="text-sm text-muted-foreground">Nothing rolled up yet.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each rollups as d (d)}
            <li><a class="text-sm text-primary underline" href={`/admin/rollups/${d}`}>{d}</a></li>
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}
