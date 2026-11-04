"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      setPending(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className="btn btn-secondary"
    >
      {pending ? "Keluar..." : "Keluar"}
    </button>
  );
}
