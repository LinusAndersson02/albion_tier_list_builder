import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";

import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

const TIERS = ["S", "A", "B", "C", "D"];
const ALL_BUCKETS = ["POOL", ...TIERS];

const SLOT_ORDER = [
  { key: "main", label: "Main / 2H" },
  { key: "off", label: "Off" },
  { key: "head", label: "Helmet" },
  { key: "armor", label: "Armor" },
  { key: "shoes", label: "Boots" },
  { key: "cape", label: "Cape" },
  { key: "food", label: "Food" },
  { key: "potion", label: "Potion" },
];

const SLOT_ID_RULES = {
  main: /_MAIN_|_2H_/i,
  off: /_OFF_/i,
  head: /_HEAD_/i,
  armor: /_ARMOR_/i,
  shoes: /_SHOES_/i,
  cape: /_CAPEITEM_/i,
  food: /_MEAL_/i,
  potion: /_POTION_/i,
};

// render service doesn't need @ encoded; keep @ as-is
function iconUrl(identifier, size = 64) {
  if (!identifier) return "";
  const encoded = encodeURIComponent(identifier.trim()).replace(/%40/g, "@");
  return `https://render.albiononline.com/v1/item/${encoded}.png?locale=en&size=${size}`;
}

function parseItemsTxt(text) {
  const items = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const idMatch = line.match(/\bT\d+_[A-Z0-9_]+(?:@\d+)?\b/);
    if (!idMatch) continue;

    const id = idMatch[0];
    const parts = line.split(":");
    const name = (parts.length >= 2 ? parts[parts.length - 1] : id).trim() || id;

    items.push({ id, name });
  }
  return items;
}

function ItemPicker({ label, items, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    const found = items.find((x) => x.id === value);
    setQuery(found ? `${found.name} (${found.id})` : value);
  }, [value, items]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 20);
    return items
      .filter((x) => x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, items]);

  return (
    <div className="Picker">
      <div className="PickerLabel">{label}</div>

      <div className="PickerRow">
        <input
          className="PickerInput"
          value={query}
          placeholder={`Search ${label}…`}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {value ? (
          <button
            className="Btn BtnGhost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        ) : null}
      </div>

      {open && matches.length > 0 ? (
        <div className="PickerDropdown">
          {matches.map((m) => (
            <button
              key={m.id}
              className="PickerOption"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(m.id)}
              title={m.id}
            >
              <img className="Icon" src={iconUrl(m.id, 48)} alt="" loading="lazy" />
              <div className="PickerOptionText">
                <div className="PickerOptionName">{m.name}</div>
                <div className="PickerOptionId">{m.id}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BuildStrip({ build, showDelete, onRemove }) {
  return (
    <div className="BuildStrip">
      {SLOT_ORDER.map((s) => (
        <div key={s.key} className="Slot" title={s.label}>
          {build.slots[s.key] ? (
            <img className="Icon" src={iconUrl(build.slots[s.key], 64)} alt={s.label} loading="lazy" />
          ) : (
            <div className="SlotEmpty">{s.label}</div>
          )}
        </div>
      ))}

      {showDelete ? (
        <button className="BuildDelete" onClick={() => onRemove(build.id)} title="Delete build">
          ✕
        </button>
      ) : null}
    </div>
  );
}

function SortableBuild({ build, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: build.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BuildStrip build={build} showDelete onRemove={onRemove} />
    </div>
  );
}

function TierDropZone({ tierId, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: tierId });
  return (
    <div ref={setNodeRef} className={`TierBuilds ${isOver ? "TierBuildsOver" : ""}`}>
      {children}
    </div>
  );
}

export default function App() {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // items
  const [allItems, setAllItems] = useState([]);
  const [itemsError, setItemsError] = useState("");

  // build form (no name, no tier dropdown; always goes into POOL)
  const [buildForm, setBuildForm] = useState({
    slots: {
      main: "",
      off: "",
      head: "",
      armor: "",
      shoes: "",
      cape: "",
      food: "",
      potion: "",
    },
  });

  // state: builds map + tier arrays
  const [buildsById, setBuildsById] = useState({});
  const [tierBuildIds, setTierBuildIds] = useState(() => {
    // init with empty structure
    const base = Object.fromEntries(ALL_BUCKETS.map((t) => [t, []]));
    return base;
  });

  // Drag overlay current build id
  const [activeId, setActiveId] = useState(null);

  // Load saved
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tierlist_state_v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.buildsById && parsed?.tierBuildIds) {
        setBuildsById(parsed.buildsById);
        // ensure missing tiers exist
        const base = Object.fromEntries(ALL_BUCKETS.map((t) => [t, []]));
        for (const t of ALL_BUCKETS) base[t] = parsed.tierBuildIds[t] || [];
        setTierBuildIds(base);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save
  useEffect(() => {
    localStorage.setItem("tierlist_state_v2", JSON.stringify({ buildsById, tierBuildIds }));
  }, [buildsById, tierBuildIds]);

  // Load items file
  useEffect(() => {
    fetch("/items.txt")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => setAllItems(parseItemsTxt(txt)))
      .catch((e) => setItemsError(String(e)));
  }, []);

  const itemsBySlot = useMemo(() => {
    const bySlot = {};
    for (const slot of Object.keys(SLOT_ID_RULES)) {
      const rule = SLOT_ID_RULES[slot];
      bySlot[slot] = allItems.filter((it) => rule.test(it.id));
    }
    return bySlot;
  }, [allItems]);

  const activeBuild = activeId ? buildsById[activeId] : null;

  function setSlot(slotKey, itemId) {
    setBuildForm((prev) => ({
      ...prev,
      slots: { ...prev.slots, [slotKey]: itemId },
    }));
  }

  function addBuild() {
    if (!buildForm.slots.main) return;

    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const build = { id, slots: { ...buildForm.slots } };

    setBuildsById((prev) => ({ ...prev, [id]: build }));
    setTierBuildIds((prev) => ({ ...prev, POOL: [id, ...prev.POOL] }));

    // reset
    setBuildForm({
      slots: { main: "", off: "", head: "", armor: "", shoes: "", cape: "", food: "", potion: "" },
    });
  }

  function removeBuild(id) {
    setBuildsById((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setTierBuildIds((prev) => {
      const next = {};
      for (const t of ALL_BUCKETS) next[t] = prev[t].filter((x) => x !== id);
      return next;
    });
  }

  function findContainer(id) {
    if (!id) return null;
    if (ALL_BUCKETS.includes(id)) return id;
    for (const t of ALL_BUCKETS) {
      if (tierBuildIds[t].includes(id)) return t;
    }
    return null;
  }

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeContainer = findContainer(active.id);
    const overContainer = findContainer(over.id);

    if (!activeContainer || !overContainer) return;

    if (activeContainer === overContainer) {
      // reorder within same tier
      const oldIndex = tierBuildIds[activeContainer].indexOf(active.id);
      const newIndex = tierBuildIds[overContainer].indexOf(over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      setTierBuildIds((prev) => ({
        ...prev,
        [activeContainer]: arrayMove(prev[activeContainer], oldIndex, newIndex),
      }));
      return;
    }

    // move to a different tier
    setTierBuildIds((prev) => {
      const from = prev[activeContainer];
      const to = prev[overContainer];

      const fromIndex = from.indexOf(active.id);
      if (fromIndex === -1) return prev;

      const nextFrom = from.filter((x) => x !== active.id);

      // If "over" is a tier container id, drop at end
      const overIsContainer = ALL_BUCKETS.includes(over.id);
      const toIndex = overIsContainer ? to.length : to.indexOf(over.id);

      const insertIndex = toIndex < 0 ? to.length : toIndex;
      const nextTo = [...to.slice(0, insertIndex), active.id, ...to.slice(insertIndex)];

      return {
        ...prev,
        [activeContainer]: nextFrom,
        [overContainer]: nextTo,
      };
    });
  }

  return (
    <div className="AppShell">
      <header className="Header">
        <div className="HeaderTitle">Albion Tier List Builder</div>
        <div className="HeaderSub">Drag builds between POOL, S, A, B, C, D.</div>
      </header>

      <main className="Main">
        <section className="Card">
          <div className="CardTitle">Create a build</div>

          {itemsError ? (
            <div className="Error">
              Couldn’t load <code>/items_cleaned.txt</code>: {itemsError}
              <div className="Hint">
                Make sure the file exists at <code>public/items_cleaned.txt</code>.
              </div>
            </div>
          ) : null}

          <div className="FormRowSimple">
            <button className="Btn BtnPrimary" onClick={addBuild} disabled={!buildForm.slots.main}>
              Add build to Pool
            </button>

            <div className="BuildPreview">
              <BuildStrip build={{ id: "preview", slots: buildForm.slots }} showDelete={false} />
            </div>
          </div>

          <div className="PickersGrid">
            {SLOT_ORDER.map((s) => (
              <ItemPicker
                key={s.key}
                label={s.label}
                items={itemsBySlot[s.key] || []}
                value={buildForm.slots[s.key]}
                onChange={(id) => setSlot(s.key, id)}
              />
            ))}
          </div>
        </section>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="TierBoard">
            {ALL_BUCKETS.map((tier) => (
              <div key={tier} className="TierRow">
                <div className={`TierLabel ${tier === "POOL" ? "TierLabelPool" : `TierLabel${tier}`}`}>
                  {tier}
                </div>

                <TierDropZone tierId={tier}>
                  <SortableContext items={tierBuildIds[tier]} strategy={rectSortingStrategy}>
                    {tierBuildIds[tier].map((id) => (
                      <SortableBuild key={id} build={buildsById[id]} onRemove={removeBuild} />
                    ))}
                  </SortableContext>

                  {tierBuildIds[tier].length === 0 ? (
                    <div className="TierEmpty">
                      {tier === "POOL" ? "Add a build, then drag it to a tier." : "Drop builds here."}
                    </div>
                  ) : null}
                </TierDropZone>
              </div>
            ))}
          </section>

          <DragOverlay>
            {activeBuild ? <BuildStrip build={activeBuild} showDelete={false} /> : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
}
