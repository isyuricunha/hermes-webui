import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import {
  FOCUS_COMPOSER_EVENT,
  OPEN_SHORTCUTS_EVENT,
  TOGGLE_SIDEBAR_EVENT,
  isTypingTarget,
} from '../lib/events';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Command palette: conversations, settings, actions' },
  { keys: [MOD, 'Shift', 'O'], label: 'New chat' },
  { keys: [MOD, 'Shift', 'S'], label: 'Show or hide the sidebar' },
  { keys: ['/'], label: 'Focus the message box' },
  { keys: ['Enter'], label: 'Send (Shift+Enter for a new line)' },
  { keys: ['Esc'], label: 'Close dialogs and menus' },
  { keys: ['?'], label: 'This list' },
];

/** Global keyboard shortcuts and their help sheet. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && event.shiftKey && key === 'o') {
        event.preventDefault();
        void navigate({ to: '/' });
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)), 50);
      } else if (mod && event.shiftKey && key === 's') {
        event.preventDefault();
        window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT));
      } else if (!mod && event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
      } else if (!mod && event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT));
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, [navigate]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden onClick={() => setOpen(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="yu-pop yu-rise relative w-full max-w-md rounded-3xl p-5"
        style={{ animationDuration: '0.35s' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" className="yu-btn yu-btn-ghost size-8 rounded-lg" onClick={() => setOpen(false)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <ul className="divide-y divide-border-subtle">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
              <span className="text-text-secondary">{shortcut.label}</span>
              <span className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="min-w-6 rounded-md bg-chip px-1.5 py-0.5 text-center font-mono text-[11px] text-text-primary shadow-[var(--yu-highlight)]">
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
