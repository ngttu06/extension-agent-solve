import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, dependency-free markdown renderer for AI output. Renders as React
 * nodes (never dangerouslySetInnerHTML) so untrusted model text can't inject
 * HTML. Supports headings, bold/italic/code, links, and bullet/ordered lists.
 */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block ```
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph: gather until blank line or next block starter
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'p', text: buf.join(' ') });
  }

  return blocks;
}

// Inline: `code`, **bold**, *italic*/_italic_, [text](url). Applied in order.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== '');
  return parts.map((part, k) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={k} className="rounded bg-elevated px-1 py-0.5 text-[10.5px] text-content">
          {part.slice(1, -1)}
        </code>
      );
    }
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return (
        <strong key={k} className="font-semibold text-content">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={k}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      const safe = /^https?:\/\//i.test(href);
      return safe ? (
        <a
          key={k}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          {link[1]}
        </a>
      ) : (
        <Fragment key={k}>{link[1]}</Fragment>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

const HEADING_SIZE: Record<number, string> = {
  1: 'text-sm font-semibold',
  2: 'text-[13px] font-semibold',
  3: 'text-xs font-semibold',
};

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-1.5 text-[11px] leading-relaxed text-content">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <div key={i} className={`${HEADING_SIZE[b.level] ?? HEADING_SIZE[3]} text-content`}>
                {renderInline(b.text)}
              </div>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-elevated px-2.5 py-2 text-[10.5px] text-muted"
              >
                {b.text}
              </pre>
            );
          case 'ul':
            return (
              <ul key={i} className="ml-4 list-disc space-y-0.5 marker:text-faint">
                {b.items.map((it, k) => (
                  <li key={k}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="ml-4 list-decimal space-y-0.5 marker:text-faint">
                {b.items.map((it, k) => (
                  <li key={k}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap break-words">
                {renderInline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
