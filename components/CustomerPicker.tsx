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
  const [searching, setSearching] = useState(false);

  const visibleCustomers = useMemo(
    () => data.customers.filter((customer) => canViewCustomer(currentUser, customer, data.jobs)),
    [currentUser, data.customers, data.jobs]
  );

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timeout = window.setTimeout(() => {
      void data.searchCustomers(trimmed, visibleCustomers)
        .then((customers) => {
          if (active) setResults(customers.slice(0, 8));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [data, query, visibleCustomers]);

  return (
    <div className="customer-picker">
      <div className="customer-search-box">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search caller name, phone, address"
          autoComplete="off"
        />
        {searching ? <span className="customer-search-busy" aria-hidden="true" /> : null}
        {query.trim().length >= 2 ? (
          <div className="picker-results" role="listbox">
            {results.length === 0 && !searching ? (
              <div className="picker-empty">
                <strong>No match</strong>
                <span>Create the customer record, then schedule the call.</span>
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
        ) : null}
      </div>
      {selectedCustomer ? (
        <div className="selected-customer">
          <strong>{selectedCustomer.name}</strong>
          <span>{formatPhone(selectedCustomer.phone)} · {selectedCustomer.addressLine1}, {selectedCustomer.city}</span>
        </div>
      ) : null}
    </div>
  );
}
