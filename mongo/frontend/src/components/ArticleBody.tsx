import ReactMarkdown from "react-markdown";
import rehypeUnwrapImages from "rehype-unwrap-images";
import type { Components } from "react-markdown";

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="font-display mt-10 text-2xl font-medium tracking-tight text-[var(--ink)] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-display mt-8 text-xl font-medium tracking-tight text-[var(--ink)]">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-4 text-base leading-relaxed text-[var(--body)]">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--ink)]">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-[var(--body)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-[var(--body)]">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-10 border-[var(--border)]" />,
  em: ({ children }) => <em className="italic text-[var(--muted)]">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-8 border-l-[3px] border-[var(--border)] bg-[var(--surface)]/80 py-3 pl-5 pr-4 text-[var(--body)] dark:bg-[var(--card)]/60 [&>p]:mt-0">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => {
    const external = href?.startsWith("http");
    return (
      <a
        href={href}
        className="font-medium text-[var(--ink)] underline decoration-[var(--border)] underline-offset-[3px] decoration-1 hover:decoration-[var(--muted)]"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt, title }) => {
    if (!src || typeof src !== "string") return null;
    return (
      <figure className="my-10 w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- URLs dinámicas del Markdown (Cloudinary u otros) */}
        <img
          src={src}
          alt={alt ?? ""}
          title={title ?? undefined}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[min(78vh,920px)] w-full max-w-full rounded-xl border border-[var(--border)] bg-[var(--tag-bg)] object-contain shadow-sm"
        />
        {title ? (
          <figcaption className="mt-3 text-center text-sm text-[var(--muted)]">{title}</figcaption>
        ) : null}
      </figure>
    );
  },
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded bg-[var(--tag-bg)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--ink)]"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-sm text-[var(--ink)]">
      {children}
    </pre>
  ),
};

export function ArticleBody({ content }: { content: string }) {
  return (
    <div className="article-md">
      <ReactMarkdown rehypePlugins={[rehypeUnwrapImages]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
