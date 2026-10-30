/** Command box (title-bar search starting with "/"): parsing and suggestions, kept pure for tests. */

export type CommandName =
  | 'available' | 'busy' | 'dnd' | 'brb' | 'away' | 'offline'
  | 'call' | 'chat' | 'files' | 'goto' | 'saved' | 'activity' | 'settings' | 'keys' | 'admin';

export interface CommandDef {
  name: CommandName;
  /** Placeholder for the argument, when the command takes one. */
  arg?: string;
  description: string;
  adminOnly?: boolean;
}

export const COMMANDS: CommandDef[] = [
  { name: 'available', description: 'Set your status to Available' },
  { name: 'busy', description: 'Set your status to Busy' },
  { name: 'dnd', description: 'Set your status to Do not disturb' },
  { name: 'brb', description: 'Set your status to Be right back' },
  { name: 'away', description: 'Set your status to Away' },
  { name: 'offline', description: 'Appear offline' },
  { name: 'call', arg: 'name', description: 'Call someone' },
  { name: 'chat', arg: 'name', description: 'Start or open a chat with someone' },
  { name: 'goto', arg: 'team or channel', description: 'Go to a team or channel' },
  { name: 'files', description: 'Open your files' },
  { name: 'saved', description: 'Show your saved messages' },
  { name: 'activity', description: 'Show your activity feed' },
  { name: 'settings', description: 'Open settings' },
  { name: 'keys', description: 'Show keyboard shortcuts' },
  { name: 'admin', description: 'Open the admin center', adminOnly: true },
];

const ALIASES: Record<string, CommandName> = { donotdisturb: 'dnd', berightback: 'brb', shortcuts: 'keys', help: 'keys', status: 'available' };

export type Parsed =
  | { kind: 'search'; q: string }
  | { kind: 'command'; command: CommandDef; arg: string }
  /** "/" plus a partial or unknown name: show matching commands. */
  | { kind: 'partial'; prefix: string; matches: CommandDef[] };

export function parseCommand(input: string, opts: { isAdmin?: boolean } = {}): Parsed {
  const text = input.trimStart();
  if (!text.startsWith('/')) return { kind: 'search', q: input.trim() };
  const m = /^\/(\S*)\s*(.*)$/s.exec(text)!;
  const word = m[1].toLowerCase();
  const arg = m[2].trim();
  const visible = COMMANDS.filter((c) => !c.adminOnly || opts.isAdmin);
  const exact = visible.find((c) => c.name === (ALIASES[word] ?? word));
  // Commands that take an argument stay "partial" until there is one, so the box keeps listing commands.
  if (exact && (!exact.arg || arg)) return { kind: 'command', command: exact, arg };
  if (exact) return { kind: 'partial', prefix: word, matches: [exact] };
  const matches = visible.filter((c) => c.name.startsWith(word) || Object.entries(ALIASES).some(([a, n]) => n === c.name && a.startsWith(word) && word));
  return { kind: 'partial', prefix: word, matches };
}

/** Presence statuses the status commands map to. */
export const STATUS_COMMANDS: Partial<Record<CommandName, 'available' | 'busy' | 'dnd' | 'brb' | 'away' | 'offline'>> = {
  available: 'available',
  busy: 'busy',
  dnd: 'dnd',
  brb: 'brb',
  away: 'away',
  offline: 'offline',
};
