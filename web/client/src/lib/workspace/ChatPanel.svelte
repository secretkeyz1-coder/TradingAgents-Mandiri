<script lang="ts">
  // Ask the chart agent about the symbol in focus. It answers, draws on the
  // chart, and remembers what you tell it; all of that is listed here. `simple`
  // (the Pemula screen) keeps only the conversation: no tool names, memory or skills.
  import { auth } from '../auth.svelte';
  import { renderMarkdown } from '../format';
  import { agent } from '../stores/agent.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import VerifyNote from '../VerifyNote.svelte';
  import SkillsPanel from './SkillsPanel.svelte';

  const SUGGESTIONS = ['Gambar support dan resistance 6 bulan', 'Ada trendline yang masih valid?', 'Buat rencana trade dari level terdekat'];

  let {
    suggestions = SUGGESTIONS,
    intro = '',
    simple = false,
  }: { suggestions?: string[]; intro?: string; simple?: boolean } = $props();

  usage.refresh();

  let draft = $state('');
  let showMemory = $state(false);
  let showSkills = $state(false);
  let list: HTMLElement | undefined = $state();

  // Keep the newest message in view.
  $effect(() => {
    void agent.messages.length;
    void agent.liveTools.length;
    void agent.liveText.length;
    list?.scrollTo({ top: list.scrollHeight });
  });

  function submit(event?: SubmitEvent) {
    event?.preventDefault();
    const text = draft;
    draft = '';
    agent.send(text);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2">
  <div class="flex flex-wrap items-center gap-1.5">
    <select
      class="select select-xs min-w-0 flex-1"
      aria-label="Sesi chat"
      value={agent.session?.id ?? ''}
      onchange={(e) => agent.open(e.currentTarget.value)}
      disabled={agent.sessions.length === 0}
    >
      {#if agent.sessions.length === 0}<option value="">Belum ada sesi</option>{/if}
      {#each agent.sessions as s (s.id)}<option value={s.id}>{s.title ?? 'Sesi baru'}</option>{/each}
    </select>
    <button class="btn btn-ghost btn-xs" onclick={() => agent.newSession()} disabled={agent.sending}>Baru</button>
    {#if agent.session}<button class="btn btn-ghost btn-xs" onclick={() => agent.deleteSession()} disabled={agent.sending}>Hapus</button>{/if}
  </div>

  <div bind:this={list} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
    {#if agent.messages.length === 0 && !agent.sending}
      <p class="text-sm text-base-content/70">{intro || `Tanya soal chart ${ws.yahoo}. Agent menghitung level dari data harga, lalu menggambarnya di chart.`}</p>
      <div class="flex flex-col gap-1.5">
        {#each suggestions as s (s)}
          <button class="btn btn-ghost btn-sm justify-start text-left font-normal" onclick={() => agent.send(s)}>{s}</button>
        {/each}
      </div>
    {/if}
    {#each agent.messages as m (m.id)}
      {#if m.role === 'user'}
        <p class="ml-6 self-end whitespace-pre-wrap rounded-box bg-base-200 px-3 py-2 text-sm">{m.content}</p>
      {:else}
        <div class="flex flex-col gap-1.5">
          {#if m.toolCalls.length && !simple}
            <p class="font-mono text-xs text-base-content/70">{m.toolCalls.map((t) => t.name).join(' · ')}</p>
          {/if}
          <div class="md text-sm">{@html renderMarkdown(m.content)}</div>
        </div>
      {/if}
    {/each}
    {#if agent.sending}
      <div class="flex flex-col gap-1">
        {#if simple}
          {#if agent.liveTools.length && !agent.liveText}<p class="text-xs text-base-content/70">AI sedang membaca data harga…</p>{/if}
        {:else}
          {#each agent.liveTools as t, i (i)}
            <p class="font-mono text-xs text-base-content/70">
              {t.summary === undefined ? '…' : t.summary.startsWith('ditolak') ? '✗' : '✓'} {t.name}
            </p>
          {/each}
        {/if}
        {#if agent.liveText}
          <div class="md text-sm">{@html renderMarkdown(agent.liveText)}</div>
        {:else}
          <span class="loading loading-dots loading-sm" aria-label="Agent sedang bekerja"></span>
        {/if}
      </div>
    {/if}
    {#if agent.error}<p role="alert" class="whitespace-pre-wrap text-sm text-error">{agent.error}</p>{/if}
  </div>

  <form class="flex flex-col gap-1.5" onsubmit={submit}>
    <textarea
      class="textarea textarea-sm min-h-16 w-full"
      bind:value={draft}
      onkeydown={onKey}
      placeholder={simple ? 'Tulis pertanyaanmu…' : 'Gambar support resistance dan jelaskan…'}
      aria-label="Pesan untuk agent"
      maxlength="4000"
    ></textarea>
    <!-- Wraps in a narrow (floating) panel, so Kirim never slides out of view. -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      {#if !simple}
        <button class="btn btn-ghost btn-xs" type="button" onclick={() => (showMemory = !showMemory)}>
          Memori · {agent.memories.length}
        </button>
        <button class="btn btn-ghost btn-xs gap-1" type="button" onclick={() => (showSkills = !showSkills)}>
          Skill
          {#if agent.drafts.length}<span class="badge badge-xs badge-warning">{agent.drafts.length} baru</span>{/if}
        </button>
        <span class="text-xs tabular-nums text-base-content/70">{agent.drawings.length} gambar</span>
      {/if}
      {#if usage.value?.chat.limit}
        <span class="text-xs tabular-nums" class:text-warning={!usage.left('chat')} class:text-base-content={usage.left('chat') > 0} title="Pesan chat hari ini; reset pukul 00.00 WIB">
          {usage.value.chat.used}/{usage.value.chat.limit} pesan
        </span>
      {/if}
      {#if agent.sending}
        <button class="btn btn-sm ml-auto" type="button" onclick={() => agent.stop()}>Hentikan</button>
      {:else}
        <button class="btn btn-primary btn-sm ml-auto" type="submit" disabled={!draft.trim() || !ws.yahoo || usage.left('chat') === 0 || auth.unverified}>Kirim</button>
      {/if}
    </div>
    {#if auth.unverified}<VerifyNote />{/if}
  </form>

  {#if showSkills}
    <SkillsPanel />
  {/if}

  {#if showMemory}
    <section class="rounded-box border border-base-300 p-2" aria-label="Memori agent">
      {#if agent.memories.length === 0}
        <p class="text-xs text-base-content/70">Belum ada. Ceritakan gaya trading kamu dan agent akan mengingatnya.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each agent.memories as m (m.id)}
            <li class="flex items-start gap-2 text-xs">
              <span class="badge badge-xs badge-ghost shrink-0">{m.scope === 'user' ? 'kamu' : m.symbol}</span>
              <span class="min-w-0 flex-1">{m.content}</span>
              <button class="link link-hover shrink-0" onclick={() => agent.deleteMemory(m.id)}>hapus</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
