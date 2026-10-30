import { useState, useRef, useEffect, useCallback, useId } from 'react';
import {
  Code2,
  FileCode,
  FolderOpen,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ExternalLink,
  Layers,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { CUSTOM_CSS_SNIPPETS, CSS_CHEAT_SHEET } from '../lib/customCss';

interface Props {
  enabled: boolean;
  css: string;
  onEnabledChange: (enabled: boolean) => void;
  onCssChange: (css: string) => void;
  notify?: (msg: string) => void;
}

export function CustomCssEditor({
  enabled,
  css,
  onEnabledChange,
  onCssChange,
  notify,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [diskPath, setDiskPath] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const isDesktop = Boolean(window.desktop?.isDesktop);

  useEffect(() => {
    if (window.desktop?.getCustomCssPath) {
      void window.desktop.getCustomCssPath().then((p) => setDiskPath(p));
    }
  }, []);

  // Synchronize scrolling between textarea and line numbers gutter
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lineCount = Math.max(css.split('\n').length, 14);
  const charCount = css.length;

  // Handle Tab, Shift+Tab, and Enter auto-indent in the code editor
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;

      if (e.shiftKey) {
        // Unindent
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        if (val.slice(lineStart, lineStart + 2) === '  ') {
          const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
          onCssChange(nextVal);
          requestAnimationFrame(() => {
            ta.selectionStart = Math.max(lineStart, start - 2);
            ta.selectionEnd = Math.max(lineStart, end - 2);
          });
        }
      } else {
        // Indent 2 spaces
        const nextVal = val.substring(0, start) + '  ' + val.substring(end);
        onCssChange(nextVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    } else if (e.key === 'Enter') {
      // Auto-indent matching leading whitespace of current line
      const start = ta.selectionStart;
      const val = ta.value;
      const currentLineStart = val.lastIndexOf('\n', start - 1) + 1;
      const currentLine = val.substring(currentLineStart, start);
      const match = currentLine.match(/^(\s+)/);
      if (match) {
        e.preventDefault();
        const indent = match[1];
        const nextVal = val.substring(0, start) + '\n' + indent + val.substring(start);
        onCssChange(nextVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1 + indent.length;
        });
      }
    }
  };

  const copyToClipboard = useCallback(() => {
    if (!css) return;
    void navigator.clipboard.writeText(css).then(() => {
      setCopied(true);
      notify?.('Custom CSS copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  }, [css, notify]);

  const handleOpenFile = async () => {
    if (window.desktop?.openCustomCssFile) {
      const res = await window.desktop.openCustomCssFile();
      if (res.ok) {
        notify?.('Opened custom.css in default text editor');
      } else {
        notify?.(`Could not open file: ${res.error ?? 'Unknown error'}`);
      }
    }
  };

  const handleOpenFolder = async () => {
    if (window.desktop?.openCustomCssFolder) {
      const res = await window.desktop.openCustomCssFolder();
      if (res.ok) {
        notify?.('Opened custom.css folder');
      } else {
        notify?.(`Could not open folder: ${res.error ?? 'Unknown error'}`);
      }
    }
  };

  const handleInsertSnippet = (snippet: typeof CUSTOM_CSS_SNIPPETS[0], mode: 'append' | 'replace') => {
    if (mode === 'replace') {
      if (css.trim().length > 0 && !window.confirm(`Replace current CSS with "${snippet.name}" preset?`)) {
        return;
      }
      onCssChange(snippet.css);
      notify?.(`Loaded preset "${snippet.name}"`);
    } else {
      const separator = css.trim().length > 0 ? '\n\n' : '';
      onCssChange(css + separator + snippet.css);
      notify?.(`Appended "${snippet.name}" snippet`);
    }
    setSnippetsOpen(false);
  };

  const handleClear = () => {
    if (!css.trim()) return;
    if (window.confirm('Are you sure you want to clear all custom CSS?')) {
      onCssChange('');
      notify?.('Cleared custom CSS');
    }
  };

  return (
    <div className="rounded-2xl border border-sc-line bg-sc-panel overflow-hidden shadow-sm transition-all duration-200">
      {/* Top Header Bar */}
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-sc-line/60 bg-sc-panel-2/20">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-sc-orange/10 border border-sc-orange/20 text-sc-orange flex items-center justify-center shrink-0 mt-0.5">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[14px] font-bold text-sc-fg tracking-tight">Custom CSS</span>
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors',
                  enabled && css.trim()
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-sc-fill/5 text-sc-muted border-sc-line'
                )}
              >
                <span
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full',
                    enabled && css.trim() ? 'bg-emerald-400 animate-pulse' : 'bg-sc-dim'
                  )}
                />
                {enabled && css.trim() ? 'Live' : enabled ? 'Active (Empty)' : 'Disabled'}
              </span>
            </div>
            <p className="text-[11.5px] text-sc-muted mt-0.5">
              Customize client styles in real-time like in Vencord. Injected directly into the DOM.
            </p>
          </div>
        </div>

        {/* Master Enable Toggle */}
        <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
          <label className="relative inline-flex items-center cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-sc-line peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sc-orange transition-colors" />
            <span className="ml-2.5 text-[12px] font-semibold text-sc-fg">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="px-4 py-2.5 bg-sc-panel-2/40 border-b border-sc-line/50 flex items-center justify-between gap-2 flex-wrap text-[11.5px]">
        {/* Left Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isDesktop && (
            <>
              <button
                type="button"
                onClick={() => void handleOpenFile()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1 font-medium text-sc-fg hover:border-sc-dim hover:bg-sc-panel-2 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Open custom.css in default system text editor (VS Code, Notepad, etc.)"
              >
                <FileCode className="w-3.5 h-3.5 text-sc-orange" />
                <span>Open in Editor</span>
              </button>
              <button
                type="button"
                onClick={() => void handleOpenFolder()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1 font-medium text-sc-muted hover:text-sc-fg hover:border-sc-dim hover:bg-sc-panel-2 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Open user folder containing custom.css"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open Folder</span>
              </button>
            </>
          )}

          {/* Snippets & Presets Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSnippetsOpen((v) => !v)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium transition-all cursor-pointer shadow-xs active:scale-95',
                snippetsOpen
                  ? 'border-sc-orange text-sc-fg bg-sc-orange/15'
                  : 'border-sc-line bg-sc-panel text-sc-fg hover:border-sc-dim hover:bg-sc-panel-2'
              )}
            >
              <Sparkles className="w-3.5 h-3.5 text-sc-orange" />
              <span>Presets & Snippets</span>
              <ChevronDown className={clsx('w-3 h-3 transition-transform', snippetsOpen && 'rotate-180')} />
            </button>

            {snippetsOpen && (
              <div
                className="absolute top-full left-0 mt-1.5 w-72 sm:w-80 rounded-xl border border-sc-line bg-sc-panel p-2 shadow-2xl z-50 animate-popover space-y-1.5 max-h-96 overflow-y-auto scroll-thin"
              >
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-sc-muted border-b border-sc-line/50 flex items-center justify-between">
                  <span>Client Themes & Snippets</span>
                  <span className="text-[10px] lowercase font-normal text-sc-dim">click to add</span>
                </div>
                {CUSTOM_CSS_SNIPPETS.map((snip) => (
                  <div
                    key={snip.id}
                    className="p-2 rounded-lg bg-sc-panel-2/30 hover:bg-sc-panel-2 border border-transparent hover:border-sc-line/70 transition-all text-left group"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-sc-fg text-[12px]">{snip.name}</span>
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => handleInsertSnippet(snip, 'append')}
                          className="px-1.5 py-0.5 rounded bg-sc-fill/10 hover:bg-sc-orange hover:text-white text-[10px] font-medium transition-colors"
                          title="Append to existing CSS"
                        >
                          + Append
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInsertSnippet(snip, 'replace')}
                          className="px-1.5 py-0.5 rounded bg-sc-fill/5 hover:bg-sc-fill/20 text-sc-muted text-[10px] font-medium transition-colors"
                          title="Replace current CSS"
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                    <p className="text-[10.5px] text-sc-muted mt-0.5 leading-snug">{snip.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyToClipboard}
            disabled={!css.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1 font-medium text-sc-muted hover:text-sc-fg hover:border-sc-dim hover:bg-sc-panel-2 disabled:opacity-40 transition-all cursor-pointer shadow-xs active:scale-95"
            title="Copy all custom CSS"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!css.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-sc-line bg-sc-panel px-2.5 py-1 font-medium text-sc-muted hover:text-rose-400 hover:border-rose-400/40 hover:bg-rose-500/10 disabled:opacity-40 transition-all cursor-pointer shadow-xs active:scale-95"
            title="Clear editor contents"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* In-App Code Editor Container */}
      <div className="relative flex bg-[#0c0c12] border-b border-sc-line/60 min-h-[260px] max-h-[480px]">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="select-none py-3 px-2 sm:px-3 text-right font-mono text-[11.5px] leading-relaxed text-sc-faint/60 border-r border-sc-line/40 bg-[#08080c] overflow-hidden shrink-0 w-10 sm:w-12 pointer-events-none"
        >
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={css}
          onChange={(e) => onCssChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={`/* Write custom CSS here (Vencord style).
 * Changes apply in real-time!
 *
 * Example:
 * aside, footer {
 *   backdrop-filter: blur(20px);
 * }
 */`}
          className="flex-1 w-full p-3 font-mono text-[12px] leading-relaxed text-sc-fg bg-transparent resize-y outline-none selection:bg-sc-orange/30 overflow-auto scroll-rail placeholder:text-sc-dim/40 placeholder:font-mono"
          style={{ tabSize: 2 }}
        />
      </div>

      {/* Editor Footer Status Bar */}
      <div className="px-4 py-2 bg-sc-panel-2/30 flex items-center justify-between gap-3 text-[11px] text-sc-dim flex-wrap">
        <div className="flex items-center gap-3">
          <span>{lineCount} lines</span>
          <span>·</span>
          <span>{charCount} characters</span>
          {diskPath && (
            <>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline truncate max-w-[280px]" title={diskPath}>
                {diskPath}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-sc-muted hover:text-sc-orange transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>CSS Class & Variable Reference</span>
          <ChevronDown className={clsx('w-3 h-3 transition-transform', guideOpen && 'rotate-180')} />
        </button>
      </div>

      {/* Collapsible Quick Reference & Cheatsheet */}
      {guideOpen && (
        <div className="p-4 sm:p-5 bg-sc-panel-2/20 border-t border-sc-line/50 space-y-4 text-[12px] animate-fade-in">
          <div>
            <h4 className="font-bold text-sc-fg mb-1">How Custom CSS Works</h4>
            <p className="text-sc-muted leading-relaxed">
              Custom CSS is injected directly into the client in real-time. If you edit <code className="px-1.5 py-0.5 rounded bg-sc-fill/10 font-mono text-[11px] text-sc-fg">custom.css</code> in an external editor like VS Code or Notepad, Abbadon will automatically detect changes and hot-reload your styling instantly without an app restart!
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Variables */}
            <div className="rounded-xl border border-sc-line/60 bg-sc-panel p-3">
              <span className="font-bold text-sc-fg text-[11.5px] uppercase tracking-wider block mb-2">
                Available CSS Variables
              </span>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-thin">
                {CSS_CHEAT_SHEET.variables.map((item) => (
                  <div key={item.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <code className="text-sc-orange font-mono font-medium">{item.name}</code>
                    <span className="text-sc-muted text-right truncate">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selectors */}
            <div className="rounded-xl border border-sc-line/60 bg-sc-panel p-3">
              <span className="font-bold text-sc-fg text-[11.5px] uppercase tracking-wider block mb-2">
                Common UI Selectors
              </span>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-thin">
                {CSS_CHEAT_SHEET.selectors.map((item) => (
                  <div key={item.selector} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <code className="text-emerald-400 font-mono font-medium">{item.selector}</code>
                    <span className="text-sc-muted text-right truncate">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
