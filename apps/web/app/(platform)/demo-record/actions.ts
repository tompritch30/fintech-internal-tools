"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "../../../lib/auth.ts";
import { addDemoNote } from "./note.ts";

export const addDemoNoteAction = defineAction(
  "platform:access",
  "demo.addNote",
  async (ctx, _prev: { error?: string; message?: string }, formData: FormData): Promise<{ error?: string; message?: string }> => {
    await addDemoNote(ctx, String(formData.get("note") ?? ""));
    revalidatePath("/demo-record");
    return { message: "Note added." };
  },
);
