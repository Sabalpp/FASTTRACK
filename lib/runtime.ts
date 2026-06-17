const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

const isProductionBuild = process.env.NODE_ENV === "production";
const explicitDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const localFallbackDemoMode = !hasSupabaseBrowserConfig && process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

export const demoMode = !isProductionBuild && (explicitDemoMode || localFallbackDemoMode);
export const googleAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH !== "false";
export const ownerMfaRequired = process.env.NEXT_PUBLIC_REQUIRE_OWNER_MFA === "true";
