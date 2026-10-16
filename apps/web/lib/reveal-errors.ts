import { ForbiddenError, NotFoundError, ValidationError } from "@fit/core";

const sentence = (msg: string) => {
  const s = msg.trim();
  const capped = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
};

/** Expected reveal errors as a sentence for the reveal dialog; anything else is a bug and is rethrown. */
export function revealFailure(err: unknown): { error: string } {
  if (err instanceof ForbiddenError) {
    return {
      error: err.required === "unmask:rate-limit" ? "You've reached the hourly limit for reveals. Try again later." : "You don't have permission to reveal this.",
    };
  }
  if (err instanceof ValidationError) {
    const min = /at least (\d+) characters/.exec(err.message);
    if (min) return { error: `The reason must be at least ${min[1]} characters.` };
    if (/requires a reason/.test(err.message)) return { error: "Give a reason for revealing this." };
    return { error: sentence(err.message) };
  }
  if (err instanceof NotFoundError) return { error: sentence(err.message) };
  throw err;
}
