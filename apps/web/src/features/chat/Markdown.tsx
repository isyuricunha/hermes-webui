import { isValidElement, memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { copyText } from '../../lib/clipboard';
import { Check, Copy } from 'lucide-react';
import { MEDIA_URL_SCHEME, rewriteMediaTags } from '@hermes-webui/shared';
import { MediaEmbed } from './MediaEmbed';

/** Reads `language-xyz` off the <code> child that remark/rehype produce. */
function languageOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(child)) return null;
  const className = (child.props as { className?: unknown }).className;
  if (typeof className !== 'string') return null;
  const match = /language-([\w+#.-]+)/.exec(className);
  return match?.[1] ?? null;
}

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);
  const copy = () => {
    const text = ref.current?.innerText ?? '';
    void copyText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="yu-codeblock">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle pr-1.5 pl-3.5">
        <span className="font-mono text-[11px] text-text-tertiary">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="yu-btn yu-btn-ghost h-7 gap-1.5 rounded-lg px-2 text-[11px]"
        >
          {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function decodeMediaPath(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="yu-table-wrap">
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt }) => {
    if (typeof src !== 'string' || src === '') return null;
    if (src.startsWith(MEDIA_URL_SCHEME)) {
      const path = decodeMediaPath(src.slice(MEDIA_URL_SCHEME.length));
      return path === null ? null : <MediaEmbed path={path} />;
    }
    return (
      <a href={src} target="_blank" rel="noreferrer noopener">
        <img src={src} alt={alt ?? ''} loading="lazy" className="max-h-96 rounded-xl border border-border-subtle" />
      </a>
    );
  },
};

const REHYPE = [[rehypeHighlight, { detect: true, ignoreMissing: true }]] as const;

/**
 * Keeps our `hermes-media:` embeds and inline raster images (the gateway's
 * chat endpoints inline MEDIA images as data URLs); everything else goes
 * through react-markdown's safe default.
 */
function urlTransform(url: string, key: string): string {
  if (url.startsWith(MEDIA_URL_SCHEME)) return url;
  if (key === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return url;
  return defaultUrlTransform(url);
}

/** Assistant markdown: GFM, highlighted code with a language header + copy. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="yu-prose min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={REHYPE as unknown as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']}
        components={COMPONENTS}
        urlTransform={urlTransform}
      >
        {rewriteMediaTags(text)}
      </ReactMarkdown>
    </div>
  );
});
