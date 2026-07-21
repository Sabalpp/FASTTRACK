"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";
import { tierLabels, tierOptions } from "@/lib/data-store";
import { subtotalForTier } from "@/lib/invoice";
import { sameLineItemService } from "@/lib/line-items";
import { money } from "@/lib/money";
import type { JobLineItem, Tier } from "@/lib/types";
import styles from "./TierColumns.module.css";

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
  const [activeTier, setActiveTier] = useState<Tier>(() => firstOptionWithWork(items));
  const tierItems = items.filter((item) => item.tier === activeTier);
  const subtotal = subtotalForTier(items, activeTier);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  function moveItem(item: JobLineItem, nextTier: Tier) {
    if (!onEdit || nextTier === item.tier) return;
    const duplicateAtDestination = items.find((candidate) => (
      candidate.id !== item.id
      && candidate.jobId === item.jobId
      && candidate.tier === nextTier
      && sameLineItemService(candidate, item)
    ));
    if (duplicateAtDestination && onDelete) onDelete(duplicateAtDestination.id);
    onEdit(item.id, { tier: nextTier });
    setActiveTier(nextTier);
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.optionTabs} role="tablist" aria-label="Estimate option">
        {tierOptions.map((tier) => {
          const optionItems = items.filter((item) => item.tier === tier);
          const optionTotal = subtotalForTier(items, tier) * (1 + taxRate);
          const selected = activeTier === tier;
          return (
            <button
              id={`estimate-option-${tier}`}
              key={tier}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="active-estimate-option"
              className={selected ? styles.optionActive : undefined}
              onClick={() => setActiveTier(tier)}
            >
              <span>{tierLabels[tier]}</span>
              <strong>{optionItems.length > 0 ? money(optionTotal) : "No items"}</strong>
              <small>{optionItems.length} {optionItems.length === 1 ? "item" : "items"}</small>
            </button>
          );
        })}
      </div>

      <section
        id="active-estimate-option"
        className={styles.optionPanel}
        role="tabpanel"
        aria-labelledby={`estimate-option-${activeTier}`}
      >
        <header className={styles.optionHeader}>
          <div>
            <span>Estimate option</span>
            <h4>{tierLabels[activeTier]}</h4>
          </div>
          {tierItems.length > 0 ? <strong>{money(total)}</strong> : null}
        </header>

        {tierItems.length === 0 ? (
          <div className={styles.emptyOption}>
            <strong>No work in this option</strong>
            <span>Add a service above, or move an existing line here.</span>
          </div>
        ) : (
          <div className={styles.itemList}>
            {tierItems.map((item) => (
              <article className={styles.item} key={item.id}>
                <div className={styles.itemMain}>
                  <div>
                    {editable && onEdit ? (
                      <input
                        className={styles.descriptionInput}
                        aria-label={`Description for ${item.description}`}
                        value={item.description}
                        onChange={(event) => onEdit(item.id, { description: event.target.value })}
                      />
                    ) : <strong>{item.description}</strong>}
                    <small>{item.quantity} × {money(item.unitPrice)}</small>
                  </div>
                  <strong>{money(item.quantity * item.unitPrice)}</strong>
                </div>

                {editable && onEdit ? (
                  <details className={styles.editDetails}>
                    <summary><span>Edit line</span><ChevronDown size={16} aria-hidden="true" /></summary>
                    <div className={styles.editControls}>
                      <label>
                        <span>Quantity</span>
                        <input
                          aria-label={`Quantity for ${item.description}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) => onEdit(item.id, { quantity: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Unit price</span>
                        <input
                          aria-label={`Unit price for ${item.description}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) => onEdit(item.id, { unitPrice: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Move to</span>
                        <select
                          aria-label={`Move ${item.description} to estimate option`}
                          value={item.tier}
                          onChange={(event) => moveItem(item, event.target.value as Tier)}
                        >
                          {tierOptions.map((option) => <option key={option} value={option}>{tierLabels[option]}</option>)}
                        </select>
                      </label>
                      {onDelete ? (
                        <button className={styles.deleteButton} type="button" onClick={() => onDelete(item.id)}>
                          <Trash2 size={16} aria-hidden="true" />Remove line
                        </button>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {tierItems.length > 0 ? (
          <div className={styles.totals}>
            <span>Subtotal <strong>{money(subtotal)}</strong></span>
            <span>Tax <strong>{money(tax)}</strong></span>
            <span>Total <strong>{money(total)}</strong></span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function firstOptionWithWork(items: JobLineItem[]): Tier {
  return tierOptions.find((tier) => items.some((item) => item.tier === tier)) ?? "good";
}
