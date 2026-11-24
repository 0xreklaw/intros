import { notFound } from "next/navigation"
import { ClientView } from "@/components/client-view"
import { findReferrals } from "@/src/clients/finder"
import { getClientDetail } from "@/src/clients/service"
import { getAppTenant } from "@/src/web/tenant"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ClientRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tenant = await getAppTenant()
  if (!UUID.test(id)) notFound()

  const detail = await getClientDetail(tenant.id, id)
  if (!detail) notFound()

  // Saved judgements only, so the page opens at once. Anything unread is read from the browser.
  const initial = await findReferrals({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    clientId: id,
    score: false,
  })
  return <ClientView detail={detail} initial={initial} />
}
