import { Marked, type Tokens } from "marked";
import { CLOUD_NAME } from "./cloudinary";

/**
 * Markdown → HTML for post bodies, hardened so the output is safe to pass to
 * `dangerouslySetInnerHTML` without a sanitizer dependency.
 *
 * ── Why hardening is load-bearing, not belt-and-braces ────────────────────
 * `marked` has had no `sanitize` option since v5; it emits raw HTML verbatim
 * and does not filter URL schemes. Verified empirically against the installed
 * marked 18.2.1:
 *
 *   "<script>alert(1)</script>"    → "<script>alert(1)</script>"
 *   "[x](javascript:alert(1))"     → "<a href=\"javascript:alert(1)\">x</a>"
 *   "<img src=x onerror=alert(1)>" → passed through unchanged
 *
 * So the three renderer overrides below are the entire defence. Removing any
 * one of them reintroduces a stored-XSS hole. Phase 0's PostArticle carried a
 * comment promising that "Phase 1's Markdown pipeline is the commit that
 * introduces [dangerouslySetInnerHTML], and the sanitisation question along
 * with it" — this module is that answer.
 *
 * Today only the site owner can author a post, so the realistic threat is a
 * mistake rather than an attacker. That changes in Phase 3, when visitor
 * comments arrive; comment bodies will render as escaped plain text and must
 * NOT come through here. This module is for owner-authored content only.
 *
 * ── Why escaping raw HTML rather than pre-escaping the source ─────────────
 * The plan proposed escaping `<` in the source before parsing. That turns out
 * to be wrong in one specific way: marked preserves existing entities in
 * ordinary text (`&(?!#?\w+;)`) but escapes `&` UNCONDITIONALLY inside code
 * spans and fenced blocks. A pre-escaped source therefore renders
 * "`<b>`" as the literal text "&lt;b&gt;" inside the code span. Overriding the
 * `html` renderer instead catches every raw-HTML token — block and inline
 * alike, which is the only path by which marked emits author markup — and
 * leaves code spans working. Same guarantee, no double-escaping.
 */

/** Schemes a link may use. Everything else — `javascript:`, `data:`, `vbscript:` — is dropped. */
const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Images are stricter: no `mailto:`, and nothing that isn't fetchable over HTTP. */
const ALLOWED_IMAGE_SCHEMES = new Set(["http:", "https:"]);

/**
 * HTML-escape every character with meaning in markup OR in an attribute
 * value. `"` and `'` matter because `safeUrl` results are interpolated into
 * `href`/`src` attributes below — an unescaped quote there would break out of
 * the attribute even for an otherwise-allowed scheme.
 *
 * Exported for the body-text path and for tests.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The URL to emit for `raw`, or null if it must be dropped.
 *
 * Site-relative (`/blog/x`) and same-document (`#notes`) targets carry no
 * scheme to check and are allowed as-is. Anything else must parse as an
 * absolute URL with an allowed scheme — which means a *schemeless* relative
 * path like `other-post.md` is rejected rather than guessed at. That is
 * deliberate: `new URL()` is the only parser here that can be trusted about
 * what a scheme is, and a rejected link is a visible authoring mistake while
 * a mis-parsed one is a silent hole.
 *
 * Case folding matters — `JaVaScRiPt:alert(1)` reaches the tokenizer intact,
 * and `URL.protocol` already normalises it, which is why this goes through
 * `URL` rather than a string prefix test.
 */
export function safeUrl(raw: string, schemes: Set<string>): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  return schemes.has(parsed.protocol) ? href : null;
}

/** True for a URL that leaves this site, and so wants rel/target hardening. */
function isExternal(href: string): boolean {
  return /^https?:/i.test(href);
}

/**
 * A marked instance of its own rather than the module-level singleton, so
 * these overrides can never leak into another consumer of `marked` added
 * later. `async: false` keeps `parse()` synchronous and therefore usable
 * directly in a server component's render.
 */
const renderer = new Marked({ gfm: true, breaks: false, async: false });

renderer.use({
  renderer: {
    /**
     * Every raw-HTML token — `<script>`, `<div>`, an inline `<b>` — becomes
     * visible text. The author sees their markup instead of it taking effect,
     * which is both the safe outcome and the informative one.
     */
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },

    /**
     * Scheme-allowlisted links. A rejected href renders as plain text rather
     * than vanishing, so a typo'd or disallowed URL is visible in a preview
     * rather than silently swallowing its own link text.
     *
     * External links get `rel="noopener noreferrer"`; `noopener` is what stops
     * the opened page reaching back through `window.opener`, and it is only
     * meaningful alongside the `target="_blank"` applied with it.
     */
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens);
      const href = safeUrl(token.href, ALLOWED_LINK_SCHEMES);
      if (!href) return text;
      const title = token.title
        ? ` title="${escapeHtml(token.title)}"`
        : "";
      const external = isExternal(href)
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${escapeHtml(href)}"${title}${external}>${text}</a>`;
    },

    /**
     * Scheme-allowlisted images, lazily loaded.
     *
     * A rejected src renders as the alt text in brackets — an image that
     * cannot load is worth seeing in a preview, and an empty `<img>` is not.
     *
     * Alt text is required in the sense that an empty one is emitted as
     * `alt=""`, which is the correct signal to a screen reader for a purely
     * decorative image; it is not silently filled with the filename.
     */
    image(token: Tokens.Image): string {
      const src = safeUrl(token.href, ALLOWED_IMAGE_SCHEMES);
      const alt = escapeHtml(token.text ?? "");
      if (!src) return token.text ? `[${alt}]` : "";
      const title = token.title
        ? ` title="${escapeHtml(token.title)}"`
        : "";
      return `<img src="${escapeHtml(src)}" alt="${alt}"${title} loading="lazy" decoding="async">`;
    },

    /**
     * Headings are demoted one level: a body `#` becomes `<h2>`.
     *
     * The post page already renders the title as the page's only `<h1>`
     * (components/PostArticle.tsx), so an un-demoted body heading would emit a
     * second one — a document-outline bug that is invisible in a browser and
     * obvious to a screen reader or a crawler. Capped at `<h6>`, since there
     * is no `<h7>`.
     */
    heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading): string {
      const text = this.parser.parseInline(token.tokens);
      const level = Math.min(token.depth + 1, 6);
      return `<h${level}>${text}</h${level}>\n`;
    },
  },
});

/**
 * Render a post body to hardened HTML.
 *
 * Synchronous and pure, so it can be called straight from a server component
 * and unit-tested without a DOM. Returns "" for an empty body so callers can
 * test the string rather than inspecting the markdown.
 */
export function renderMarkdown(body: string): string {
  if (!body.trim()) return "";
  return renderer.parse(body) as string;
}
