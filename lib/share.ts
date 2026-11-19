/**
 * Share-intent URL builders.
 *
 * Pure, server-import-free and in one place, for exactly the reason
 * `lib/urls.ts` exists (invariant 10): six files once assembled catalog paths
 * by hand, and moving the prefix was six chances to miss one. An intent URL is
 * the same shape of problem — a parameter name differs per network, every
 * value has to be encoded, and a missed `encodeURIComponent` produces a link
 * that works until someone writes a post title containing an ampersand.
 *
 * Every builder takes the canonical URL from `postUrl()` and returns a string
 * safe to put straight in an `href`.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 * **Instagram.** It has no web intent for sharing an arbitrary link — there is
 * no URL that opens Instagram with a link attached. It is reachable only
 * through the operating system's share sheet, which `navigator.share` opens,
 * so the native sheet is how Instagram gets served rather than a button.
 *
 * **Any share counter.** None of these targets reports one, a click on an
 * outbound anchor is not a share, and a number that overstates reality is
 * worse than no number. Nothing here is stored.
 */

/** A share target, in the order they are rendered. */
export interface ShareTarget {
  /** Stable id — also the `data-track` label if share clicks are ever evented. */
  id: string;
  label: string;
  href: string;
}

/**
 * X (formerly Twitter). `x.com/intent/post` is the current path; the old
 * `twitter.com/intent/tweet` still redirects, but pointing at the redirect
 * means every share pays a hop and depends on that redirect surviving.
 */
export function xShareUrl(url: string, title: string): string {
  return `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
}

/**
 * LinkedIn. It accepts ONLY a url — any title or summary parameter is ignored,
 * and the card is built entirely from the page's Open Graph tags. That is why
 * `generateMetadata` in app/blog/[slug]/page.tsx has to set them: without OG,
 * this button produces a bare grey card no matter what is passed here.
 */
export function linkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

/** Facebook. Also OG-driven; `u` is the only parameter it reads. */
export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

/** Reddit, which does use the title it is given as the submission title. */
export function redditShareUrl(url: string, title: string): string {
  return `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
}

/** WhatsApp. One `text` field, so the title and URL are joined into it. */
export function whatsAppShareUrl(url: string, title: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
}

/**
 * Email. The one target that needs no JavaScript and no third party at all,
 * which is also why it is worth keeping even though it looks dated.
 */
export function emailShareUrl(url: string, title: string): string {
  return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
}

/**
 * Every link-based target for one post, in render order.
 *
 * Ordered by how much use each actually gets on a site like this rather than
 * alphabetically or by the networks' own size.
 */
export function shareTargets(url: string, title: string): ShareTarget[] {
  return [
    { id: "x", label: "X", href: xShareUrl(url, title) },
    { id: "facebook", label: "Facebook", href: facebookShareUrl(url) },
    { id: "linkedin", label: "LinkedIn", href: linkedInShareUrl(url) },
    { id: "reddit", label: "Reddit", href: redditShareUrl(url, title) },
    { id: "whatsapp", label: "WhatsApp", href: whatsAppShareUrl(url, title) },
    { id: "email", label: "Email", href: emailShareUrl(url, title) },
  ];
}
