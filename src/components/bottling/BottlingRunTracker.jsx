import { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, Zap, Check, X, Camera } from 'lucide-react';
import { toast } from 'sonner';

export default function BottlingRunTracker({ run, onComplete, onCancel }) {
  const [caseCount, setCaseCount] = useState(0);
  const [manualInput, setManualInput] = useState('');
  const [staffList, setStaffList] = useState(run?.staff || []);
  const [newStaffName, setNewStaffName] = useState('');
  const [scannedCases, setScannedCases] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Calculate production metrics
  const bottlesProduced = caseCount * (run?.bottles_per_case || 0);
  const spiritVolume = run?.available_volume || 0;
  const estimatedConsumption = (bottlesProduced * (run?.bottle_size_ml || 0)) / 1000;

  // Add staff name
  const handleAddStaff = () => {
    if (newStaffName.trim()) {
      setStaffList([...staffList, newStaffName.trim()]);
      setNewStaffName('');
      toast.success('Staff added');
    }
  };

  // Remove staff
  const handleRemoveStaff = (index) => {
    setStaffList(staffList.filter((_, i) => i !== index));
  };

  // Increment case
  const handleIncrementCase = () => {
    setCaseCount(caseCount + 1);
  };

  // Decrement case
  const handleDecrementCase = () => {
    if (caseCount > 0) setCaseCount(caseCount - 1);
  };

  // Bulk manual entry
  const handleManualEntry = () => {
    const bulk = parseInt(manualInput, 10);
    if (!isNaN(bulk) && bulk > 0) {
      setCaseCount(caseCount + bulk);
      setManualInput('');
      toast.success(`Added ${bulk} case${bulk !== 1 ? 's' : ''}`);
    } else {
      toast.error('Enter a valid number');
    }
  };

  // Start barcode scanner
  const startScanner = async () => {
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (err) {
      toast.error('Camera access denied');
      setShowScanner(false);
    }
  };

  const stopScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setShowScanner(false);
  };

  // Handle scan (simplified—full barcode/QR parsing requires additional library)
  const handleScan = (barcode) => {
    if (scannedCases.includes(barcode)) {
      toast.error('Duplicate scan!');
      return;
    }
    setScannedCases([...scannedCases, barcode]);
    setCaseCount(caseCount + 1);
    toast.success('Case logged');
  };

  // Complete run
  const handleCompleteRun = () => {
    if (caseCount === 0) {
      toast.error('No cases produced');
      return;
    }
    if (staffList.length === 0) {
      toast.error('Add at least one staff member');
      return;
    }
    onComplete({
      cases_produced: caseCount,
      bottles_produced: bottlesProduced,
      staff: staffList,
      scanned_cases: scannedCases,
      completion_time: new Date().toISOString(),
    });
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto pb-20">
      {/* Run Header */}
      <Card className="p-4 bg-primary/10 border-primary/20">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Bottling Run</p>
          <h2 className="text-2xl font-bold font-display">{run?.product_name}</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Tank</p>
              <p className="font-semibold">{run?.tank_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Bottle Size</p>
              <p className="font-semibold">{run?.bottle_size_ml}ml</p>
            </div>
            <div>
              <p className="text-muted-foreground">Available Volume</p>
              <p className="font-semibold">{spiritVolume.toFixed(1)}L</p>
            </div>
            <div>
              <p className="text-muted-foreground">Est. Consumption</p>
              <p className="font-semibold text-orange-600">{estimatedConsumption.toFixed(2)}L</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Staff Management */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Production Crew</h3>
        <div className="space-y-2 mb-3">
          {staffList.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No staff added yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staffList.map((name, idx) => (
                <Badge key={idx} variant="outline" className="flex items-center gap-1.5">
                  {name}
                  <button onClick={() => handleRemoveStaff(idx)} className="text-destructive hover:text-destructive/80">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Enter staff name"
            value={newStaffName}
            onChange={e => setNewStaffName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddStaff()}
            className="text-base"
          />
          <Button onClick={handleAddStaff} variant="outline" size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      {/* Case Tracking — Large Tap-Friendly UI */}
      <Card className="p-6 bg-gradient-to-b from-primary/5 to-primary/10 border-primary/20">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4 font-semibold">Cases Produced</p>
        <div className="text-center mb-8">
          <p className="text-7xl font-bold font-display text-primary">{caseCount}</p>
        </div>

        {/* Increment / Decrement Buttons */}
        <div className="flex gap-3 mb-6">
          <Button
            onClick={handleDecrementCase}
            disabled={caseCount === 0}
            variant="outline"
            className="flex-1 h-16 text-lg"
          >
            <Minus className="w-6 h-6" />
          </Button>
          <Button
            onClick={handleIncrementCase}
            className="flex-1 h-16 text-lg font-semibold bg-primary hover:bg-primary/90"
          >
            <Plus className="w-6 h-6 mr-2" />+1 Case
          </Button>
        </div>

        {/* Manual Bulk Entry */}
        <div className="flex gap-2 mb-4">
          <Input
            type="number"
            placeholder="Bulk entry (e.g. 10)"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualEntry()}
            className="text-base h-12"
            min="1"
          />
          <Button onClick={handleManualEntry} variant="outline" className="h-12">
            Add Bulk
          </Button>
        </div>

        {/* Barcode Scanner Button */}
        <Button
          onClick={showScanner ? stopScanner : startScanner}
          variant={showScanner ? 'destructive' : 'secondary'}
          className="w-full h-12 text-base font-semibold"
        >
          <Camera className="w-5 h-5 mr-2" />
          {showScanner ? 'Stop Scanner' : 'Scan Cases'}
        </Button>

        {/* Camera Preview */}
        {showScanner && (
          <div className="mt-4 rounded-lg overflow-hidden bg-black">
            <video ref={videoRef} autoPlay playsInline className="w-full aspect-video" />
          </div>
        )}

        {/* Scanned Cases List */}
        {scannedCases.length > 0 && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Scanned Cases: {scannedCases.length}</p>
            <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto text-xs">
              {scannedCases.map((barcode, idx) => (
                <Badge key={idx} variant="secondary" className="font-mono">
                  {barcode.slice(0, 8)}...
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Production Summary */}
      {caseCount > 0 && (
        <Card className="p-4 bg-green-50 border-green-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-green-900 mb-3">Session Summary</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-green-700/70">Cases</p>
              <p className="font-bold text-lg text-green-900">{caseCount}</p>
            </div>
            <div>
              <p className="text-green-700/70">Bottles</p>
              <p className="font-bold text-lg text-green-900">{bottlesProduced}</p>
            </div>
            <div className="col-span-2">
              <p className="text-green-700/70">Spirit Consumed</p>
              <p className="font-bold text-lg text-green-900">{estimatedConsumption.toFixed(2)}L</p>
            </div>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={onCancel} variant="outline" className="flex-1 h-12 text-base">
          Cancel
        </Button>
        <Button
          onClick={handleCompleteRun}
          disabled={caseCount === 0}
          className="flex-1 h-12 text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
        >
          <Check className="w-5 h-5 mr-2" />
          Complete Run
        </Button>
      </div>
    </div>
  );
}