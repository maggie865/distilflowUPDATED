import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Zap, Calendar, User, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import BottlingRunTracker from '@/components/bottling/BottlingRunTracker';

const BOTTLE_SIZES = [200, 350, 500, 700, 750, 1000];

export default function BottlingFloor() {
  const [activeRun, setActiveRun] = useState(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [newRunForm, setNewRunForm] = useState({
    product_id: '',
    tank_id: '',
    bottle_size_ml: '700',
    bottles_per_case: '6',
  });
  const [historyFilter, setHistoryFilter] = useState({
    product: 'all',
    startDate: '',
    endDate: '',
    operator: '',
  });

  const queryClient = useQueryClient();

  // Fetch master batches and finished goods tanks
  const { data: masterBatches = [] } = useQuery({
    queryKey: ['masterBatches'],
    queryFn: () => base44.entities.MasterBatch.list('-date_started', 100),
  });

  const { data: tanks = [] } = useQuery({
    queryKey: ['storageTanks'],
    queryFn: () => base44.entities.StorageTank.list(),
  });

  const { data: bottlingRuns = [] } = useQuery({
    queryKey: ['bottlingFloorRuns'],
    queryFn: () => base44.entities.BottlingRun.list('-date', 100),
  });

  // Filter tanks that are "bottle_ready"
  const availableTanks = tanks.filter(t => t.purpose === 'final_product_storage' && t.status === 'in_use');

  // Filter history
  const filteredHistory = bottlingRuns.filter(run => {
    if (newRunForm.product_id && run.batch_number !== newRunForm.product_id) return false;
    if (historyFilter.startDate && new Date(run.date) < new Date(historyFilter.startDate)) return false;
    if (historyFilter.endDate && new Date(run.date) > new Date(historyFilter.endDate)) return false;
    return true;
  });

  // Create bottling run
  const createRunMutation = useMutation({
    mutationFn: async (runData) => {
      const tank = tanks.find(t => t.id === runData.tank_id);
      return base44.entities.BottlingRun.create({
        batch_number: runData.product_id,
        product_name: masterBatches.find(b => b.batch_code === runData.product_id)?.product_name || '',
        date: new Date().toISOString().split('T')[0],
        input_volume: tank?.current_volume || 0,
        input_abv: tank?.current_abv || 0,
        bottle_size_ml: parseInt(runData.bottle_size_ml),
        bottles_produced: 0, // Updated on completion
        status: 'in_progress',
      });
    },
    onSuccess: (data) => {
      setActiveRun({
        id: data.id,
        product_name: newRunForm.product_id,
        tank_name: tanks.find(t => t.id === newRunForm.tank_id)?.name || '',
        bottle_size_ml: parseInt(newRunForm.bottle_size_ml),
        bottles_per_case: parseInt(newRunForm.bottles_per_case),
        available_volume: tanks.find(t => t.id === newRunForm.tank_id)?.current_volume || 0,
        tank_id: newRunForm.tank_id,
      });
      setShowNewRun(false);
      toast.success('Bottling run started');
    },
  });

  // Complete bottling run and update inventory
  const completeRunMutation = useMutation({
    mutationFn: async (completionData) => {
      const tank = tanks.find(t => t.id === activeRun.tank_id);
      const spiritUsed = (completionData.bottles_produced * (activeRun.bottle_size_ml || 0)) / 1000;

      // Update bottling run
      await base44.entities.BottlingRun.update(activeRun.id, {
        bottles_produced: completionData.bottles_produced,
        status: 'completed',
        notes: `Staff: ${completionData.staff.join(', ')} | Scanned: ${completionData.scanned_cases.length} cases`,
      });

      // Deduct from source tank
      if (tank) {
        await base44.entities.StorageTank.update(tank.id, {
          current_volume: Math.max(0, (tank.current_volume || 0) - spiritUsed),
        });

        // Create tank movement record
        await base44.entities.TankMovement.create({
          date: new Date().toISOString().split('T')[0],
          action: 'bottling_draw',
          tank_name: tank.name,
          volume_litres: spiritUsed,
          abv: tank.current_abv || 0,
          lals: (spiritUsed * (tank.current_abv || 0)) / 100,
          product: activeRun.product_name,
          batch_number: newRunForm.product_id,
          operator: completionData.staff[0] || 'Unknown',
          notes: `Bottling run completed - ${completionData.cases_produced} cases`,
        });
      }

      // Create/update finished goods
      const existingFG = await base44.entities.FinishedGood.filter({
        product_name: activeRun.product_name,
        batch_number: newRunForm.product_id,
      });

      if (existingFG.length > 0) {
        const fg = existingFG[0];
        await base44.entities.FinishedGood.update(fg.id, {
          quantity_bottles: (fg.quantity_bottles || 0) + completionData.bottles_produced,
          total_lals: (fg.total_lals || 0) + ((spiritUsed * (tank?.current_abv || 0)) / 100),
        });
      } else {
        await base44.entities.FinishedGood.create({
          product_name: activeRun.product_name,
          batch_number: newRunForm.product_id,
          bottle_size_ml: activeRun.bottle_size_ml,
          abv_percent: tank?.current_abv || 0,
          quantity_bottles: completionData.bottles_produced,
          total_lals: (spiritUsed * (tank?.current_abv || 0)) / 100,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bottlingFloorRuns'] });
      queryClient.invalidateQueries({ queryKey: ['storageTanks'] });
      queryClient.invalidateQueries({ queryKey: ['finishedGoods'] });
      setActiveRun(null);
      toast.success('Bottling run completed and inventory updated');
    },
  });

  if (activeRun) {
    return (
      <BottlingRunTracker
        run={activeRun}
        onComplete={(data) => completeRunMutation.mutate(data)}
        onCancel={() => setActiveRun(null)}
      />
    );
  }

  return (
    <div className="pb-20 md:pb-0">
      <PageHeader title="Bottling Floor" subtitle="Live production tracking and case management">
        <Button onClick={() => setShowNewRun(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Start Run
        </Button>
      </PageHeader>

      {/* Start New Run Dialog */}
      <Dialog open={showNewRun} onOpenChange={setShowNewRun}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Start Bottling Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label>Product / Batch</Label>
              <Select value={newRunForm.product_id} onValueChange={v => setNewRunForm({ ...newRunForm, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>
                  {masterBatches.filter(b => b.status !== 'sold' && b.status !== 'completed').map(b => (
                    <SelectItem key={b.id} value={b.batch_code}>{b.batch_code} - {b.product_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Source Tank (Finished / Ready)</Label>
              <Select value={newRunForm.tank_id} onValueChange={v => setNewRunForm({ ...newRunForm, tank_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select tank" /></SelectTrigger>
                <SelectContent>
                  {availableTanks.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} - {t.current_volume?.toFixed(1) || 0}L @ {t.current_abv || 0}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Bottle Size (ml)</Label>
              <Select value={newRunForm.bottle_size_ml} onValueChange={v => setNewRunForm({ ...newRunForm, bottle_size_ml: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOTTLE_SIZES.map(size => (
                    <SelectItem key={size} value={size.toString()}>{size}ml</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Bottles per Case</Label>
              <Input
                type="number"
                value={newRunForm.bottles_per_case}
                onChange={e => setNewRunForm({ ...newRunForm, bottles_per_case: e.target.value })}
                min="1"
                className="text-base h-10"
              />
            </div>

            <Button
              onClick={() => createRunMutation.mutate(newRunForm)}
              disabled={!newRunForm.product_id || !newRunForm.tank_id || createRunMutation.isPending}
              className="w-full"
            >
              {createRunMutation.isPending ? 'Starting…' : 'Start Production'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bottling History */}
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Bottling History
          </h2>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <Input
              type="date"
              value={historyFilter.startDate}
              onChange={e => setHistoryFilter({ ...historyFilter, startDate: e.target.value })}
              placeholder="Start date"
              className="text-sm"
            />
            <Input
              type="date"
              value={historyFilter.endDate}
              onChange={e => setHistoryFilter({ ...historyFilter, endDate: e.target.value })}
              placeholder="End date"
              className="text-sm"
            />
            <Input
              value={historyFilter.operator}
              onChange={e => setHistoryFilter({ ...historyFilter, operator: e.target.value })}
              placeholder="Filter by operator"
              className="text-sm"
            />
            <Button
              variant="outline"
              onClick={() => setHistoryFilter({ product: 'all', startDate: '', endDate: '', operator: '' })}
              className="text-sm"
            >
              Clear Filters
            </Button>
          </div>

          {/* History Table */}
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Bottles</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No bottling runs yet
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredHistory.map(run => (
                    <TableRow key={run.id}>
                      <TableCell>{run.date ? format(new Date(run.date), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell className="font-mono font-semibold">{run.batch_number}</TableCell>
                      <TableCell>{run.product_name}</TableCell>
                      <TableCell className="font-semibold">{run.bottles_produced || 0}</TableCell>
                      <TableCell>{run.bottle_size_ml}ml</TableCell>
                      <TableCell><StatusBadge status={run.status} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}