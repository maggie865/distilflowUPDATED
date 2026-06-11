import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DISTILLERY_ADDRESS = '250 Ocean Beach Road, Bluff, New Zealand';
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

const CO2E_FACTORS = {
  road: 0.12,
  courier: 0.15,
  air: 0.55,
  sea: 0.008,
};

async function getDistanceKm(origin) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(DISTILLERY_ADDRESS)}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  const element = json?.rows?.[0]?.elements?.[0];
  if (element?.status === 'OK') {
    return Math.round(element.distance.value / 1000);
  }
  return null;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  // Fetch all receivings and suppliers
  const [receivings, suppliers] = await Promise.all([
    base44.asServiceRole.entities.Receiving.list(),
    base44.asServiceRole.entities.Supplier.list(),
  ]);

  // Build supplier lookup by name (case-insensitive)
  const supplierMap = {};
  for (const s of suppliers) {
    supplierMap[s.business_name.toLowerCase().trim()] = s;
  }

  // Cache distances per supplier address to avoid redundant API calls
  const distanceCache = {};

  let updated = 0;
  let skipped = 0;

  for (const r of receivings) {
    const supplierName = (r.supplier_name || '').toLowerCase().trim();

    // Try to match supplier
    let matchedSupplier = null;
    if (r.supplier_id) {
      matchedSupplier = suppliers.find(s => s.id === r.supplier_id);
    }
    if (!matchedSupplier && supplierName) {
      // Fuzzy match: find supplier whose name contains or is contained in the receiving name
      matchedSupplier = suppliers.find(s => {
        const sName = s.business_name.toLowerCase().trim();
        return sName.includes(supplierName) || supplierName.includes(sName);
      });
    }

    if (!matchedSupplier || !matchedSupplier.address) {
      skipped++;
      continue;
    }

    const address = matchedSupplier.address.trim();

    // Get distance (cached)
    if (distanceCache[address] === undefined) {
      distanceCache[address] = await getDistanceKm(address);
    }
    const distanceKm = distanceCache[address];

    if (!distanceKm) {
      skipped++;
      continue;
    }

    // Derive weight from quantity
    let weightKg = r.weight_kg || null;
    if (!weightKg) {
      if (r.unit === 'kg') weightKg = r.quantity;
      else if (r.unit === 'litres') weightKg = r.quantity; // ~1 kg/L approximation
      // units: skip
    }

    // Calculate CO2e
    let co2eKg = null;
    if (weightKg && distanceKm) {
      const method = r.transport_method || 'road';
      const factor = CO2E_FACTORS[method] || CO2E_FACTORS.road;
      co2eKg = parseFloat(((distanceKm * weightKg / 1000) * factor).toFixed(3));
    }

    const updatePayload = {
      supplier_id: matchedSupplier.id,
      supplier_name: matchedSupplier.business_name,
      transport_distance_km: distanceKm,
    };
    if (weightKg) updatePayload.weight_kg = weightKg;
    if (co2eKg !== null) updatePayload.co2e_kg = co2eKg;
    if (!r.transport_method) updatePayload.transport_method = 'road';

    await base44.asServiceRole.entities.Receiving.update(r.id, updatePayload);
    updated++;
  }

  return Response.json({ updated, skipped, total: receivings.length });
});