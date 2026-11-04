import Link from "next/link";

type Props = {
  title: string;
  step: string;
  description: string;
};

export function ComingSoon({ title, step, description }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <p className="eyebrow">{step}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {description}
        </p>
      </header>

      <section className="panel max-w-2xl p-6">
        <p className="text-sm font-medium">Halaman ini belum aktif.</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Fitur ini berada di tahap berikutnya. Selama belum aktif, tidak ada
          kontrol kosong yang bisa diklik.
        </p>
        <Link href="/dashboard" className="btn btn-secondary mt-5">
          Kembali ke dashboard
        </Link>
      </section>
    </div>
  );
}
