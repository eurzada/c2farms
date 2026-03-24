import { useState, useEffect } from 'react';
import { Typography, Box, Button, Alert, Tabs, Tab, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import EditIcon from '@mui/icons-material/Edit';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountingGrid from '../components/accounting/AccountingGrid';
import CashFlowSummary from '../components/accounting/CashFlowSummary';
import ExportButtons from '../components/accounting/ExportButtons';
import CsvImportButton from '../components/accounting/CsvImportButton';
import ActualsGrid from '../components/shared/ActualsGrid';
import VarianceGrid from '../components/shared/VarianceGrid';
import TabPanel from '../components/shared/TabPanel';
import { useFarm } from '../contexts/FarmContext';
import api from '../services/api';

export default function Accounting() {
  const { currentFarm, fiscalYear, canEdit } = useFarm();
  const [summary, setSummary] = useState({});
  const [months, setMonths] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [viewTab, setViewTab] = useState(0);
  const [varianceData, setVarianceData] = useState(null);

  // Load variance data when variance tab is selected (tab 0)
  useEffect(() => {
    if (!currentFarm?.id || !fiscalYear || viewTab !== 0) return;
    api.get(`/api/farms/${currentFarm.id}/variance/${fiscalYear}`)
      .then(res => setVarianceData(res.data))
      .catch(() => setVarianceData(null));
  }, [currentFarm?.id, fiscalYear, viewTab, refreshKey]);

  const handleSummaryLoaded = (newSummary, newMonths) => {
    setSummary(newSummary);
    if (newMonths) setMonths(newMonths);
  };

  const handleClearActuals = async () => {
    setClearing(true);
    try {
      const res = await api.delete(`/api/farms/${currentFarm.id}/accounting/clear-year`, {
        data: { fiscal_year: fiscalYear },
      });
      setSyncMessage(res.data.message);
      setRefreshKey(k => k + 1);
    } catch {
      setSyncMessage('Failed to clear actuals.');
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
        <Typography variant="h5">Cost Forecast</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ExportButtons farmId={currentFarm.id} fiscalYear={fiscalYear} />
        </Box>
      </Box>

      {syncMessage && (
        <Alert
          severity={syncMessage.includes('failed') || syncMessage.includes('Failed') ? 'warning' : 'info'}
          sx={{ mb: 2 }}
          onClose={() => setSyncMessage('')}
        >
          {syncMessage}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={viewTab} onChange={(_, v) => setViewTab(v)}>
          <Tab icon={<CompareArrowsIcon />} iconPosition="start" label="Variance" />
          <Tab icon={<EditIcon />} iconPosition="start" label="Plan" />
          <Tab icon={<ReceiptLongIcon />} iconPosition="start" label="Actuals" />
        </Tabs>
      </Box>

      <TabPanel value={viewTab} index={0}>
        <VarianceGrid data={varianceData} />
      </TabPanel>

      <TabPanel value={viewTab} index={1}>
        <AccountingGrid
          farmId={currentFarm.id}
          fiscalYear={fiscalYear}
          key={refreshKey}
          onSummaryLoaded={handleSummaryLoaded}
        />
        <CashFlowSummary summary={summary} months={months} />
      </TabPanel>

      <TabPanel value={viewTab} index={2}>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {canEdit && (
            <>
              <CsvImportButton
                farmId={currentFarm.id}
                fiscalYear={fiscalYear}
                onImportComplete={() => setRefreshKey(k => k + 1)}
              />
              <Button variant="outlined" color="error" size="small" startIcon={<DeleteSweepIcon />}
                onClick={() => setClearDialogOpen(true)}>
                Clear Actuals
              </Button>
            </>
          )}
        </Box>
        <ActualsGrid mode="accounting" />
      </TabPanel>

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear Actuals</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Clear all imported QB actuals for FY {fiscalYear}? This removes GL detail records and
            actual monthly data. Your plan data will not be affected. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleClearActuals} color="error" variant="contained" disabled={clearing}>
            {clearing ? 'Clearing...' : 'Clear Actuals'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
