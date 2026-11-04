import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { LogoutButton } from "@/components/LogoutButton";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings?.setup_completed) redirect("/setup");

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
            <Link
              href="/dashboard"
              className="flex min-h-11 items-center gap-2 text-[var(--ink)]"
            >
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded bg-[var(--accent)] text-sm font-bold text-[#fff7ed]"
              >
                B
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">
                  Botseri
                </span>
                <span className="block max-w-52 truncate text-xs leading-tight text-[var(--muted)]">
                  {settings.brand_name}
                </span>
              </span>
            </Link>

            <div className="ml-auto flex min-w-0 items-center gap-3">
              <span className="truncate text-sm text-[var(--muted)]">
                {session.username}
              </span>
              <LogoutButton />
            </div>
          </div>

          <AppNav enableOrders={settings.enable_orders} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
