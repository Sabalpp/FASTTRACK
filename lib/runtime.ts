const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

const isProductionBuild = process.env.NODE_ENV === "production";
const explicitDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const localFallbackDemoMode = !hasSupabaseBrowserConfig && process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

// An explicit flag is allowed in hosted builds so the production-shaped Vercel
// deployment can be used as a temporary, browser-local acceptance sandbox.
// The automatic fallback remains development-only to prevent a missing
// Supabase variable from silently exposing demo access in production.
export const demoMode = explicitDemoMode || (!isProductionBuild && localFallbackDemoMode);
export const googleAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH !== "false";
export const ownerMfaRequired = process.env.NEXT_PUBLIC_REQUIRE_OWNER_MFA === "true";
