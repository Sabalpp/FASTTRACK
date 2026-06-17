"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canViewCustomer } from "@/lib/access";
import { formatPhone } from "@/lib/phone";
import type { Customer } from "@/lib/types";

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const { currentUser } = useAuth();
  const data = useAppData();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);

  const visibleCustomers = useMemo(
    () => data.customers.filter((customer) => canViewCustomer(currentUser, customer, data.jobs)),
    [currentUser, data.customers, data.jobs]
  );

  useEffect(() => {
    let active = true;
    if (query.trim().length <= 1) {
      setResults([]);
      return;
    }

    void data.searchCustomers(query, visibleCustomers).then((customers) => {
      if (active) setResults(customers.slice(0, 6));
    });

    return () => {
      active = false;
    };
  }, [data, query, visibleCustomers]);

  return (
    <div className={`global-search ${compact ? "global-search-compact" : ""}`}>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search customers"
        aria-label="Universal customer search"
      />
      {results.length > 0 ? (
        <div className="search-results">
          {results.map((customer) => (
            <Link key={customer.id} href={`/customers/${customer.id}`} onClick={() => setQuery("")}> 
              <strong>{customer.name}</strong>
              <span>{formatPhone(customer.phone)} · {customer.city}, {customer.state} {customer.zip}</span>
              <small>{customer.addressLine1}</small>
            </Link>
          ))}
        </div>
      ) : query.trim().length > 1 ? (
        <div className="search-results search-results-empty">
          <span>No match.</span>
          {currentUser.role !== "tech" ? <Link href="/customers/new">Create new customer</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
