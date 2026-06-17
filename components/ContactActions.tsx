"use client";

import { Mail, MapPinned, MessageSquare, Phone } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import type { Customer } from "@/lib/types";

function mapsHref(customer: Customer) {
  const address = [
    customer.addressLine1,
    customer.addressLine2,
    customer.city,
    customer.state,
    customer.zip
  ].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function ContactActions({ customer, subject }: { customer: Customer; subject?: string }) {
  const emailHref = customer.email
    ? `mailto:${customer.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`
    : undefined;

  return (
    <div className="contact-action-grid">
      <a className="contact-action" href={`tel:${customer.phoneDigits || customer.phone}`} aria-label={`Call ${customer.name}`}>
        <Phone size={17} aria-hidden="true" />
        <span>{formatPhone(customer.phone)}</span>
      </a>
      <a className="contact-action" href={`sms:${customer.phoneDigits || customer.phone}`} aria-label={`Text ${customer.name}`}>
        <MessageSquare size={17} aria-hidden="true" />
        <span>Text</span>
      </a>
      {emailHref ? (
        <a className="contact-action" href={emailHref} aria-label={`Email ${customer.name}`}>
          <Mail size={17} aria-hidden="true" />
          <span>Email</span>
        </a>
      ) : null}
      <a className="contact-action" href={mapsHref(customer)} target="_blank" rel="noreferrer" aria-label={`Open map for ${customer.name}`}>
        <MapPinned size={17} aria-hidden="true" />
        <span>Map</span>
      </a>
    </div>
  );
}
