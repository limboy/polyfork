import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
markdown.validateLink = (href) => {
  try {
    return new URL(href, "https://github.com/limboy/polyfork/releases/").protocol === "https:";
  } catch {
    return false;
  }
};

// Release bodies are remote Markdown: escape HTML, omit images and allow HTTPS links only.
export const renderReleaseNotes = (notes: string) => markdown.render(notes);
