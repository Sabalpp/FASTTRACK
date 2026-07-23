export const branding = {
  businessName: "Fast Track Repair Service",
  tagline: "Appliance repair service",
  primaryColor: "#164e63",
  accentColor: "#f97316",
  phone: "(703) 899-5615",
  email: "info@fasttrackdmv.org",
  website: "www.fasttrackdmv.org",
  licenseNumber: "VA License #PLACEHOLDER",
  address: "13817 Fount Beattie Ct., Centreville, VA 20121",
  logoPath: "/brand/fast-track-logo.avif",
  // JPEG keeps the invoice logo compatible with react-pdf's server renderer
  // across Vercel and local PDF generation (indexed/transparent PNGs can drop
  // out of the rendered document).
  invoiceLogoPath: "/brand/fast-track-logo-pdf.jpg",
  taxRate: 0.06
};
