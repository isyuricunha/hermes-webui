import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchConfigRaw, putConfigRaw, validateConfigRaw, type ConfigValidation } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

function lineDiff(
  original: string,
  edited: string,
): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = original.split('\n');
  const b = edited.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j]
          ? (lcs[i + 1]![j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'del', text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j]! });
    j += 1;
  }
  return out;
}

function jumpToLine(
  textarea: HTMLTextAreaElement | null,
  text: string,
  line: number,
  column: number,
) {
  if (textarea === null) return;
  const lines = text.split('\n');
  const index = Math.max(0, Math.min(line - 1, lines.length - 1));
  const offset =
    lines.slice(0, index).reduce((sum, value) => sum + value.length + 1, 0) +
    Math.max(0, column - 1);
  textarea.focus();
  textarea.setSelectionRange(offset, offset);
}

function validationState(
  validation: ConfigValidation | null,
  pending: boolean,
): { label: string; tone: 'ok' | 'bad' | 'idle' } {
  if (pending) return { label: 'checking', tone: 'idle' };
  if (validation === null) return { label: 'unknown', tone: 'idle' };
  if (!validation.ok) return { label: 'invalid', tone: 'bad' };
  if (validation.warnings.length > 0) return { label: 'warning', tone: 'idle' };
  return { label: 'valid', tone: 'ok' };
}

export function RawConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['config-raw'], queryFn: fetchConfigRaw });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const original = query.data?.yaml ?? '';
  const originalRev = query.data?.rev ?? '';
  const [edited, setEdited] = useState<string | null>(null);
  const [rev, setRev] = useState('');
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState<ConfigValidation | null>(null);
  const [validatedText, setValidatedText] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  const shown = edited ?? original;

  const [prevOriginal, setPrevOriginal] = useState<string | null>(null);
  if (query.data !== undefined && prevOriginal !== original) {
    setPrevOriginal(original);
    setEdited(original);
    setRev(originalRev);
    setSaved(false);
    setShowReview(false);
  }

  useEffect(() => {
    if (edited === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void validateConfigRaw(edited)
        .then((result) => {
          if (!cancelled) {
            setValidation(result);
            setValidatedText(edited);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setValidation({
              ok: false,
              errors: [{ line: 1, column: 1, message: error instanceof Error ? error.message : 'Validation failed.' }],
              warnings: [],
            });
            setValidatedText(edited);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [edited]);

  const save = useMutation({
    mutationFn: async (yamlText: string) => putConfigRaw(yamlText, rev),
    onSuccess: async (result) => {
      const fresh = await fetchConfigRaw();
      queryClient.setQueryData(['config-raw'], fresh);
      setEdited(fresh.yaml);
      setRev(fresh.rev);
      setSaved(true);
      setShowReview(false);
      setValidation(result.validation);
      window.dispatchEvent(new CustomEvent('hermes-webui:restart-required'));
    },
  });

  const validationPending = edited !== null && validatedText !== edited;
  const dirty = edited !== null && edited !== original;
  const diff = useMemo(
    () => (dirty ? lineDiff(original, edited ?? '') : []),
    [dirty, original, edited],
  );
  const changedLines = diff.filter((d) => d.kind !== 'same').length;
  const lineCount = Math.max(1, shown.split('\n').length);
  const state = validationState(validation, validationPending);

  const onScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  if (query.isPending) {
    return (
      <SettingsPage title={t('settings.rawConfig.title')}>
        <p className="text-sm text-text-secondary">{t('settings.rawConfig.loading')}</p>
      </SettingsPage>
    );
  }
  if (query.isError) {
    return (
      <SettingsPage title={t('settings.rawConfig.title')}>
        <SettingsError message={query.error.message} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={t('settings.rawConfig.title')}
      wide
      description={
        <>
          <span className="font-mono">{query.data.path}</span>
          {t('settings.rawConfig.descMid')}
          <a
            href="https://hermes-agent.nousresearch.com/docs/user-guide/configuration"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            {t('settings.rawConfig.docsLink')}
          </a>
          {t('settings.rawConfig.descEnd')}
        </>
      }
      actions={
        <a
          href="https://hermes-agent.nousresearch.com/docs/"
          target="_blank"
          rel="noreferrer noopener"
          className="yu-btn yu-btn-tonal h-9 px-3.5 text-[13px]"
        >
          {t('settings.rawConfig.docs')}
        </a>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={[
            'rounded-full px-2.5 py-1 text-[11px] font-medium',
            state.tone === 'ok'
              ? 'bg-success/10 text-success'
              : state.tone === 'bad'
                ? 'bg-danger/10 text-danger'
                : 'bg-chip text-text-secondary',
          ].join(' ')}
        >
          {t(`settings.rawConfig.status.${state.label}`, {
            defaultValue: state.label,
          })}
        </span>
        {validation?.errors.length ? (
          <span className="text-xs text-danger">
            {t('settings.rawConfig.errorCount', { count: validation.errors.length })}
          </span>
        ) : null}
        {validation?.warnings.length ? (
          <span className="text-xs text-text-secondary">
            {t('settings.rawConfig.warningCount', { count: validation.warnings.length })}
          </span>
        ) : null}
        {validationPending ? (
          <span className="text-xs text-text-tertiary">{t('settings.rawConfig.validationPending')}</span>
        ) : null}
      </div>

      {validation && validation.errors.length > 0 ? (
        <div className="mb-3 rounded-2xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs font-medium text-danger">{t('settings.rawConfig.fixErrors')}</p>
          <div className="mt-2 space-y-1">
            {validation.errors.slice(0, 12).map((issue, index) => (
              <button
                type="button"
                key={index}
                onClick={() => jumpToLine(textareaRef.current, shown, issue.line, issue.column)}
                className="block w-full rounded-lg px-2 py-1.5 text-left font-mono text-[11px] text-danger hover:bg-danger/10"
              >
                {t('settings.rawConfig.errorAt', {
                  line: issue.line,
                  column: issue.column,
                  message: issue.message,
                })}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showReview && dirty ? (
        <details open className="mb-3 yu-card rounded-2xl p-3 text-xs">
          <summary className="cursor-pointer select-none font-medium">
            {t('settings.rawConfig.review', { count: changedLines })}
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-xl bg-surface-editor p-3 font-mono text-text-secondary">
            {diff.map((line, index) => (
              <div
                key={index}
                className={
                  line.kind === 'add'
                    ? 'bg-success/10 text-success'
                    : line.kind === 'del'
                      ? 'bg-danger/10 text-danger'
                      : 'text-text-secondary'
                }
              >
                {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
                {line.text}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="yu-card flex h-[62vh] min-h-[420px] overflow-hidden rounded-2xl">
        <div
          ref={gutterRef}
          aria-hidden
          className="hidden h-full w-12 shrink-0 select-none overflow-hidden border-r border-border-subtle bg-surface-input py-4 text-right font-mono text-[11px] leading-5 text-text-tertiary sm:block"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index} className="pr-3">
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={shown}
          onScroll={onScroll}
          onChange={(event) => {
            setEdited(event.target.value);
            setSaved(false);
            setShowReview(false);
            setValidation(null);
            setValidatedText(null);
          }}
          spellCheck={false}
          aria-label={t('settings.rawConfig.aria')}
          wrap="off"
          className="h-full min-h-0 w-full resize-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 outline-none focus:ring-0"
          style={{ tabSize: 2 }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || save.isPending || validationPending || validation === null || !validation.ok}
          onClick={() => setShowReview((current) => !current)}
          className="yu-btn yu-btn-primary h-9 px-4 text-sm"
        >
          {showReview ? t('settings.rawConfig.hideReview') : t('settings.rawConfig.reviewButton', { count: changedLines })}
        </button>
        {showReview ? (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(edited ?? '')}
            className="yu-btn yu-btn-primary h-9 px-4 text-sm"
          >
            {save.isPending ? t('settings.rawConfig.saving') : t('settings.rawConfig.saveConfig')}
          </button>
        ) : null}
        {dirty ? (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              setEdited(original);
              setRev(originalRev);
              setSaved(false);
              setShowReview(false);
              setValidation(null);
              setValidatedText(null);
            }}
            className="yu-btn yu-btn-secondary h-9 px-4 text-sm"
          >
            {t('settings.rawConfig.discard')}
          </button>
        ) : null}
        {saved ? <span className="text-sm text-success">{t('settings.rawConfig.saved')}</span> : null}
        {save.isError ? <span className="text-sm text-danger">{save.error.message}</span> : null}
      </div>

      {validation && validation.warnings.length > 0 ? (
        <p className="mt-3 text-xs text-text-secondary">{t('settings.rawConfig.warningHint')}</p>
      ) : null}
    </SettingsPage>
  );
}
