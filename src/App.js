import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import Fuse from "fuse.js";

import {
  DndContext,
  pointerWithin,
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

// abilities enabled on these slots only
const ABILITY_SLOTS = ["main", "head", "armor", "shoes"];

const STORAGE_KEY = "tierlist_state_v7";
const LEGACY_KEYS = ["tierlist_state_v6", "tierlist_state_v5", "tierlist_state_v4"];

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function iconUrl(identifier, size = 96) {
  if (!identifier) return "";
  const encoded = encodeURIComponent(identifier.trim()).replace(/%40/g, "@");
  return `https://render.albiononline.com/v1/item/${encoded}.png?locale=en&size=${size}`;
}

function defaultTierBuildIds() {
  return Object.fromEntries(TIERS.map((t) => [t, []]));
}

function defaultSlots() {
  return Object.fromEntries(SLOT_ORDER.map((s) => [s.key, ""]));
}

function defaultAbilities() {
  return Object.fromEntries(ABILITY_SLOTS.map((k) => [k, []]));
}

function sanitizeBuild(build) {
  const slots = { ...defaultSlots(), ...(build?.slots || {}) };

  const rawAbilities = build?.abilities && typeof build.abilities === "object" ? build.abilities : {};
  const abilities = { ...defaultAbilities() };
  for (const k of ABILITY_SLOTS) {
    const arr = rawAbilities[k];
    abilities[k] = Array.isArray(arr) ? arr.slice(0, 3) : [];
  }

  return {
    id: build?.id,
    slots,
    abilities,
  };
}

function normalizeState(parsed) {
  const buildsById = {};
  const incomingBuilds =
    parsed?.buildsById && typeof parsed.buildsById === "object" ? parsed.buildsById : {};

  for (const [id, b] of Object.entries(incomingBuilds)) {
    buildsById[id] = sanitizeBuild({ ...b, id });
  }

  const tierBuildIds = defaultTierBuildIds();
  const incomingTiers =
    parsed?.tierBuildIds && typeof parsed.tierBuildIds === "object" ? parsed.tierBuildIds : {};

  for (const t of TIERS) {
    const arr = incomingTiers[t];
    tierBuildIds[t] = Array.isArray(arr) ? arr.filter((id) => !!buildsById[id]) : [];
  }

  let selectedBuildId = parsed?.selectedBuildId || null;
  if (selectedBuildId && !buildsById[selectedBuildId]) selectedBuildId = null;

  return { buildsById, tierBuildIds, selectedBuildId };
}

function loadPersistedState() {
  const fallback = {
    buildsById: {},
    tierBuildIds: defaultTierBuildIds(),
    selectedBuildId: null,
  };

  try {
    const tryKeys = [STORAGE_KEY, ...LEGACY_KEYS];
    for (const key of tryKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Parse items.txt lines, and SKIP enchanted (@X) */
function parseItemsTxt(text) {
  const items = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const idMatch = line.match(/\bT\d+_[A-Z0-9_]+(?:@\d+)?\b/);
    if (!idMatch) continue;

    const id = idMatch[0];
    if (/@\d+/.test(id)) continue;

    const tierMatch = id.match(/^T(\d+)_/i);
    const tier = tierMatch ? Number(tierMatch[1]) : null;

    const parts = line.split(":");
    const name = (parts.length >= 2 ? parts[parts.length - 1] : id).trim() || id;

    items.push({ id, name, tier, enchant: 0 });
  }

  return items;
}

// Tokens: Q1 W2 P2 (also R1, E3, etc.). Max 3.
function parseAbilityTokens(raw) {
  const matches = raw.toUpperCase().match(/[A-Z]\d+/g) || [];
  return matches.slice(0, 3);
}

function parseTierEnchant(raw) {
  let q = raw.trim().toLowerCase();
  let tier = null;
  let enchant = null;

  const m = q.match(/(?:^|\s)t?(\d{1,2})\s*[.@]\s*(\d)(?:\s|$)/);
  if (m) {
    tier = Number(m[1]);
    enchant = Number(m[2]);
    q = q.replace(m[0], " ");
  }

  const t = q.match(/(?:^|\s)t(\d{1,2})(?:\s|$)/);
  if (t) {
    tier = Number(t[1]);
    q = q.replace(t[0], " ");
  } else {
    const t2 = q.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
    if (t2) {
      tier = Number(t2[1]);
      q = q.replace(t2[0], " ");
    }
  }

  const e = q.match(/@(\d)(?:\s|$)/);
  if (e) {
    enchant = Number(e[1]);
    q = q.replace(e[0], " ");
  }

  const text = q.replace(/\s+/g, " ").trim();
  return { text, tier, enchant };
}

function ItemPicker({ label, items, value, onChange, children }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const fuse = useMemo(() => {
    return new Fuse(items, {
      keys: ["name", "id"],
      threshold: 0.38,
      ignoreLocation: true,
    });
  }, [items]);

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    const found = items.find((x) => x.id === value);
    setQuery(found ? found.name : "");
  }, [value, items]);

  const matches = useMemo(() => {
    const { text, tier, enchant } = parseTierEnchant(query);

    let base = text ? fuse.search(text).map((r) => r.item) : items;

    let filtered = base;
    if (tier != null) filtered = filtered.filter((x) => x.tier === tier);
    if (enchant != null) filtered = filtered.filter((x) => x.enchant === enchant);

    if (filtered.length === 0 && enchant != null) {
      filtered = base;
      if (tier != null) filtered = filtered.filter((x) => x.tier === tier);
    }

    if (text && base.length === 0) {
      const t = text.toLowerCase();
      filtered = items.filter(
        (x) => x.name.toLowerCase().includes(t) || x.id.toLowerCase().includes(t)
      );
      if (tier != null) filtered = filtered.filter((x) => x.tier === tier);
      if (enchant != null) filtered = filtered.filter((x) => x.enchant === enchant);
    }

    return filtered.slice(0, 30);
  }, [query, fuse, items]);

  function handleSelect(item) {
    onChange(item.id);
    setQuery(item.name);
    setOpen(false);
    setTimeout(() => inputRef.current?.blur(), 0);
  }

  return (
    <div className="Picker">
      <div className="PickerLabel">{label}</div>

      <div className="PickerRow">
        <input
          ref={inputRef}
          className="PickerInput"
          value={query}
          placeholder={`Search ${label}… (e.g. "incubus 7.2")`}
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

      {children}

      {open ? (
        matches.length > 0 ? (
          <div className="PickerDropdown">
            {matches.map((m) => (
              <button
                key={m.id}
                className="PickerOption"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(m)}
                title={m.id}
              >
                <img className="PickerIcon" src={iconUrl(m.id, 56)} alt="" loading="lazy" />
                <div className="PickerOptionText">
                  <div className="PickerOptionName">{m.name}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="PickerDropdown">
            <div style={{ padding: 10, color: "rgba(255,255,255,0.6)" }}>No matches.</div>
          </div>
        )
      ) : null}
    </div>
  );
}

function AbilitiesInput({ enabled, disabled, valueTokens, onChangeTokens }) {
  const [raw, setRaw] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  // ✅ Only sync from tokens when NOT actively typing (prevents "can't type" bug)
  useEffect(() => {
    if (isFocused) return;
    setRaw((valueTokens || []).join(" "));
  }, [valueTokens, isFocused]);

  if (!enabled) return null;

  return (
    <div className="AbilityEditorRow">
      <div className="AbilityEditorLabel">Abilities</div>
      <input
        className="AbilityEditorInput"
        disabled={disabled}
        value={raw}
        placeholder={disabled ? "Select an item first…" : 'e.g. "Q1 W2 P2"'}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          // normalize display on blur
          setRaw((valueTokens || []).join(" "));
        }}
        onChange={(e) => {
          const nextRaw = e.target.value;
          setRaw(nextRaw);

          // ✅ Allow typing partial tokens without wiping:
          // - if user clears input -> clear tokens
          // - otherwise only update tokens when we have at least one complete token
          const trimmed = nextRaw.trim();
          if (trimmed === "") {
            onChangeTokens([]);
            return;
          }

          const parsed = parseAbilityTokens(nextRaw);
          if (parsed.length > 0) onChangeTokens(parsed);
        }}
      />
    </div>
  );
}

function AbilityPills({ tokens }) {
  const safe = Array.isArray(tokens) ? tokens.filter(Boolean).slice(0, 3) : [];
  if (safe.length === 0) return null; // ✅ do not render if empty

  return (
    <div className="AbilityPillRow" aria-hidden="true">
      {safe.map((t, i) => (
        <span key={i} className="AbilityPill">
          {t}
        </span>
      ))}
    </div>
  );
}

function BuildStrip({
  build,
  selected,
  onSelect,
  showActions,
  onDuplicate,
  onRemove,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
  className = "",
}) {
  return (
    <div
      className={`BuildStrip ${selected ? "BuildStripSelected" : ""} ${className}`}
      onClick={onSelect}
      title="Click to select / edit"
    >
      <button
        ref={dragHandleRef}
        className="DragHandle"
        title="Drag"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        {...dragHandleAttributes}
        {...dragHandleListeners}
      >
        ⋮⋮
      </button>

      {SLOT_ORDER.map((s) => {
        const itemId = build.slots?.[s.key] || "";
        const abilities = build.abilities?.[s.key] || [];

        const showAbilities = ABILITY_SLOTS.includes(s.key) && abilities.length > 0; // ✅ only when non-empty

        return (
          <div key={s.key} className="Slot" title={s.label}>
            {itemId ? (
              <img className="Icon" src={iconUrl(itemId, 96)} alt={s.label} loading="lazy" />
            ) : (
              <div className="SlotEmpty">{s.label}</div>
            )}

            {showAbilities ? <AbilityPills tokens={abilities} /> : null}
          </div>
        );
      })}

      {showActions ? (
        <div className="BuildActions">
          <button
            className="ActionBtn"
            title="Duplicate"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate?.();
            }}
          >
            ⧉
          </button>
          <button
            className="ActionBtn ActionBtnDanger"
            title="Delete"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.();
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SortableBuild({ build, selected, onSelect, onRemove, onDuplicate }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: build.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BuildStrip
        build={build}
        selected={selected}
        onSelect={onSelect}
        showActions
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        dragHandleRef={setActivatorNodeRef}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
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
  const sensors = useSensors(useSensor(PointerSensor));

  const [allItems, setAllItems] = useState([]);
  const [itemsError, setItemsError] = useState("");

  const initial = useMemo(() => loadPersistedState(), []);
  const [buildsById, setBuildsById] = useState(initial.buildsById);
  const [tierBuildIds, setTierBuildIds] = useState(initial.tierBuildIds);
  const [selectedBuildId, setSelectedBuildId] = useState(initial.selectedBuildId);

  const [buildForm, setBuildForm] = useState({
    slots: defaultSlots(),
    abilities: defaultAbilities(),
  });

  const importInputRef = useRef(null);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ buildsById, tierBuildIds, selectedBuildId })
      );
    } catch {}
  }, [buildsById, tierBuildIds, selectedBuildId]);

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

  function editorBuild() {
    if (selectedBuildId && buildsById[selectedBuildId]) return buildsById[selectedBuildId];
    return { id: "draft", slots: buildForm.slots, abilities: buildForm.abilities };
  }

  function setSlot(slotKey, itemId) {
    const shouldClearAbilities = ABILITY_SLOTS.includes(slotKey) && !itemId;

    if (selectedBuildId) {
      setBuildsById((prev) => {
        const current = prev[selectedBuildId];
        if (!current) return prev;

        const nextAbilities = { ...(current.abilities || defaultAbilities()) };
        if (shouldClearAbilities) nextAbilities[slotKey] = [];

        return {
          ...prev,
          [selectedBuildId]: sanitizeBuild({
            ...current,
            slots: { ...current.slots, [slotKey]: itemId },
            abilities: nextAbilities,
          }),
        };
      });
    } else {
      setBuildForm((prev) => {
        const nextAbilities = { ...prev.abilities };
        if (shouldClearAbilities) nextAbilities[slotKey] = [];
        return {
          ...prev,
          slots: { ...prev.slots, [slotKey]: itemId },
          abilities: nextAbilities,
        };
      });
    }
  }

  function setAbilities(slotKey, tokens) {
    if (!ABILITY_SLOTS.includes(slotKey)) return;

    if (selectedBuildId) {
      setBuildsById((prev) => {
        const current = prev[selectedBuildId];
        if (!current) return prev;
        return {
          ...prev,
          [selectedBuildId]: sanitizeBuild({
            ...current,
            abilities: { ...(current.abilities || defaultAbilities()), [slotKey]: tokens.slice(0, 3) },
          }),
        };
      });
    } else {
      setBuildForm((prev) => ({
        ...prev,
        abilities: { ...prev.abilities, [slotKey]: tokens.slice(0, 3) },
      }));
    }
  }

  function clearEditor() {
    setSelectedBuildId(null);
  }

  function addBuildToS() {
    const draft = editorBuild();
    if (!draft.slots.main) return;

    const id = makeId();
    const build = sanitizeBuild({ id, slots: { ...draft.slots }, abilities: { ...draft.abilities } });

    setBuildsById((prev) => ({ ...prev, [id]: build }));
    setTierBuildIds((prev) => ({ ...prev, S: [id, ...prev.S] }));
  }

  function findContainer(id) {
    if (!id) return null;
    if (TIERS.includes(id)) return id;
    for (const t of TIERS) {
      if (tierBuildIds[t].includes(id)) return t;
    }
    return null;
  }

  function duplicateBuild(id) {
    const src = buildsById[id];
    if (!src) return;

    const newId = makeId();
    const copy = sanitizeBuild({ ...src, id: newId });
    const tier = findContainer(id) || "S";

    setBuildsById((prev) => ({ ...prev, [newId]: copy }));
    setTierBuildIds((prev) => {
      const arr = prev[tier];
      const idx = arr.indexOf(id);
      const insertAt = idx >= 0 ? idx + 1 : arr.length;
      const next = [...arr.slice(0, insertAt), newId, ...arr.slice(insertAt)];
      return { ...prev, [tier]: next };
    });

    setSelectedBuildId(newId);
  }

  function removeBuild(id) {
    setBuildsById((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });

    setTierBuildIds((prev) => {
      const next = {};
      for (const t of TIERS) next[t] = prev[t].filter((x) => x !== id);
      return next;
    });

    if (selectedBuildId === id) setSelectedBuildId(null);
  }

  function resetAll() {
    if (!window.confirm("Reset everything? This will remove all builds and tiers.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setBuildsById({});
    setTierBuildIds(defaultTierBuildIds());
    setSelectedBuildId(null);
    setBuildForm({ slots: defaultSlots(), abilities: defaultAbilities() });
  }

  function exportJson() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      buildsById,
      tierBuildIds,
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `albion-tierlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openImport() {
    importInputRef.current?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const next = normalizeState(parsed);

      setBuildsById(next.buildsById);
      setTierBuildIds(next.tierBuildIds);
      setSelectedBuildId(next.selectedBuildId || null);
    } catch (err) {
      alert(`Import failed: ${String(err)}`);
    }
  }

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragOver(event) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id);
    const overContainer = findContainer(over.id);

    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;

    setTierBuildIds((prev) => {
      const from = prev[activeContainer];
      const to = prev[overContainer];

      const fromIndex = from.indexOf(active.id);
      if (fromIndex === -1) return prev;

      const nextFrom = from.filter((x) => x !== active.id);

      const overIsTier = TIERS.includes(over.id);
      const toIndex = overIsTier ? to.length : to.indexOf(over.id);
      const insertAt = toIndex < 0 ? to.length : toIndex;

      const nextTo = [...to.slice(0, insertAt), active.id, ...to.slice(insertAt)];

      return {
        ...prev,
        [activeContainer]: nextFrom,
        [overContainer]: nextTo,
      };
    });
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeContainer = findContainer(active.id);
    const overContainer = findContainer(over.id);
    if (!activeContainer || !overContainer) return;

    if (activeContainer === overContainer) {
      const oldIndex = tierBuildIds[activeContainer].indexOf(active.id);
      const newIndex = tierBuildIds[overContainer].indexOf(over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      setTierBuildIds((prev) => ({
        ...prev,
        [activeContainer]: arrayMove(prev[activeContainer], oldIndex, newIndex),
      }));
    }
  }

  const ed = editorBuild();

  return (
    <div className="AppShell">
      <main className="Main">
        <section className="Card">
          <div className="CardHeaderRow">
            <div>
              <div className="CardTitle">
                {selectedBuildId ? "Editing build (live)" : "Create a build"}
              </div>
              <div className="CardSub">
                {selectedBuildId
                  ? "Changes apply instantly. Use ⋮⋮ to drag."
                  : "Pick items → Add build to S. Click a build later to edit it."}
              </div>
            </div>

            <div className="TopActions">
              <button className="Btn BtnGhost" onClick={exportJson}>Export JSON</button>
              <button className="Btn BtnGhost" onClick={openImport}>Import JSON</button>
              <button className="Btn BtnGhost" onClick={resetAll}>Reset all</button>

              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />

              {selectedBuildId ? (
                <button className="Btn BtnGhost" onClick={clearEditor}>
                  Stop editing
                </button>
              ) : null}
            </div>
          </div>

          {itemsError ? (
            <div className="Error">
              Couldn’t load <code>/items.txt</code>: {itemsError}
              <div className="Hint">
                Make sure the file exists at <code>public/items.txt</code>.
              </div>
            </div>
          ) : null}

          <div className="FormRowSimple">
            {!selectedBuildId ? (
              <button className="Btn BtnPrimary" onClick={addBuildToS} disabled={!ed.slots.main}>
                Add build to S
              </button>
            ) : (
              <button className="Btn" onClick={() => duplicateBuild(selectedBuildId)}>
                Duplicate
              </button>
            )}

            <div className="BuildPreview">
              <BuildStrip build={ed} selected={false} onSelect={() => {}} showActions={false} />
            </div>
          </div>

          <div className="PickersGrid">
            {SLOT_ORDER.map((s) => {
              const enabledAbilities = ABILITY_SLOTS.includes(s.key);
              const hasItem = !!ed.slots[s.key];

              return (
                <ItemPicker
                  key={s.key}
                  label={s.label}
                  items={itemsBySlot[s.key] || []}
                  value={ed.slots[s.key]}
                  onChange={(id) => setSlot(s.key, id)}
                >
                  <AbilitiesInput
                    enabled={enabledAbilities}
                    disabled={!hasItem}
                    valueTokens={ed.abilities?.[s.key] || []}
                    onChangeTokens={(tokens) => setAbilities(s.key, tokens)}
                  />
                </ItemPicker>
              );
            })}
          </div>
        </section>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <section className="TierBoard" id="tierboard-capture">
            {TIERS.map((tier) => (
              <div key={tier} className={`TierRow TierRow${tier}`}>
                <div className={`TierLabel TierLabel${tier}`}>{tier}</div>

                <TierDropZone tierId={tier}>
                  <SortableContext items={tierBuildIds[tier]} strategy={rectSortingStrategy}>
                    {tierBuildIds[tier].map((id) => (
                      <SortableBuild
                        key={id}
                        build={buildsById[id]}
                        selected={selectedBuildId === id}
                        onSelect={() => setSelectedBuildId(id)}
                        onRemove={() => removeBuild(id)}
                        onDuplicate={() => duplicateBuild(id)}
                      />
                    ))}
                  </SortableContext>

                  {tierBuildIds[tier].length === 0 ? (
                    <div className="TierEmpty">Drop builds here.</div>
                  ) : null}
                </TierDropZone>
              </div>
            ))}
          </section>

          <DragOverlay>
            {activeBuild ? (
              <BuildStrip
                build={activeBuild}
                selected={false}
                onSelect={() => {}}
                showActions={false}
                className="OverlayBuild"
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
}
