import { useCallback, useEffect, useState } from 'react';

interface Props {
    /** The editable element, so command state can be read from the selection. */
    editorRef: React.RefObject<HTMLDivElement | null>;
}

const ALIGNS = ['left', 'center', 'right'] as const;

const INLINE = [
    { cmd: 'bold', label: 'B', title: 'Bold', style: { fontWeight: 700 } },
    { cmd: 'italic', label: 'I', title: 'Italic', style: { fontStyle: 'italic' } },
    { cmd: 'underline', label: 'U', title: 'Underline', style: { textDecoration: 'underline' } },
    { cmd: 'strikeThrough', label: 'S', title: 'Strikethrough', style: { textDecoration: 'line-through' } },
] as const;

const LISTS = [
    { cmd: 'insertOrderedList', label: '1.', title: 'Ordered list' },
    { cmd: 'insertUnorderedList', label: '•', title: 'Bullet list' },
] as const;

/**
 * The extension's formatting controls, on top of `contenteditable`.
 *
 * `document.execCommand` is deprecated and still the only way to get native
 * rich-text editing without shipping an editor framework into a widget that has
 * to stay one small self-contained file. What it produces is messy — `<b>`, stray
 * `<div>`s, inline styles — which is why every save goes through
 * `sanitizeCanonical` before it reaches the server.
 */
export function EditorToolbar({ editorRef }: Props) {
    const [active, setActive] = useState<Record<string, boolean>>({});
    const [alignIndex, setAlignIndex] = useState(0);

    const refresh = useCallback(() => {
        const state: Record<string, boolean> = {};

        for (const { cmd } of [...INLINE, ...LISTS]) {
            try {
                state[cmd] = document.queryCommandState(cmd);
            } catch {
                state[cmd] = false;
            }
        }

        state['blockquote'] = closestTag(editorRef.current, 'blockquote') !== null;
        setActive(state);
    }, [editorRef]);

    useEffect(() => {
        document.addEventListener('selectionchange', refresh);
        return () => document.removeEventListener('selectionchange', refresh);
    }, [refresh]);

    const run = (command: string, value?: string): void => {
        editorRef.current?.focus();
        document.execCommand(command, false, value);
        refresh();
    };

    const align = ALIGNS[alignIndex] ?? 'left';

    return (
        <div className="toolbar" role="toolbar" aria-label="Formatting">
            {INLINE.map(({ cmd, label, title, style }) => (
                <button
                    key={cmd}
                    type="button"
                    className={`tb${active[cmd] === true ? ' on' : ''}`}
                    title={title}
                    style={style}
                    // Keeping the selection is the whole game: a button that takes
                    // focus applies its command to nothing.
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => run(cmd)}
                >
                    {label}
                </button>
            ))}

            <span className="tb-sep" />

            {LISTS.map(({ cmd, label, title }) => (
                <button
                    key={cmd}
                    type="button"
                    className={`tb${active[cmd] === true ? ' on' : ''}`}
                    title={title}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => run(cmd)}
                >
                    {label}
                </button>
            ))}

            <button
                type="button"
                className={`tb${active['blockquote'] === true ? ' on' : ''}`}
                title="Blockquote"
                onMouseDown={event => event.preventDefault()}
                onClick={() => run('formatBlock', active['blockquote'] === true ? 'p' : 'blockquote')}
            >
                ❝
            </button>

            <span className="tb-sep" />

            <button
                type="button"
                className="tb"
                title={`Align (currently ${align})`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                    const next = (alignIndex + 1) % ALIGNS.length;
                    setAlignIndex(next);
                    run({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' }[ALIGNS[next]!]);
                }}
            >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                    <line x1="2" y1="5" x2="18" y2="5" />
                    <line
                        x1={align === 'center' ? 5 : align === 'right' ? 8 : 2}
                        y1="10"
                        x2={align === 'center' ? 15 : align === 'right' ? 18 : 12}
                        y2="10"
                    />
                    <line x1="2" y1="15" x2="18" y2="15" />
                </svg>
            </button>

            <button
                type="button"
                className="tb"
                title="Decrease indent"
                onMouseDown={event => event.preventDefault()}
                onClick={() => run('outdent')}
            >
                ⇤
            </button>
            <button
                type="button"
                className="tb"
                title="Increase indent"
                onMouseDown={event => event.preventDefault()}
                onClick={() => run('indent')}
            >
                ⇥
            </button>
        </div>
    );
}

/** Walks up from the caret to see whether it sits inside `tag`. */
function closestTag(editor: HTMLElement | null, tag: string): Element | null {
    const selection = window.getSelection();

    if (editor === null || selection === null || selection.rangeCount === 0) {
        return null;
    }

    let node: Node | null = selection.getRangeAt(0).startContainer;

    while (node !== null && node !== editor) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === tag) {
            return node as Element;
        }
        node = node.parentNode;
    }

    return null;
}
