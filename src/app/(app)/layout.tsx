import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env/server";
import { SetupRequired } from "@/components/layout/setup-required";
import { navigationFor } from "@/lib/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

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

  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const sections = navigationFor(user.role);

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar sections={sections} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} sections={sections} />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
