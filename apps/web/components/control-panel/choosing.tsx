"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogEntry } from "@/lib/api-client";
import { getCatalogEntries } from "@/lib/catalog";
import { useEditorStore } from "@/lib/store";

function groupByCategory(entries: readonly CatalogEntry[]): Map<string, CatalogEntry[]> {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.category) ?? [];
    group.push(entry);
    groups.set(entry.category, group);
  }
  return groups;
}

/** Current-catalog list, grouped by category, with a text filter. Picking an entry starts tuning. */
export function ChoosingPanel({ vmId }: { vmId: string }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const [filter, setFilter] = useState("");
  const filterId = useId();

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const all = getCatalogEntries();
    if (!query) return all;
    return all.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [filter]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  return (
    <div className="flex flex-col gap-3" data-testid="panel-choosing">
      <p className="text-sm text-muted-foreground">
        Choose an animation for <span className="font-mono text-xs">{vmId}</span>
      </p>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={filterId}>
        Filter
        <Input
          id={filterId}
          placeholder="Search animations…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No animations match &ldquo;{filter}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from(groups.entries()).map(([category, categoryEntries]) => (
            <div key={category} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground capitalize">{category}</h3>
              <ul className="flex flex-col gap-1">
                {categoryEntries.map((entry) => (
                  <li key={entry.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => dispatchPanel({ type: "PICK", animationId: entry.id })}
                    >
                      {entry.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => dispatchPanel({ type: "BACK" })}>
        Back
      </Button>
    </div>
  );
}
