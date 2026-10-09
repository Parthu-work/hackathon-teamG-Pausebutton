import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { HttpError } from "./session";

type Ctx = { params: Promise<Record<string, string>> };

/** Wraps a route handler: JSON in, JSON out, friendly errors. */
export function route<T>(fn: (req: Request, params: Record<string, string>) => Promise<T>) {
  return async (req: Request, ctx: Ctx) => {
    await connection(); // every API call is per-request: never prerender at build time
    try {
      const data = await fn(req, ctx?.params ? await ctx.params : {});
      return Response.json(data ?? { ok: true });
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof z.ZodError) {
        return Response.json({ error: error.issues[0]?.message ?? "Please check what you typed." }, { status: 400 });
      }
      console.error(error);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => ({}));
  return schema.parse(json);
}
