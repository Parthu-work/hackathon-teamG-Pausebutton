import { z } from "zod";
import { toIndianMobile } from "@/lib/phone";
import { HOLD_CHOICES } from "@/lib/check/config";

export const personBody = z.object({
  name: z.string().trim().min(1, "Please type a name.").max(40),
  relation: z.enum(["Son", "Daughter", "Spouse", "Friend"]),
  phone: z
    .string()
    .trim()
    .refine((v) => toIndianMobile(v) !== null, "Please type a 10-digit mobile number.")
    .transform((v) => toIndianMobile(v)!),
  earlyHeadsUp: z.boolean().default(true),
});

/** A person's own name: what the home screen greets by and what family and alerts call them. Never the old "Guest". */
export const nameField = z
  .string({ error: "Please enter your name." })
  .trim()
  .min(1, "Please enter your name.")
  .max(40, "Please keep your name under 40 letters.")
  .refine((v) => v.toLowerCase() !== "guest", "Please enter your name.");

/** A2: the role, and the name the home screen greets by (required since sign-up asks for it). */
export const roleBody = z.object({
  role: z.enum(["protected", "family"]),
  name: nameField,
});

/** Settings › Payment hold time: one of the fixed choices, in minutes. */
export const holdMinutesField = z
  .number()
  .int()
  .refine((v) => (HOLD_CHOICES as readonly number[]).includes(v), "Please pick 5, 10, 15, 30 or 60 minutes.");
