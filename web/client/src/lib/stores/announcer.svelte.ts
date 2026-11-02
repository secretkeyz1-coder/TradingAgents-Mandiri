// One polite live region for the whole page (App.svelte renders it, empty, from the start). A status
// that appears together with its text, such as "AI sedang menganalisa Bitcoin…" or a notice a link
// brought, is often not read out: screen readers announce changes to a region that already exists,
// not a region that arrives full. Components still show the status, and say it here too.

class Announcer {
  text = $state('');

  /** Read `message` out politely; the same message twice is read twice. */
  say(message: string) {
    this.text = '';
    setTimeout(() => (this.text = message), 50);
  }
}

export const announcer = new Announcer();
