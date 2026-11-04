import Link from "next/link";
import { prisma } from "@/lib/db";
import { OrderBoard } from "./OrderBoard";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const settings = await prisma.botSettings.findUniqueOrThrow({ where: { id: 1 } });

  if (!settings.enable_orders) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <p className="eyebrow">Modul Opsional</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Pesanan Pelanggan</h1>
        </header>

        <section className="panel p-6 sm:p-8 text-center max-w-lg mx-auto my-8">
          <p className="text-base font-semibold text-[var(--ink)]">
            Modul Pesanan Sedang Dinonaktifkan
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Botseri saat ini berjalan dalam mode Produktivitas Personal &amp; To-Do. Anda dapat mengaktifkan kembali modul pencatatan pesanan kapan saja melalui menu Pengaturan.
          </p>
          <div className="mt-6 flex justify-center">
            <Link href="/settings" className="btn btn-primary min-h-[44px]">
              Buka Pengaturan
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const orders = await prisma.order.findMany({
    orderBy: { delivery_date: { sort: "asc", nulls: "last" } },
    take: 200,
  });

  return (
    <OrderBoard
      initialOrders={orders.map((order) => ({
        id: order.id,
        customer_name: order.customer_name,
        customer_contact: order.customer_contact,
        description: order.description,
        event_date: order.event_date?.toISOString() ?? null,
        delivery_date: order.delivery_date?.toISOString() ?? null,
        delivery_address: order.delivery_address,
        total_amount: order.total_amount === null ? null : Number(order.total_amount),
        dp_amount: order.dp_amount === null ? null : Number(order.dp_amount),
        payment_status: order.payment_status,
        status: order.status,
        notes: order.notes,
      }))}
      timezone={settings.timezone}
    />
  );
}
