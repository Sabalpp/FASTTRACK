"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canViewCustomer } from "@/lib/access";
import { formatPhone } from "@/lib/phone";
import type { Customer } from "@/lib/types";

export function CustomerPicker({ onPick, selectedCustomer }: { onPick: (customer: Customer) => void; selectedCustomer?: Customer }) {
  const data = useAppData();
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);

  const visibleCustomers = useMemo(
    () => data.customers.filter((customer) => canViewCustomer(currentUser, customer, data.jobs)),
    [currentUser, data.customers, data.jobs]
  );

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    void data.searchCustomers(trimmed, visibleCustomers).then((customers) => {
      if (active) setResults(customers.slice(0, 8));
    });

    return () => {
      active = false;
    };
  }, [data, query, visibleCustomers]);

  return (
    <div className="customer-picker">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find customer by name, phone, or address" />
      {selectedCustomer ? (
        <div className="selected-customer">
          <strong>{selectedCustomer.name}</strong>
          <span>{formatPhone(selectedCustomer.phone)} · {selectedCustomer.addressLine1}, {selectedCustomer.city}</span>
        </div>
      ) : null}
      <div className="picker-results">
        {query.trim().length < 2 ? (
          <div className="picker-empty">
            <strong>Start with search</strong>
            <span>Type 2+ characters. Results stay filtered.</span>
          </div>
        ) : results.length === 0 ? (
          <div className="picker-empty">
            <strong>No match</strong>
            <span>Create the customer, then return here to schedule.</span>
            <Link href="/customers/new?next=job" className="button button-secondary">Create customer</Link>
          </div>
        ) : (
          results.map((customer) => (
            <button key={customer.id} type="button" onClick={() => onPick(customer)}>
              <strong>{customer.name}</strong>
              <span>{formatPhone(customer.phone)} · {customer.city}, {customer.state} {customer.zip}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
