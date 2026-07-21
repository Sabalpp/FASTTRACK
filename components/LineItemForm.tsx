"use client";

import { useState } from "react";
import { Button, Field, TwoColumn } from "@/components/ui";
import { tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { sameLineItemService } from "@/lib/line-items";
import type { Tier } from "@/lib/types";

export function LineItemForm({ jobId, onSaved }: { jobId: string; onSaved?: (tier: Tier) => void }) {
  const data = useAppData();
  const activeParts = data.parts.filter((part) => part.active);
  const [partId, setPartId] = useState(activeParts[0]?.id ?? "manual");
  const selectedPart = activeParts.find((part) => part.id === partId);
  const [description, setDescription] = useState(selectedPart?.name ?? "");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState(String(selectedPart?.defaultPrice ?? 0));
  const [tier, setTier] = useState<Tier>("standard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handlePartChange(value: string) {
    setPartId(value);
    const nextPart = activeParts.find((part) => part.id === value);
    if (nextPart) {
      setDescription(nextPart.name);
      setUnitPrice(String(nextPart.defaultPrice));
    } else {
      setDescription("");
      setUnitPrice("0");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const nextQuantity = Number(quantity);
    const nextUnitPrice = Number(unitPrice);
    if (!description.trim()) {
      setError("Enter a description before saving this line item.");
      return;
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(nextUnitPrice) || nextUnitPrice < 0) {
      setError("Unit price must be zero or greater.");
      return;
    }
    const nextItem = {
      jobId,
      partId: selectedPart?.id,
      description: description.trim(),
      quantity: nextQuantity,
      unitPrice: nextUnitPrice,
      tier,
      isManual: !selectedPart
    };
    const matchingItems = data.jobLineItems.filter((item) => (
      item.jobId === jobId
      && sameLineItemService(item, nextItem)
    ));
    const [matchingItem, ...duplicateItems] = matchingItems;
    setSaving(true);
    setError(undefined);
    try {
      if (matchingItem) {
        await data.updateLineItem(matchingItem.id, nextItem);
        for (const item of duplicateItems) await data.deleteLineItem(item.id);
      } else {
        await data.addLineItem(nextItem);
      }
      onSaved?.(tier);
      setDescription(selectedPart?.name ?? "");
      setQuantity("1");
      setUnitPrice(String(selectedPart?.defaultPrice ?? 0));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The line item could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack line-item-entry-form" onSubmit={(event) => void submit(event)}>
      <TwoColumn>
        <Field label="Part or service">
          <select value={partId} onChange={(event) => handlePartChange(event.target.value)}>
            {activeParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
            <option value="manual">Custom item</option>
          </select>
        </Field>
        <Field label="Estimate option">
          <select value={tier} onChange={(event) => setTier(event.target.value as Tier)}>
            {tierOptions.map((option) => <option key={option} value={option}>{tierLabels[option]}</option>)}
          </select>
          <small className="muted">Use Standard for one straightforward scope. Good, Better, and Best are optional customer choices.</small>
        </Field>
      </TwoColumn>
      <Field label="Description">
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Diagnostic, repair, part, labor, or recommendation" />
      </Field>
      <TwoColumn>
        <Field label="Quantity">
          <input type="number" step="0.01" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="Unit price ($)">
          <div className="money-input">
            <span>$</span>
            <input aria-label="Unit price ($)" type="number" step="0.01" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
          </div>
        </Field>
      </TwoColumn>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <Button type="submit" disabled={saving}>{saving ? "Saving line item…" : "Save line item"}</Button>
    </form>
  );
}
