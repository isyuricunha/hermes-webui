import {
  BarChart3,
  Brain,
  Clock,
  FileCode,
  Info,
  KeyRound,
  MessagesSquare,
  Palette,
  Plug,
  ScrollText,
  Server,
  Sparkles,
  SquareTerminal,
  UserRound,
  Wand2,
  Webhook,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture, shared by the nav column and the palette.
 * `label` and `group` are i18n keys: render them through t(). `keywords` stay
 * English: they are search terms, never displayed.
 */
export interface SettingsNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
}

export const SETTINGS_NAV: readonly { group: string; items: readonly SettingsNavItem[] }[] = [
  {
    group: 'settings.groups.assistant',
    items: [
      {
        to: '/settings/profile',
        label: 'settings.nav.profile',
        icon: UserRound,
        keywords: 'persona personality soul profiles',
      },
      {
        to: '/settings/models',
        label: 'settings.nav.models',
        icon: Sparkles,
        keywords: 'provider llm',
      },
      { to: '/settings/skills', label: 'settings.nav.skills', icon: Wand2 },
      {
        to: '/settings/tools',
        label: 'settings.nav.tools',
        icon: Wrench,
        keywords: 'toolsets terminal browser',
      },
      {
        to: '/settings/memory',
        label: 'settings.nav.memory',
        icon: Brain,
        keywords: 'memory providers curator',
      },
    ],
  },
  {
    group: 'settings.groups.automation',
    items: [
      { to: '/settings/cron', label: 'settings.nav.cron', icon: Clock, keywords: 'jobs schedule' },
      { to: '/settings/webhooks', label: 'settings.nav.webhooks', icon: Webhook },
      {
        to: '/settings/messaging',
        label: 'settings.nav.messaging',
        icon: MessagesSquare,
        keywords: 'telegram discord platforms',
      },
      { to: '/settings/mcp', label: 'settings.nav.mcp', icon: Plug, keywords: 'servers' },
    ],
  },
  {
    group: 'settings.groups.insights',
    items: [
      {
        to: '/settings/usage',
        label: 'settings.nav.usage',
        icon: BarChart3,
        keywords: 'analytics tokens cost',
      },
      {
        to: '/settings/system',
        label: 'settings.nav.system',
        icon: Server,
        keywords: 'gateway restart doctor update',
      },
      { to: '/settings/logs', label: 'settings.nav.logs', icon: ScrollText },
    ],
  },
  {
    group: 'settings.groups.app',
    items: [
      {
        to: '/settings/appearance',
        label: 'settings.nav.appearance',
        icon: Palette,
        keywords: 'theme accent notifications yucode chat style',
      },
      {
        to: '/settings/about',
        label: 'settings.nav.about',
        icon: Info,
        keywords: 'version github gitlab source license credits',
      },
    ],
  },
  {
    group: 'settings.groups.advanced',
    items: [
      {
        to: '/settings/advanced/config',
        label: 'settings.nav.rawConfig',
        icon: FileCode,
        keywords: 'yaml',
      },
      {
        to: '/settings/advanced/environment',
        label: 'settings.nav.environment',
        icon: KeyRound,
        keywords: 'env secrets keys',
      },
      { to: '/settings/advanced/cli', label: 'settings.nav.cli', icon: SquareTerminal },
    ],
  },
];

export const SETTINGS_ITEMS: readonly SettingsNavItem[] = SETTINGS_NAV.flatMap(
  (group) => group.items,
);
