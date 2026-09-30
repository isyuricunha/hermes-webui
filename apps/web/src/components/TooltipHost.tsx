import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * One themed tooltip for the whole app. Any element with `data-tip` (or a
 * plain `title`) gets it on hover after a short delay and at once on
 * keyboard focus. A `title` is parked in `data-tip-title` while shown so the
 * browser's own tooltip does not double it, then put back.
 * `data-tip-wide` allows a longer, multi-line explanation.
 */

interface TipState {
  text: string;
  wide: boolean;
  top: number;
  left: number;
  below: boolean;
}

const SHOW_DELAY_MS = 380;

function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const element = node.closest<HTMLElement>('[data-tip], [title], [data-tip-title], button[aria-label], a[aria-label]');
  if (element === null || element.hasAttribute('data-no-tip')) return null;
  return textOf(element) === '' ? null : element;
}

/** Icon-only controls explain themselves with their aria-label. */
function textOf(element: HTMLElement): string {
  const explicit = element.getAttribute('data-tip') ?? element.getAttribute('title') ?? element.getAttribute('data-tip-title');
  if (explicit !== null) return explicit.trim();
  const label = element.getAttribute('aria-label');
  return label !== null && (element.textContent ?? '').trim() === '' ? label.trim() : '';
}

export function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const restoreTitle = (element: HTMLElement | null) => {
      const parked = element?.getAttribute('data-tip-title');
      if (element && parked !== null && parked !== undefined) {
        element.setAttribute('title', parked);
        element.removeAttribute('data-tip-title');
      }
    };
    const hide = () => {
      clearTimer();
      restoreTitle(current.current);
      current.current = null;
      setTip(null);
    };
    const show = (element: HTMLElement) => {
      const text = textOf(element);
      if (text === '' || !element.isConnected) return;
      const title = element.getAttribute('title');
      if (title !== null) {
        element.setAttribute('data-tip-title', title);
        element.removeAttribute('title');
      }
      const rect = element.getBoundingClientRect();
      const below = rect.top < 72;
      setTip({
        text,
        wide: element.hasAttribute('data-tip-wide') || text.length > 90,
        top: below ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
        below,
      });
    };
    const enter = (element: HTMLElement, delay: number) => {
      if (current.current === element) return;
      hide();
      current.current = element;
      // Park the title right away so the native tooltip never appears.
      const title = element.getAttribute('title');
      if (title !== null) {
        element.setAttribute('data-tip-title', title);
        element.removeAttribute('title');
      }
      timer.current = window.setTimeout(() => show(element), delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const element = tipTarget(event.target);
      if (element === null) {
        if (current.current !== null) hide();
        return;
      }
      enter(element, SHOW_DELAY_MS);
    };
    const onFocus = (event: FocusEvent) => {
      const element = tipTarget(event.target);
      if (element !== null && (event.target as Element).matches(':focus-visible')) enter(element, 0);
    };
    // Typing (or Escape) dismisses a hover tip; Tab moves focus, which shows the next one.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Shift') hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onKey);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (tip === null) return null;
  const maxWidth = tip.wide ? 300 : 240;
  const left = Math.min(Math.max(tip.left, maxWidth / 2 + 8), window.innerWidth - maxWidth / 2 - 8);
  return createPortal(
    <div
      className="pointer-events-none fixed z-[90]"
      style={{ top: tip.top, left, maxWidth, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
      <div
        role="tooltip"
        className="yu-pop yu-pop-in rounded-lg px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-line text-text-primary"
      >
        {tip.text}
      </div>
    </div>,
    document.body,
  );
}
