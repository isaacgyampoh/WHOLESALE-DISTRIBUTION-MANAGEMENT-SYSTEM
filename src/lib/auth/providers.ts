/**
 * Which sign-in methods this deployment offers.
 *
 * Each has to be configured in the Supabase dashboard as well - Google
 * needs OAuth credentials, phone needs a provider entry. Showing a
 * button for something unconfigured produces a confusing failure, so
 * both are off unless switched on explicitly.
 *
 * Referenced as full literals: Next.js inlines NEXT_PUBLIC_* at build
 * time and cannot resolve a computed lookup.
 */
export interface AuthMethods {
  password: true;
  google: boolean;
  phone: boolean;
}

export function authMethods(): AuthMethods {
  return {
    // Email and password is always available; it needs no provider setup.
    password: true,
    google: process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true",
    phone: process.env.NEXT_PUBLIC_AUTH_PHONE === "true",
  };
}
