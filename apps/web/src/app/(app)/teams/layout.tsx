import { TeamList } from '@/components/teams/team-list';

export default function TeamsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TeamList />
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </>
  );
}
