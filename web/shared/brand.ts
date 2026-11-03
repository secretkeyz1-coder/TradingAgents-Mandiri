// The product's public identity, used by the site, the app, e-mails and Telegram
// (ADR 0022). The engine underneath keeps its own name, TradingAgents; only what a
// member reads says TraderMedan. Empty fields are left out wherever they would show.
export const BRAND = {
  name: "TraderMedan",
  /** The name as the wordmark sets it: the second part in the brand's orange. */
  wordmark: ["Trader", "Medan"] as const,
  tagline: "Bukti, bukan janji.",
  /** Support address, shown on the site and in e-mails when set. */
  supportEmail: "",
  /** Support WhatsApp number in +62 form, shown when set. */
  whatsapp: "",
  /** The company that runs the service, named on the legal pages once it exists. */
  company: "",
};

/**
 * The mark on a 64-unit square: an orange diamond with an ink M drawn as one stroke. The app's Logo, the
 * public pages' header and client/public/favicon.svg draw these same paths.
 */
export const MARK = {
  viewBox: "0 0 64 64",
  diamond: "M32 2 L62 32 L32 62 L2 32 Z",
  m: "M18 41 V23 L32 35 L46 23 V41",
  stroke: 5.2,
};

/** How a member reaches the people behind the service (WhatsApp first), or null while neither contact is set. */
export function supportContact(): { label: string; href: string } | null {
  if (BRAND.whatsapp) return { label: `WhatsApp ${BRAND.whatsapp}`, href: `https://wa.me/${BRAND.whatsapp.replace(/\D/g, "")}` };
  if (BRAND.supportEmail) return { label: BRAND.supportEmail, href: `mailto:${BRAND.supportEmail}` };
  return null;
}
