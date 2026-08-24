import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Is there a photograph for the sign-in panel?
 *
 * Decided here, at build time, and baked into the bundle - not checked
 * from the page. `public/` is served by the CDN and is not on the
 * filesystem the server functions run against, so an existsSync inside
 * a page returns false in production however many images are deployed,
 * and the slot would never light up.
 *
 * See public/images/README.md.
 */
const signInPhoto = existsSync(
  path.join(process.cwd(), "public", "images", "warehouse.jpg"),
);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SIGNIN_PHOTO: signInPhoto ? "1" : "",
  },
};

export default nextConfig;
