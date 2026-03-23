import { useState } from 'react';
import {
  Box, Typography, Paper, Button, TextField, CircularProgress,
  Autocomplete, FormGroup, FormControlLabel, Checkbox,
  ToggleButtonGroup, ToggleButton, Divider, Alert,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableChartIcon from '@mui/icons-material/TableChart';
import DescriptionIcon from '@mui/icons-material/Description';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';
import { extractErrorMessage } from '../../utils/errorHelpers';

const ALL_BU_OPTION = { id: 'all', name: 'All Business Units' };

const BU_SECTIONS = [
  { key: 'crop_plan', label: 'Crop Plan' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'labour', label: 'Labour' },
  { key: 'cost_model', label: 'Operating Statement' },
  { key: 'per_acre', label: 'Per-Acre Analysis' },
];

const ENTERPRISE_SECTIONS = [
  { key: 'marketing', label: 'Marketing Contracts', enterprise: true },
  { key: 'logistics', label: 'Logistics Summary', enterprise: true },
  { key: 'inventory', label: 'Inventory Position', enterprise: true },
];

const MIME_TYPES = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

const EXTENSIONS = { pdf: '.pdf', excel: '.xlsx', csv: '.csv' };

export default function ReportingDashboard() {
  const { farmUnits } = useFarm();

  // Canned report state
  const [cannedYear, setCannedYear] = useState(2026);
  const [cannedLoading, setCannedLoading] = useState(false);
  const [cannedError, setCannedError] = useState('');

  // Custom report state
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [selectedBUs, setSelectedBUs] = useState([ALL_BU_OPTION]);
  const [selectedSections, setSelectedSections] = useState(['crop_plan', 'procurement', 'labour', 'cost_model', 'per_acre', 'marketing', 'logistics', 'inventory']);
  const [format, setFormat] = useState('pdf');
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState('');

  const buOptions = [ALL_BU_OPTION, ...farmUnits];

  const handleCannedGenerate = async () => {
    setCannedLoading(true);
    setCannedError('');
    try {
      const res = await api.get('/api/admin/reporting/production-year', {
        params: { year: cannedYear },
        responseType: 'blob',
      });
      downloadBlob(res.data, `production-year-report-FY${cannedYear}.pdf`, 'application/pdf');
    } catch (err) {
      setCannedError(extractErrorMessage(err, 'Failed to generate report'));
    } finally {
      setCannedLoading(false);
    }
  };

  const handleBUChange = (_e, value) => {
    if (!value || value.length === 0) {
      setSelectedBUs([]);
      return;
    }
    const lastPicked = value[value.length - 1];
    if (lastPicked.id === 'all') {
      setSelectedBUs([ALL_BU_OPTION]);
    } else {
      setSelectedBUs(value.filter(v => v.id !== 'all'));
    }
  };

  const toggleSection = (key) => {
    setSelectedSections(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  const handleCustomGenerate = async () => {
    setCustomLoading(true);
    setCustomError('');
    try {
      const farmIds = selectedBUs.some(b => b.id === 'all')
        ? ['all']
        : selectedBUs.map(b => b.id);

      const res = await api.post('/api/admin/reporting/custom', {
        fiscalYear,
        farmIds,
        sections: selectedSections,
        format,
      }, { responseType: 'blob' });

      const ext = EXTENSIONS[format];
      downloadBlob(res.data, `c2-custom-report-FY${fiscalYear}${ext}`, MIME_TYPES[format]);
    } catch (err) {
      setCustomError(extractErrorMessage(err, 'Failed to generate custom report'));
    } finally {
      setCustomLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Typography variant="h5" gutterBottom>Reports</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Generate canned or custom reports across all business units and modules.
      </Typography>

      {/* Canned Reports */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Canned Reports</Typography>
        <Divider sx={{ mb: 2 }} />

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2">Production Year Report</Typography>
            <Typography variant="body2" color="text.secondary">
              Comprehensive PDF with all module data by BU — crop plan, procurement, labour, cost model, per-acre — plus enterprise marketing, logistics, and inventory.
            </Typography>
          </Box>
          <TextField
            label="FY"
            type="number"
            size="small"
            value={cannedYear}
            onChange={(e) => setCannedYear(Number(e.target.value))}
            sx={{ width: 90 }}
          />
          <Button
            variant="contained"
            onClick={handleCannedGenerate}
            disabled={cannedLoading}
            startIcon={cannedLoading ? <CircularProgress size={18} /> : <PictureAsPdfIcon />}
          >
            {cannedLoading ? 'Generating...' : 'Generate PDF'}
          </Button>
        </Box>
        {cannedError && <Alert severity="error" sx={{ mt: 1 }}>{cannedError}</Alert>}
      </Paper>

      {/* Custom Report Builder */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>Custom Report Builder</Typography>
        <Divider sx={{ mb: 2 }} />

        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <TextField
            label="Fiscal Year"
            type="number"
            size="small"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            sx={{ width: 120 }}
          />
          <Autocomplete
            multiple
            size="small"
            options={buOptions}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            value={selectedBUs}
            onChange={handleBUChange}
            renderInput={(params) => <TextField {...params} label="Business Units" />}
            sx={{ minWidth: 300, flex: 1 }}
          />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Sections</Typography>
        <Box sx={{ display: 'flex', gap: 4, mb: 3 }}>
          <FormGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>Per Business Unit</Typography>
            {BU_SECTIONS.map(s => (
              <FormControlLabel
                key={s.key}
                control={<Checkbox size="small" checked={selectedSections.includes(s.key)} onChange={() => toggleSection(s.key)} />}
                label={<Typography variant="body2">{s.label}</Typography>}
              />
            ))}
          </FormGroup>
          <FormGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>Enterprise-wide</Typography>
            {ENTERPRISE_SECTIONS.map(s => (
              <FormControlLabel
                key={s.key}
                control={<Checkbox size="small" checked={selectedSections.includes(s.key)} onChange={() => toggleSection(s.key)} />}
                label={<Typography variant="body2">{s.label}</Typography>}
              />
            ))}
          </FormGroup>
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Format</Typography>
        <ToggleButtonGroup
          value={format}
          exclusive
          onChange={(_e, val) => val && setFormat(val)}
          size="small"
          sx={{ mb: 3 }}
        >
          <ToggleButton value="pdf"><PictureAsPdfIcon sx={{ mr: 0.5, fontSize: 18 }} /> PDF</ToggleButton>
          <ToggleButton value="excel"><TableChartIcon sx={{ mr: 0.5, fontSize: 18 }} /> Excel</ToggleButton>
          <ToggleButton value="csv"><DescriptionIcon sx={{ mr: 0.5, fontSize: 18 }} /> CSV</ToggleButton>
        </ToggleButtonGroup>

        <Box>
          <Button
            variant="contained"
            onClick={handleCustomGenerate}
            disabled={customLoading || selectedSections.length === 0}
            startIcon={customLoading ? <CircularProgress size={18} /> : null}
            size="large"
          >
            {customLoading ? 'Generating...' : 'Generate Report'}
          </Button>
        </Box>
        {customError && <Alert severity="error" sx={{ mt: 1 }}>{customError}</Alert>}
      </Paper>
    </Box>
  );
}

function downloadBlob(data, filename, type) {
  const url = window.URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
