import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, TextField, Chip, Autocomplete,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

function fmt(n) { return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function fmtDec(n, d = 2) { return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }); }

const NUTRIENTS = ['n', 'p', 'k', 's', 'cu', 'b', 'zn'];
const NUTRIENT_LABELS = { n: 'N', p: 'P', k: 'K', s: 'S', cu: 'Cu', b: 'B', zn: 'Zn' };
const MACRO = ['n', 'p', 'k', 's'];
const MICRO = ['cu', 'b', 'zn'];

function parseAnalysis(code) {
  if (!code) return { n: 0, p: 0, k: 0, s: 0, cu: 0, b: 0, zn: 0 };
  const parts = code.split('-').map(Number);
  return {
    n: parts[0] || 0, p: parts[1] || 0, k: parts[2] || 0, s: parts[3] || 0,
    cu: parts[4] || 0, b: parts[5] || 0, zn: parts[6] || 0,
  };
}

function computeRowNutrients(row) {
  const a = parseAnalysis(row.product_analysis);
  const result = {};
  for (const n of NUTRIENTS) {
    result[n] = row.rate * (a[n] / 100);
  }
  return result;
}

function computeBalance(allocation, rows) {
  const yld = allocation.target_yield_bu || 0;
  const required = {
    n: yld * (allocation.n_rate_per_bu || 0),
    p: yld * (allocation.p_rate_per_bu || 0),
    k: yld * (allocation.k_rate_per_bu || 0),
    s: yld * (allocation.s_rate_per_bu || 0),
    cu: allocation.cu_target || 0,
    b: allocation.b_target || 0,
    zn: allocation.zn_target || 0,
  };
  const toApply = {
    n: required.n - (allocation.available_n || 0),
    p: required.p, k: required.k, s: required.s,
    cu: required.cu, b: required.b, zn: required.zn,
  };
  const applied = { n: 0, p: 0, k: 0, s: 0, cu: 0, b: 0, zn: 0 };
  for (const row of rows) {
    const rn = computeRowNutrients(row);
    for (const n of NUTRIENTS) applied[n] += rn[n];
  }
  const surplus = {};
  for (const n of NUTRIENTS) surplus[n] = applied[n] - toApply[n];
  return { required, toApply, applied, surplus, available_n: allocation.available_n || 0 };
}

const FORM_LABELS = { nh3: 'NH3', dry: 'Dry', liquid: 'Liquid', micro_nutrient: 'Micro' };

export default function FertilizerMatrix({ allocation, products, canEdit, onSave, onAllocUpdate }) {
  // Build a lookup from product name → catalog product
  const productMap = useMemo(() => {
    const map = {};
    for (const p of products) map[p.name] = p;
    return map;
  }, [products]);

  const productOptions = useMemo(() => products.map(p => p.name), [products]);

  // Build initial rows from existing fertilizer inputs only
  const buildRows = useCallback(() => {
    const fertInputs = (allocation.inputs || []).filter(i => i.category === 'fertilizer');
    if (fertInputs.length === 0) return [];

    return fertInputs
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((inp, i) => ({
        _key: inp.id || `row_${i}`,
        product_name: inp.product_name,
        product_analysis: inp.product_analysis || '',
        form: inp.form || '',
        rate: inp.rate,
        rate_unit: inp.rate_unit,
        cost_per_unit: inp.cost_per_unit,
        sort_order: inp.sort_order,
      }));
  }, [allocation]);

  const [rows, setRows] = useState(buildRows);
  const [allocFields, setAllocFields] = useState({
    n_rate_per_bu: allocation.n_rate_per_bu ?? '',
    p_rate_per_bu: allocation.p_rate_per_bu ?? '',
    k_rate_per_bu: allocation.k_rate_per_bu ?? '',
    s_rate_per_bu: allocation.s_rate_per_bu ?? '',
    available_n: allocation.available_n ?? '',
    cu_target: allocation.cu_target ?? '',
    b_target: allocation.b_target ?? '',
    zn_target: allocation.zn_target ?? '',
  });
  const debounceRef = useRef(null);
  const allocDebounceRef = useRef(null);

  // Rebuild rows when allocation/products change externally
  useEffect(() => {
    setRows(buildRows());
  }, [buildRows]);

  useEffect(() => {
    setAllocFields({
      n_rate_per_bu: allocation.n_rate_per_bu ?? '',
      p_rate_per_bu: allocation.p_rate_per_bu ?? '',
      k_rate_per_bu: allocation.k_rate_per_bu ?? '',
      s_rate_per_bu: allocation.s_rate_per_bu ?? '',
      available_n: allocation.available_n ?? '',
      cu_target: allocation.cu_target ?? '',
      b_target: allocation.b_target ?? '',
      zn_target: allocation.zn_target ?? '',
    });
  }, [allocation.n_rate_per_bu, allocation.p_rate_per_bu, allocation.k_rate_per_bu,
      allocation.s_rate_per_bu, allocation.available_n,
      allocation.cu_target, allocation.b_target, allocation.zn_target]);

  // Debounced save for fertilizer rows
  const scheduleSave = useCallback((newRows) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSave(allocation.id, newRows);
    }, 1500);
  }, [allocation.id, onSave]);

  // Debounced save for allocation fields (rate/bu, available_n, targets)
  const scheduleAllocSave = useCallback((newFields) => {
    if (allocDebounceRef.current) clearTimeout(allocDebounceRef.current);
    allocDebounceRef.current = setTimeout(() => {
      const fields = {};
      for (const k of ['n_rate_per_bu', 'p_rate_per_bu', 'k_rate_per_bu', 's_rate_per_bu',
                        'available_n', 'cu_target', 'b_target', 'zn_target']) {
        const val = parseFloat(newFields[k]);
        fields[k] = isNaN(val) ? null : val;
      }
      onAllocUpdate(allocation.id, fields);
    }, 1500);
  }, [allocation.id, onAllocUpdate]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (allocDebounceRef.current) clearTimeout(allocDebounceRef.current);
    };
  }, []);

  const updateRow = (idx, field, value) => {
    const newRows = rows.map((r, i) => i === idx ? { ...r, [field]: value } : r);
    setRows(newRows);
    scheduleSave(newRows);
  };

  // When a product is selected from the dropdown, auto-fill analysis/form/unit/cost
  const selectProduct = (idx, productName) => {
    const catalog = productMap[productName];
    const updates = { product_name: productName || '' };
    if (catalog) {
      updates.product_analysis = catalog.analysis_code || '';
      updates.form = catalog.form || '';
      updates.rate_unit = catalog.default_unit || 'lbs/acre';
      updates.cost_per_unit = catalog.default_cost ?? 0;
    }
    const newRows = rows.map((r, i) => i === idx ? { ...r, ...updates } : r);
    setRows(newRows);
    scheduleSave(newRows);
  };

  const addRow = () => {
    const newRow = {
      _key: `row_${Date.now()}`,
      product_name: '',
      product_analysis: '',
      form: '',
      rate: 0,
      rate_unit: 'lbs/acre',
      cost_per_unit: 0,
      sort_order: rows.length + 10,
    };
    setRows([...rows, newRow]);
  };

  const deleteRow = (idx) => {
    const newRows = rows.filter((_, i) => i !== idx);
    setRows(newRows);
    scheduleSave(newRows);
  };

  const updateAllocField = (field, value) => {
    const newFields = { ...allocFields, [field]: value };
    setAllocFields(newFields);
    scheduleAllocSave(newFields);
  };

  // Live allocation for balance computation
  const liveAlloc = useMemo(() => ({
    ...allocation,
    n_rate_per_bu: parseFloat(allocFields.n_rate_per_bu) || 0,
    p_rate_per_bu: parseFloat(allocFields.p_rate_per_bu) || 0,
    k_rate_per_bu: parseFloat(allocFields.k_rate_per_bu) || 0,
    s_rate_per_bu: parseFloat(allocFields.s_rate_per_bu) || 0,
    available_n: parseFloat(allocFields.available_n) || 0,
    cu_target: parseFloat(allocFields.cu_target) || 0,
    b_target: parseFloat(allocFields.b_target) || 0,
    zn_target: parseFloat(allocFields.zn_target) || 0,
  }), [allocation, allocFields]);

  const balance = useMemo(() => computeBalance(liveAlloc, rows), [liveAlloc, rows]);

  const costPerAcre = rows.reduce((s, r) => s + r.rate * r.cost_per_unit, 0);
  const totalCost = costPerAcre * allocation.acres;

  const surplusColor = (val) => val >= 0 ? 'success.main' : 'error.main';
  const surplusFmt = (val) => `${val >= 0 ? '+' : ''}${fmtDec(val, 1)}`;

  const cellSx = { py: 0.25, px: 0.5, fontSize: '0.8rem' };
  const headerSx = { py: 0.5, px: 0.5, fontSize: '0.75rem', fontWeight: 'bold' };
  const inputSx = { style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } };

  return (
    <Box sx={{ mb: 2 }}>
      {/* Section Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>FERTILIZER</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
          ${fmtDec(costPerAcre)}/ac | ${fmt(totalCost)}
        </Typography>
      </Box>

      {/* Nutrient Balance Header */}
      <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: 'action.hover' }}>
        <Typography variant="caption" fontWeight="bold" sx={{ mb: 0.5, display: 'block' }}>
          Nutrient Balance (lbs/acre)
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx} width={120} />
              {NUTRIENTS.map(n => (
                <TableCell key={n} align="right" sx={headerSx}>{NUTRIENT_LABELS[n]}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {/* Rate/Bu row — macros editable from soil tests */}
            <TableRow>
              <TableCell sx={cellSx}>Rate/Bu (lbs)</TableCell>
              {MACRO.map(n => {
                const field = `${n}_rate_per_bu`;
                return (
                  <TableCell key={n} align="right" sx={cellSx}>
                    {canEdit ? (
                      <TextField
                        size="small" type="number"
                        value={allocFields[field]}
                        onChange={e => updateAllocField(field, e.target.value)}
                        sx={{ width: 70 }}
                        inputProps={{ step: '0.01', ...inputSx.style && { style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                        slotProps={{ htmlInput: { step: '0.01', style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                      />
                    ) : fmtDec(liveAlloc[field], 2)}
                  </TableCell>
                );
              })}
              {MICRO.map(n => <TableCell key={n} align="right" sx={{ ...cellSx, color: 'text.disabled' }}>—</TableCell>)}
            </TableRow>
            {/* Required row — computed: yield × Rate/Bu */}
            <TableRow>
              <TableCell sx={cellSx}>Required</TableCell>
              {MACRO.map(n => (
                <TableCell key={n} align="right" sx={cellSx}>{fmtDec(balance.required[n], 1)}</TableCell>
              ))}
              {MICRO.map(n => <TableCell key={n} align="right" sx={{ ...cellSx, color: 'text.disabled' }}>—</TableCell>)}
            </TableRow>
            {/* Available N row — editable from soil tests */}
            <TableRow>
              <TableCell sx={cellSx}>Available N</TableCell>
              <TableCell align="right" sx={cellSx}>
                {canEdit ? (
                  <TextField
                    size="small" type="number"
                    value={allocFields.available_n}
                    onChange={e => updateAllocField('available_n', e.target.value)}
                    sx={{ width: 70 }}
                    slotProps={{ htmlInput: { style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                  />
                ) : fmtDec(balance.available_n, 0)}
              </TableCell>
              {['p','k','s', ...MICRO].map(n => <TableCell key={n} align="right" sx={{ ...cellSx, color: 'text.disabled' }}>—</TableCell>)}
            </TableRow>
            {/* To Apply row — Cu/B/Zn are editable flat targets */}
            <TableRow>
              <TableCell sx={{ ...cellSx, fontWeight: 'bold' }}>To Apply</TableCell>
              {MACRO.map(n => (
                <TableCell key={n} align="right" sx={{ ...cellSx, fontWeight: 'bold' }}>{fmtDec(balance.toApply[n], 1)}</TableCell>
              ))}
              {MICRO.map(n => (
                <TableCell key={n} align="right" sx={cellSx}>
                  {canEdit ? (
                    <TextField
                      size="small" type="number"
                      value={allocFields[`${n}_target`]}
                      onChange={e => updateAllocField(`${n}_target`, e.target.value)}
                      sx={{ width: 60 }}
                      slotProps={{ htmlInput: { style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                    />
                  ) : fmtDec(balance.toApply[n], 1)}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Paper>

      {/* Product Matrix */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': headerSx }}>
              <TableCell sx={{ minWidth: 160 }}>Product</TableCell>
              <TableCell>Analysis</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell align="right">$/Unit</TableCell>
              <TableCell align="right">$/Acre</TableCell>
              <TableCell align="right">Total $</TableCell>
              <TableCell>Form</TableCell>
              {NUTRIENTS.map(n => (
                <TableCell key={n} align="right">{NUTRIENT_LABELS[n]}</TableCell>
              ))}
              {canEdit && <TableCell width={32} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => {
              const rowNut = computeRowNutrients(row);
              const cpa = row.rate * row.cost_per_unit;
              const isZero = row.rate === 0;
              const rowOpacity = isZero ? 0.45 : 1;

              return (
                <TableRow key={row._key} hover sx={{ opacity: rowOpacity, '& td': cellSx }}>
                  {/* Product — Autocomplete dropdown with freeSolo for custom names */}
                  <TableCell>
                    {canEdit ? (
                      <Autocomplete
                        size="small"
                        freeSolo
                        options={productOptions}
                        value={row.product_name}
                        onChange={(_, val) => selectProduct(idx, val || '')}
                        onInputChange={(_, val, reason) => {
                          if (reason === 'input') updateRow(idx, 'product_name', val);
                        }}
                        renderInput={(params) => (
                          <TextField {...params} placeholder="Select product..."
                            sx={{ minWidth: 140 }}
                            slotProps={{ htmlInput: { ...params.inputProps, style: { fontSize: '0.8rem', padding: '2px 4px' } } }}
                          />
                        )}
                        disableClearable
                        sx={{ '& .MuiOutlinedInput-root': { py: 0 } }}
                      />
                    ) : row.product_name}
                  </TableCell>
                  {/* Analysis — editable override */}
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {canEdit ? (
                      <TextField size="small" value={row.product_analysis}
                        onChange={e => updateRow(idx, 'product_analysis', e.target.value)}
                        placeholder="N-P-K-S"
                        sx={{ width: 110 }}
                        slotProps={{ htmlInput: { style: { fontSize: '0.8rem', padding: '2px 4px' } } }}
                      />
                    ) : (row.product_analysis || '—')}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit ? (
                      <TextField size="small" type="number" value={row.rate}
                        onChange={e => updateRow(idx, 'rate', parseFloat(e.target.value) || 0)}
                        sx={{ width: 70 }}
                        slotProps={{ htmlInput: { style: { textAlign: 'right', fontSize: '0.8rem', padding: '2px 4px' } } }}
                      />
                    ) : fmtDec(row.rate)}
                  </TableCell>
                  <TableCell>{row.rate_unit}</TableCell>
                  <TableCell align="right">
                    {canEdit ? (
                      <TextField size="small" type="number" value={row.cost_per_unit}
                        onChange={e => updateRow(idx, 'cost_per_unit', parseFloat(e.target.value) || 0)}
                        sx={{ width: 80 }}
                        slotProps={{ htmlInput: { style: { textAlign: 'right', fontSize: '0.8rem', padding: '2px 4px' } } }}
                      />
                    ) : `$${fmtDec(row.cost_per_unit, 4)}`}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>${fmtDec(cpa)}</TableCell>
                  <TableCell align="right">${fmt(cpa * allocation.acres)}</TableCell>
                  <TableCell>
                    {row.form ? (
                      <Chip label={FORM_LABELS[row.form] || row.form} size="small" variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }} />
                    ) : '—'}
                  </TableCell>
                  {NUTRIENTS.map(n => (
                    <TableCell key={n} align="right" sx={{
                      ...cellSx,
                      color: rowNut[n] > 0 ? 'text.primary' : 'text.disabled',
                    }}>
                      {fmtDec(rowNut[n], 1)}
                    </TableCell>
                  ))}
                  {canEdit && (
                    <TableCell>
                      <IconButton size="small" color="error" onClick={() => deleteRow(idx)}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}

            {/* Applied row */}
            <TableRow sx={{ '& td': { ...cellSx, fontWeight: 'bold', borderTop: '2px solid', borderColor: 'divider' } }}>
              <TableCell colSpan={8}>Applied</TableCell>
              {NUTRIENTS.map(n => (
                <TableCell key={n} align="right">{fmtDec(balance.applied[n], 1)}</TableCell>
              ))}
              {canEdit && <TableCell />}
            </TableRow>

            {/* Surplus row */}
            <TableRow sx={{ '& td': { ...cellSx, fontWeight: 'bold' } }}>
              <TableCell colSpan={8}>Surplus</TableCell>
              {NUTRIENTS.map(n => (
                <TableCell key={n} align="right" sx={{ color: surplusColor(balance.surplus[n]) }}>
                  {surplusFmt(balance.surplus[n])}
                </TableCell>
              ))}
              {canEdit && <TableCell />}
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {canEdit && (
        <Button size="small" startIcon={<AddIcon />} onClick={addRow} sx={{ mt: 0.5 }}>
          Add Row
        </Button>
      )}
    </Box>
  );
}
