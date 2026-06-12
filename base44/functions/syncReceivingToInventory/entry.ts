import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch all receiving records
    const receivings = await base44.entities.Receiving.list('date_received', 1000);

    // Group by material_name to sum quantities
    const grouped = {};
    receivings.forEach(r => {
      if (!grouped[r.material_name]) {
        grouped[r.material_name] = {
          material_name: r.material_name,
          material_type: r.material_type,
          quantity: 0,
          unit: r.unit || 'litres',
          abv_percent: r.abv_percent,
          lals: 0,
          supplier: r.supplier_name,
          cost_per_unit: r.cost_per_unit,
          batch_number: r.batch_number
        };
      }
      grouped[r.material_name].quantity += r.quantity || 0;
      grouped[r.material_name].lals += r.lals || 0;
    });

    // For each material, create or update RawMaterial
    const results = [];
    for (const [name, data] of Object.entries(grouped)) {
      try {
        // Try to find existing RawMaterial
        const existing = await base44.entities.RawMaterial.filter({ name });

        if (existing && existing.length > 0) {
          // Update existing
          await base44.entities.RawMaterial.update(existing[0].id, {
            quantity: data.quantity,
            lals: data.lals,
            abv_percent: data.abv_percent,
            unit: data.unit,
            type: data.material_type?.toLowerCase() || 'other',
            supplier: data.supplier,
            cost_per_unit: data.cost_per_unit,
            batch_number: data.batch_number
          });
          results.push({
            action: 'updated',
            material: name,
            quantity: data.quantity,
            lals: data.lals
          });
        } else {
          // Create new
          await base44.entities.RawMaterial.create({
            name: data.material_name,
            type: data.material_type?.toLowerCase() || 'other',
            quantity: data.quantity,
            unit: data.unit,
            abv_percent: data.abv_percent,
            lals: data.lals,
            supplier: data.supplier,
            cost_per_unit: data.cost_per_unit,
            batch_number: data.batch_number
          });
          results.push({
            action: 'created',
            material: name,
            quantity: data.quantity,
            lals: data.lals
          });
        }
      } catch (err) {
        results.push({
          action: 'error',
          material: name,
          error: err.message
        });
      }
    }

    return Response.json({
      success: true,
      message: `Synced ${Object.keys(grouped).length} materials`,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});