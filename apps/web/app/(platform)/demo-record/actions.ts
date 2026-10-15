"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "../../../lib/auth.ts";
import { addDemoNote } from "./note.ts";

export const addDemoNoteAction = defineAction("platform:access", "demo.addNote", async (ctx, formData: FormData) => {
  await addDemoNote(ctx, String(formData.get("note") ?? ""));
  revalidatePath("/demo-record");
});
