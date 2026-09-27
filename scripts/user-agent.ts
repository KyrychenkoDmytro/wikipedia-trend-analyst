/**
 * Wikimedia's API etiquette policy asks every client to identify itself with
 * a descriptive User-Agent that includes contact info, so operators can reach
 * you if a request pattern causes problems. Set WIKI_UA_CONTACT once (e.g. in
 * your shell profile or the agent's environment) rather than passing --contact
 * on every call.
 */
export function buildUserAgent(contact?: string): string {
  const contactInfo = contact ?? process.env.WIKI_UA_CONTACT ?? "no-contact-set (set WIKI_UA_CONTACT)";
  return `wikipedia-trend-analyst-skill/0.1 (${contactInfo}) node-fetch`;
}
