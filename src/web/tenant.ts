import { eq } from "drizzle-orm"
import { db } from "../db/client"
import { tenants } from "../db/schema/index"
import { env } from "../config"

export interface AppTenant {
  id: string
  slug: string
  name: string
}

const columns = { id: tenants.id, slug: tenants.slug, name: tenants.name }

const find = async () => {
  const [row] = await db
    .select(columns)
    .from(tenants)
    .where(eq(tenants.slug, env.APP_TENANT_SLUG))
    .limit(1)
  return row
}

/**
 * The workspace the app serves, chosen by APP_TENANT_SLUG. It is created the first time it is
 * asked for, so a fresh database needs no setup beyond migrations, and it takes its name from
 * APP_TENANT_NAME.
 */
export async function getAppTenant(): Promise<AppTenant> {
  const existing = await find()
  if (existing?.name === env.APP_TENANT_NAME) return existing

  if (existing) {
    await db
      .update(tenants)
      .set({ name: env.APP_TENANT_NAME })
      .where(eq(tenants.id, existing.id))
  } else {
    await db
      .insert(tenants)
      .values({ slug: env.APP_TENANT_SLUG, name: env.APP_TENANT_NAME })
      .onConflictDoNothing()
  }
  return (await find())!
}
