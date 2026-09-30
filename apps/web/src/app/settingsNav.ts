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

/** Settings information architecture, shared by the nav column and the palette. */
export interface SettingsNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
}

export const SETTINGS_NAV: readonly { group: string; items: readonly SettingsNavItem[] }[] = [
  {
    group: 'Assistant',
    items: [
      { to: '/settings/profile', label: 'Profile & SOUL', icon: UserRound, keywords: 'persona personality soul profiles' },
      { to: '/settings/models', label: 'Models', icon: Sparkles, keywords: 'provider llm' },
      { to: '/settings/skills', label: 'Skills', icon: Wand2 },
      { to: '/settings/tools', label: 'Tools', icon: Wrench, keywords: 'toolsets terminal browser' },
      { to: '/settings/memory', label: 'Memory', icon: Brain, keywords: 'memory providers curator' },
    ],
  },
  {
    group: 'Automation',
    items: [
      { to: '/settings/cron', label: 'Cron', icon: Clock, keywords: 'jobs schedule' },
      { to: '/settings/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/settings/messaging', label: 'Messaging', icon: MessagesSquare, keywords: 'telegram discord platforms' },
      { to: '/settings/mcp', label: 'MCP', icon: Plug, keywords: 'servers' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { to: '/settings/usage', label: 'Usage', icon: BarChart3, keywords: 'analytics tokens cost' },
      { to: '/settings/system', label: 'System', icon: Server, keywords: 'gateway restart doctor update' },
      { to: '/settings/logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    group: 'App',
    items: [
      { to: '/settings/appearance', label: 'Appearance', icon: Palette, keywords: 'theme accent notifications yucode chat style' },
      { to: '/settings/about', label: 'About', icon: Info, keywords: 'version github gitlab source license credits' },
    ],
  },
  {
    group: 'Advanced',
    items: [
      { to: '/settings/advanced/config', label: 'Raw Config', icon: FileCode, keywords: 'yaml' },
      { to: '/settings/advanced/environment', label: 'Environment', icon: KeyRound, keywords: 'env secrets keys' },
      { to: '/settings/advanced/cli', label: 'Hermes CLI', icon: SquareTerminal },
    ],
  },
];

export const SETTINGS_ITEMS: readonly SettingsNavItem[] = SETTINGS_NAV.flatMap((group) => group.items);
