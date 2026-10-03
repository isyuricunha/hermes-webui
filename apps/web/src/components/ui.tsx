import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, TriangleAlert } from 'lucide-react';

/**
 * YuTheme page primitives shared by every management screen: page header,
 * sections, switches, segmented controls, stat tiles, badges, skeletons,
 * empty/error states and a small popover menu.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-normal tracking-[-0.025em] text-text-primary">{title}</h1>
        {description !== undefined ? (
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={['yu-rise mx-auto w-full px-4 pt-5 pb-10 md:px-8 md:py-8', wide ? 'max-w-5xl' : 'max-w-3xl'].join(' ')}>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      {title !== undefined || actions !== undefined ? (
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="text-[13px] font-medium text-text-secondary">{title}</h2> : null}
            {description !== undefined ? (
              <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={['yu-card rounded-2xl', className].join(' ')}>{children}</div>;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-chip shadow-[inset_0_0_0_0.5px_var(--color-border-strong)]',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'inline-block size-[18px] rounded-full shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px] bg-on-accent' : 'translate-x-[2px] bg-text-secondary',
        ].join(' ')}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-input p-0.5 shadow-[inset_0_0_0_0.5px_var(--color-border-subtle)]">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={[
            'h-8 rounded-[10px] px-3 text-xs font-medium transition-colors',
            option.value === value ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)]' : 'text-text-tertiary hover:text-text-primary',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'accent' | 'agent' | 'success' | 'danger';
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'agent'
        ? 'text-agent-soft'
        : tone === 'success'
          ? 'text-success'
          : tone === 'danger'
            ? 'text-danger'
            : 'text-text-primary';
  return (
    <div className="yu-card rounded-2xl px-4 py-3.5">
      <p className="text-xs text-text-tertiary">{label}</p>
      <p className={['mt-1 text-[22px] leading-tight font-normal tracking-[-0.02em]', toneClass].join(' ')}>
        {value}
      </p>
      {hint !== undefined ? <p className="mt-0.5 truncate text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'agent' | 'success' | 'warning' | 'danger';
}) {
  return <span className={['yu-chip', `yu-chip-${tone}`].join(' ')}>{children}</span>;
}

export function StatusDot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const cls =
    tone === 'success'
      ? 'bg-success text-success yu-pulse'
      : tone === 'warning'
        ? 'bg-warning text-warning'
        : tone === 'danger'
          ? 'bg-danger text-danger'
          : 'bg-text-tertiary text-text-tertiary';
  return <span aria-hidden className={['inline-block size-1.5 shrink-0 rounded-full', cls].join(' ')} />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2.5" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="yu-skel h-11 rounded-xl" style={{ opacity: 1 - index * 0.18 }} />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="yu-chip-danger flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry !== undefined ? (
        <button type="button" className="yu-btn yu-btn-tonal h-7 rounded-lg px-2.5 text-xs" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyNote({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="yu-card flex flex-col items-center rounded-2xl px-6 py-10 text-center">
      {icon !== undefined ? <div className="mb-3 text-text-tertiary">{icon}</div> : null}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {children !== undefined ? <p className="mt-1 max-w-sm text-[13px] text-text-secondary">{children}</p> : null}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check (current choice in a picker menu). */
  checked?: boolean;
  /** Second line under the label. */
  hint?: string;
}

/**
 * Small popover menu anchored to its trigger; closes on outside click,
 * Escape, scroll or resize. Rendered in a portal on <body> so no transformed
 * or clipped ancestor can put it under the page content.
 */
export function Menu({
  trigger,
  items,
  label,
  align = 'end',
  triggerClassName = 'yu-btn yu-btn-ghost size-8 rounded-lg',
  tip,
  above = false,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  label: string;
  align?: 'start' | 'end';
  triggerClassName?: string;
  /** Hover help on the trigger. */
  tip?: string;
  /** Open upwards (triggers near the bottom of the screen). */
  above?: boolean;
}) {
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;
  const toggle = () => {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const vertical = above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 };
    setPosition(
      align === 'end'
        ? { ...vertical, right: Math.max(8, window.innerWidth - rect.right) }
        : { ...vertical, left: Math.max(8, rect.left) },
    );
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={triggerClassName}
        {...(tip !== undefined ? { 'data-tip': tip, 'data-tip-wide': '' } : {})}
      >
        {trigger}
      </button>
      {position !== null
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              className="yu-pop yu-pop-in fixed z-[70] max-h-[70vh] min-w-48 overflow-y-auto rounded-2xl p-1.5"
              style={position}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setPosition(null);
                    item.onSelect();
                  }}
                  className={[
                    'flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] transition-colors outline-none hover:bg-chip focus-visible:bg-chip disabled:opacity-40',
                    item.danger === true ? 'text-danger' : 'text-text-primary',
                  ].join(' ')}
                >
                  {item.icon !== undefined ? <span className="flex text-text-tertiary [&>svg]:size-4">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1 py-1.5">
                    <span className="block">{item.label}</span>
                    {item.hint !== undefined ? <span className="block text-[11px] text-text-tertiary">{item.hint}</span> : null}
                  </span>
                  {item.checked === true ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Side panel on desktop, bottom sheet on phones. Escape and backdrop close it. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portal: a transformed ancestor (the page entrance animation) would
  // otherwise size this "fixed" panel to the whole page, not the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-end justify-end md:items-stretch">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="yu-pop yu-rise relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full flex-col rounded-t-3xl pb-[env(safe-area-inset-bottom)] md:max-h-none md:pb-0 md:w-[min(44rem,92vw)] md:rounded-none md:rounded-l-3xl"
        style={{ animationDuration: '0.35s' }}
      >
        <header className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-medium text-text-primary">{title}</h2>
            {subtitle !== undefined ? <p className="mt-0.5 truncate text-xs text-text-tertiary">{subtitle}</p> : null}
          </div>
          {actions}
          <button type="button" aria-label="Close" onClick={onClose} className="yu-btn yu-btn-ghost size-8 rounded-lg">
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
