import Link from "next/link";
import { SageMark } from "@sage/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="fade-up flex flex-col items-center text-center">
        <SageMark size={28} className="text-muted-foreground" />
        <span className="mt-6 label-caps text-muted-foreground">404</span>
        <h1 className="mt-2 font-display text-title font-semibold tracking-[-0.03em]">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for may have moved, or the address was mistyped.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full border border-hairline px-5 py-2 text-sm font-medium transition-colors hover:bg-surface-hover"
        >
          Back to overview
        </Link>
      </div>
    </main>
  );
}
