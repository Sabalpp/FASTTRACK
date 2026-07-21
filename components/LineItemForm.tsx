"use client";

import { useState } from "react";
import { Button, Field, TwoColumn } from "@/components/ui";
import { tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { sameLineItemService } from "@/lib/line-items";
import type { Tier } from "@/lib/types";

export function LineItemForm({ jobId }: { jobId: string }) {
  const data = useAppData();
  const activeParts = data.parts.filter((part) => part.active);
  const [partId, setPartId] = useState(activeParts[0]?.id ?? "manual");
  const selectedPart = activeParts.find((part) => part.id === partId);
  const [description, setDescription] = useState(selectedPart?.name ?? "");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState(String(selectedPart?.defaultPrice ?? 0));
  const [tier, setTier] = useState<Tier>("good");

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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    const nextItem = {
      jobId,
      partId: selectedPart?.id,
      description: description.trim(),
      quantity: Number(quantity),
      unitPrice: Number(unitPrice),
      tier,
      isManual: !selectedPart
    };
    const matchingItems = data.jobLineItems.filter((item) => (
      item.jobId === jobId
      && sameLineItemService(item, nextItem)
    ));
    const [matchingItem, ...duplicateItems] = matchingItems;
    if (matchingItem) {
      data.updateLineItem(matchingItem.id, nextItem);
      duplicateItems.forEach((item) => data.deleteLineItem(item.id));
    } else {
      data.addLineItem(nextItem);
    }
    setDescription(selectedPart?.name ?? "");
    setQuantity("1");
    setUnitPrice(String(selectedPart?.defaultPrice ?? 0));
  }

  return (
    <form className="stack line-item-entry-form" onSubmit={submit}>
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
            <input type="number" step="0.01" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
          </div>
        </Field>
      </TwoColumn>
      <Button type="submit">Save line item</Button>
    </form>
  );
}
