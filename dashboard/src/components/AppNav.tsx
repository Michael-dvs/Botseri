"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/todos", label: "To-Do" },
  { href: "/orders", label: "Pesanan" },
  { href: "/pipeline", label: "Alur Kerja" },
  { href: "/priority-stack", label: "Priority Stack" },
  { href: "/prompt", label: "Prompt" },
  { href: "/settings", label: "Pengaturan" },
  { href: "/integrations", label: "Integrasi" },
  { href: "/analytics", label: "Analitik" },
  { href: "/logs", label: "Log" },
  { href: "/status", label: "Status" },
];

export function AppNav({ enableOrders = true }: { enableOrders?: boolean }) {
  const pathname = usePathname();
  const visibleLinks = enableOrders
    ? links
    : links.filter((item) => item.href !== "/orders");

  return (
    <nav aria-label="Navigasi utama" className="flex flex-wrap gap-1 pb-2">
      {visibleLinks.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded px-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
