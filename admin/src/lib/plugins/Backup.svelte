<script lang="ts">
  import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Alert from '$lib/components/ui/alert';

  let busy = $state(false);
  let msg = $state('');
  let err = $state('');

  async function restore(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) {
      err = 'choose a backup file first';
      return;
    }
    busy = true;
    err = '';
    try {
      const r = await fetch('/admin/backup', { method: 'POST', body: fd, headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({ ok: r.ok }));
      if (!j.ok) err = j.error ?? 'failed';
      else {
        msg = j.msg ?? 'done';
        form.reset();
      }
    } catch (e) {
      err = String(e);
    } finally {
      busy = false;
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
      <HardDriveIcon />
      <Card.Title>backup</Card.Title>
    </div>
    <Card.Description
      >Download monitors, jobs, log sources, deploy targets, agent tokens, analytics sites, settings, checks, rollups, and recent log tails. Restore upserts those rows. Extra rows you added after the file are kept. Settings in the file overwrite, including the admin token.</Card.Description
    >
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <div>
      <Button href="/admin/backup.json" download>
        <DownloadIcon data-icon="inline-start" /> download JSON
      </Button>
    </div>
    <form onsubmit={restore}>
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="file">restore from JSON</Field.FieldLabel>
          <Input id="file" name="file" type="file" accept="application/json,.json" required />
        </Field.Field>
      </Field.FieldGroup>
      <Button type="submit" class="mt-4" variant="secondary" disabled={busy}>
        <UploadIcon data-icon="inline-start" /> {busy ? 'restoring…' : 'restore'}
      </Button>
    </form>
  </Card.Content>
</Card.Root>
