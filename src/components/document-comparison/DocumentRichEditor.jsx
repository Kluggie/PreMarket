import React, { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import CharacterCount from '@tiptap/extension-character-count';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Expand,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minimize,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isTipTapDocJson, normalizeEditorContent } from './editorContent';
import { sanitizePastedHtml, sanitizePastedText } from './editorSanitization';

const TEXT_COLORS = [
  '#0f172a',
  '#334155',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
];

const HIGHLIGHT_COLORS = ['#fef08a', '#fecaca', '#bbf7d0', '#bfdbfe', '#ddd6fe'];

const SAFE_LINK_SCHEME_PATTERN = /^(https?:|mailto:|\/|#)/i;
const SAFE_IMAGE_SCHEME_PATTERN = /^(https?:|blob:)/i;

function normalizeHtml(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function ToolbarButton({ onClick, active = false, disabled = false, title, children }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={active ? 'bg-blue-50 border-blue-300 text-blue-700' : ''}
    >
      {children}
    </Button>
  );
}

function sanitizeUrl(url, mode = 'link') {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return '';
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    return '';
  }

  if (mode === 'image') {
    return SAFE_IMAGE_SCHEME_PATTERN.test(trimmed) ? trimmed : '';
  }

  return SAFE_LINK_SCHEME_PATTERN.test(trimmed) ? trimmed : '';
}

function mapTextIndexToPos(textNodes, targetIndex) {
  const index = Math.max(0, Number(targetIndex || 0));
  for (const node of textNodes) {
    if (index <= node.end) {
      const offset = Math.max(0, Math.min(node.text.length, index - node.start));
      return node.pos + offset;
    }
  }
  const lastNode = textNodes[textNodes.length - 1];
  return lastNode ? lastNode.pos + lastNode.text.length : 1;
}

function findTextSelectionRange(doc, searchText) {
  const needle = String(searchText || '').trim();
  if (!doc || !needle) {
    return null;
  }

  const textNodes = [];
  let fullText = '';

  doc.descendants((node, pos) => {
    if (!node?.isText || !node.text) {
      return;
    }
    const text = String(node.text || '');
    const start = fullText.length;
    const end = start + text.length;
    textNodes.push({ pos, text, start, end });
    fullText += text;
  });

  if (!fullText || !textNodes.length) {
    return null;
  }

  const lowerFullText = fullText.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const startIndex = lowerFullText.lastIndexOf(lowerNeedle);
  if (startIndex < 0) {
    return null;
  }

  const endIndex = startIndex + needle.length;
  const from = mapTextIndexToPos(textNodes, startIndex);
  const to = mapTextIndexToPos(textNodes, endIndex);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }

  return { from, to };
}

export default function DocumentRichEditor({
  label,
  content,
  placeholder,
  onChange,
  onSelectionTextChange,
  onSelectionChange,
  replaceSelectionRequest = null,
  onReplaceSelectionApplied,
  onToggleFullscreen,
  isFullscreen = false,
  minHeightClassName = 'min-h-[560px]',
  scrollContainerClassName = 'h-[560px]',
  maxCharacters = null,
  shouldFocus = false,
  focusRequestId = 0,
  jumpToTextRequest = null,
  'data-testid': testId = null,
  editorRef = null,
  /** When true the editor is non-editable (toolbar hidden, typing blocked). */
  readOnly = false,
}) {
  const onSelectionTextChangeRef = useRef(onSelectionTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const initialContent = useMemo(() => normalizeEditorContent(content), [content]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Subscript,
      Superscript,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      CharacterCount,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Image,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: `pm-tiptap-editor ${minHeightClassName}`,
      },
      transformPastedHTML(html) {
        return sanitizePastedHtml(html);
      },
      transformPastedText(text) {
        return sanitizePastedText(text);
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange?.({
        html: instance.getHTML(),
        text: instance.getText({ blockSeparator: '\n\n' }).trim(),
        json: instance.getJSON(),
        characters: instance.storage.characterCount.characters(),
        words: instance.storage.characterCount.words(),
      });
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (isTipTapDocJson(content)) {
      const currentJson = editor.getJSON();
      if (JSON.stringify(currentJson) === JSON.stringify(content)) {
        return;
      }
      try {
        editor.commands.setContent(content, false);
      } catch (error) {
        console.error('Failed to initialize document editor JSON content.', error);
        editor.commands.clearContent();
      }
      return;
    }

    const nextHtml = typeof content === 'string' ? content : '<p></p>';
    if (normalizeHtml(editor.getHTML()) === normalizeHtml(nextHtml)) {
      return;
    }

    try {
      editor.commands.setContent(nextHtml || '<p></p>', false);
    } catch (error) {
      console.error('Failed to initialize document editor HTML content.', error);
      editor.commands.clearContent();
    }
  }, [content, editor]);

  // Expose editor instance via ref for direct content capture
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  // Sync TipTap editable flag with the readOnly prop
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    onSelectionTextChangeRef.current = onSelectionTextChange;
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange, onSelectionTextChange]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const emitSelectionText = () => {
      const selectionTextCallback = onSelectionTextChangeRef.current;
      const selectionChangeCallback = onSelectionChangeRef.current;
      if (
        typeof selectionTextCallback !== 'function' &&
        typeof selectionChangeCallback !== 'function'
      ) {
        return;
      }

      const { from, to } = editor.state.selection;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        if (typeof selectionTextCallback === 'function') {
          selectionTextCallback('');
        }
        if (typeof selectionChangeCallback === 'function') {
          selectionChangeCallback({
            text: '',
            range: null,
          });
        }
        return;
      }
      const selected = editor.state.doc.textBetween(from, to, ' ').trim();
      if (typeof selectionTextCallback === 'function') {
        selectionTextCallback(selected);
      }
      if (typeof selectionChangeCallback === 'function') {
        selectionChangeCallback({
          text: selected,
          range: { from, to },
        });
      }
    };

    emitSelectionText();
    editor.on('selectionUpdate', emitSelectionText);
    return () => {
      editor.off('selectionUpdate', emitSelectionText);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !replaceSelectionRequest?.id) {
      return;
    }

    const requestId = Number(replaceSelectionRequest.id || 0);
    const rawText = String(replaceSelectionRequest.text || '');
    const rawFrom = Number(replaceSelectionRequest.from || 0);
    const rawTo = Number(replaceSelectionRequest.to || 0);
    if (!requestId || !rawText.trim() || !Number.isFinite(rawFrom) || !Number.isFinite(rawTo) || rawTo <= rawFrom) {
      onReplaceSelectionApplied?.({
        id: requestId || 0,
        success: false,
        error: 'invalid_selection_range',
      });
      return;
    }

    try {
      const currentDocSize = editor.state.doc.content.size;
      const from = Math.max(1, Math.min(rawFrom, currentDocSize));
      const to = Math.max(from, Math.min(rawTo, currentDocSize));
      const replacementText = String(rawText || '').replace(/\r/g, '');
      if (to <= from) {
        onReplaceSelectionApplied?.({
          id: requestId,
          success: false,
          error: 'selection_out_of_bounds',
        });
        return;
      }

      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .insertContent({
          type: 'text',
          text: replacementText,
        })
        .scrollIntoView()
        .run();
      const updatedDocSize = editor.state.doc.content.size;
      const highlightTo = Math.max(from, Math.min(updatedDocSize, from + replacementText.length));
      editor.chain().focus().setTextSelection({ from, to: highlightTo }).run();
      window.setTimeout(() => {
        editor.chain().focus(highlightTo).run();
      }, 2200);

      onReplaceSelectionApplied?.({
        id: requestId,
        success: true,
        range: { from, to: highlightTo },
        text: replacementText,
      });
    } catch (error) {
      console.error('Failed to apply selection replacement in document editor.', error);
      onReplaceSelectionApplied?.({
        id: requestId,
        success: false,
        error: 'replace_selection_failed',
      });
    }
  }, [editor, onReplaceSelectionApplied, replaceSelectionRequest?.from, replaceSelectionRequest?.id, replaceSelectionRequest?.text, replaceSelectionRequest?.to]);

  useEffect(() => {
    if (!editor || !shouldFocus || !focusRequestId) {
      return;
    }
    requestAnimationFrame(() => {
      editor.commands.focus('end');
    });
  }, [editor, shouldFocus, focusRequestId]);

  useEffect(() => {
    if (!editor || !jumpToTextRequest?.id) {
      return;
    }

    let cancelled = false;
    let retryTimer = null;
    let clearSelectionTimer = null;
    const jumpText = String(jumpToTextRequest.text || '').trim();

    const tryFocus = (attempt = 0) => {
      if (cancelled) {
        return;
      }

      if (!jumpText) {
        editor.chain().focus('end').scrollIntoView().run();
        return;
      }

      const range = findTextSelectionRange(editor.state.doc, jumpText);
      if (!range) {
        if (attempt < 4) {
          retryTimer = window.setTimeout(() => tryFocus(attempt + 1), 90);
          return;
        }
        editor.chain().focus('end').scrollIntoView().run();
        return;
      }

      editor.chain().focus().setTextSelection(range).scrollIntoView().run();
      clearSelectionTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        editor.chain().focus(range.to).run();
      }, 2600);
    };

    requestAnimationFrame(() => tryFocus(0));

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (clearSelectionTimer) {
        clearTimeout(clearSelectionTimer);
      }
    };
  }, [editor, jumpToTextRequest?.id, jumpToTextRequest?.text]);

  if (!editor) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Initializing editor...
      </div>
    );
  }

  const headingValue = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph';

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href || '';
    const url = window.prompt('Enter URL', previousUrl || 'https://');

    if (url === null) {
      return;
    }

    const safeUrl = sanitizeUrl(url, 'link');
    if (!safeUrl) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run();
  };

  const insertImageFromUrl = () => {
    const url = window.prompt('Image URL', 'https://');
    if (url === null) {
      return;
    }

    const safeUrl = sanitizeUrl(url, 'image');
    if (!safeUrl) {
      window.alert('Use an http(s) or blob image URL.');
      return;
    }

    editor.chain().focus().setImage({ src: safeUrl, alt: 'Inserted image' }).run();
  };

  const insertAttachmentLink = () => {
    const url = window.prompt('Attachment URL', 'https://');
    if (url === null) {
      return;
    }

    const safeUrl = sanitizeUrl(url, 'link');
    if (!safeUrl) {
      window.alert('Use an http(s) or mailto link.');
      return;
    }

    const label = String(window.prompt('Attachment label', 'Attachment') || '').trim() || 'Attachment';
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: label,
            marks: [{ type: 'link', attrs: { href: safeUrl } }],
          },
        ],
      })
      .run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-slate-700">{label}</div>
            {readOnly && (
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                Read only
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {maxCharacters ? (
              <span className="text-xs text-slate-500">
                {editor.storage.characterCount.characters().toLocaleString()} / {maxCharacters.toLocaleString()} chars
              </span>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onToggleFullscreen}>
              {isFullscreen ? <Minimize className="w-4 h-4 mr-2" /> : <Expand className="w-4 h-4 mr-2" />}
              {isFullscreen ? 'Exit Full Screen' : 'Expand'}
            </Button>
          </div>
        </div>

        {!readOnly && (
        <div className="flex flex-wrap gap-2 items-center">
          <ToolbarButton
            title="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
          >
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
          >
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')}
          >
            <UnderlineIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Strike"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive('strike')}
          >
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <select
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={headingValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'paragraph') {
                editor.chain().focus().setParagraph().run();
                return;
              }
              const level = Number(value.replace('h', ''));
              editor.chain().focus().toggleHeading({ level }).run();
            }}
          >
            <option value="paragraph">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>

          <ToolbarButton
            title="H1"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
          >
            <Heading1 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="H2"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
          >
            <Heading2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="H3"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
          >
            <Heading3 className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton
            title="Bullet List"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
          >
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Numbered List"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Checklist"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive('taskList')}
          >
            <ListChecks className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton
            title="Blockquote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Callout"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
          >
            Callout
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton title="Insert Link" onClick={setLink} active={editor.isActive('link')}>
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton title="Remove Link" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Unlink className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton title="Insert Image URL" onClick={insertImageFromUrl}>
            <ImagePlus className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton title="Insert Attachment Link" onClick={insertAttachmentLink}>
            <Paperclip className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton
            title="Subscript"
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            active={editor.isActive('subscript')}
          >
            <SubscriptIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Superscript"
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            active={editor.isActive('superscript')}
          >
            <SuperscriptIcon className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton
            title="Align Left"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            active={editor.isActive({ textAlign: 'left' })}
          >
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Align Center"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            active={editor.isActive({ textAlign: 'center' })}
          >
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Align Right"
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            active={editor.isActive({ textAlign: 'right' })}
          >
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Justify"
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            active={editor.isActive({ textAlign: 'justify' })}
          >
            <AlignJustify className="w-4 h-4" />
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton title="Insert Table" onClick={insertTable}>
            <Table2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Add Row"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            disabled={!editor.isActive('table')}
          >
            +Row
          </ToolbarButton>
          <ToolbarButton
            title="Add Column"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            disabled={!editor.isActive('table')}
          >
            +Col
          </ToolbarButton>
          <ToolbarButton
            title="Delete Row"
            onClick={() => editor.chain().focus().deleteRow().run()}
            disabled={!editor.isActive('table')}
          >
            -Row
          </ToolbarButton>
          <ToolbarButton
            title="Delete Column"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            disabled={!editor.isActive('table')}
          >
            -Col
          </ToolbarButton>
          <ToolbarButton
            title="Delete Table"
            onClick={() => editor.chain().focus().deleteTable().run()}
            disabled={!editor.isActive('table')}
          >
            DelTbl
          </ToolbarButton>

          <div className="h-6 w-px bg-slate-200" />

          <div className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1">
            <Type className="w-4 h-4 text-slate-500" />
            {TEXT_COLORS.map((color) => (
              <button
                key={`text-color-${color}`}
                type="button"
                className="h-4 w-4 rounded-sm border border-slate-200"
                style={{ backgroundColor: color }}
                onClick={() => editor.chain().focus().setColor(color).run()}
                title={`Text color ${color}`}
              />
            ))}
            <button
              type="button"
              className="text-[11px] text-slate-600 hover:text-slate-900"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              clear
            </button>
          </div>

          <div className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1">
            <Highlighter className="w-4 h-4 text-slate-500" />
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={`highlight-${color}`}
                type="button"
                className="h-4 w-4 rounded-sm border border-slate-200"
                style={{ backgroundColor: color }}
                onClick={() => editor.chain().focus().setHighlight({ color }).run()}
                title={`Highlight ${color}`}
              />
            ))}
            <button
              type="button"
              className="text-[11px] text-slate-600 hover:text-slate-900"
              onClick={() => editor.chain().focus().unsetHighlight().run()}
            >
              clear
            </button>
          </div>

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton
            title="Undo"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
          >
            <Undo2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Redo"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
          >
            <Redo2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
        )}
      </div>

      <div className={`bg-white overflow-y-auto ${scrollContainerClassName}`} data-testid="doc-rich-editor-scroll">
        <EditorContent editor={editor} data-testid={testId || 'doc-rich-editor'} />
      </div>

      {placeholder ? (
        <div className="sr-only" aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}
