import { Email, ExtractOtpOptions, ExtractLinkOptions } from './types.js';

// Re-export so existing deep imports (`@testmail-stream/sdk/extract`) keep working.
export type { ExtractOtpOptions, ExtractLinkOptions } from './types.js';

function stripHtml(html: string): string {
  // Drop <script> and <style> blocks entirely (tag AND contents) so CSS/JS
  // text never leaks into visible-text searches or OTP/link extraction.
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  // Replace remaining HTML tags with space to preserve word separation
  text = text.replace(/<[^>]*>/g, ' ');
  // Decode basic HTML entities to avoid breaking regexes on common characters
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function isValidLink(url: string): boolean {
  // Must start with http:// or https://
  if (!/^https?:\/\//i.test(url)) return false;
  // Exclude non-navigational links
  if (/\b(?:javascript|mailto|tel):/i.test(url)) return false;
  return true;
}

export function extractOtp(email: Email, opts: ExtractOtpOptions = {}): string | null {
  const preferHtml = opts.preferHtml ?? false;

  // Decide target text
  let sourceText = '';
  if (preferHtml && email.bodyHtml) {
    sourceText = stripHtml(email.bodyHtml);
  } else if (email.bodyText) {
    sourceText = email.bodyText;
  } else if (email.bodyHtml) {
    sourceText = stripHtml(email.bodyHtml);
  }

  if (!sourceText) return null;

  // Use custom RegExp if provided
  if (opts.regex) {
    const match = sourceText.match(opts.regex);
    return match ? match[0] : null;
  }

  // Build the code-matching pattern
  // Alphanumeric vs digits
  const len = opts.length ?? null;

  let codeRegex: RegExp;
  if (opts.alphanumeric) {
    if (len !== null) {
      codeRegex = new RegExp(`\\b[A-Z0-9]{${len}}\\b|\\b[A-Z0-9]{${Math.floor(len/2)}}-?[A-Z0-9]{${Math.ceil(len/2)}}\\b`, 'gi');
    } else {
      codeRegex = /\b[A-Z0-9]{4,8}\b|\b[A-Z0-9]{2,6}-[A-Z0-9]{2,6}\b/gi;
    }
  } else {
    if (len !== null) {
      codeRegex = new RegExp(`\\b[0-9]{${len}}\\b`, 'g');
    } else {
      codeRegex = /\b[0-9]{4,8}\b/g;
    }
  }

  // Keyword list for filtering and proximity scoring
  const keywords = opts.keywords ?? ['code', 'otp', 'passcode', 'verification', 'one-time', 'one time', '2fa'];

  // Find all matches in the source text
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  codeRegex.lastIndex = 0;
  while ((match = codeRegex.exec(sourceText)) !== null) {
    const candidate = match[0];
    if (keywords.some(kw => kw.toLowerCase() === candidate.toLowerCase())) {
      continue;
    }
    matches.push(candidate);
  }

  if (matches.length === 0) return null;

  // Keyword-proximity scoring
  const keywordRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'gi');

  const keywordIndices: number[] = [];
  let kwMatch: RegExpExecArray | null;
  while ((kwMatch = keywordRegex.exec(sourceText)) !== null) {
    keywordIndices.push(kwMatch.index);
  }

  if (keywordIndices.length === 0) {
    return matches[0];
  }

  let bestMatch: string | null = null;
  let minDistance = Infinity;

  for (const candidate of matches) {
    let searchIdx = 0;
    while (true) {
      const idx = sourceText.indexOf(candidate, searchIdx);
      if (idx === -1) break;

      for (const kwIdx of keywordIndices) {
        const distance = Math.abs(idx - kwIdx);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = candidate;
        }
      }
      searchIdx = idx + 1;
    }
  }

  if (minDistance <= 60 && bestMatch) {
    return bestMatch;
  }
  return matches[0] || null;
}

export function extractLinks(email: Email): string[] {
  const links: string[] = [];

  // Extract from HTML href attributes if bodyHtml exists
  if (email.bodyHtml) {
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = hrefRegex.exec(email.bodyHtml)) !== null) {
      const url = match[1].trim();
      if (isValidLink(url)) {
        links.push(url);
      }
    }
  }

  // Extract bare links from bodyText if it exists
  if (email.bodyText) {
    const urlRegex = /https?:\/\/[^\s"'<>\(\)]+/gi;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(email.bodyText)) !== null) {
      const url = match[0].trim();
      if (isValidLink(url)) {
        links.push(url);
      }
    }
  }

  // Deduplicate while preserving order
  const uniqueLinks: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const decodedLink = decodeHtmlEntities(link);
    if (!seen.has(decodedLink)) {
      seen.add(decodedLink);
      uniqueLinks.push(decodedLink);
    }
  }

  return uniqueLinks;
}

export function extractVerificationLink(email: Email, opts: ExtractLinkOptions = {}): string | null {
  const links = extractLinks(email);
  if (links.length === 0) return null;

  const keywords = opts.keywords ?? ['verify', 'confirm', 'activate', 'reset', 'magic', 'login'];
  const domainAllowlist = opts.domainAllowlist ?? null;

  let candidateLinks = links;
  if (domainAllowlist && domainAllowlist.length > 0) {
    candidateLinks = links.filter(link => {
      try {
        const urlObj = new URL(link);
        return domainAllowlist.some(domain =>
          urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
        );
      } catch {
        return false;
      }
    });
  }

  if (candidateLinks.length === 0) return null;

  let bestLink: string | null = null;
  let highestScore = -1;

  for (const link of candidateLinks) {
    let score = 0;
    const lowerLink = link.toLowerCase();
    for (const kw of keywords) {
      if (lowerLink.includes(kw.toLowerCase())) {
        score++;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestLink = link;
    }
  }

  if (highestScore > 0) {
    return bestLink;
  }
  return candidateLinks[0] || null;
}

export function extractLinkByText(email: Email, linkText: string): string {
  const normalizedSearch = linkText.trim().toLowerCase();
  if (!normalizedSearch) return '';

  // 1. Search in HTML body first
  if (email.bodyHtml) {
    const anchorRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRegex.exec(email.bodyHtml)) !== null) {
      const url = match[1].trim();
      const innerHtml = match[2];
      const visibleText = stripHtml(innerHtml).toLowerCase();
      if (visibleText.includes(normalizedSearch)) {
        return decodeHtmlEntities(url);
      }
    }
  }

  // 2. Search in plain text body line-by-line
  if (email.bodyText) {
    const lines = email.bodyText.split(/\r?\n/);
    const urlRegex = /https?:\/\/[^\s"'<>\(\)]+/gi;
    for (const line of lines) {
      if (line.toLowerCase().includes(normalizedSearch)) {
        const urlMatch = line.match(urlRegex);
        if (urlMatch && urlMatch[0]) {
          return urlMatch[0].trim();
        }
      }
    }
  }

  return '';
}

export function hasText(email: Email, searchText: string): boolean {
  const normalizedSearch = searchText.toLowerCase();
  if (!normalizedSearch) return false;

  // Check subject
  if (email.subject && email.subject.toLowerCase().includes(normalizedSearch)) {
    return true;
  }

  // Check bodyText
  if (email.bodyText && email.bodyText.toLowerCase().includes(normalizedSearch)) {
    return true;
  }

  // Check bodyHtml (stripped of tags for clean visible text search)
  if (email.bodyHtml) {
    const cleanHtml = stripHtml(email.bodyHtml).toLowerCase();
    if (cleanHtml.includes(normalizedSearch)) {
      return true;
    }
  }

  return false;
}
