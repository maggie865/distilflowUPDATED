import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Calculator } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';

const BLANK_FORM = {
  batch_number: '',
  date: new Date().toISOString().split('T')[0],
  source_type: 'receiving',   // 'receiving' | 'master_batch'
  source_id: '',              // id of selected Receiving or MasterBatch record
  input_ethanol_volume: '',
  input_abv: '',
  water_added: '',
  tank_id: '',                // StorageTank id
  status: 'completed',
  notes: '',
};

export default function Dilutions() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const queryClient = useQueryClient();

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  // Data fetches
  const { data: dilutions = [], isLoading } = useQuery({
    queryKey: ['dilutions'],
    queryFn: () => base44.entities.Dilution.list('-date', 50),
  });

  const { data: receivings = [] } = useQuery({
    queryKey: ['receivings-ethanol'],
    queryFn: () => base44.entities.Receiving.filter({ material_type: 'ethanol' }, '-date_received', 50),
  });

  const { data: masterBatches = [] } = useQuery({
    queryKey: ['masterBatches'],
    queryFn: () => base44.entities.MasterBatch.list('-date_started', 50),
  });

  const { data: tanks = [] } = useQuery({
    queryKey: ['storageTanks'],
    queryFn: () => base44.entities.StorageTank.list('name', 50),
  });

  // Auto-fill ABV when source is selected
  const handleSourceChange = (id) => {
    set('source_id', id);
    if (form.source_type === 'receiving') {
      const rec = receivings.find(r => r.id === id);
      if (rec) {
        set('input_abv', rec.abv_percent || '');
        set('input_ethanol_volume', rec.quantity || '');
      }
    } else {
      const mb = masterBatches.find(m => m.id === id);
      if (mb) {
        set('input_abv', mb.target_abv || '');
      }
    }
  };

  // Derived calcs
  const inputLALs = form.input_ethanol_volume && form.input_abv
    ? parseFloat(form.input_ethanol_volume) * parseFloat(form.input_abv) / 100 : 0;
  const outputVolume = (parseFloat(form.input_ethanol_volume) || 0) + (parseFloat(form.water_added) || 0);
  const outputABV = outputVolume > 0 ? (inputLALs / outputVolume) * 100 : 0;

  const selectedTank = tanks.find(t => t.id === form.tank_id);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const sourceName = data.source_type === 'receiving'
        ? receivings.find(r => r.id === data.source_id)?.batch_number
        : masterBatches.find(m => m.id === data.source_id)?.batch_code;

      // 1. Create dilution record
      await base44.entities.Dilution.create({
        batch_number: data.batch_number,
        date: data.date,
        input_ethanol_volume: parseFloat(data.input_ethanol_volume),
        input_abv: parseFloat(data.input_abv),
        input_lals: inputLALs,
        water_added: parseFloat(data.water_added) || 0,
        output_volume: outputVolume,
        output_abv: parseFloat(outputABV.toFixed(2)),
        output_lals: parseFloat(inputLALs.toFixed(4)),
        status: data.status,
        notes: data.notes,
      });

      // 2. If a tank was chosen, log a TankMovement and update the tank
      if (data.tank_id && selectedTank) {
        await base44.entities.TankMovement.create({
          date: data.date,
          action: 'fill',
          tank_name: selectedTank.name,
          volume_litres: outputVolume,
          abv: parseFloat(outputABV.toFixed(2)),
          lals: parseFloat(inputLALs.toFixed(4)),
          product: data.batch_number,
          batch_number: data.batch_number || sourceName,
          notes: `Dilution — source: ${data.source_type === 'receiving' ? 'Receiving' : 'Master Batch'} ${sourceName || ''}`,
        });

        const newVol = Math.min(
          (selectedTank.current_volume || 0) + outputVolume,
          selectedTank.capacity_litres
        );

        await base44.entities.StorageTank.update(data.tank_id, {
          current_volume: newVol,
          current_abv: parseFloat(outputABV.toFixed(2)),
          current_product: data.batch_number || selectedTank.current_product,
          current_batch: data.batch_number || sourceName,
          status: 'in_use',
        });

        queryClient.invalidateQueries({ queryKey: ['storageTanks'] });
        queryClient.invalidateQueries({ queryKey: ['tankMovements'] });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dilutions'] });
      setOpen(false);
      setForm(BLANK_FORM);
      toast.success('Dilution recorded');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <div className="pb-20 md:pb-0">
      <PageHeader title="Dilutions" subtitle="Track ethanol dilutions and LAL calculations">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Dilution</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display">Record Dilution</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">

              {/* Batch + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Batch Number</Label>
                  <Input value={form.batch_number} onChange={e => set('batch_number', e.target.value)} required />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
                </div>
              </div>

              {/* Source selection */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ethanol Source</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>Source Type</Label>
                    <Select
                      value={form.source_type}
                      onValueChange={v => setForm(p => ({ ...p, source_type: v, source_id: '', input_abv: '', input_ethanol_volume: '' }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receiving">Ethanol Shipment (Receiving)</SelectItem>
                        <SelectItem value="master_batch">Master Batch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label>{form.source_type === 'receiving' ? 'Ethanol Shipment' : 'Master Batch'}</Label>
                    <Select value={form.source_id} onValueChange={handleSourceChange}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {form.source_type === 'receiving'
                          ? receivings.map(r => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.material_name} — Lot: {r.batch_number || 'N/A'} ({r.quantity}{r.unit}, {r.abv_percent}% ABV) — {r.date_received}
                            </SelectItem>
                          ))
                          : masterBatches.map(m => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.batch_code} — {m.product_name} ({m.status})
                            </SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Input ethanol */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Input Ethanol</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Volume (L)</Label>
                    <Input type="number" step="0.01" value={form.input_ethanol_volume} onChange={e => set('input_ethanol_volume', e.target.value)} required />
                  </div>
                  <div>
                    <Label>ABV %</Label>
                    <Input type="number" step="0.1" value={form.input_abv} onChange={e => set('input_abv', e.target.value)} required />
                  </div>
                  <div>
                    <Label className="flex items-center gap-1">LALs <Calculator className="w-3 h-3 text-primary" /></Label>
                    <div className={`h-9 flex items-center px-3 rounded-md border text-sm font-semibold transition-colors ${inputLALs > 0 ? 'bg-primary/8 border-primary/30 text-primary' : 'bg-muted border-input text-muted-foreground'}`}>
                      {inputLALs > 0 ? inputLALs.toFixed(3) : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Water + output */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dilution & Output</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Water Added (L)</Label>
                    <Input type="number" step="0.01" value={form.water_added} onChange={e => set('water_added', e.target.value)} />
                  </div>
                  <div>
                    <Label>Output Vol (L)</Label>
                    <div className={`h-9 flex items-center px-3 rounded-md border text-sm font-semibold transition-colors ${outputVolume > 0 ? 'bg-primary/8 border-primary/30 text-primary' : 'bg-muted border-input text-muted-foreground'}`}>
                      {outputVolume > 0 ? outputVolume.toFixed(2) : '—'}
                    </div>
                  </div>
                  <div>
                    <Label>Output ABV %</Label>
                    <div className={`h-9 flex items-center px-3 rounded-md border text-sm font-semibold transition-colors ${outputABV > 0 ? 'bg-primary/8 border-primary/30 text-primary' : 'bg-muted border-input text-muted-foreground'}`}>
                      {outputABV > 0 ? outputABV.toFixed(2) : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Calculator className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    LALs are <span className="font-medium text-foreground">conserved</span> through dilution —
                    Output LALs = <span className="font-semibold text-primary">{inputLALs > 0 ? inputLALs.toFixed(3) : '—'}</span>
                  </p>
                </div>
              </div>

              {/* Tank selection */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tank Assignment</p>
                <div>
                  <Label>Dilution Tank (optional)</Label>
                  <Select value={form.tank_id} onValueChange={v => set('tank_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Select tank..." /></SelectTrigger>
                    <SelectContent>
                      {tanks.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          Tank {t.name} — {t.capacity_litres}L capacity
                          {t.status === 'empty' ? ' (empty)' : ` — ${t.current_volume || 0}L in use`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedTank && outputVolume > 0 && (
                  <p className="text-xs text-primary font-medium">
                    Tank {selectedTank.name} will be updated to {Math.min((selectedTank.current_volume || 0) + outputVolume, selectedTank.capacity_litres).toFixed(1)}L
                    / {selectedTank.capacity_litres}L at {outputABV.toFixed(2)}% ABV
                  </p>
                )}
              </div>

              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>

              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Record Dilution'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Batch #</TableHead>
                <TableHead>Input Vol (L)</TableHead>
                <TableHead>Input ABV</TableHead>
                <TableHead>Input LALs</TableHead>
                <TableHead>Water (L)</TableHead>
                <TableHead>Output Vol (L)</TableHead>
                <TableHead>Output ABV</TableHead>
                <TableHead>Output LALs</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : dilutions.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No dilutions recorded</TableCell></TableRow>
              ) : dilutions.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="text-sm">{d.date ? format(new Date(d.date), 'MMM d, yyyy') : '—'}</TableCell>
                  <TableCell className="font-medium text-sm">{d.batch_number}</TableCell>
                  <TableCell className="text-sm">{d.input_ethanol_volume}</TableCell>
                  <TableCell className="text-sm">{d.input_abv}%</TableCell>
                  <TableCell className="text-sm font-medium">{d.input_lals?.toFixed(3)}</TableCell>
                  <TableCell className="text-sm">{d.water_added}</TableCell>
                  <TableCell className="text-sm">{d.output_volume?.toFixed(2)}</TableCell>
                  <TableCell className="text-sm">{d.output_abv?.toFixed(2)}%</TableCell>
                  <TableCell className="text-sm font-medium">{d.output_lals?.toFixed(3)}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}