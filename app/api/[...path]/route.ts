import { NextResponse, type NextRequest } from "next/server"
import { routeApi } from "@/src/web/api"
import { ClientError } from "@/src/clients/service"

export const dynamic = "force-dynamic"

const MAX_BODY = 64 * 1024

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const result = await routeApi({
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    readBody: async () => {
      const raw = await req.text()
      if (raw.length > MAX_BODY)
        throw new ClientError("Request body too large", 413)
      if (!raw) return {}
      try {
        return JSON.parse(raw)
      } catch {
        throw new ClientError("Body must be JSON", 400)
      }
    },
  })
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  })
}

export { handle as GET, handle as POST, handle as PUT }
