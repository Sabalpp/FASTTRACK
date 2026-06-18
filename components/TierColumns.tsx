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
    <div className="tier-grid estimate-tier-grid">
      {tierOptions.map((tier) => {
        const tierItems = items.filter((item) => item.tier === tier);
        const subtotal = subtotalForTier(items, tier);
        const tax = subtotal * taxRate;
        const total = subtotal + tax;
        return (
          <div className={`tier-card estimate-tier-card ${tierItems.length === 0 ? "tier-card-empty" : ""}`} key={tier}>
            <div className="tier-head">
              <div>
                <span>{tierLabels[tier]}</span>
                <small>{tierItems.length} item{tierItems.length === 1 ? "" : "s"}</small>
              </div>
              {tierItems.length > 0 ? <strong>{money(total)}</strong> : null}
            </div>
            {tierItems.length === 0 ? (
              <p className="muted">Add an item when this option needs work.</p>
            ) : (
              <div className="line-items-list">
                {tierItems.map((item) => (
                  <div key={item.id} className={`line-item-row estimate-line-item ${editable ? "line-item-row-editable" : ""}`}>
                    {editable && onEdit ? (
                      <div className="estimate-line-editor">
                        <input
                          className="line-description-input"
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
                        <div className="money-input compact-money-input">
                          <span>$</span>
                          <input
                            aria-label="Unit price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(event) => onEdit(item.id, { unitPrice: Number(event.target.value) })}
                          />
                        </div>
                        <div className="segmented-control tier-move-segments" aria-label="Move item to option">
                          {tierOptions.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={item.tier === option ? "active" : ""}
                              onClick={() => onEdit(item.id, { tier: option as Tier })}
                            >
                              {tierLabels[option]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <strong>{item.description}</strong>
                        <small>{item.quantity} × {money(item.unitPrice)}</small>
                      </div>
                    )}
                    <div className="line-item-actions">
                      <span className="line-item-amount">{money(item.quantity * item.unitPrice)}</span>
                      {editable && onDelete ? <button type="button" className="mini-button" onClick={() => onDelete(item.id)}>Remove</button> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tierItems.length > 0 ? (
              <div className="tier-totals">
                <span>Subtotal <strong>{money(subtotal)}</strong></span>
                <span>Tax <strong>{money(tax)}</strong></span>
                <span>Total <strong>{money(total)}</strong></span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
