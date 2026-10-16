import Link from "next/link";
import { EmptyState, linkClass } from "@fit/ui";

/** A record id that doesn't exist (pages call notFound()). Shown inside the app frame. */
export default function PlatformNotFound() {
  return (
    <EmptyState title="Record not found">
      <p>
        Nothing matches this link. It may be mistyped, or the record may not exist.{" "}
        <Link className={linkClass} href="/">
          Go to Home
        </Link>
      </p>
    </EmptyState>
  );
}
