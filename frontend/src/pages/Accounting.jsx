import { useState } from 'react';
import { Typography, Box, Button, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import AccountingGrid from '../components/accounting/AccountingGrid';
import CashFlowSummary from '../components/accounting/CashFlowSummary';
import ExportButtons from '../components/accounting/ExportButtons';
import CsvImportButton from '../components/accounting/CsvImportButton';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function Accounting() {
  const { currentFarm, fiscalYear, canEdit } = useFarm();
  const [summary, setSummary] = useState({});
  const [months, setMonths] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleSummaryLoaded = (newSummary, newMonths) => {
    setSummary(newSummary);
    if (newMonths) setMonths(newMonths);
  };

  const handleQBSync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const res = await api.post(`/api/farms/${currentFarm.id}/quickbooks/sync`, {
        fiscal_year: fiscalYear,
      });
      if (res.data.fallback) {
        setSyncMessage(res.data.message);
      } else {
        setSyncMessage('QuickBooks sync completed successfully');
        setRefreshKey(k => k + 1);
      }
    } catch {
      setSyncMessage('QuickBooks sync failed. Please enter actuals manually.');
    } finally {
      setSyncing(false);
    }
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
        <Typography variant="h5">
          Section 3: Accounting Operating Statement
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {canEdit && (
            <>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteSweepIcon />}
                onClick={() => setClearDialogOpen(true)}
              >
                Clear Year
              </Button>
              <CsvImportButton
                farmId={currentFarm.id}
                fiscalYear={fiscalYear}
                onImportComplete={() => setRefreshKey(k => k + 1)}
              />
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={handleQBSync}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'QB Sync'}
              </Button>
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
