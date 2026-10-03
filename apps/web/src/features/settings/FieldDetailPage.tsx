import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchConfigSchema,
  fetchSettingsConfig,
  fetchSettingsDefaults,
  putSettingsConfig,
} from '../../lib/api';
import { getByPath, setByPath } from '../../lib/settingsSearch';
import { SettingsError, SettingsPage } from './SettingsLayout';

/**
 * Schema-driven field editor (PRD 20, 21, 65.2/65.3): edits one dotpath of
 * the real Hermes config via the dashboard deep-merge API, then re-reads to
 * confirm the change landed (never trusts the 200 alone).
 */
export function FieldDetailPage({ path }: { path: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schemaQuery = useQuery({ queryKey: ['settings-schema'], queryFn: fetchConfigSchema });
  const configQuery = useQuery({ queryKey: ['settings-config'], queryFn: fetchSettingsConfig });
  const defaultsQuery = useQuery({
    queryKey: ['settings-defaults'],
    queryFn: fetchSettingsDefaults,
  });

  const field = schemaQuery.data?.fields[path];
  const current = configQuery.data !== undefined ? getByPath(configQuery.data, path) : undefined;
  const fallback =
    defaultsQuery.data !== undefined ? getByPath(defaultsQuery.data, path) : undefined;

  const [input, setInput] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Reset the editor when navigating to another field.
  const [prevPath, setPrevPath] = useState(path);
  if (prevPath !== path) {
    setPrevPath(path);
    setInput(null);
    setConfirmed(false);
  }

  const save = useMutation({
    mutationFn: (value: unknown) => putSettingsConfig(setByPath(value, path)),
    onSuccess: async () => {
      const fresh = await fetchSettingsConfig();
      const landed = getByPath(fresh, path);
      if (landed === current) {
        setConfirmed(false);
      } else {
        setConfirmed(true);
        // PRD 30: config changes may need a gateway restart; surface it.
        window.dispatchEvent(new CustomEvent('hermes-webui:restart-required'));
      }
      void queryClient.invalidateQueries({ queryKey: ['settings-config'] });
    },
    onError: () => setConfirmed(false),
  });

  if (schemaQuery.isPending || configQuery.isPending || defaultsQuery.isPending) {
    return (
      <SettingsPage title={path}>
        <p className="text-sm text-text-secondary">{t('settings.fieldDetail.loading')}</p>
      </SettingsPage>
    );
  }
  if (schemaQuery.isError) {
    return (
      <SettingsPage title={path}>
        <SettingsError message={schemaQuery.error.message} />
      </SettingsPage>
    );
  }
  if (field === undefined) {
    return (
      <SettingsPage title={path}>
        <p className="text-sm text-text-secondary">{t('settings.fieldDetail.unknownSetting')}</p>
      </SettingsPage>
    );
  }
  if (configQuery.isError) {
    return (
      <SettingsPage title={path}>
        <SettingsError message={configQuery.error.message} />
      </SettingsPage>
    );
  }

  const type = String(field.type ?? 'string');
  const currentValue = current !== undefined ? current : fallback;
  const draft =
    input !== null
      ? input
      : currentValue !== undefined && currentValue !== null
        ? String(currentValue)
        : '';

  const buildValue = (): unknown => {
    if (type === 'number') return Number(draft);
    if (type === 'boolean') return draft === 'true';
    return draft;
  };

  const invalid = type === 'number' && draft.trim() !== '' && Number.isNaN(Number(draft));

  return (
    <SettingsPage title={path}>
      <div className="yu-card rounded-2xl p-4">
        <p className="text-sm font-medium">{field.description ?? path}</p>
        <p className="mt-1 text-xs text-text-secondary">
          {t('settings.fieldDetail.fieldType', { type, category: field.category ?? '?' })}
          {current !== undefined ? '' : t('settings.fieldDetail.notSetDefault')}
        </p>
        <input
          value={draft}
          onChange={(event) => {
            setInput(event.target.value);
            setConfirmed(false);
          }}
          aria-label={t('settings.fieldDetail.valueAria', { path })}
          spellCheck={false}
          className="mt-3 h-10 w-full max-w-md yu-input px-3 text-sm"
        />
        {invalid ? (
          <p className="mt-1 text-xs text-danger">{t('settings.fieldDetail.notValidNumber')}</p>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={invalid || draft === '' || save.isPending}
            onClick={() => save.mutate(buildValue())}
            className="yu-btn yu-btn-primary px-4 py-2 text-sm"
          >
            {save.isPending ? t('settings.fieldDetail.saving') : t('settings.fieldDetail.save')}
          </button>
          {confirmed ? (
            <span className="text-sm text-success">{t('settings.fieldDetail.savedConfirmed')}</span>
          ) : null}
          {save.isError ? <span className="text-sm text-danger">{save.error.message}</span> : null}
        </div>
        {fallback !== undefined ? (
          <p className="mt-2 text-xs text-text-secondary">
            {t('settings.fieldDetail.defaultLabel', { value: String(fallback) })}
          </p>
        ) : null}
      </div>
      <p className="mt-4 text-xs text-text-secondary">{t('settings.fieldDetail.saveHint')}</p>
    </SettingsPage>
  );
}
