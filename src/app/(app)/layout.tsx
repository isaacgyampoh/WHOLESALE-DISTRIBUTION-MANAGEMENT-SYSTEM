import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env/server";
import { SetupRequired } from "@/components/layout/setup-required";
import { AccountPending } from "@/components/layout/account-pending";
import { navigationFor } from "@/lib/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SessionWatcher } from "@/components/layout/session-watcher";

/**
 * Every page in this shell depends on who is signed in, so none of it may
 * be statically rendered or cached at build time.
 */
export const dynamic = "force-dynamic";

/**
 * Protected shell. The user is resolved server-side on every request;
 * middleware only handles the redirect, it does not establish identity.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Distinguish "not configured yet" from "not signed in": the first is a
  // setup step, the second is a redirect.
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const session = await getSessionState();

  // A pending account holds a valid session, so redirecting it to
  // sign-in would bounce straight back here. Say what is happening.
  if (session.status === "pending") return <AccountPending email={session.email} />;
  if (session.status === "anonymous") redirect("/sign-in");

  // A PIN somebody else chose gets you exactly one screen: the one that
  // replaces it. Nothing here renders until it has been.
  if (session.mustChangePin) redirect("/set-pin");

  const { user } = session;
  const sections = navigationFor(user.role);

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar sections={sections} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        {/* Bottom padding clears the fixed mobile bar and its safe-area inset. */}
        <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
      <BottomNav sections={sections} />
      <SessionWatcher />
    </div>
  );
}
