import { useState, useMemo, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stepper, Step, StepLabel, Alert, Chip, Stack, LinearProgress,
  FormControl, InputLabel, Select, MenuItem, TextField,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useThemeMode } from '../../contexts/ThemeContext';
import api from '../../services/api';

const steps = ['Upload File', 'Preview & Resolve', 'Complete'];

function MatchChip({ value }) {
  if (!value) return <Chip label="No match" size="small" color="warning" variant="outlined" />;
  return <Chip label={value} size="small" color="success" variant="outlined" />;
}

export default function ElevatorTicketImportDialog({ open, onClose, farmId, countPeriodId, periodLabel, onImported }) {
  const { mode } = useThemeMode();
  const gridRef = useRef();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [fileName, setFileName] = useState('');

  // Resolution state
  const [commodities, setCommodities] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [commodityMap, setCommodityMap] = useState({});
  const [counterpartyMap, setCounterpartyMap] = useState({});

  const loadLookups = useCallback(async () => {
    try {
      const [comRes, cpRes] = await Promise.all([
        api.get(`/api/farms/${farmId}/inventory/commodities`),
        api.get(`/api/farms/${farmId}/marketing/counterparties`),
      ]);
      setCommodities(comRes.data.commodities || []);
      setCounterparties(cpRes.data.counterparties || cpRes.data || []);
    } catch { /* ignore */ }
  }, [farmId]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const [res] = await Promise.all([
        api.post(`/api/farms/${farmId}/reconciliation/${countPeriodId}/elevator-tickets/preview`, formData),
        loadLookups(),
      ]);
      setPreview(res.data);

      // Initialize resolution maps for unmatched items
      const tickets = res.data.tickets || [];
      const unmatchedCrops = {};
      const unmatchedBuyers = {};
      for (const t of tickets) {
        if (!t.commodity_id && t.commodity_raw) {
          unmatchedCrops[t.commodity_raw] = unmatchedCrops[t.commodity_raw] || { action: '', targetId: '', newName: t.commodity_raw, newCode: '', newLbsPerBu: '' };
        }
        if (!t.counterparty_id && t.buyer_name) {
          unmatchedBuyers[t.buyer_name] = unmatchedBuyers[t.buyer_name] || { action: '', targetId: '', newName: t.buyer_name };
        }
      }
      setCommodityMap(unmatchedCrops);
      setCounterpartyMap(unmatchedBuyers);
      setActiveStep(1);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const unmatchedCropNames = Object.keys(commodityMap);
  const unmatchedBuyerNames = Object.keys(counterpartyMap);
  const hasUnresolved = unmatchedCropNames.some(k => !commodityMap[k].action) ||
    unmatchedBuyerNames.some(k => !counterpartyMap[k].action);
  const hasIssues = unmatchedCropNames.length > 0 || unmatchedBuyerNames.length > 0;

  const handleImport = async () => {
    if (!preview?.tickets) return;
    setLoading(true);
    setError(null);
    try {
      // Create new commodities/counterparties
      const newCommodityIds = {};
      const newCounterpartyIds = {};

      for (const [cropName, resolution] of Object.entries(commodityMap)) {
        if (resolution.action === 'create') {
          if (!resolution.newCode || !resolution.newLbsPerBu) {
            setError(`Please fill in code and lbs/bu for new commodity "${cropName}"`);
            setLoading(false);
            return;
          }
          const res = await api.post(`/api/farms/${farmId}/inventory/commodities`, {
            name: resolution.newName || cropName,
            code: resolution.newCode,
            lbs_per_bu: parseFloat(resolution.newLbsPerBu),
          });
          newCommodityIds[cropName] = res.data.commodity.id;
        }
      }

      for (const [buyerName, resolution] of Object.entries(counterpartyMap)) {
        if (resolution.action === 'create') {
          const res = await api.post(`/api/farms/${farmId}/marketing/counterparties`, {
            name: resolution.newName || buyerName,
            short_code: (resolution.newName || buyerName).substring(0, 10).toUpperCase().replace(/\s+/g, ''),
            type: 'buyer',
          });
          newCounterpartyIds[buyerName] = res.data.counterparty.id;
        }
      }

      // Update tickets with resolved IDs
      const resolvedTickets = preview.tickets.map(t => {
        const ticket = { ...t };
        if (!ticket.commodity_id && ticket.commodity_raw) {
          const resolution = commodityMap[ticket.commodity_raw];
          if (resolution?.action === 'map') {
            ticket.commodity_id = resolution.targetId;
            ticket.commodity_match = commodities.find(c => c.id === resolution.targetId)?.name || null;
          } else if (resolution?.action === 'create') {
            ticket.commodity_id = newCommodityIds[ticket.commodity_raw];
            ticket.commodity_match = resolution.newName || ticket.commodity_raw;
          }
        }
        if (!ticket.counterparty_id && ticket.buyer_name) {
          const resolution = counterpartyMap[ticket.buyer_name];
          if (resolution?.action === 'map') {
            ticket.counterparty_id = resolution.targetId;
            ticket.counterparty_match = counterparties.find(c => c.id === resolution.targetId)?.name || null;
          } else if (resolution?.action === 'create') {
            ticket.counterparty_id = newCounterpartyIds[ticket.buyer_name];
            ticket.counterparty_match = resolution.newName || ticket.buyer_name;
          }
        }
        return ticket;
      });

      // Build alias resolutions
      const aliasResolutions = { commodityMap: {}, counterpartyMap: {} };
      for (const [cropName, resolution] of Object.entries(commodityMap)) {
        if (resolution.action === 'map') {
          aliasResolutions.commodityMap[cropName] = { action: 'map', targetId: resolution.targetId };
        } else if (resolution.action === 'create') {
          aliasResolutions.commodityMap[cropName] = { action: 'create', createdId: newCommodityIds[cropName] };
        }
      }
      for (const [buyerName, resolution] of Object.entries(counterpartyMap)) {
        if (resolution.action === 'map') {
          aliasResolutions.counterpartyMap[buyerName] = { action: 'map', targetId: resolution.targetId };
        } else if (resolution.action === 'create') {
          aliasResolutions.counterpartyMap[buyerName] = { action: 'create', createdId: newCounterpartyIds[buyerName] };
        }
      }

      // Commit
      const res = await api.post(`/api/farms/${farmId}/reconciliation/${countPeriodId}/elevator-tickets/commit`, {
        tickets: resolvedTickets,
        resolutions: aliasResolutions,
        source_file: fileName,
      });
      setImportResult(res.data);
      setActiveStep(2);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setFileName('');
    setCommodityMap({});
    setCounterpartyMap({});
    onClose();
    if (importResult) onImported?.();
  };

  const updateCommodityResolution = (name, field, value) => {
    setCommodityMap(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  };
  const updateCounterpartyResolution = (name, field, value) => {
    setCounterpartyMap(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  };

  const ticketCountByCrop = useMemo(() => {
    if (!preview?.tickets) return {};
    const counts = {};
    for (const t of preview.tickets) {
      if (!t.commodity_id && t.commodity_raw) counts[t.commodity_raw] = (counts[t.commodity_raw] || 0) + 1;
    }
    return counts;
  }, [preview]);

  const ticketCountByBuyer = useMemo(() => {
    if (!preview?.tickets) return {};
    const counts = {};
    for (const t of preview.tickets) {
      if (!t.counterparty_id && t.buyer_name) counts[t.buyer_name] = (counts[t.buyer_name] || 0) + 1;
    }
    return counts;
  }, [preview]);

  const columnDefs = useMemo(() => [
    {
      field: 'status', headerName: '', width: 80, sortable: false,
      cellRenderer: p => p.value === 'duplicate'
        ? <Chip label="Dup" size="small" color="warning" />
        : <Chip label="New" size="small" color="primary" />,
    },
    { field: 'ticket_number', headerName: 'Ticket #', width: 120 },
    { field: 'delivery_date', headerName: 'Date', width: 110 },
    { field: 'commodity_raw', headerName: 'Commodity', width: 130,
      cellStyle: p => (!p.data?.commodity_id && p.value) ? { backgroundColor: '#FFF3E0', fontWeight: 600 } : null,
    },
    { field: 'net_weight_mt', headerName: 'Net MT', width: 100, valueFormatter: p => p.value?.toFixed(3) },
    { field: 'counterparty_match', headerName: 'Buyer', width: 140,
      cellRenderer: p => {
        if (p.value) return <MatchChip value={p.value} />;
        if (p.data?.buyer_name) return <Chip label={p.data.buyer_name} size="small" color="warning" />;
        return <MatchChip value={null} />;
      },
    },
    { field: 'grade', headerName: 'Grade', width: 100 },
    { field: 'protein_pct', headerName: 'Protein %', width: 100, valueFormatter: p => p.value?.toFixed(1) || '' },
    { field: 'moisture_pct', headerName: 'Moisture %', width: 100, valueFormatter: p => p.value?.toFixed(1) || '' },
    { field: 'contract_number', headerName: 'Contract', width: 140 },
    { field: 'destination', headerName: 'Destination', width: 140 },
  ], []);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xl" fullWidth>
      <DialogTitle>Import Elevator Tickets (Buyer Portal)</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Step 0: Upload */}
        {activeStep === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <UploadFileIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Upload Buyer Portal Export</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Upload a CSV or Excel file exported from a buyer portal (Cargill, Richardson, G3, etc.)
            </Typography>
            {periodLabel && (
              <Typography variant="body2" color="primary" sx={{ mb: 3, fontWeight: 600 }}>
                Target period: {periodLabel}
              </Typography>
            )}
            <Button variant="contained" component="label" disabled={loading}>
              Choose File
              <input type="file" accept=".csv,.xlsx" hidden onChange={handleFileUpload} />
            </Button>
          </Box>
        )}

        {/* Step 1: Preview & Resolve */}
        {activeStep === 1 && preview && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
              <Chip label={`${preview.summary?.total || 0} tickets`} color="primary" />
              <Chip label={`${preview.summary?.new_count || 0} new`} color="success" />
              {(preview.summary?.duplicate_count || 0) > 0 && (
                <Chip label={`${preview.summary.duplicate_count} duplicates (will replace)`} color="warning" />
              )}
              <Chip label={`Detected: ${preview.detected_unit?.toUpperCase()}`} variant="outlined" />
            </Stack>

            {preview.errors.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.errors.length} row(s) skipped: {preview.errors.slice(0, 3).join('; ')}
                {preview.errors.length > 3 && ` and ${preview.errors.length - 3} more...`}
              </Alert>
            )}

            {hasIssues && (
              <Alert
                severity={hasUnresolved ? 'warning' : 'success'}
                icon={hasUnresolved ? <WarningAmberIcon /> : <CheckCircleIcon />}
                sx={{ mb: 2 }}
              >
                {hasUnresolved
                  ? 'Resolve the items below before importing. Map them to existing records or create new ones.'
                  : 'All issues resolved — ready to import.'}
              </Alert>
            )}

            {/* Unmatched Commodities */}
            {unmatchedCropNames.length > 0 && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                  Unmatched Commodities ({unmatchedCropNames.length})
                </Typography>
                {unmatchedCropNames.map(cropName => (
                  <Box key={cropName} sx={{ mb: 1.5, pl: 1 }}>
                    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                        "{cropName}" <Chip label={`${ticketCountByCrop[cropName]} ticket(s)`} size="small" sx={{ ml: 0.5 }} />
                      </Typography>
                      <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Action</InputLabel>
                        <Select
                          value={commodityMap[cropName]?.action || ''}
                          label="Action"
                          onChange={e => updateCommodityResolution(cropName, 'action', e.target.value)}
                        >
                          <MenuItem value="">— Select —</MenuItem>
                          <MenuItem value="map">Map to existing</MenuItem>
                          <MenuItem value="create">Create new</MenuItem>
                          <MenuItem value="skip">Import without linking</MenuItem>
                        </Select>
                      </FormControl>

                      {commodityMap[cropName]?.action === 'map' && (
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                          <InputLabel>Commodity</InputLabel>
                          <Select
                            value={commodityMap[cropName]?.targetId || ''}
                            label="Commodity"
                            onChange={e => updateCommodityResolution(cropName, 'targetId', e.target.value)}
                          >
                            {commodities.map(c => (
                              <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}

                      {commodityMap[cropName]?.action === 'create' && (
                        <>
                          <TextField
                            size="small" label="Name" sx={{ width: 140 }}
                            value={commodityMap[cropName]?.newName || ''}
                            onChange={e => updateCommodityResolution(cropName, 'newName', e.target.value)}
                          />
                          <TextField
                            size="small" label="Code" sx={{ width: 80 }}
                            value={commodityMap[cropName]?.newCode || ''}
                            onChange={e => updateCommodityResolution(cropName, 'newCode', e.target.value.toUpperCase())}
                            placeholder="e.g. OAT"
                          />
                          <TextField
                            size="small" label="Lbs/bu" sx={{ width: 80 }} type="number"
                            value={commodityMap[cropName]?.newLbsPerBu || ''}
                            onChange={e => updateCommodityResolution(cropName, 'newLbsPerBu', e.target.value)}
                            placeholder="e.g. 34"
                          />
                        </>
                      )}
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}

            {/* Unmatched Buyers */}
            {unmatchedBuyerNames.length > 0 && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                  Unmatched Buyers ({unmatchedBuyerNames.length})
                </Typography>
                {unmatchedBuyerNames.map(buyerName => (
                  <Box key={buyerName} sx={{ mb: 1.5, pl: 1 }}>
                    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                        "{buyerName}" <Chip label={`${ticketCountByBuyer[buyerName]} ticket(s)`} size="small" sx={{ ml: 0.5 }} />
                      </Typography>
                      <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Action</InputLabel>
                        <Select
                          value={counterpartyMap[buyerName]?.action || ''}
                          label="Action"
                          onChange={e => updateCounterpartyResolution(buyerName, 'action', e.target.value)}
                        >
                          <MenuItem value="">— Select —</MenuItem>
                          <MenuItem value="map">Map to existing</MenuItem>
                          <MenuItem value="create">Create new</MenuItem>
                          <MenuItem value="skip">Import without linking</MenuItem>
                        </Select>
                      </FormControl>

                      {counterpartyMap[buyerName]?.action === 'map' && (
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                          <InputLabel>Buyer</InputLabel>
                          <Select
                            value={counterpartyMap[buyerName]?.targetId || ''}
                            label="Buyer"
                            onChange={e => updateCounterpartyResolution(buyerName, 'targetId', e.target.value)}
                          >
                            {counterparties.map(cp => (
                              <MenuItem key={cp.id} value={cp.id}>{cp.name}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}

                      {counterpartyMap[buyerName]?.action === 'create' && (
                        <TextField
                          size="small" label="Name" sx={{ width: 200 }}
                          value={counterpartyMap[buyerName]?.newName || ''}
                          onChange={e => updateCounterpartyResolution(buyerName, 'newName', e.target.value)}
                        />
                      )}
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}

            {/* Preview grid */}
            <Box
              className={mode === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
              sx={{ height: 400, width: '100%' }}
            >
              <AgGridReact
                ref={gridRef}
                rowData={preview.tickets}
                columnDefs={columnDefs}
                defaultColDef={{ sortable: true, resizable: true, filter: true }}
                animateRows
                getRowId={p => p.data?.ticket_number}
              />
            </Box>
          </Box>
        )}

        {/* Step 2: Complete */}
        {activeStep === 2 && importResult && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>Import Complete</Typography>
            <Stack direction="row" spacing={2} justifyContent="center" sx={{ mb: 2 }}>
              <Chip label={`${importResult.created} imported`} color="success" />
              {importResult.deleted > 0 && (
                <Chip label={`${importResult.deleted} replaced`} color="info" />
              )}
            </Stack>
            {importResult.errors?.length > 0 && (
              <Alert severity="warning">
                {importResult.errors.length} error(s): {importResult.errors.slice(0, 5).join('; ')}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{activeStep === 2 ? 'Done' : 'Cancel'}</Button>
        {activeStep === 1 && (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={loading || !preview?.tickets?.length || hasUnresolved}
          >
            {hasUnresolved
              ? `Resolve ${unmatchedCropNames.filter(k => !commodityMap[k].action).length + unmatchedBuyerNames.filter(k => !counterpartyMap[k].action).length} Issue(s) to Import`
              : `Import ${preview?.summary?.total || 0} Elevator Tickets`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
