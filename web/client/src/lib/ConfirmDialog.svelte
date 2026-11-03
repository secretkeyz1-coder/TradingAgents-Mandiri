<script lang="ts">
  // A question before an action that cannot be undone: a native <dialog> opened modal, so the page behind is
  // inert, Escape cancels and focus goes back to the button that asked. The title names the action and the
  // object, and the two buttons say what they do; the one that removes is red.
  let {
    open,
    title,
    body = '',
    confirm,
    danger = true,
    onconfirm,
    oncancel,
  }: { open: boolean; title: string; body?: string; confirm: string; danger?: boolean; onconfirm: () => void; oncancel: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="modal" aria-labelledby="confirm-title" onclose={() => open && oncancel()}>
  <div class="modal-box flex max-w-md flex-col gap-4">
    <h2 id="confirm-title" class="ta-section-title">{title}</h2>
    {#if body}<p class="text-sm leading-relaxed">{body}</p>{/if}
    <div class="modal-action mt-0">
      <button type="button" class="btn" onclick={oncancel}>Batal</button>
      <button type="button" class="btn {danger ? 'btn-error' : 'btn-primary'}" onclick={onconfirm}>{confirm}</button>
    </div>
  </div>
</dialog>
