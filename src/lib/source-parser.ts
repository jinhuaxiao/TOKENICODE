/**
 * Source parser — extracts URLs and sources from search backend outputs.
 * Supports Grok (markdown) and Gemini (JSON grounding metadata).
 * Pure functions, no side effects.
 */

export interface ParsedSource {
  url: string;
  title: string;
  snippet: string;
}

/** Check if a Bash command is a Grok search via opencli */
export function isGrokBashCommand(command: string | undefined | null): boolean {
  if (!command) return false;
  return /\bopencli\s+grok\b/i.test(command);
}

/** Check if a Bash command is a Gemini search via curl */
export function isGeminiSearchCommand(command: string | undefined | null): boolean {
  if (!command) return false;
  return /generativelanguage\.googleapis\.com.*generateContent/i.test(command);
}

/** Unified detection: returns the search type or null */
export function detectTeamSearchCommand(command: string | undefined | null): 'grok-search' | 'gemini-search' | null {
  if (!command) return null;
  if (isGrokBashCommand(command)) return 'grok-search';
  if (isGeminiSearchCommand(command)) return 'gemini-search';
  return null;
}

/** Extract the search query from an opencli grok command */
export function extractGrokQuery(command: string | undefined | null): string | null {
  if (!command) return null;
  // Match: opencli grok chat "query" or opencli grok chat 'query' or opencli grok "query"
  const match = command.match(/\bopencli\s+grok\s+(?:chat\s+)?["']([^"']+)["']/i);
  if (match) return match[1];
  // Fallback: opencli grok chat query (unquoted, take rest of line)
  const fallback = command.match(/\bopencli\s+grok\s+(?:chat\s+)?(.+)$/i);
  if (fallback) return fallback[1].trim();
  return null;
}

/** Extract the search query from a Gemini curl command (from JSON body "text" field) */
export function extractGeminiQuery(command: string | undefined | null): string | null {
  if (!command) return null;
  // Try to match the "text" field in the JSON body of the curl command
  const textMatch = command.match(/"text"\s*:\s*"([^"]+)"/);
  if (textMatch) return textMatch[1];
  // Fallback: look for single-quoted text field
  const singleMatch = command.match(/"text"\s*:\s*'([^']+)'/);
  if (singleMatch) return singleMatch[1];
  return null;
}

/** Unified query extraction */
export function extractSearchQuery(command: string | undefined | null, type: 'grok-search' | 'gemini-search'): string | null {
  if (type === 'grok-search') return extractGrokQuery(command);
  if (type === 'gemini-search') return extractGeminiQuery(command);
  return null;
}

/** Extract domain from a URL */
export function extractDomainFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Extract sources from Grok's markdown output using multiple patterns */
export function extractSourcesFromMarkdown(markdown: string): ParsedSource[] {
  if (!markdown) return [];

  const seen = new Set<string>();
  const sources: ParsedSource[] = [];

  const addSource = (url: string, title: string, snippet: string) => {
    const normalizedUrl = url.replace(/\/$/, '');
    if (seen.has(normalizedUrl)) return;
    if (!/^https?:\/\//i.test(normalizedUrl)) return;
    // Skip common non-content URLs
    if (/\.(js|css|png|jpg|gif|svg|ico)(\?|$)/i.test(normalizedUrl)) return;
    seen.add(normalizedUrl);
    sources.push({ url: normalizedUrl, title: title || extractDomainFromUrl(normalizedUrl), snippet });
  };

  // Pattern 1: Numbered reference lists — "N. Title ... URL" or "[N] Title - URL"
  const numberedPattern = /(?:^|\n)\s*(?:\[?\d+\]?[\.\)]\s*)(.+?)\s*[-–—]\s*(https?:\/\/\S+)/g;
  let match;
  while ((match = numberedPattern.exec(markdown)) !== null) {
    addSource(match[2], match[1].trim(), '');
  }

  // Pattern 2: Markdown links — [Title](URL)
  const mdLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((match = mdLinkPattern.exec(markdown)) !== null) {
    addSource(match[2], match[1], '');
  }

  // Pattern 3: Bare URLs (not already captured)
  const bareUrlPattern = /(?:^|\s)(https?:\/\/[^\s<>")\]]+)/g;
  while ((match = bareUrlPattern.exec(markdown)) !== null) {
    addSource(match[1], '', '');
  }

  // Try to extract snippets — look for text near each source URL
  for (const source of sources) {
    if (source.snippet) continue;
    const urlIdx = markdown.indexOf(source.url);
    if (urlIdx === -1) continue;
    // Look for surrounding text (up to 200 chars before/after)
    const before = markdown.slice(Math.max(0, urlIdx - 200), urlIdx);
    const afterEnd = markdown.indexOf('\n', urlIdx + source.url.length);
    const after = markdown.slice(urlIdx + source.url.length, afterEnd !== -1 ? afterEnd : urlIdx + source.url.length + 200);
    // Take the last sentence before the URL as snippet
    const sentences = before.split(/[.!?。]\s+/);
    const lastSentence = sentences[sentences.length - 1]?.trim();
    if (lastSentence && lastSentence.length > 10 && lastSentence.length < 200) {
      source.snippet = lastSentence;
    } else if (after.trim().length > 10) {
      source.snippet = after.trim().slice(0, 150);
    }
  }

  return sources;
}

/** Extract sources from Gemini's JSON response (groundingMetadata.groundingChunks) */
export function extractSourcesFromGeminiResponse(jsonText: string): ParsedSource[] {
  if (!jsonText) return [];

  try {
    const data = JSON.parse(jsonText);
    const chunks =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks ??
      data?.groundingMetadata?.groundingChunks ??
      [];

    const sources: ParsedSource[] = [];
    const seen = new Set<string>();

    for (const chunk of chunks) {
      const web = chunk?.web;
      if (!web?.uri) continue;
      const url = web.uri.replace(/\/$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({
        url,
        title: web.title || extractDomainFromUrl(url),
        snippet: '',
      });
    }

    if (sources.length > 0) return sources;
  } catch {
    // JSON parse failed — fall back to markdown extraction
  }

  // Fallback: treat as markdown/text and extract URLs
  return extractSourcesFromMarkdown(jsonText);
}

/** Unified source extraction based on search type */
export function extractSources(resultContent: string, type: 'grok-search' | 'gemini-search'): ParsedSource[] {
  if (type === 'gemini-search') return extractSourcesFromGeminiResponse(resultContent);
  return extractSourcesFromMarkdown(resultContent);
}
