import type { ToolDefinition, ToolContext } from '@/shared/tool-registry';
import type { ToolCall, ToolResult } from '@/shared/types';

/**
 * Web search and fetch tools.
 * These have scope: 'network' and don't interact with the page DOM.
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * SSRF protection: block private IPs and special addresses
 */
function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    
    const hostname = parsed.hostname.toLowerCase();
    
    // Block localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
    
    // Block private IP ranges
    if (hostname.startsWith('10.')) return false;
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return false;
    }
    if (hostname.startsWith('192.168.')) return false;
    
    // Block link-local
    if (hostname.startsWith('169.254.')) return false;
    
    // Block metadata endpoints
    if (hostname === '169.254.169.254') return false;
    
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  
  return text.replace(/&[a-z]+;|&#\d+;/gi, (match) => entities[match] ?? match);
}

/**
 * Search DuckDuckGo HTML and parse results
 */
async function searchDuckDuckGo(query: string, maxResults = 5): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    
    const html = await response.text();
    const results: SearchResult[] = [];
    
    // Parse DuckDuckGo HTML structure
    const resultRegex = /<div class="result[^"]*">[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    
    let match;
    while ((match = resultRegex.exec(html)) && results.length < maxResults) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();
      
      if (url && title) {
        results.push({
          title: decodeHtmlEntities(title),
          url: url,
          snippet: decodeHtmlEntities(snippet),
        });
      }
    }
    
    return results;
  } catch (err) {
    throw new Error(`DuckDuckGo search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Fetch URL and convert to readable text
 */
async function fetchUrl(url: string): Promise<string> {
  if (!isUrlSafe(url)) {
    throw new Error('URL blocked by SSRF protection');
  }
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    if (!contentType.includes('text/html')) {
      const text = await response.text();
      return text.slice(0, 20000);
    }
    
    const html = await response.text();
    
    // Simple HTML-to-text
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    text = decodeHtmlEntities(text);
    
    if (text.length > 20000) {
      text = text.slice(0, 20000) + '\n... [content truncated]';
    }
    
    return text;
  } catch (err) {
    throw new Error(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool definitions will be added next
const webSearchTool: ToolDefinition = {
  name: 'web_search',
  schema: {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns title, URL, and snippet for each result.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 10).',
        },
      },
      required: ['query'],
    },
  },
  risk: 'safe',
  scope: 'network',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call: ToolCall, _ctx: ToolContext): Promise<ToolResult> {
    const query = String(call.args.query ?? '');
    const maxResults = Math.min(Number(call.args.max_results ?? 5), 10);
    
    if (!query.trim()) {
      return {
        id: call.id,
        name: 'web_search',
        ok: false,
        content: 'Search query cannot be empty.',
      };
    }
    
    try {
      const results = await searchDuckDuckGo(query, maxResults);
      
      if (results.length === 0) {
        return {
          id: call.id,
          name: 'web_search',
          ok: true,
          content: `No results found for: ${query}`,
        };
      }
      
      const formatted = results
        .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
        .join('\n\n');
      
      return {
        id: call.id,
        name: 'web_search',
        ok: true,
        content: `Search results for "${query}":\n\n${formatted}`,
      };
    } catch (err) {
      return {
        id: call.id,
        name: 'web_search',
        ok: false,
        content: `Search error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  schema: {
    name: 'fetch_url',
    description: 'Fetch content from a URL and convert HTML to readable text. Protected against SSRF.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch (must be http or https).',
        },
      },
      required: ['url'],
    },
  },
  risk: 'safe',
  scope: 'network',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call: ToolCall, _ctx: ToolContext): Promise<ToolResult> {
    const url = String(call.args.url ?? '');
    
    if (!url.trim()) {
      return {
        id: call.id,
        name: 'fetch_url',
        ok: false,
        content: 'URL cannot be empty.',
      };
    }
    
    try {
      const content = await fetchUrl(url);
      
      return {
        id: call.id,
        name: 'fetch_url',
        ok: true,
        content: `Content from ${url}:\n\n${content}`,
      };
    } catch (err) {
      return {
        id: call.id,
        name: 'fetch_url',
        ok: false,
        content: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const webTools: ToolDefinition[] = [webSearchTool, fetchUrlTool];
