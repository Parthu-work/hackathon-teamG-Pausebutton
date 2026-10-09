import { z } from "zod";

export const personBody = z.object({
  name: z.string().trim().min(1, "Please type a name.").max(40),
  relation: z.enum(["Son", "Daughter", "Spouse", "Friend"]),
  phone: z.string().trim().min(10, "Please type a mobile number.").max(20),
  earlyHeadsUp: z.boolean().default(true),
});
