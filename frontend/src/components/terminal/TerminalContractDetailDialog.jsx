import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Grid, Paper, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, MenuItem, IconButton, InputAdornment, CircularProgress, Alert, Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../services/api';
import { formatCurrency, fmt, fmtDollar } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import ConfirmDialog from '../shared/ConfirmDialog';
import RealizationPanel from './RealizationPanel';

const STATUS_COLORS = {
  executed: 'info', in_delivery: 'warning', fulfilled: 'success',
  settled: 'default', cancelled: 'error',
};

const SETTLEMENT_STATUS_COLORS = {
  draft: 'default', finalized: 'warning', pushed: 'success',
};

const parseJsonArray = (val) => {
  if (!val) return [];
  try {
    const arr = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const fmtMt = v => v != null ? `${v.toLocaleString('en-CA', { maximumFractionDigits: 1 })} MT` : '\u2014';

const fmtDate = v => {
  if (!v) return '\u2014';
  try { return new Date(v).toLocaleDateString('en-CA'); } catch { return v; }
};

function InfoRow({ label, value, children }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.3 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {children || <Typography variant="body2" fontWeight={500}>{value}</Typography>}
    </Box>
  );
}

function SettlementTable({ settlements, label }) {
  if (!settlements || settlements.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
        No {label.toLowerCase()} yet.
      </Typography>
    );
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Settlement #</TableCell>
            <TableCell align="right">Net MT</TableCell>
            <TableCell align="right">Net Amount</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {settlements.map(s => (
            <TableRow key={s.id}>
              <TableCell>{s.settlement_number || s.id.slice(0, 8)}</TableCell>
              <TableCell align="right">{fmt(s.net_mt ?? s.lines?.reduce((sum, l) => sum + (l.net_mt || 0), 0))}</TableCell>
              <TableCell align="right">{fmtDollar(s.net_amount ?? s.lines?.reduce((sum, l) => sum + (l.net_amount || 0), 0))}</TableCell>
              <TableCell>
                <Chip
                  label={s.status || 'draft'}
                  size="small"
                  color={SETTLEMENT_STATUS_COLORS[s.status] || 'default'}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function TerminalContractDetailDialog({
  open, onClose, contract: contractRow, farmId, onSaved, counterparties = [], commodities = [],
}) {
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});

  const load = useCallback(async () => {
    if (!farmId || !contractRow?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/contracts/${contractRow.id}`);
      setContract(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load contract'));
    } finally {
      setLoading(false);
    }
  }, [farmId, contractRow?.id]);

  useEffect(() => {
    if (open) { load(); setEditing(false); setError(null); }
    else { setContract(null); }
  }, [open, load]);

  const initEditForm = useCallback(() => {
    if (!contract) return;
    setEditForm({
      contract_number: contract.contract_number || '',
      direction: contract.direction || 'purchase',
      counterparty_id: contract.counterparty_id || '',
      commodity_id: contract.commodity_id || '',
      contracted_mt: contract.contracted_mt != null ? String(contract.contracted_mt) : '',
      price_per_mt: contract.price_per_mt != null ? String(contract.price_per_mt) : '',
      ship_mode: contract.ship_mode || 'truck',
      delivery_point: contract.delivery_point || '',
      start_date: contract.start_date ? contract.start_date.slice(0, 10) : '',
      end_date: contract.end_date ? contract.end_date.slice(0, 10) : '',
      notes: contract.notes || '',
      grade_prices_json: parseJsonArray(contract.grade_prices_json),
      blend_requirement_json: parseJsonArray(contract.blend_requirement_json),
    });
  }, [contract]);

  const handleStartEdit = () => {
    initEditForm();
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!contract) return;
    setSaving(true);
    setError(null);
    try {
      const gradeP = editForm.grade_prices_json
        .filter(r => r.grade?.trim() && r.price_per_mt != null && r.price_per_mt !== '')
        .map(r => ({ grade: r.grade.trim(), price_per_mt: parseFloat(r.price_per_mt) }));
      const blendR = editForm.blend_requirement_json
        .filter(r => r.grade?.trim() && r.mt != null && r.mt !== '')
        .map(r => ({ grade: r.grade.trim(), mt: parseFloat(r.mt) }));

      await api.put(`/api/farms/${farmId}/terminal/contracts/${contract.id}`, {
        contract_number: editForm.contract_number,
        direction: editForm.direction,
        counterparty_id: editForm.counterparty_id,
        commodity_id: editForm.commodity_id,
        contracted_mt: parseFloat(editForm.contracted_mt),
        price_per_mt: editForm.price_per_mt ? parseFloat(editForm.price_per_mt) : null,
        ship_mode: editForm.ship_mode,
        delivery_point: editForm.delivery_point,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        notes: editForm.notes,
        grade_prices_json: gradeP.length ? gradeP : null,
        blend_requirement_json: blendR.length ? blendR : null,
      });
      setEditing(false);
      await load();
      if (onSaved) onSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update contract'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!contract) return;
    const ok = await confirm({
      title: 'Delete Contract',
      message: `Delete contract ${contract.contract_number}? This cannot be undone.`,
      confirmText: 'Delete',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/farms/${farmId}/terminal/contracts/${contract.id}`);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete contract (settlements may still be linked)'));
    }
  };

  // Derived data
  const transferAgreements = contract?.transfer_agreements || [];
  const buyerSettlements = (contract?.settlements || []).filter(s => s.type === 'buyer_settlement');
  const transferSettlements = (contract?.settlements || []).filter(s => s.type === 'transfer' || s.type === 'transloading');
  const gradePrices = parseJsonArray(contract?.grade_prices_json);
  const blendRequirement = parseJsonArray(contract?.blend_requirement_json);

  // Find realization from buyer settlements
  const realizationSettlement = buyerSettlements.find(s => s.realization_json);
  const realization = realizationSettlement ? (
    typeof realizationSettlement.realization_json === 'string'
      ? JSON.parse(realizationSettlement.realization_json)
      : realizationSettlement.realization_json
  ) : null;

  const counterpartyName = contract?.counterparty?.name || '';

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            Contract Detail
            {contract && (
              <Typography variant="subtitle2" color="text.secondary" component="span" sx={{ ml: 1 }}>
                {contract.contract_number}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </DialogTitle>

        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          )}

          {!loading && contract && !editing && (
            <>
              {/* Twin-pane layout */}
              <Grid container spacing={3}>
                {/* Left Pane: Buyer Contract */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        Buyer Contract
                      </Typography>
                      <Chip
                        label={contract.direction === 'purchase' ? 'Purchase' : 'Sale'}
                        size="small"
                        color={contract.direction === 'purchase' ? 'primary' : 'secondary'}
                        variant="outlined"
                      />
                      <Chip
                        label={contract.status}
                        size="small"
                        color={STATUS_COLORS[contract.status] || 'default'}
                      />
                    </Box>
                    <Divider sx={{ mb: 1.5 }} />

                    <InfoRow label="Contract #" value={contract.contract_number} />
                    <InfoRow label="Counterparty" value={counterpartyName} />
                    <InfoRow label="Commodity" value={contract.commodity?.name || ''} />
                    <InfoRow label="Contracted" value={fmtMt(contract.contracted_mt)} />
                    <InfoRow label="Delivered" value={fmtMt(contract.delivered_mt)} />
                    <InfoRow label="Remaining" value={fmtMt(contract.remaining_mt)} />
                    <InfoRow label="Price" value={contract.price_per_mt ? `${formatCurrency(contract.price_per_mt)}/MT` : '\u2014'} />
                    <InfoRow label="Ship Mode" value={contract.ship_mode || '\u2014'} />
                    <InfoRow label="Delivery Point" value={contract.delivery_point || '\u2014'} />
                    <InfoRow label="Date Range" value={`${fmtDate(contract.start_date)} \u2013 ${fmtDate(contract.end_date)}`} />

                    {contract.notes && (
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="body2" color="text.secondary">Notes</Typography>
                        <Typography variant="body2">{contract.notes}</Typography>
                      </Box>
                    )}

                    {/* Grade Prices Table */}
                    {gradePrices.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Grade Prices</Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Grade</TableCell>
                                <TableCell align="right">$/MT</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {gradePrices.map((gp, i) => (
                                <TableRow key={i}>
                                  <TableCell>{gp.grade}</TableCell>
                                  <TableCell align="right">{formatCurrency(gp.price_per_mt)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    )}

                    {/* Blend Requirement Table */}
                    {blendRequirement.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Blend Requirement</Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Grade</TableCell>
                                <TableCell align="right">MT</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {blendRequirement.map((br, i) => (
                                <TableRow key={i}>
                                  <TableCell>{br.grade}</TableCell>
                                  <TableCell align="right">{fmt(br.mt)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    )}

                    {/* Buyer Settlements */}
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Buyer Settlements</Typography>
                      <SettlementTable settlements={buyerSettlements} label="buyer settlements" />
                    </Box>
                  </Paper>
                </Grid>

                {/* Right Pane: Transfer Contract */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                      Transfer Contract (LGX \u2192 C2)
                    </Typography>
                    <Divider sx={{ mb: 1.5 }} />

                    {transferAgreements.length > 0 ? (
                      transferAgreements.map((ta, idx) => (
                        <Box key={ta.id || idx} sx={{ mb: idx < transferAgreements.length - 1 ? 3 : 0 }}>
                          {transferAgreements.length > 1 && (
                            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                              Transfer {idx + 1}
                            </Typography>
                          )}
                          <InfoRow label="Contract #" value={ta.contract_number || ta.contractNumber || '\u2014'} />
                          <InfoRow label="Counterparty" value={ta.counterparty?.name || ta.counterparty_name || '\u2014'} />
                          <InfoRow label="Commodity" value={ta.commodity?.name || ta.commodity_name || contract.commodity?.name || ''} />
                          <InfoRow label="Contracted" value={fmtMt(ta.contracted_mt || ta.contracted_tonnes)} />
                          <InfoRow label="Delivered" value={fmtMt(ta.delivered_mt || ta.delivered_tonnes)} />
                          <InfoRow label="Remaining" value={fmtMt(
                            ta.remaining_mt ?? ta.remaining_tonnes ??
                            ((ta.contracted_mt || ta.contracted_tonnes || 0) - (ta.delivered_mt || ta.delivered_tonnes || 0))
                          )} />
                          <InfoRow label="Status" value="">
                            <Chip
                              label={ta.status || 'executed'}
                              size="small"
                              color={STATUS_COLORS[ta.status] || 'default'}
                            />
                          </InfoRow>

                          {/* Transfer Settlements */}
                          <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Transfer Settlements</Typography>
                            <SettlementTable
                              settlements={ta.settlements || transferSettlements}
                              label="transfer settlements"
                            />
                          </Box>
                        </Box>
                      ))
                    ) : (
                      <Box sx={{ py: 4, textAlign: 'center' }}>
                        <Typography variant="body1" color="text.secondary">
                          No C2 transfer \u2014 transloading only
                        </Typography>
                        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
                          This contract does not have a linked C2 transfer agreement.
                        </Typography>
                      </Box>
                    )}

                    {/* Transloading settlements that aren't linked to a transfer agreement */}
                    {transferAgreements.length === 0 && transferSettlements.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Transloading Settlements</Typography>
                        <SettlementTable settlements={transferSettlements} label="transloading settlements" />
                      </Box>
                    )}
                  </Paper>
                </Grid>
              </Grid>

              {/* Bottom Section: Realization Panel */}
              {realization && (
                <Box sx={{ mt: 3 }}>
                  <RealizationPanel
                    realization={realization}
                    buyerName={counterpartyName}
                    contractNumber={contract.contract_number}
                    deductions={realization.deductions || []}
                  />
                </Box>
              )}
            </>
          )}

          {/* Edit Mode */}
          {!loading && contract && editing && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Contract #"
                value={editForm.contract_number}
                onChange={e => setEditForm(f => ({ ...f, contract_number: e.target.value }))}
                fullWidth required
              />
              <TextField
                select label="Direction" value={editForm.direction}
                onChange={e => setEditForm(f => ({ ...f, direction: e.target.value }))}
                fullWidth
              >
                <MenuItem value="purchase">Purchase (from grower)</MenuItem>
                <MenuItem value="sale">Sale (to buyer)</MenuItem>
              </TextField>
              <TextField
                select label="Counterparty" value={editForm.counterparty_id}
                onChange={e => setEditForm(f => ({ ...f, counterparty_id: e.target.value }))}
                fullWidth required
              >
                {counterparties.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField
                select label="Commodity" value={editForm.commodity_id}
                onChange={e => setEditForm(f => ({ ...f, commodity_id: e.target.value }))}
                fullWidth required
              >
                {commodities.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.code})</MenuItem>)}
              </TextField>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <TextField
                  label="Contracted MT" type="number" value={editForm.contracted_mt}
                  onChange={e => setEditForm(f => ({ ...f, contracted_mt: e.target.value }))}
                  required
                />
                <TextField
                  label="Price $/MT" type="number" value={editForm.price_per_mt}
                  onChange={e => setEditForm(f => ({ ...f, price_per_mt: e.target.value }))}
                />
              </Box>
              <TextField
                select label="Ship Mode" value={editForm.ship_mode}
                onChange={e => setEditForm(f => ({ ...f, ship_mode: e.target.value }))}
                fullWidth
              >
                <MenuItem value="truck">Truck</MenuItem>
                <MenuItem value="rail">Rail</MenuItem>
              </TextField>
              <TextField
                label="Delivery Point" value={editForm.delivery_point}
                onChange={e => setEditForm(f => ({ ...f, delivery_point: e.target.value }))}
                fullWidth
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <TextField
                  label="Start Date" type="date" value={editForm.start_date}
                  onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="End Date" type="date" value={editForm.end_date}
                  onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>
              <TextField
                label="Notes" value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                fullWidth multiline rows={2}
              />

              {/* Grade Prices */}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Grade Prices</Typography>
              {(editForm.grade_prices_json || []).map((row, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small" label="Grade" value={row.grade || ''}
                    onChange={e => setEditForm(f => ({
                      ...f,
                      grade_prices_json: f.grade_prices_json.map((r, i) =>
                        i === idx ? { ...r, grade: e.target.value } : r
                      ),
                    }))}
                    sx={{ width: 140 }}
                  />
                  <TextField
                    size="small" label="$/MT" type="number" value={row.price_per_mt ?? ''}
                    onChange={e => setEditForm(f => ({
                      ...f,
                      grade_prices_json: f.grade_prices_json.map((r, i) =>
                        i === idx ? { ...r, price_per_mt: e.target.value } : r
                      ),
                    }))}
                    sx={{ width: 120 }}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => setEditForm(f => ({
                      ...f,
                      grade_prices_json: f.grade_prices_json.filter((_, i) => i !== idx),
                    }))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button
                size="small" startIcon={<AddIcon />}
                onClick={() => setEditForm(f => ({
                  ...f,
                  grade_prices_json: [...(f.grade_prices_json || []), { grade: '', price_per_mt: '' }],
                }))}
              >
                Add grade price
              </Button>

              {/* Blend Requirement */}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Blend Requirement</Typography>
              {(editForm.blend_requirement_json || []).map((row, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small" label="Grade" value={row.grade || ''}
                    onChange={e => setEditForm(f => ({
                      ...f,
                      blend_requirement_json: f.blend_requirement_json.map((r, i) =>
                        i === idx ? { ...r, grade: e.target.value } : r
                      ),
                    }))}
                    sx={{ width: 140 }}
                  />
                  <TextField
                    size="small" label="MT" type="number" value={row.mt ?? ''}
                    onChange={e => setEditForm(f => ({
                      ...f,
                      blend_requirement_json: f.blend_requirement_json.map((r, i) =>
                        i === idx ? { ...r, mt: e.target.value } : r
                      ),
                    }))}
                    sx={{ width: 120 }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => setEditForm(f => ({
                      ...f,
                      blend_requirement_json: f.blend_requirement_json.filter((_, i) => i !== idx),
                    }))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button
                size="small" variant="outlined" startIcon={<AddIcon />}
                onClick={() => setEditForm(f => ({
                  ...f,
                  blend_requirement_json: [...(f.blend_requirement_json || []), { grade: '', mt: '' }],
                }))}
              >
                Add blend line
              </Button>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 1.5 }}>
          <Box>
            {!editing && contract && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={handleDelete}>
                Delete
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {!editing && contract && (
              <Button startIcon={<EditIcon />} onClick={handleStartEdit}>
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button onClick={handleCancelEdit}>Cancel</Button>
                <Button
                  variant="contained"
                  startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                  onClick={handleSave}
                  disabled={saving || !editForm.contract_number || !editForm.counterparty_id || !editForm.commodity_id || !editForm.contracted_mt}
                >
                  Save
                </Button>
              </>
            )}
            {!editing && (
              <Button onClick={onClose}>Close</Button>
            )}
          </Box>
        </DialogActions>
      </Dialog>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
