import { useQuery } from '@tanstack/react-query';
import { fetchSkills } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** Installed skills (PRD 25). Install/hub flows arrive with the Beta scope. */
export function SkillsPage() {
  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: fetchSkills });

  if (skillsQuery.isPending) {
    return (
      <SettingsPage title="Skills">
        <p className="text-sm text-text-secondary">Loading skills…</p>
      </SettingsPage>
    );
  }
  if (skillsQuery.isError) {
    return (
      <SettingsPage title="Skills">
        <SettingsError message={skillsQuery.error.message} />
      </SettingsPage>
    );
  }

  const skills = skillsQuery.data ?? [];
  return (
    <SettingsPage title="Skills">
      <p className="mb-3 text-xs text-text-secondary">{skills.length} installed.</p>
      <ul className="space-y-1.5">
        {skills.map((skill) => (
          <li
            key={skill.name}
            className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2"
          >
            <p className="text-sm font-medium">{skill.name}</p>
            {skill.description ? (
              <p className="line-clamp-2 text-xs text-text-secondary">{skill.description}</p>
            ) : null}
          </li>
        ))}
        {skills.length === 0 ? (
          <li className="text-sm text-text-secondary">No skills installed.</li>
        ) : null}
      </ul>
    </SettingsPage>
  );
}
