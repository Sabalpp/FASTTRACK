export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
export const googleAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH !== "false";
export const ownerMfaRequired = process.env.NEXT_PUBLIC_REQUIRE_OWNER_MFA === "true";
