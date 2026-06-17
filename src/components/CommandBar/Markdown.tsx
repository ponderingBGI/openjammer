/**
 * Markdown — the assistant's prose renderer for the Ctrl/Cmd+K chat.
 *
 * Most queries are questions, so the answer has to read beautifully: GitHub-
 * flavored markdown (headings, lists, tables, fenced code, links) with clean
 * wrapping at a readable measure. Raw HTML is OFF (react-markdown's safe default)
 * — the agent is an untrusted generator, so its text is data, never markup.
 * Styling lives in CommandBar.css (`.command-bar-md *`): Caveat headings, Inter
 * body, JetBrains Mono code — the Living Sketchbook applied to a chat.
 */

import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

const COMPONENTS: Components = { a: MarkdownLink };

export function Markdown({ children }: { children: string }) {
    return (
        <div className="command-bar-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {children}
            </ReactMarkdown>
        </div>
    );
}
