<script lang="ts">
  // Riset AI before an asset's chart is open (ADR 0019, replacing ADR 0018's picker beside the AI panel): the assets
  // on the left (AssetPicker), the one picked on the right with its chart, the AI's last call and how to start
  // (ResearchPreview). A browser that never opened an asset sees how research works instead of a preview of an
  // asset nobody chose. On a phone the list and the preview take turns, the preview behind a back button.
  import { usage } from '../stores/usage.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { ws } from '../stores/workspace.svelte';
  import AssetPicker from './AssetPicker.svelte';
  import Icon from './Icon.svelte';
  import ResearchPreview from './ResearchPreview.svelte';

  usage.refresh();

  const wide = $derived(layoutOf(viewport) !== 'narrow');
  /** Something to show beside the list: an asset opened before in this browser, or one picked here. */
  let picked = $state(ws.recent.length > 0);
  /** On a phone: the preview is showing, the list one tap back. */
  let previewing = $state(false);

  function pick(tv: string) {
    ws.preview(tv);
    picked = true;
    previewing = true;
  }

  const quotaLine = $derived.by(() => {
    if (!usage.value) return '';
    const analyses = usage.left('analyses');
    const chat = usage.left('chat');
    if (!Number.isFinite(analyses) && !Number.isFinite(chat)) return '';
    const amount = (n: number, unit: string) => (Number.isFinite(n) ? `${n} ${unit}` : `${unit} tanpa batas`);
    return `Sisa kuota hari ini: ${amount(analyses, 'analisa')} dan ${amount(chat, 'pesan Tanya AI')}. Kembali penuh pukul 00.00 WIB.`;
  });
</script>

{#snippet guide()}
  <section class="ta-card flex flex-col gap-5 p-6" aria-labelledby="guide-title">
    <div class="flex items-center gap-3">
      <span class="ta-step-n bg-base-200 text-base-content" aria-hidden="true">2</span>
      <h2 id="guide-title" class="ta-section-title">Pilih aset di kiri untuk mulai</h2>
    </div>
    <p class="max-w-prose text-base">
      Riset AI membaca satu aset sekaligus. Begitu kamu memilih, harga, grafik, dan keputusan AI terakhirnya muncul di sini, lalu kamu memilih cara risetnya.
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="flex items-start gap-3 rounded-box border border-base-300 p-4">
        <span class="ta-choice-icon"><Icon name="ai" /></span>
        <span class="min-w-0">
          <span class="ta-nx-title">Analisa lengkap</span>
          <span class="ta-nx-sub">Tim analis AI membaca harga, berita, dan sentimen, lalu memutuskan Beli, Tunggu dulu, atau Jual beserta alasannya. Memakai 1 kuota analisa.</span>
        </span>
      </div>
      <div class="flex items-start gap-3 rounded-box border border-base-300 p-4">
        <span class="ta-choice-icon"><Icon name="chat" /></span>
        <span class="min-w-0">
          <span class="ta-nx-title">Tanya AI</span>
          <span class="ta-nx-sub">Tanya jawab cepat soal grafik dan berita aset itu. Memakai 1 kuota tanya per pesan.</span>
        </span>
      </div>
    </div>
    {#if quotaLine}<p class="text-sm ta-muted">{quotaLine}</p>{/if}
  </section>
{/snippet}

<!-- Each scroller is `relative` so sr-only text inside it is clipped with it instead of lengthening the page. -->
{#if wide}
  <div class="relative h-full overflow-auto bg-base-200">
    <div class="ta-research mx-auto w-full max-w-[100rem]">
      <div><AssetPicker selected={picked ? ws.symbol : null} onpick={pick} /></div>
      <div>{#if picked}<ResearchPreview />{:else}{@render guide()}{/if}</div>
    </div>
  </div>
{:else if previewing}
  <div class="flex h-full min-h-0 flex-col bg-base-200">
    <div class="shrink-0 border-b border-base-300 bg-base-100 px-2 py-1.5">
      <button type="button" class="btn btn-ghost btn-sm gap-1 px-2" onclick={() => (previewing = false)}><Icon name="left" size={16} />Daftar aset</button>
    </div>
    <div class="relative min-h-0 flex-1 overflow-auto p-3"><ResearchPreview /></div>
  </div>
{:else}
  <div class="relative h-full overflow-auto bg-base-200 p-4"><AssetPicker onpick={pick} /></div>
{/if}
