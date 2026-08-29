/**
 * Markdown — the assistant's prose renderer for the Ctrl/Cmd+K chat.
 *
 * Most queries are questions, so the answer has to read beautifully: GitHub-
 * flavored markdown (headings, lists, tables, fenced code, links) with clean
 * wrapping at a readable measure. Raw HTML is OFF (react-markdown's safe default)
 * — the agent is an untrusted generator, so its text is data, never markup.
 *
 * Fenced blocks — the tool/verb payloads the agent quotes back — render through
 * oj-ui's `CodeBlock`, so an exact payload is always the mono, hairline-bounded
 * block it is everywhere else in the app (Mono-Means-Exact). The rest is styled
 * in CommandBar.css (`.command-bar-md *`): Outfit prose, JetBrains Mono code.
 */

import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@openjammer/oj-ui';
import { openExternal } from '../../ai/tauri';

/** Links leave the webview via the system browser instead of navigating it. */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
    return (
        <a
            href={href}
            onClick={(e) => {
                e.preventDefault();
                if (href) void openExternal(href);
            }}
        >
            {children}
        </a>
    );
}

/** A fenced block is an exact payload — oj-ui's read-only mono block. */
function MarkdownPre({ children }: { children?: ReactNode }) {
    return <CodeBlock>{children}</CodeBlock>;
}

const COMPONENTS: Components = { a: MarkdownLink, pre: MarkdownPre };

export function Markdown({ children }: { children: string }) {
    return (
        <div className="command-bar-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {children}
            </ReactMarkdown>
        </div>
    );
}
