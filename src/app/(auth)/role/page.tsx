import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { getDb, schema } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { sessionUserId } from "@/lib/server/session";
import { RoleScreen } from "@/screens/auth";

/** A2: only reachable mid sign-up. The name box starts with the invite's name, when family invited this number. */
async function Role() {
  const id = await sessionUserId("pending");
  if (!id) {
    if (await sessionUserId("rao")) redirect("/");
    if (await sessionUserId("family")) redirect("/family");
    redirect("/welcome");
  }
  await connection(); // the database read happens per request, never in a prefetched shell
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  return (
    <Fresh>
      <RoleScreen suggestedName={user ? (displayName(user.name, { full: true }) ?? "") : ""} />
    </Fresh>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Role />
    </Suspense>
  );
}
