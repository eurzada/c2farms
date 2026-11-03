import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, MenuItem, Alert, Checkbox, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper,
  InputAdornment,
} from '@mui/material';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';

/**
 * Create a new transloading invoice.
 * Grain sale settlements are created via PDF upload, not this dialog.
 */
export default function CreateTerminalSettlementDialog({ open, onClose, farmId, onSaved }) {
  const [counterparties, setCounterparties] = useState([]);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState('');
  const [tickets, setTickets] = useState([]);
  const [selectedTicketIds, setSelectedTicketIds] = useState([]);
  const [transloadingRate, setTransloadingRate] = useState('');
  const [settlementNumber, setSettlementNumber] = useState('');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedCounterpartyId('');
    setTickets([]);
    setSelectedTicketIds([]);
    setTransloadingRate('');
    setSettlementDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setError(null);
    const now = new Date();
    const seq = String(Math.floor(Math.random() * 900) + 100);
    setSettlementNumber(`TL-${now.getFullYear()}-${seq}`);
  }, [open]);

  useEffect(() => {
    if (!open || !farmId) return;
    api.get(`/api/farms/${farmId}/terminal/counterparties`)
      .then(res => setCounterparties(res.data.counterparties || []))
      .catch(() => setCounterparties([]));
  }, [open, farmId]);

  const loadTickets = useCallback(async () => {
    if (!farmId) return;
    try {
      const res = await api.get(`/api/farms/${farmId}/terminal/eligible-tickets`, { params: { type: 'transloading' } });
      setTickets(res.data.tickets || []);
      setSelectedTicketIds([]);
    } catch {
      setTickets([]);
    }
  }, [farmId]);

  useEffect(() => {
    if (!open) return;
    loadTickets();
  }, [open, loadTickets]);

  const lines = useMemo(() => {
    const rate = transloadingRate ? parseFloat(transloadingRate) : null;
    return selectedTicketIds.map(tid => {
      const ticket = tickets.find(t => t.id === tid);
      if (!ticket) return null;
      const netMt = ticket.weight_kg ? ticket.weight_kg / 1000 : 0;
      const amount = rate != null ? rate * netMt : null;
      return { ticket_id: tid, ticket, net_weight_mt: netMt, price_per_mt: rate, amount };
    }).filter(Boolean);
  }, [selectedTicketIds, tickets, transloadingRate]);

  const totalMt = useMemo(() => lines.reduce((s, l) => s + l.net_weight_mt, 0), [lines]);
  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);

  const handleTicketToggle = (ticketId) => {
    setSelectedTicketIds(prev =>
      prev.includes(ticketId) ? prev.filter(id => id !== ticketId) : [...prev, ticketId]
    );
  };

  const handleSelectAll = () => {
    setSelectedTicketIds(prev => prev.length === tickets.length ? [] : tickets.map(t => t.id));
  };

  const handleSave = async () => {
    if (!settlementNumber.trim()) { setError('Settlement number is required'); return; }
    if (!selectedCounterpartyId) { setError('Select a counterparty'); return; }
    if (lines.length === 0) { setError('Select at least one ticket'); return; }

    setLoading(true);
    setError(null);
    try {
      const payload = {
        type: 'transloading',
        settlement_number: settlementNumber.trim(),
        counterparty_id: selectedCounterpartyId,
        settlement_date: settlementDate,
        lines: lines.map(l => ({
          ticket_id: l.ticket_id,
          source_farm_name: l.ticket.grower_name || null,
          net_weight_mt: l.net_weight_mt,
          price_per_mt: l.price_per_mt,
        })),
        notes: notes.trim() || null,
      };
      await api.post(`/api/farms/${farmId}/terminal/settlements`, payload);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create transloading invoice'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>New Transloading Invoice</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            label="Invoice #"
            value={settlementNumber}
            onChange={e => setSettlementNumber(e.target.value)}
            sx={{ width: 200 }}
            required
          />
          <TextField
            size="small"
            label="Date"
            type="date"
            value={settlementDate}
            onChange={e => setSettlementDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 160 }}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            select fullWidth size="small" label="Buyer (counterparty)"
            value={selectedCounterpartyId}
            onChange={e => setSelectedCounterpartyId(e.target.value)}
          >
            <MenuItem value="">-- Select --</MenuItem>
            {counterparties.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Transloading Rate"
            type="number"
            value={transloadingRate}
            onChange={e => setTransloadingRate(e.target.value)}
            sx={{ width: 180 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$/MT</InputAdornment> }}
          />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Outbound Tickets ({tickets.length} available, {selectedTicketIds.length} selected)
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 250, mb: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={tickets.length > 0 && selectedTicketIds.length === tickets.length}
                    indeterminate={selectedTicketIds.length > 0 && selectedTicketIds.length < tickets.length}
                    onChange={handleSelectAll}
                  />
                </TableCell>
                <TableCell>Ticket #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Rail Car</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Buyer</TableCell>
                <TableCell align="right">Net (MT)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tickets.map(t => (
                <TableRow
                  key={t.id} hover
                  onClick={() => handleTicketToggle(t.id)}
                  sx={{ cursor: 'pointer' }}
                  selected={selectedTicketIds.includes(t.id)}
                >
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={selectedTicketIds.includes(t.id)} />
                  </TableCell>
                  <TableCell>{t.ticket_number || '---'}</TableCell>
                  <TableCell>{t.delivery_date ? new Date(t.delivery_date).toLocaleDateString('en-CA') : '---'}</TableCell>
                  <TableCell>{t.rail_car_number || '---'}</TableCell>
                  <TableCell>{t.product || '---'}</TableCell>
                  <TableCell>{t.sold_to || t.grower_name || '---'}</TableCell>
                  <TableCell align="right">{t.weight_kg ? fmt(t.weight_kg / 1000) : '---'}</TableCell>
                </TableRow>
              ))}
              {tickets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary">No outbound tickets available</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {lines.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Invoice Lines</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 250, mb: 2 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Ticket #</TableCell>
                    <TableCell>Rail Car</TableCell>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Net MT</TableCell>
                    <TableCell align="right">$/MT</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map(l => (
                    <TableRow key={l.ticket_id}>
                      <TableCell>{l.ticket.ticket_number || '---'}</TableCell>
                      <TableCell>{l.ticket.rail_car_number || '---'}</TableCell>
                      <TableCell>{l.ticket.product || '---'}</TableCell>
                      <TableCell align="right">{fmt(l.net_weight_mt)}</TableCell>
                      <TableCell align="right">{l.price_per_mt != null ? fmtDollar(l.price_per_mt) : '---'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {l.amount != null ? fmtDollar(l.amount) : '---'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                    <TableCell colSpan={3}>Totals</TableCell>
                    <TableCell align="right">{fmt(totalMt)}</TableCell>
                    <TableCell />
                    <TableCell align="right">{fmtDollar(totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        <TextField
          label="Notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          fullWidth multiline rows={2} size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={loading || lines.length === 0}>
          {loading ? 'Creating...' : 'Create Invoice'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
