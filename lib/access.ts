import type { AllowedUser, Customer, Invoice, Job, Role } from "@/lib/types";

export function isOwner(role: Role): boolean {
  return role === "owner";
}

export function canSeeMoney(role: Role): boolean {
  return role === "owner" || role === "tech";
}

export function canSeePhotos(role: Role): boolean {
  return role === "owner" || role === "tech";
}

export function canManageParts(role: Role): boolean {
  return role === "owner";
}

export function canSendInvoices(role: Role): boolean {
  return role === "owner";
}

export function canScheduleJobs(role: Role): boolean {
  return role === "owner" || role === "call_center";
}

export function canCreateCustomers(role: Role): boolean {
  return role === "owner" || role === "call_center" || role === "tech";
}

export function canEditCustomers(role: Role): boolean {
  return role === "owner" || role === "call_center";
}

export function canDeleteCustomers(role: Role): boolean {
  return role === "owner";
}

export function canManageUsers(role: Role): boolean {
  return role === "owner";
}

export function canViewJob(user: AllowedUser, job: Job): boolean {
  if (user.role === "owner" || user.role === "call_center") return true;
  return job.assignedTechId === user.id;
}

export function canViewCustomer(user: AllowedUser, customer: Customer, jobs: Job[]): boolean {
  if (user.role === "owner" || user.role === "call_center") return true;
  if (customer.createdBy === user.id) return true;
  return jobs.some((job) => job.customerId === customer.id && job.assignedTechId === user.id);
}

export function canViewInvoice(user: AllowedUser, invoice: Invoice, jobs: Job[]): boolean {
  if (user.role === "owner") return true;
  if (user.role === "call_center") return false;
  const job = jobs.find((candidate) => candidate.id === invoice.jobId);
  return job?.assignedTechId === user.id;
}
