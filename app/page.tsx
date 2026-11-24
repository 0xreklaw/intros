import Link from "next/link"
import { Building2, ChevronRight } from "lucide-react"

import { ClickRow } from "@/components/click-row"
import { Initials } from "@/components/initials"
import { AddClientDialog } from "@/components/forms/add-client-dialog"
import { PageBody, PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { PageEmptyState } from "@/components/ui/page-empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RECOMMENDATION_CLASS } from "@/lib/format"
import { listClients } from "@/src/clients/service"
import { getAppTenant } from "@/src/web/tenant"

export const dynamic = "force-dynamic"

export default async function ClientsPage() {
  const tenant = await getAppTenant()
  const clients = await listClients(tenant.id)

  return (
    <>
      <PageHeader
        title="Clients"
        description="Each client is a company. Open one to see who its people can introduce you to."
        actions={<AddClientDialog />}
      />
      {clients.length === 0 ? (
        <PageEmptyState
          icon={Building2}
          title="No clients yet"
          description="Add a company to start mapping its people and connections."
        >
          <div className="mt-4 flex justify-center">
            <AddClientDialog />
          </div>
        </PageEmptyState>
      ) : (
        <PageBody className="p-0 sm:p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead className="w-48">Industry</TableHead>
                <TableHead className="w-28 text-right">People</TableHead>
                <TableHead className="w-32 text-right">Connections</TableHead>
                <TableHead className="w-32 text-right">Top matches</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <ClickRow key={c.id} href={`/clients/${c.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Initials name={c.name} square />
                      <div className="min-w-0">
                        <Link
                          href={`/clients/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {c.domain ?? "No domain yet"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.employeeCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.connectionCount}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.topCount ? (
                      <Badge className={RECOMMENDATION_CLASS.ask}>
                        {c.topCount}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {c.topCount === null ? "—" : 0}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                  </TableCell>
                </ClickRow>
              ))}
            </TableBody>
          </Table>
        </PageBody>
      )}
    </>
  )
}
