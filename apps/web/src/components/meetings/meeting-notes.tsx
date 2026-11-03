'use client';

import { Loader2 } from 'lucide-react';
import { PageEditor } from '@/components/pages/page-editor';
import { errorText } from '@/components/teams/ui';
import { MEETING_NOTES_TEMPLATE, useMeetingNotes } from '@/lib/pages';

/** The meeting's co-edited notes & agenda page (created on first open, seeded with an agenda template). */
export function MeetingNotes({ meetingId, dark }: { meetingId: string; dark?: boolean }) {
  const { data: page, isLoading, error } = useMeetingNotes(meetingId);
  if (isLoading) return <div className="p-4"><Loader2 className="animate-spin opacity-60" /></div>;
  if (!page) return <p className="p-4 text-sm">{errorText(error) ?? 'Notes are not available.'}</p>;
  return <PageEditor pageId={page.id} template={MEETING_NOTES_TEMPLATE} dark={dark} />;
}
