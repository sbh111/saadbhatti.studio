import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown, safeUrl } from "@/lib/markdown";

/**
 * These tests exist because lib/markdown.ts is the only thing standing between
 * a post body and `dangerouslySetInnerHTML`. They are written as attacks
 * rather than as feature checks on purpose: marked 18 passes raw HTML through
 * verbatim and does not filter URL schemes, so each case below is something
 * that DOES get through an unhardened pipeline.
 */

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

describe("renderMarkdown — hardening", () => {
  it("renders a raw <script> block as visible text, not as a script", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders an inline <script> inside a paragraph as visible text", () => {
    const html = renderMarkdown("before <script>alert(1)</script> after");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("neutralises an event-handler attribute on raw HTML", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    // The whole tag is text now, so there is no attribute to fire.
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain("&lt;img");
  });

  it("drops a javascript: link but keeps its text", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
    expect(html).not.toContain("<a ");
  });

  it("drops a javascript: link whatever its casing", () => {
    // URL.protocol normalises case, which a string prefix check would miss.
    const html = renderMarkdown("[click](JaVaScRiPt:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("drops a data: link", () => {
    const html = renderMarkdown(
      "[click](data:text/html,<script>alert(1)</script>)"
    );
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<a ");
  });

  it("drops a javascript: image source", () => {
    const html = renderMarkdown("![alt](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    // The alt text survives in brackets so the mistake is visible in a preview.
    expect(html).toContain("[alt]");
  });

  it("neutralises a hand-written anchor with a javascript: href", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/<a\s/i);
    expect(html).toContain("&lt;a");
  });
});

describe("renderMarkdown — markdown that should still work", () => {
  it("keeps an https link and marks it external", () => {
    const html = renderMarkdown("[ok](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("keeps a site-relative link without external attributes", () => {
    const html = renderMarkdown("[other](/blog/other)");
    expect(html).toContain('href="/blog/other"');
    expect(html).not.toContain("noopener");
  });

  it("keeps a mailto link", () => {
    const html = renderMarkdown("[mail](mailto:someone@example.com)");
    expect(html).toContain('href="mailto:someone@example.com"');
  });

  it("renders an https image lazily", () => {
    const html = renderMarkdown("![a cat](https://example.com/cat.jpg)");
    expect(html).toContain('src="https://example.com/cat.jpg"');
    expect(html).toContain('alt="a cat"');
    expect(html).toContain('loading="lazy"');
  });

  it("renders emphasis, lists and blockquotes", () => {
    expect(renderMarkdown("*hi*")).toContain("<em>hi</em>");
    expect(renderMarkdown("- one\n- two")).toContain("<li>");
    expect(renderMarkdown("> quoted")).toContain("<blockquote>");
  });

  it("escapes a code span's contents ONCE, not twice", () => {
    // The regression the module's header documents: pre-escaping the source
    // would make this render as the literal text "&lt;b&gt;", because marked
    // escapes `&` unconditionally inside code.
    const html = renderMarkdown("`<b>`");
    expect(html).toContain("<code>&lt;b&gt;</code>");
    expect(html).not.toContain("&amp;lt;");
  });

  it("keeps an author's own entity intact in ordinary text", () => {
    expect(renderMarkdown("a &lt; b")).toContain("a &lt; b");
    expect(renderMarkdown("a &lt; b")).not.toContain("&amp;lt;");
  });
});

describe("renderMarkdown — heading demotion", () => {
  it("demotes a body h1 to h2 so the post title stays the only h1", () => {
    const html = renderMarkdown("# Body heading");
    expect(html).toContain("<h2>Body heading</h2>");
    expect(html).not.toContain("<h1");
  });

  it("caps demotion at h6", () => {
    const html = renderMarkdown("###### Deep");
    expect(html).toContain("<h6>Deep</h6>");
    expect(html).not.toContain("<h7");
  });
});

describe("renderMarkdown — empty input", () => {
  it("returns an empty string for an empty or whitespace-only body", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  ")).toBe("");
  });
});

describe("safeUrl", () => {
  it("allows site-relative and same-document targets unchanged", () => {
    expect(safeUrl("/blog/x", LINK_SCHEMES)).toBe("/blog/x");
    expect(safeUrl("#notes", LINK_SCHEMES)).toBe("#notes");
  });

  it("rejects a schemeless relative path rather than guessing", () => {
    expect(safeUrl("other-post.md", LINK_SCHEMES)).toBeNull();
  });

  it("rejects an empty or whitespace-only href", () => {
    expect(safeUrl("", LINK_SCHEMES)).toBeNull();
    expect(safeUrl("   ", LINK_SCHEMES)).toBeNull();
  });

  it("rejects a scheme outside the allowlist", () => {
    expect(safeUrl("vbscript:x", LINK_SCHEMES)).toBeNull();
    expect(safeUrl("file:///etc/passwd", LINK_SCHEMES)).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes both markup and attribute-breaking characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;"
    );
  });

  it("escapes & first, so nothing is double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
