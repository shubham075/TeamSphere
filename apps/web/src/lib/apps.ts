import {
  Activity, Calendar, CheckSquare, FileText, Folder, LayoutGrid, MessageSquare, Phone, Users, type LucideIcon,
} from 'lucide-react';

export interface RailApp {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Phase in SOURCE_OF_TRUTH §9 that delivers this app. */
  phase: number;
  description: string;
}

/** Apps on the left rail. Admin policies will make the pinned set configurable (Phase 7). */
export const RAIL_APPS: RailApp[] = [
  { id: 'activity', label: 'Activity', icon: Activity, phase: 1, description: 'Mentions, replies, reactions and missed calls in one feed.' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, phase: 1, description: 'One-on-one and group conversations.' },
  { id: 'teams', label: 'Teams', icon: Users, phase: 2, description: 'Teams and channels with threaded posts.' },
  { id: 'calendar', label: 'Calendar', icon: Calendar, phase: 5, description: 'Schedule and join meetings.' },
  { id: 'calls', label: 'Calls', icon: Phone, phase: 3, description: 'Call history, speed dial and voicemail.' },
  { id: 'files', label: 'Files', icon: Folder, phase: 6, description: 'Your files and team document libraries.' },
  { id: 'tasks', label: 'Planner', icon: CheckSquare, phase: 8, description: 'Plans, boards and personal tasks.' },
  { id: 'pages', label: 'Pages', icon: FileText, phase: 8, description: 'Co-edited pages, notes and wikis.' },
];

export const MORE_APPS: RailApp = {
  id: 'apps',
  label: 'Apps',
  icon: LayoutGrid,
  phase: 12,
  description: 'Approvals, Shifts, Lists, Forms, Bookings and more.',
};

export const ALL_APPS = [...RAIL_APPS, MORE_APPS];
