import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie on every request and keeps
 * unauthenticated visitors out of the application shell.
 *
 * Named `proxy` rather than `middleware`: the middleware convention is
 * deprecated in Next.js 16 and runs on the Node.js runtime here.
 *
 * This is a routing convenience, not a security control: data access is
 * governed by row level security in the database. A forged request that
 * slips past this still cannot read another organization's rows.
 */
// /portal is deliberately here. A supplier holds a link, not an
// account, so sending them to a sign-in page would make the link
// useless. The link itself is the authorisation, checked and rate
// limited in the database by the route that serves it.
// /receipt is here for the same reason as /portal: the customer holds a
// link, not an account. The token is the whole of their authorization
// and it reaches exactly one receipt - so sending them to sign in would
// be sending them nowhere, which is what it did before this line.
const PUBLIC_PATHS = [
  "/sign-in", "/auth", "/_next", "/favicon.ico", "/portal", "/receipt",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh and no way to
  // authenticate. Pass through so the page itself can explain what is
  // missing, rather than failing every request here.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    //
    // sw.js and the manifest are excluded deliberately. A browser
    // refuses to register a service worker whose script came back via a
    // redirect, so sending an unauthenticated request for /sw.js to the
    // sign-in page does not just fail the redirect - it permanently
    // fails registration, and with it the whole offline app. Neither
    // file carries anything private.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
