// The product's public identity, used by the site, the app and e-mails. Change
// it here once the brand, domain and company are decided; empty fields are left
// out wherever they would show.
export const BRAND = {
  name: "TradingAgents",
  tagline: "Bukti, bukan janji.",
  /** Support address, shown on the site and in e-mails when set. */
  supportEmail: "",
  /** Support WhatsApp number in +62 form, shown when set. */
  whatsapp: "",
  /** The company that runs the service, named on the legal pages once it exists. */
  company: "",
};

/** How a member reaches the people behind the service (WhatsApp first), or null while neither contact is set. */
export function supportContact(): { label: string; href: string } | null {
  if (BRAND.whatsapp) return { label: `WhatsApp ${BRAND.whatsapp}`, href: `https://wa.me/${BRAND.whatsapp.replace(/\D/g, "")}` };
  if (BRAND.supportEmail) return { label: BRAND.supportEmail, href: `mailto:${BRAND.supportEmail}` };
  return null;
}
