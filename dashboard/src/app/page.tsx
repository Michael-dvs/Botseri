import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const settings = await prisma.botSettings.findUnique({ where: { id: 1 } });
  if (!settings?.setup_completed) redirect("/setup");
  const session = await getSession();
  redirect(session ? "/dashboard" : "/login");
}
