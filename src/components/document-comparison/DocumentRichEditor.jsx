import React, { useEffect, useMemo } from 'react';
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
  Italic,
  Link2,
  List,
  ListOrdered,
  Minimize,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isTipTapDocJson, normalizeEditorContent } from './editorContent';

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

export default function DocumentRichEditor({
  label,
  content,
  placeholder,
  onChange,
  onToggleFullscreen,
  isFullscreen = false,
  minHeightClassName = 'min-h-[560px]',
}) {
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
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: `pm-tiptap-editor ${minHeightClassName}`,
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange?.({
        html: instance.getHTML(),
        text: instance.getText({ blockSeparator: '\n\n' }).trim(),
        json: instance.getJSON(),
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

    const trimmed = String(url || '').trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-slate-700">{label}</div>
          <Button type="button" variant="outline" size="sm" onClick={onToggleFullscreen}>
            {isFullscreen ? <Minimize className="w-4 h-4 mr-2" /> : <Expand className="w-4 h-4 mr-2" />}
            {isFullscreen ? 'Exit Full Screen' : 'Expand'}
          </Button>
        </div>

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

          <div className="h-6 w-px bg-slate-200" />

          <ToolbarButton title="Insert Link" onClick={setLink} active={editor.isActive('link')}>
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton title="Remove Link" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Unlink className="w-4 h-4" />
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

          <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()}>
            <Undo2 className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()}>
            <Redo2 className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="bg-white">
        <EditorContent editor={editor} />
      </div>

      {placeholder ? (
        <div className="sr-only" aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}
