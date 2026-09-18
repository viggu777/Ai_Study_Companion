"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/**
 * Rich renderer for tutor answers:
 * - GFM tables, task lists, strikethrough (remark-gfm)
 * - LaTeX math: $inline$ and $$display$$ (remark-math + KaTeX)
 * - Fenced code blocks + inline code
 * - Bullet / numbered points, headings, quotes
 *
 * The tutor `answer` field is Markdown (see ai/tutor.ts prompt), so this
 * replaces the old plain <p class="whitespace-pre-wrap"> rendering.
 */
function TutorMarkdownInner({ content }: { content: string }) {
  return (
    <div className="tutor-markdown text-[15px] leading-relaxed text-stone-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Headings — compact, tutor-like hierarchy
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-lg font-semibold tracking-tight text-stone-900 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-4 text-base font-semibold tracking-tight text-stone-900 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 text-[15px] font-semibold text-stone-900 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-3 text-sm font-semibold text-stone-900 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          // Points — real bullets / numbers with spacing
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-stone-400">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-stone-500">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Tables — GFM, scrollable on small screens, zebra + sticky header look
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-stone-100">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-stone-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-600">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-stone-100 px-3 py-2 align-top text-stone-800 last:border-b-0">
              {children}
            </td>
          ),
          tr: ({ children }) => <tr className="even:bg-stone-50/60">{children}</tr>,
          // Code — inline pill vs fenced block
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-xl border border-stone-800 bg-stone-900 p-4 text-[13px] leading-relaxed text-stone-100">
              {children}
            </pre>
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: (props: any) => {
            const { className, children, ...rest } = props;
            const text = String(children ?? "");
            // react-markdown v9+ dropped the `inline` prop: detect blocks by
            // language tag or multi-line content instead.
            const isBlock = /language-/.test(String(className ?? "")) || text.includes("\n");
            if (!isBlock) {
              return (
                <code
                  className="rounded-md border border-stone-200 bg-stone-100 px-1.5 py-0.5 font-mono text-[13px] text-stone-800"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={`font-mono text-[13px] text-stone-100 ${className ?? ""}`} {...rest}>
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-sky-600/40 bg-sky-50/50 rounded-r-lg px-3 py-2 text-stone-700">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-stone-200" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-stone-900">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const TutorMarkdown = memo(TutorMarkdownInner);
export default TutorMarkdown;
