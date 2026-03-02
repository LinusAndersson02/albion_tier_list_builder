import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

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

// Match by UNIQUE ID patterns from your file (e.g. T6_MAIN_..., T6_2H_..., etc.)
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

function iconUrl(identifier, size = 64) {
  if (!identifier) return "";
  const encoded = encodeURIComponent(identifier.trim());
  return `https://render.albiononline.com/v1/item/${encoded}.png?locale=en&size=${size}`;
}

function parseItemsTxt(text) {
  const items = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    // Grab the first unique-id token that starts with T<number>_
    const idMatch = line.match(/\bT\d+_[A-Z0-9_]+(?:@\d+)?\b/);
    if (!idMatch) continue;

    const id = idMatch[0];

    // Name is usually after the last colon
    const parts = line.split(":");
    const name = (parts.length >= 2 ? parts[parts.length - 1] : id).trim() || id;

    items.push({ id, name });
  }

  return items;
}

function ItemPicker({ label, items, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Keep input readable when value changes externally
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
          onBlur={() => {
            // Small delay so click can register
            setTimeout(() => setOpen(false), 120);
          }}
        />
        {value ? (
          <button className="Btn BtnGhost" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange("")}>
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

function BuildCard({ build, onTierChange, onRemove }) {
  return (
    <div className="BuildCard">
      <div className="BuildTop">
        <div className="BuildTitle">{build.title || "Untitled Build"}</div>
        <select
          className="TierSelect"
          value={build.tier}
          onChange={(e) => onTierChange(build.id, e.target.value)}
          title="Move build to tier"
        >
          <option value="POOL">Pool</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="Btn BtnDanger" onClick={() => onRemove(build.id)} title="Delete build">
          ✕
        </button>
      </div>

      <div className="BuildRow" title="Main/2H, Off, Helmet, Armor, Boots, Cape, Food, Potion">
        {SLOT_ORDER.map((s) => (
          <div key={s.key} className="Slot">
            {build.slots[s.key] ? (
              <img className="Icon" src={iconUrl(build.slots[s.key], 64)} alt={s.label} loading="lazy" />
            ) : (
              <div className="SlotEmpty" title={s.label}>
                {s.label}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [allItems, setAllItems] = useState([]);
  const [itemsError, setItemsError] = useState("");

  const [buildForm, setBuildForm] = useState({
    title: "",
    tier: "POOL",
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

  const [builds, setBuilds] = useState(() => {
    try {
      const raw = localStorage.getItem("tierlist_builds_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("tierlist_builds_v1", JSON.stringify(builds));
  }, [builds]);

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

  const grouped = useMemo(() => {
    const g = Object.fromEntries(ALL_BUCKETS.map((b) => [b, []]));
    for (const b of builds) g[b.tier]?.push(b);
    return g;
  }, [builds]);

  function addBuild() {
    // Require at least a main/2h to avoid empty spam
    if (!buildForm.slots.main) return;

    const newBuild = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title: buildForm.title.trim(),
      tier: buildForm.tier,
      slots: { ...buildForm.slots },
    };

    setBuilds((prev) => [newBuild, ...prev]);

    setBuildForm((prev) => ({
      ...prev,
      title: "",
      tier: "POOL",
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
    }));
  }

  function setSlot(slotKey, itemId) {
    setBuildForm((prev) => ({
      ...prev,
      slots: { ...prev.slots, [slotKey]: itemId },
    }));
  }

  function setBuildTier(buildId, tier) {
    setBuilds((prev) => prev.map((b) => (b.id === buildId ? { ...b, tier } : b)));
  }

  function removeBuild(buildId) {
    setBuilds((prev) => prev.filter((b) => b.id !== buildId));
  }

  return (
    <div className="AppShell">
      <header className="Header">
        <div className="HeaderTitle">Albion Tier List Builder</div>
        <div className="HeaderSub">
          Builds render horizontally; tier rows grow automatically as they fill.
        </div>
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

          <div className="FormRow">
            <label className="Field">
              <div className="FieldLabel">Build name (optional)</div>
              <input
                className="TextInput"
                value={buildForm.title}
                onChange={(e) => setBuildForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Greataxe PvE"
              />
            </label>

            <label className="Field">
              <div className="FieldLabel">Start in tier</div>
              <select
                className="TextInput"
                value={buildForm.tier}
                onChange={(e) => setBuildForm((p) => ({ ...p, tier: e.target.value }))}
              >
                <option value="POOL">Pool</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <button className="Btn BtnPrimary" onClick={addBuild} disabled={!buildForm.slots.main}>
              Add build
            </button>
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

          <div className="PreviewRow">
            <div className="PreviewLabel">Preview</div>
            <div className="BuildRow">
              {SLOT_ORDER.map((s) => (
                <div key={s.key} className="Slot">
                  {buildForm.slots[s.key] ? (
                    <img className="Icon" src={iconUrl(buildForm.slots[s.key], 64)} alt={s.label} loading="lazy" />
                  ) : (
                    <div className="SlotEmpty">{s.label}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="TierBoard">
          {/* Pool */}
          <div className="TierRow">
            <div className="TierLabel TierLabelPool">POOL</div>
            <div className="TierBuilds">
              {grouped.POOL.map((b) => (
                <BuildCard key={b.id} build={b} onTierChange={setBuildTier} onRemove={removeBuild} />
              ))}
              {grouped.POOL.length === 0 ? <div className="TierEmpty">No builds yet.</div> : null}
            </div>
          </div>

          {/* Tiers */}
          {TIERS.map((tier) => (
            <div key={tier} className="TierRow">
              <div className={`TierLabel TierLabel${tier}`}>{tier}</div>
              <div className="TierBuilds">
                {grouped[tier].map((b) => (
                  <BuildCard key={b.id} build={b} onTierChange={setBuildTier} onRemove={removeBuild} />
                ))}
                {grouped[tier].length === 0 ? <div className="TierEmpty">Drop builds here by selecting tier.</div> : null}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
