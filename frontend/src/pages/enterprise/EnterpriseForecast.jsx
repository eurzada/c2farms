import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function EnterpriseForecast() {
  const { farmUnits, fiscalYear } = useFarm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!farmUnits?.length) return;
    setLoading(true);

    Promise.all(
      farmUnits.map(farm =>
        api.get(`/api/farms/${farm.id}/assumptions/${fiscalYear}`)
          .then(res => ({ farm, assumptions: res.data }))
          .catch(() => ({ farm, assumptions: null }))
      )
    ).then(results => {
      const farms = results
        .filter(r => r.assumptions)
        .map(r => ({
          name: r.farm.name,
          id: r.farm.id,
          total_acres: r.assumptions.total_acres || 0,
          is_frozen: r.assumptions.is_frozen,
          crops: r.assumptions.crops_json?.length || 0,
        }));

      setData({
        farms,
        total_acres: farms.reduce((s, f) => s + f.total_acres, 0),
        total_farms: farms.length,
        frozen_count: farms.filter(f => f.is_frozen).length,
      });
    }).finally(() => setLoading(false));
  }, [farmUnits, fiscalYear]);

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">Enterprise Forecast</Typography>
        <Chip icon={<VisibilityIcon />} label="Read-Only" size="small" variant="outlined" />
        <Chip label={`FY ${fiscalYear}`} size="small" />
      </Box>

      <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
        This is a consolidated view across all farm units. To edit forecast data, switch to an individual farm unit.
      </Alert>

      {!data || data.farms.length === 0 ? (
        <Alert severity="warning">
          No forecast data found for FY {fiscalYear}. Set up forecast assumptions on individual farm units first.
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Farm Units</Typography>
              <Typography variant="h4" fontWeight="bold">{data.total_farms}</Typography>
            </Paper>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Total Acres</Typography>
              <Typography variant="h4" fontWeight="bold">{fmt(data.total_acres)}</Typography>
            </Paper>
            <Paper sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography variant="body2" color="text.secondary">Budgets Frozen</Typography>
              <Typography variant="h4" fontWeight="bold">{data.frozen_count} / {data.total_farms}</Typography>
            </Paper>
          </Stack>

          <Typography variant="h6" sx={{ mb: 1 }}>Farm Unit Summary</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 'bold', bgcolor: 'grey.100' } }}>
                  <TableCell>Farm Unit</TableCell>
                  <TableCell align="right">Total Acres</TableCell>
                  <TableCell align="right">Crops</TableCell>
                  <TableCell align="center">Budget Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.farms.map(f => (
                  <TableRow key={f.id} hover>
                    <TableCell>{f.name}</TableCell>
                    <TableCell align="right">{fmt(f.total_acres)}</TableCell>
                    <TableCell align="right">{f.crops}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={f.is_frozen ? 'Frozen' : 'Draft'}
                        size="small"
                        color={f.is_frozen ? 'warning' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{fmt(data.total_acres)}</TableCell>
                  <TableCell align="right">—</TableCell>
                  <TableCell align="center">
                    {data.frozen_count === data.total_farms
                      ? <Chip label="All Frozen" size="small" color="success" />
                      : <Chip label={`${data.frozen_count} / ${data.total_farms}`} size="small" variant="outlined" />}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
