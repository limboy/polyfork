import { expect, test } from "bun:test";
import { renderReleaseNotes } from "./release-notes";

test("release notes display headings, change lists and emphasis", () => {
  const html = renderReleaseNotes("## What's new\n\n- **Sort models:** newest first\n- Resize the sidebar");
  expect(html).toContain("<h2>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<strong>Sort models:</strong>");
});

test("release notes cannot inject HTML or remote images", () => {
  const html = renderReleaseNotes('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![tracking](https://example.com/image.png)');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
});

test("release note links allow HTTPS and relative paths but reject active schemes", () => {
  const html = renderReleaseNotes("[Release](https://github.com/limboy/polyfork/releases)\n\n[Readme](../README.md)\n\n[Bad](javascript:alert(1))\n\n[Local](file:///Applications)\n\n[HTTP](http://example.com)");
  expect(html).toContain('href="https://github.com/limboy/polyfork/releases"');
  expect(html).toContain('href="../README.md"');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="file:');
  expect(html).not.toContain('href="http:');
});
