// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW — PO-wise Part & Quantity Allocation for the Packing List.
//
// Pure functions (no DB, no I/O). The SAME code is mirrored in
// frontend/src/utils/plAllocation.js so the allocation screen shows exactly
// what the backend will validate and print — keep the two files identical
// apart from the export line at the bottom.
//
// Data available per part on a Shipment: quantity, net_wt_per_unit,
// gross_wt (TOTAL for that part line), no_of_boxes, box_size. There is no
// per-box content mapping, so each part's boxes are treated as that part's
// own physical boxes, and each box is assigned to exactly ONE PO.
//
// Weights (never "gross ∝ quantity"):
//   net   of an allocation = qty × net_wt_per_unit
//   tare  per box          = (part gross − part net) / original box count
//   gross of one box       = tare + (pieces in that box × net_wt_per_unit)
//   (fallback when unit weight is missing or gross < net: gross/box count)
// Rounding is done cumulatively in integer cents / milli-kg across the POs
// of a part, so per-PO values always add back to the part's original
// totals exactly — nothing is lost or duplicated.
// ─────────────────────────────────────────────────────────────────────────

const WHOLE_RE = /^\d+$/;

function toCents(x) { return Math.round((Number(x) + Number.EPSILON) * 100); }
function toMilli(x) { return Math.round((Number(x) + Number.EPSILON) * 1000); }

// Equal whole-number split; the first `remainder` slots take one extra, so
// every unit is placed exactly once (e.g. 10 over 3 → 4, 3, 3).
function splitEqually(total, n) {
  const count = Math.max(1, Number(n) || 1);
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(t / count);
  const rem = t - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

function parseWhole(v) {
  if (v === undefined || v === null) return { ok: true, n: 0, blank: true };
  const s = String(v).trim();
  if (s === "") return { ok: true, n: 0, blank: true };
  if (!WHOLE_RE.test(s)) return { ok: false, n: 0 };
  return { ok: true, n: Number(s), blank: false };
}

function partLabel(parts, i) {
  const p = parts[i];
  const name = [p.partNo, p.description].filter(Boolean).join(" — ") || `Line ${i + 1}`;
  const dup = parts.filter((x, k) => k !== i && x.partNo && x.partNo === p.partNo).length > 0;
  return dup ? `${name} (line ${i + 1})` : name;
}

// Default whole-box assignment for one part across its active POs.
//   • one active PO  → all of the part's boxes (existing single-PO behaviour)
//   • several        → every active PO gets ≥1 box, the rest follow quantity
//                      (largest remainder), never more boxes than pieces.
function autoBoxes(qtys, N, repackConfirmed) {
  const active = qtys.map((q, j) => (q > 0 ? j : -1)).filter((j) => j >= 0);
  const out = qtys.map(() => 0);
  if (active.length === 0) return out;
  if (active.length === 1) { out[active[0]] = N; return out; }
  active.forEach((j) => { out[j] = 1; });
  if (active.length >= N || repackConfirmed) return out;
  const S = active.reduce((s, j) => s + qtys[j], 0);
  let extra = N - active.length;
  while (extra > 0) {
    let best = -1;
    let bestGap = -Infinity;
    for (const j of active) {
      if (out[j] >= qtys[j]) continue; // no more boxes than pieces
      const gap = (N * qtys[j]) / S - out[j];
      if (gap > bestGap + 1e-12) { bestGap = gap; best = j; }
    }
    if (best < 0) break;
    out[best] += 1;
    extra -= 1;
  }
  return out;
}

/**
 * @param {Object}   input
 * @param {Array}    input.parts  [{ partNo, description, hsnCode, unit, qty, netWtPerUnit, grossWt, boxes, boxSize }]
 * @param {Array}    input.pos    [{ poNumber, poDate, packingListNo, qty:[per part], boxes:[per part] | null }]
 *                                 qty/box cells may be numbers or strings (as typed).
 *                                 boxes[i] undefined/null/"" for every PO ⇒ automatic box assignment for part i.
 * @param {Object}   input.confirmations  { repackParts: { [partIdx]: true }, dedicatedBoxes: boolean }
 * @param {boolean}  input.requirePoDetails  backend: also require PO numbers / ≥2 POs
 */
function computeAllocation({ parts, pos, confirmations = {}, requirePoDetails = false }) {
  const errors = [];
  const P = Array.isArray(parts) ? parts : [];
  const O = Array.isArray(pos) ? pos : [];
  const repack = confirmations.repackParts || {};

  if (requirePoDetails) {
    if (O.length < 1) errors.push("Add at least one PO Number.");
    const seen = new Set();
    O.forEach((po, j) => {
      const n = String(po.poNumber || "").trim();
      if (!n) errors.push(`PO ${j + 1}: PO Number is required.`);
      else if (seen.has(n.toLowerCase())) errors.push(`PO Number ${n} is entered more than once.`);
      else seen.add(n.toLowerCase());
    });
  }

  // Per-PO accumulators
  const poItemsByPart = O.map(() => []); // [{ partIdx, qty, netMilli, grossCents, pallets }]
  const partsOut = [];
  let invalidCells = false;

  P.forEach((part, i) => {
    const label = partLabel(P, i);
    const Q = Number(part.qty) || 0;
    const u = Number(part.netWtPerUnit) || 0;
    const G = Number(part.grossWt) || 0;
    const N = Math.max(1, Math.round(Number(part.boxes) || 0) || 1);
    const info = { idx: i, label, total: Q, allocated: 0, remaining: Q, status: "ok", boxesOriginal: N, needsRepack: false, boxes: [], autoBoxes: [], boxesAuto: true, boxesTotal: 0 };

    if (!Number.isInteger(Q) || Q < 0) {
      errors.push(`${label}: shipment quantity must be a whole number.`);
    }

    // ── quantities ──
    const q = O.map((po, j) => {
      const r = parseWhole((po.qty || [])[i]);
      if (!r.ok) {
        invalidCells = true;
        errors.push(`${label}, PO ${String(po.poNumber || "").trim() || j + 1}: quantity must be a whole number (0 or more).`);
        return 0;
      }
      return r.n;
    });
    const S = q.reduce((s, x) => s + x, 0);
    info.allocated = S;
    info.remaining = Q - S;
    info.status = S === Q ? "ok" : S < Q ? "under" : "over";
    if (S < Q) errors.push(`${label}: ${Q - S} of ${Q} pcs are still unallocated (allocated ${S}).`);
    if (S > Q) errors.push(`${label}: over-allocated by ${S - Q} (allocated ${S}, shipment quantity ${Q}).`);

    const active = q.map((x, j) => (x > 0 ? j : -1)).filter((j) => j >= 0);
    const k = active.length;
    info.needsRepack = k > N;
    const repackOk = info.needsRepack && repack[i] === true;

    // ── boxes ──
    const rawBoxes = O.map((po) => (Array.isArray(po.boxes) ? po.boxes[i] : undefined));
    const touched = rawBoxes.some((v) => v !== undefined && v !== null && String(v).trim() !== "");
    const auto = autoBoxes(q, N, repackOk);
    info.autoBoxes = auto;
    info.boxesAuto = !touched;
    let b = auto.slice();
    let boxesValid = true;
    if (touched) {
      b = rawBoxes.map((v, j) => {
        const r = parseWhole(v);
        if (!r.ok) {
          boxesValid = false;
          errors.push(`${label}, PO ${String(O[j].poNumber || "").trim() || j + 1}: number of boxes must be a whole number (0 or more).`);
          return 0;
        }
        return r.n;
      });
    }
    info.boxes = b;
    info.boxesTotal = b.reduce((s, x) => s + x, 0);

    if (info.needsRepack && !repackOk) {
      errors.push(
        `${label}: split across ${k} POs but it only has ${N} physical box${N === 1 ? "" : "es"} — one box cannot be in two Packing Lists. ` +
        `Reallocate whole boxes, or confirm repacking this part into separate boxes.`
      );
    }
    if (boxesValid && S > 0) {
      b.forEach((cnt, j) => {
        const poName = String(O[j].poNumber || "").trim() || `PO ${j + 1}`;
        if (q[j] === 0 && cnt > 0) errors.push(`${label}, ${poName}: has ${cnt} box(es) but no quantity.`);
        if (q[j] > 0 && cnt < 1) errors.push(`${label}, ${poName}: quantity ${q[j]} needs at least 1 box.`);
        if (k >= 2 && q[j] > 0 && cnt > q[j]) errors.push(`${label}, ${poName}: ${cnt} boxes for only ${q[j]} pcs.`);
      });
      if (!info.needsRepack) {
        if (info.boxesTotal !== N) {
          errors.push(`${label}: boxes allocated across POs total ${info.boxesTotal}, but the shipment has ${N} box${N === 1 ? "" : "es"} for this part.`);
        }
      }
    }

    // ── weights, box by box ──
    const useTare = u > 0 && G >= Q * u;
    const tare = useTare ? (G - Q * u) / N : 0;
    const flatBox = G / N;
    let cumQty = 0;
    let cumNetMilli = 0;
    let cumGross = 0;
    let cumGrossCents = 0;
    O.forEach((po, j) => {
      if (q[j] <= 0) return;
      cumQty += q[j];
      const nowNet = toMilli(cumQty * u);
      const netMilli = nowNet - cumNetMilli;
      cumNetMilli = nowNet;

      const nBoxes = Math.max(1, b[j] || 0);
      const contents = splitEqually(q[j], nBoxes);
      const pallets = contents.map((c) => {
        cumGross += useTare ? tare + c * u : flatBox;
        const nowCents = toCents(cumGross);
        const cents = nowCents - cumGrossCents;
        cumGrossCents = nowCents;
        return { qty: c, dimensions: part.boxSize || "", grossWt: cents / 100 };
      });
      const grossCents = pallets.reduce((s, p) => s + toCents(p.grossWt), 0);
      poItemsByPart[j].push({ partIdx: i, qty: q[j], netMilli, grossCents, pallets });
    });

    partsOut.push(info);
  });

  // Box contents are not recorded per box, so for multi-part shipments the
  // user must confirm parts are packed in their own boxes.
  const multiPartSplit = P.length > 1 && O.length >= 2;
  if (multiPartSplit && confirmations.dedicatedBoxes !== true) {
    errors.push(
      "Box contents are not recorded per box for this shipment. Please confirm that each part is packed in its own boxes (no box holds parts that belong to different POs)."
    );
  }

  // ── build one Packing List item set per PO (merge repeated part rows) ──
  const perPo = O.map((po, j) => {
    const merged = new Map();
    poItemsByPart[j].forEach((it) => {
      const part = P[it.partIdx];
      const key = [part.partNo, part.description, part.hsnCode, part.unit || "pcs"].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
      if (!merged.has(key)) {
        merged.set(key, { description: part.description || part.partNo || "", partNo: part.partNo || "", hsnCode: part.hsnCode || "", unit: part.unit || "pcs", qty: 0, netMilli: 0, grossCents: 0, pallets: [] });
      }
      const m = merged.get(key);
      m.qty += it.qty;
      m.netMilli += it.netMilli;
      m.grossCents += it.grossCents;
      m.pallets = m.pallets.concat(it.pallets);
    });
    const items = [...merged.values()].map((m) => ({
      description: m.description, partNo: m.partNo, hsnCode: m.hsnCode, unit: m.unit,
      qty: m.qty, netWt: m.netMilli / 1000, grossWt: m.grossCents / 100, pallets: m.pallets,
    }));
    const totals = items.reduce(
      (t, it) => ({ qty: t.qty + it.qty, netMilli: t.netMilli + Math.round(it.netWt * 1000), grossCents: t.grossCents + Math.round(it.grossWt * 100), boxes: t.boxes + it.pallets.length }),
      { qty: 0, netMilli: 0, grossCents: 0, boxes: 0 }
    );
    if (requirePoDetails && totals.qty === 0 && String(po.poNumber || "").trim()) {
      errors.push(`PO ${String(po.poNumber).trim()}: no quantity allocated — remove this PO or allocate parts to it.`);
    }
    return {
      poNumber: String(po.poNumber || "").trim(), poDate: po.poDate || "", packingListNo: po.packingListNo || "",
      items, totals: { qty: totals.qty, net: totals.netMilli / 1000, gross: totals.grossCents / 100, boxes: totals.boxes },
    };
  });

  // One combined Packing List: every PO's allocation merged by part, so each
  // part is printed once with its total, and boxes keep their PO order.
  const combinedMap = new Map();
  perPo.forEach((po) =>
    po.items.forEach((it) => {
      const key = [it.partNo, it.description, it.hsnCode, it.unit].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
      if (!combinedMap.has(key)) combinedMap.set(key, { ...it, netMilli: 0, grossCents: 0, qty: 0, pallets: [] });
      const m = combinedMap.get(key);
      m.qty += it.qty;
      m.netMilli += Math.round(it.netWt * 1000);
      m.grossCents += Math.round(it.grossWt * 100);
      m.pallets = m.pallets.concat(it.pallets);
    })
  );
  const combinedItems = [...combinedMap.values()].map((m) => ({
    description: m.description, partNo: m.partNo, hsnCode: m.hsnCode, unit: m.unit,
    qty: m.qty, netWt: m.netMilli / 1000, grossWt: m.grossCents / 100, pallets: m.pallets,
  }));

  const original = {
    qty: P.reduce((s, p) => s + (Number(p.qty) || 0), 0),
    net: P.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.netWtPerUnit) || 0), 0),
    gross: P.reduce((s, p) => s + (Number(p.grossWt) || 0), 0),
    boxes: P.reduce((s, p) => s + Math.max(1, Math.round(Number(p.boxes) || 0) || 1), 0),
  };
  const sum = perPo.reduce((t, p) => ({ qty: t.qty + p.totals.qty, net: t.net + p.totals.net, gross: t.gross + p.totals.gross, boxes: t.boxes + p.totals.boxes }), { qty: 0, net: 0, gross: 0, boxes: 0 });
  const totals = { qty: sum.qty, net: Math.round(sum.net * 1000) / 1000, gross: Math.round(sum.gross * 100) / 100, boxes: sum.boxes };

  // Final reconciliation guard (only meaningful when every part is fully allocated)
  const allExact = partsOut.every((p) => p.status === "ok") && !invalidCells;
  if (allExact && errors.length === 0) {
    const needRepack = partsOut.some((p) => p.needsRepack);
    if (totals.qty !== original.qty) errors.push(`Total allocated quantity ${totals.qty} does not match the shipment quantity ${original.qty}.`);
    if (Math.abs(totals.net - Math.round(original.net * 1000) / 1000) > 0.0005) errors.push(`Total net weight ${totals.net} does not reconcile with the shipment (${Math.round(original.net * 1000) / 1000}).`);
    if (!needRepack && Math.abs(totals.gross - Math.round(original.gross * 100) / 100) > 0.005) errors.push(`Total gross weight ${totals.gross} does not reconcile with the shipment (${Math.round(original.gross * 100) / 100}).`);
  }

  return { ok: errors.length === 0, errors, parts: partsOut, perPo, combinedItems, totals, original };
}

// Maps a Shipment's stored parts[] into the shape computeAllocation expects.
// The number of parts is whatever the shipment holds (1, 2, 8, …). If the
// shipment has no parts[] at all, one line is built from its stored totals
// (same fallback the existing Packing List screen uses).
function mapShipmentParts(shipmentParts, fullShipment) {
  const list = Array.isArray(shipmentParts) ? shipmentParts : [];
  if (list.length === 0 && fullShipment) {
    const qty = Number(fullShipment.total_parts_count ?? fullShipment.total_qty) || 0;
    if (qty <= 0) return [];
    return [{
      partNo: "", description: fullShipment.manual_desc || "", hsnCode: "", unit: "pcs", qty,
      netWtPerUnit: (Number(fullShipment.total_net_weight ?? fullShipment.total_net_wt) || 0) / qty,
      grossWt: Number(fullShipment.total_gross_weight ?? fullShipment.total_gross_wt) || 0,
      boxes: Number(fullShipment.total_no_of_boxes) || 0, boxSize: "",
    }];
  }
  return list.map((p) => ({
    partNo: p.part_no || "",
    description: p.part_desc || "",
    hsnCode: p.hsn_code || "",
    unit: "pcs",
    qty: Number(p.quantity) || 0,
    netWtPerUnit: Number(p.net_wt_per_unit) || 0,
    grossWt: Number(p.gross_wt) || 0,
    boxes: Number(p.no_of_boxes) || 0,
    boxSize: p.box_size || "",
  }));
}

module.exports = { computeAllocation, splitEqually, autoBoxes, mapShipmentParts };
