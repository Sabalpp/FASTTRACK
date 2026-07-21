"use client";

import { ChevronDown, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { tierLabels, tierOptions } from "@/lib/data-store";
import { subtotalForTier } from "@/lib/invoice";
import { sameLineItemService } from "@/lib/line-items";
import { money } from "@/lib/money";
import type { JobLineItem, Tier } from "@/lib/types";
import styles from "./TierColumns.module.css";

type LineItemUpdate = (id: string, input: Partial<JobLineItem>) => Promise<void> | void;
type LineItemDelete = (id: string) => Promise<void> | void;

export function TierColumns({
  items,
  taxRate,
  onEdit,
  onDelete,
  editable = false,
  activeTier: controlledActiveTier,
  onActiveTierChange
}: {
  items: JobLineItem[];
  taxRate: number;
  onEdit?: LineItemUpdate;
  onDelete?: LineItemDelete;
  editable?: boolean;
  activeTier?: Tier;
  onActiveTierChange?: (tier: Tier) => void;
}) {
  const [internalActiveTier, setInternalActiveTier] = useState<Tier>(() => firstOptionWithWork(items));
  const activeTier = controlledActiveTier ?? internalActiveTier;
  const tierItems = items.filter((item) => item.tier === activeTier);
  const subtotal = subtotalForTier(items, activeTier);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  function selectTier(tier: Tier) {
    setInternalActiveTier(tier);
    onActiveTierChange?.(tier);
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
              onClick={() => selectTier(tier)}
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
              <LineItemRow
                key={item.id}
                item={item}
                items={items}
                editable={editable}
                onEdit={onEdit}
                onDelete={onDelete}
                onPersistedTier={selectTier}
              />
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

function LineItemRow({
  item,
  items,
  editable,
  onEdit,
  onDelete,
  onPersistedTier
}: {
  item: JobLineItem;
  items: JobLineItem[];
  editable: boolean;
  onEdit?: LineItemUpdate;
  onDelete?: LineItemDelete;
  onPersistedTier: (tier: Tier) => void;
}) {
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice));
  const [tier, setTier] = useState<Tier>(item.tier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDescription(item.description);
    setQuantity(String(item.quantity));
    setUnitPrice(String(item.unitPrice));
    setTier(item.tier);
    setError(undefined);
  }, [item.description, item.id, item.quantity, item.tier, item.unitPrice]);

  const parsedQuantity = Number(quantity);
  const parsedUnitPrice = Number(unitPrice);
  const dirty = description.trim() !== item.description
    || parsedQuantity !== item.quantity
    || parsedUnitPrice !== item.unitPrice
    || tier !== item.tier;

  async function saveChanges() {
    if (!onEdit || busy || !dirty) return;
    const nextDescription = description.trim();
    if (!nextDescription) {
      setError("Enter a description before saving this line.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
      setError("Unit price must be zero or greater.");
      return;
    }

    const duplicateAtDestination = items.find((candidate) => (
      candidate.id !== item.id
      && candidate.jobId === item.jobId
      && candidate.tier === tier
      && sameLineItemService(candidate, { ...item, description: nextDescription })
    ));
    if (duplicateAtDestination && !onDelete) {
      setError("This service already exists in that option and cannot be merged here.");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      if (duplicateAtDestination && onDelete) await onDelete(duplicateAtDestination.id);
      await onEdit(item.id, {
        description: nextDescription,
        quantity: parsedQuantity,
        unitPrice: parsedUnitPrice,
        tier
      });
      onPersistedTier(tier);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The line changes could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLine() {
    if (!onDelete || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(item.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The line could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.item}>
      <div className={styles.itemMain}>
        <div>
          <strong>{item.description}</strong>
          <small>{item.quantity} × {money(item.unitPrice)}</small>
        </div>
        <strong>{money(item.quantity * item.unitPrice)}</strong>
      </div>

      {editable && onEdit ? (
        <details className={styles.editDetails}>
          <summary><span>Edit line</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className={styles.editControls}>
            <label className={styles.descriptionField}>
              <span>Description</span>
              <input
                aria-label={`Description for ${item.description}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <span>Quantity</span>
              <input
                aria-label={`Quantity for ${item.description}`}
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <span>Unit price</span>
              <input
                aria-label={`Unit price for ${item.description}`}
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <span>Move to</span>
              <select
                aria-label={`Move ${item.description} to estimate option`}
                value={tier}
                onChange={(event) => setTier(event.target.value as Tier)}
                disabled={busy}
              >
                {tierOptions.map((option) => <option key={option} value={option}>{tierLabels[option]}</option>)}
              </select>
            </label>
            <div className={styles.editActions}>
              <button className={styles.saveButton} type="button" onClick={() => void saveChanges()} disabled={busy || !dirty}>
                <Save size={16} aria-hidden="true" />{busy ? "Saving…" : "Save changes"}
              </button>
              {onDelete ? (
                <button className={styles.deleteButton} type="button" onClick={() => void removeLine()} disabled={busy}>
                  <Trash2 size={16} aria-hidden="true" />Remove line
                </button>
              ) : null}
            </div>
            {error ? <p className={styles.editError} role="alert">{error}</p> : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function firstOptionWithWork(items: JobLineItem[]): Tier {
  return tierOptions.find((tier) => items.some((item) => item.tier === tier)) ?? "standard";
}
