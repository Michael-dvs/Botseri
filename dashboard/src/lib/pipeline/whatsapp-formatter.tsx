import React from "react";

export function formatWhatsAppMarkdown(text: string): string {
  if (!text) return "";

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~([^~]+)~/g, "<del>$1</del>")
    .replace(
      /```([^`]+)```/g,
      "<code class='rounded bg-stone-200 px-1 py-0.5 font-mono text-xs text-stone-900'>$1</code>"
    )
    .replace(/\n/g, "<br />");
}

export function WhatsAppFormattedText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const formattedHtml = formatWhatsAppMarkdown(text);
  return <span dangerouslySetInnerHTML={{ __html: formattedHtml }} />;
}
