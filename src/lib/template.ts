// Sequence copy supports two constructs:
//   {{first_name}} / {{first_name|fallback}}     — lead variables
//   {{RANDOM|option a|option b|option c}}        — spintax, uniform pick
// Variable names map to Lead fields plus any custom CSV columns.

export interface LeadVars {
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  [key: string]: string;
}

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function renderTemplate(template: string, vars: LeadVars): string {
  return template.replace(TOKEN, (_match, inner: string) => {
    const parts = inner.split("|").map((p) => p.trim());
    if (parts[0].toUpperCase() === "RANDOM") {
      const options = parts.slice(1);
      if (options.length === 0) return "";
      return options[Math.floor(Math.random() * options.length)];
    }
    const key = parts[0].toLowerCase().replace(/\s+/g, "_");
    const value = vars[key];
    if (value && value.trim()) return value;
    return parts[1] ?? "";
  });
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bodies are authored as plain text, so bare URLs must become anchors here —
 * click tracking has nothing to rewrite otherwise. `linkHref` maps each raw
 * URL to what the href should be (the tracking redirect when enabled).
 */
export function textToHtml(text: string, linkHref?: (url: string) => string): string {
  return text
    .split(/\n\n+/)
    .map((paragraph) => {
      let html = "";
      let cursor = 0;
      for (const match of paragraph.matchAll(URL_RE)) {
        const url = match[0].replace(/[.,;:!?)\]]+$/, "");
        const start = match.index ?? 0;
        html += escapeHtml(paragraph.slice(cursor, start));
        html += `<a href="${escapeHtml(linkHref ? linkHref(url) : url)}">${escapeHtml(url)}</a>`;
        cursor = start + url.length;
      }
      html += escapeHtml(paragraph.slice(cursor));
      return `<p style="margin:0 0 1em 0">${html.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
}

export const VARIABLES = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{last_name}}", label: "Last name" },
  { token: "{{company}}", label: "Company" },
  { token: "{{title}}", label: "Job title" },
  { token: "{{email}}", label: "Email" },
  { token: "{{RANDOM|Hi|Hello|Hey}}", label: "Spintax greeting" },
];
