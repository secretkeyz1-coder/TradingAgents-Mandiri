<script lang="ts">
  // Recipe skills the agent proposed. Nothing the agent proposes is usable until
  // it is approved here; each change is a new version and older ones can come back.
  import type { AgentSkill } from '../api';
  import { agent } from '../stores/agent.svelte';

  const STATUS: Record<string, string> = {
    draft: 'Menunggu persetujuan',
    active: 'Aktif',
    archived: 'Versi lama',
    rejected: 'Ditolak',
    disabled: 'Nonaktif',
  };

  // One group per skill name; the versions come newest first from the server.
  const groups = $derived(
    Object.values(
      agent.skills.reduce<Record<string, AgentSkill[]>>((acc, s) => {
        (acc[s.name] ??= []).push(s);
        return acc;
      }, {}),
    ),
  );
  let openVersions = $state<Record<string, boolean>>({});
</script>

<section class="flex flex-col gap-2 rounded-box border border-base-300 p-2" aria-label="Skill agent">
  {#if groups.length === 0}
    <p class="text-xs text-base-content/70">
      Belum ada skill. Jelaskan cara analisa kamu di chat, lalu minta agent "simpan sebagai skill".
    </p>
  {/if}
  {#each groups as versions (versions[0].name)}
    {@const shown = (['draft', 'active', 'disabled'] as const).map((s) => versions.find((v) => v.status === s)).find(Boolean) ?? versions[0]}
    {@const d = shown.definition}
    <article class="flex flex-col gap-1.5 border-b border-base-300 pb-2 last:border-0 last:pb-0">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-mono text-xs font-semibold">{d.name}</span>
        <span class="badge badge-xs" class:badge-warning={shown.status === 'draft'} class:badge-soft={shown.status === 'draft'} class:badge-ghost={shown.status !== 'draft'}>
          {STATUS[shown.status]} · v{shown.version}
        </span>
      </div>
      <p class="text-xs">{d.description}</p>
      <p class="text-xs text-base-content/70">Dipakai saat: {d.when_to_use}</p>
      <details class="text-xs">
        <summary class="cursor-pointer text-base-content/70">Isi skill</summary>
        <p class="mt-1 font-mono">{d.steps.map((s) => s.tool).join(' → ')}</p>
        {#if Object.keys(d.params).length}
          <p class="font-mono text-base-content/70">{Object.entries(d.params).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>
        {/if}
        <p class="mt-1 whitespace-pre-wrap">{d.instruction}</p>
      </details>
      {#if shown.test}
        <p class="text-xs" class:text-success={shown.test.ok} class:text-error={!shown.test.ok}>
          Uji di {shown.test.symbol}: {shown.test.ok ? 'berhasil' : `gagal — ${shown.test.errors.join('; ')}`}
        </p>
      {/if}
      <div class="flex flex-wrap gap-1">
        {#if shown.status === 'draft'}
          <button class="btn btn-primary btn-xs" onclick={() => agent.skillAction(shown, 'approve')} disabled={!shown.test?.ok}>Setujui</button>
          <button class="btn btn-ghost btn-xs" onclick={() => agent.skillAction(shown, 'reject')}>Tolak</button>
        {:else if shown.status === 'active'}
          <button class="btn btn-ghost btn-xs" onclick={() => agent.skillAction(shown, 'disable')}>Nonaktifkan</button>
        {:else if shown.status === 'disabled'}
          <button class="btn btn-xs" onclick={() => agent.skillAction(shown, 'enable')}>Aktifkan</button>
        {/if}
        {#if versions.length > 1}
          <button class="btn btn-ghost btn-xs" onclick={() => (openVersions[d.name] = !openVersions[d.name])}>
            Versi ({versions.length})
          </button>
        {/if}
        <button class="btn btn-ghost btn-xs ml-auto" onclick={() => agent.deleteSkill(d.name)}>Hapus</button>
      </div>
      {#if openVersions[d.name]}
        <ul class="flex flex-col gap-1 text-xs">
          {#each versions as v (v.id)}
            <li class="flex items-center gap-2">
              <span class="font-mono">v{v.version}</span>
              <span class="text-base-content/70">{STATUS[v.status]}</span>
              {#if v.status === 'archived'}
                <button class="link link-hover ml-auto" onclick={() => agent.skillAction(v, 'restore')}>Pulihkan</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </article>
  {/each}
</section>
