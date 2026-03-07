import { useState, useEffect } from 'react';
import { Typography, Box, Button, Alert, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import AccountingGrid from '../components/accounting/AccountingGrid';
import CashFlowSummary from '../components/accounting/CashFlowSummary';
import ExportButtons from '../components/accounting/ExportButtons';
import CsvImportButton from '../components/accounting/CsvImportButton';
import FreezeDialog from '../components/assumptions/FreezeDialog';
import UnfreezeDialog from '../components/assumptions/UnfreezeDialog';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function Accounting() {
  const { currentFarm, fiscalYear, canEdit, isAdmin } = useFarm();
  const [summary, setSummary] = useState({});
  const [months, setMonths] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);

  // Load frozen status
  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear) return;
    api.get(`/api/farms/${currentFarm.id}/assumptions/${fiscalYear}`)
      .then(res => setIsFrozen(res.data?.is_frozen || false))
      .catch(() => setIsFrozen(false));
  }, [currentFarm, fiscalYear, refreshKey]);

  const handleFreeze = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/assumptions/${fiscalYear}/freeze`);
      setIsFrozen(true); setFreezeOpen(false);
      setSyncMessage('Budget frozen successfully');
      setRefreshKey(k => k + 1);
    } catch (err) { setSyncMessage(err.response?.data?.error || 'Failed to freeze'); }
  };

  const handleUnfreeze = async () => {
    try {
      await api.post(`/api/farms/${currentFarm.id}/assumptions/${fiscalYear}/unfreeze`);
      setIsFrozen(false); setUnfreezeOpen(false);
      setSyncMessage('Budget unfrozen successfully');
      setRefreshKey(k => k + 1);
    } catch (err) { setSyncMessage(err.response?.data?.error || 'Failed to unfreeze'); }
  };

  const handleSummaryLoaded = (newSummary, newMonths) => {
    setSummary(newSummary);
    if (newMonths) setMonths(newMonths);
  };

  const handleClearYear = async () => {
    setClearing(true);
    try {
      const res = await api.delete(`/api/farms/${currentFarm.id}/accounting/clear-year`, {
        data: { fiscal_year: fiscalYear },
      });
      setSyncMessage(res.data.message);
      setRefreshKey(k => k + 1);
    } catch {
      setSyncMessage('Failed to clear year data.');
    } finally {
      setClearing(false);
      setClearDialogOpen(false);
    }
  };

  if (!currentFarm) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No farm selected.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h5">Cost Forecast</Typography>
          {isFrozen && <Chip icon={<LockIcon />} label="Budget Frozen" color="warning" size="small" />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {!isFrozen && canEdit && (
            <Button variant="outlined" color="warning" size="small" startIcon={<AcUnitIcon />}
              onClick={() => setFreezeOpen(true)}>
              Freeze Budget
            </Button>
          )}
          {isFrozen && isAdmin && (
            <Button variant="outlined" color="info" size="small" startIcon={<LockOpenIcon />}
              onClick={() => setUnfreezeOpen(true)}>
              Unfreeze
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="outlined" color="error" size="small" startIcon={<DeleteSweepIcon />}
                onClick={() => setClearDialogOpen(true)}>
                Clear Year
              </Button>
              <CsvImportButton
                farmId={currentFarm.id}
                fiscalYear={fiscalYear}
                onImportComplete={() => setRefreshKey(k => k + 1)}
              />
            </>
          )}
          <ExportButtons farmId={currentFarm.id} fiscalYear={fiscalYear} />
        </Box>
      </Box>

      {syncMessage && (
        <Alert
          severity={syncMessage.includes('failed') || syncMessage.includes('not connected') ? 'warning' : 'info'}
          sx={{ mb: 2 }}
          onClose={() => setSyncMessage('')}
        >
          {syncMessage}
        </Alert>
      )}

      <AccountingGrid
        farmId={currentFarm.id}
        fiscalYear={fiscalYear}
        key={refreshKey}
        onSummaryLoaded={handleSummaryLoaded}
      />
      <CashFlowSummary summary={summary} months={months} />

      <FreezeDialog open={freezeOpen} onConfirm={handleFreeze} onCancel={() => setFreezeOpen(false)} fiscalYear={fiscalYear} />
      <UnfreezeDialog open={unfreezeOpen} onConfirm={handleUnfreeze} onCancel={() => setUnfreezeOpen(false)} fiscalYear={fiscalYear} />

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear Year Data</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Clear all imported accounting data for FY {fiscalYear}? This will remove all GL detail
            and reset monthly data to zero. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleClearYear} color="error" variant="contained" disabled={clearing}>
            {clearing ? 'Clearing...' : 'Clear Year Data'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
