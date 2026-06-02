import { Sidebar } from "@/components/layout/Sidebar";
import { EventFeed } from "@/components/layout/EventFeed";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {/* On mobile: add top + bottom padding for fixed bars */}
        <main className="flex-1 overflow-y-auto pt-12 pb-16 md:pt-0 md:pb-0">
          {children}
        </main>
        <aside className="hidden xl:flex w-64 flex-col border-l border-border bg-card/30 shrink-0">
          <EventFeed />
        </aside>
      </div>
    </div>
  );
}
