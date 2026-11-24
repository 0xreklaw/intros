import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/src/config"

/**
 * Puts the whole app behind one password (HTTP basic auth, any username). The app spends money
 * on every search, so it is not served to anyone in production until APP_PASSWORD is set.
 * `/api/health` stays open for uptime checks.
 */

const digest = (value: string) => createHash("sha256").update(value).digest()

function passwordOf(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8")
  const colon = decoded.indexOf(":")
  return colon < 0 ? null : decoded.slice(colon + 1)
}

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/health") return NextResponse.next()

  const expected = env.APP_PASSWORD
  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next()
    return new NextResponse("Set APP_PASSWORD to start the app.", {
      status: 503,
    })
  }

  const given = passwordOf(req.headers.get("authorization"))
  if (given !== null && timingSafeEqual(digest(given), digest(expected)))
    return NextResponse.next()

  return new NextResponse("Password required.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Intros", charset="UTF-8"' },
  })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
