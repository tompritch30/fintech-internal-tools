import Link from "next/link";
import { EmptyState, linkClass } from "@fit/ui";

/** Any URL that matches no page. Rendered outside the app frame, so it links back in. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4">
      <div className="w-full">
        <EmptyState title="Page not found">
          <p>
            This address doesn&apos;t match any page in Internal tools.{" "}
            <Link className={linkClass} href="/">
              Go to Home
            </Link>
          </p>
        </EmptyState>
      </div>
    </main>
  );
}
