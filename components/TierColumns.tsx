"use client";

import { tierLabels, tierOptions } from "@/lib/data-store";
import { subtotalForTier } from "@/lib/invoice";
import { money } from "@/lib/money";
import type { JobLineItem, Tier } from "@/lib/types";

export function TierColumns({
  items,
  taxRate,
  onEdit,
  onDelete,
  editable = false
}: {
  items: JobLineItem[];
  taxRate: number;
  onEdit?: (id: string, input: Partial<JobLineItem>) => void;
  onDelete?: (id: string) => void;
  editable?: boolean;
}) {
  return (
    <div className="tier-grid">
      {tierOptions.map((tier) => {
        const tierItems = items.filter((item) => item.tier === tier);
        const subtotal = subtotalForTier(items, tier);
        const tax = subtotal * taxRate;
        const total = subtotal + tax;
        return (
          <div className="tier-card" key={tier}>
            <div className="tier-head">
              <span>{tierLabels[tier]}</span>
              <strong>{money(total)}</strong>
            </div>
            {tierItems.length === 0 ? (
              <p className="muted">No {tierLabels[tier].toLowerCase()} items yet.</p>
            ) : (
              <div className="line-items-list">
                {tierItems.map((item) => (
                  <div key={item.id} className={`line-item-row ${editable ? "line-item-row-editable" : ""}`}>
                    {editable && onEdit ? (
                      <div className="line-item-edit-grid">
                        <input
                          aria-label="Line item description"
                          value={item.description}
                          onChange={(event) => onEdit(item.id, { description: event.target.value })}
                        />
                        <input
                          aria-label="Quantity"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) => onEdit(item.id, { quantity: Number(event.target.value) })}
                        />
                        <input
                          aria-label="Unit price"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) => onEdit(item.id, { unitPrice: Number(event.target.value) })}
                        />
                        <select
                          aria-label="Tier"
                          value={item.tier}
                          onChange={(event) => onEdit(item.id, { tier: event.target.value as Tier })}
                        >
                          {tierOptions.map((option) => <option key={option} value={option}>{tierLabels[option]}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <strong>{item.description}</strong>
                        <small>{item.quantity} × {money(item.unitPrice)}</small>
                      </div>
                    )}
                    <span className="line-item-amount">{money(item.quantity * item.unitPrice)}</span>
                    {editable && onDelete ? <button type="button" className="mini-button" onClick={() => onDelete(item.id)}>Remove</button> : null}
                  </div>
                ))}
              </div>
            )}
            <div className="tier-totals">
              <span>Subtotal <strong>{money(subtotal)}</strong></span>
              <span>Tax <strong>{money(tax)}</strong></span>
              <span>Total <strong>{money(total)}</strong></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
