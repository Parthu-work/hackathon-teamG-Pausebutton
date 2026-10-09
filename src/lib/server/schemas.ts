import { z } from "zod";
import { toIndianMobile } from "@/lib/phone";

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
