import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, MenuItem, Alert, Checkbox, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, ToggleButton, ToggleButtonGroup,
  InputAdornment,
} from '@mui/material';
import api from '../../services/api';
import { fmt, fmtDollar } from '../../utils/formatting';
import { extractErrorMessage } from '../../utils/errorHelpers';

export default function CreateTerminalSettlementDialog({ open, onClose, farmId, onSaved }) {
  const [type, setType] = useState('transfer');
  const [contracts, setContracts] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState('');
  const [tickets, setTickets] = useState([]);
  const [selectedTicketIds, setSelectedTicketIds] = useState([]);
  const [lineOverrides, setLineOverrides] = useState({});
  const [handlingRate, setHandlingRate] = useState('');
  const [settlementNumber, setSettlementNumber] = useState('');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setType('transfer');
    setSelectedContractId('');
    setSelectedCounterpartyId('');
    setTickets([]);
    setSelectedTicketIds([]);
    setLineOverrides({});
    setHandlingRate('');
    setSettlementDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setError(null);
    // Generate default settlement number
    const now = new Date();
    const seq = String(Math.floor(Math.random() * 900) + 100);
    setSettlementNumber(`LGX-STL-${now.getFullYear()}-${seq}`);
  }, [open]);

  // Load contracts (for transfer) or counterparties (for transloading)
  useEffect(() => {
    if (!open || !farmId) return;
    if (type === 'transfer') {
      api.get(`/api/farms/${farmId}/terminal/contracts`, { params: { direction: 'sale', limit: 500 } })
        .then(res => setContracts(res.data.contracts || []))
        .catch(() => setContracts([]));
    } else {
      api.get(`/api/farms/${farmId}/terminal/counterparties`)
        .then(res => setCounterparties(res.data.counterparties || []))
        .catch(() => setCounterparties([]));
    }
  }, [open, farmId, type]);

  // Load eligible tickets — filtered by contract when one is selected
  const loadTickets = useCallback(async () => {
    if (!farmId) return;
    try {
      const params = { type };
      if (type === 'transfer' && selectedContractId) {
        params.contract_id = selectedContractId;
      }
      const res = await api.get(`/api/farms/${farmId}/terminal/eligible-tickets`, { params });
      setTickets(res.data.tickets || []);
      setSelectedTicketIds([]);
      setLineOverrides({});
    } catch {
      setTickets([]);
    }
  }, [farmId, type, selectedContractId]);

  useEffect(() => {
    if (!open) return;
    loadTickets();
  }, [open, loadTickets]);

  // Get selected contract object
  const selectedContract = useMemo(
    () => contracts.find(c => c.id === selectedContractId),
    [contracts, selectedContractId]
  );

  // Grade prices from selected contract
  const gradePrices = useMemo(() => {
    if (!selectedContract?.grade_prices_json) return {};
    try {
      const arr = typeof selectedContract.grade_prices_json === 'string'
        ? JSON.parse(selectedContract.grade_prices_json)
        : selectedContract.grade_prices_json;
      if (!Array.isArray(arr)) return {};
      const map = {};
      for (const gp of arr) {
        if (gp.grade && gp.price_per_mt != null) {
          map[gp.grade.toLowerCase()] = parseFloat(gp.price_per_mt);
        }
      }
      return map;
    } catch { return {}; }
  }, [selectedContract]);

  // Build lines from selected tickets
  const lines = useMemo(() => {
    return selectedTicketIds.map(tid => {
      const ticket = tickets.find(t => t.id === tid);
      if (!ticket) return null;
      const override = lineOverrides[tid] || {};
      const grade = override.grade ?? ticket.grade ?? '';
      const netMt = ticket.weight_kg ? ticket.weight_kg / 1000 : 0;

      let pricePerMt = override.price_per_mt;
      if (pricePerMt == null || pricePerMt === '') {
        // Auto-assign from grade prices
        if (type === 'transfer' && grade) {
          const matched = gradePrices[grade.toLowerCase()];
          if (matched != null) pricePerMt = matched;
        }
        if (type === 'transloading' && handlingRate) {
          pricePerMt = parseFloat(handlingRate);
        }
      }
      const price = pricePerMt != null && pricePerMt !== '' ? parseFloat(pricePerMt) : null;
      const amount = price != null ? price * netMt : null;

      return {
        ticket_id: tid,
        ticket,
        grade,
        net_weight_mt: netMt,
        price_per_mt: price,
        amount,
      };
    }).filter(Boolean);
  }, [selectedTicketIds, tickets, lineOverrides, gradePrices, type, handlingRate]);

  const totalMt = useMemo(() => lines.reduce((s, l) => s + l.net_weight_mt, 0), [lines]);
  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);

  const handleTicketToggle = (ticketId) => {
    setSelectedTicketIds(prev =>
      prev.includes(ticketId)
        ? prev.filter(id => id !== ticketId)
        : [...prev, ticketId]
    );
  };

  const handleSelectAll = () => {
    if (selectedTicketIds.length === tickets.length) {
      setSelectedTicketIds([]);
    } else {
      setSelectedTicketIds(tickets.map(t => t.id));
    }
  };

  const handleOverride = (ticketId, field, value) => {
    setLineOverrides(prev => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!settlementNumber.trim()) {
      setError('Settlement number is required');
      return;
    }
    if (type === 'transfer' && !selectedContractId) {
      setError('Select a contract for transfer settlement');
      return;
    }
    if (type === 'transloading' && !selectedCounterpartyId) {
      setError('Select a counterparty for transloading settlement');
      return;
    }
    if (lines.length === 0) {
      setError('Select at least one ticket');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const counterpartyId = type === 'transfer'
        ? selectedContract?.counterparty_id
        : selectedCounterpartyId;

      const payload = {
        type,
        settlement_number: settlementNumber.trim(),
        contract_id: type === 'transfer' ? selectedContractId : null,
        counterparty_id: counterpartyId,
        settlement_date: settlementDate,
        marketing_contract_id: selectedContract?.marketing_contract_id || null,
        lines: lines.map(l => ({
          ticket_id: l.ticket_id,
          source_farm_name: l.ticket.grower_name || null,
          commodity_id: null,
          grade: l.grade || null,
          gross_weight_mt: null,
          tare_weight_mt: null,
          net_weight_mt: l.net_weight_mt,
          price_per_mt: l.price_per_mt,
        })),
        notes: notes.trim() || null,
      };

      await api.post(`/api/farms/${farmId}/terminal/settlements`, payload);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create settlement'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>New Terminal Settlement</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            value={type}
            exclusive
            onChange={(_, v) => { if (v) setType(v); }}
          >
            <ToggleButton value="transfer">Transfer</ToggleButton>
            <ToggleButton value="transloading">Transloading</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            size="small"
            label="Settlement #"
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

        {type === 'transfer' && (
          <TextField
            select
            fullWidth
            size="small"
            label="Contract (Sale)"
            value={selectedContractId}
            onChange={e => setSelectedContractId(e.target.value)}
            sx={{ mb: 2 }}
          >
            <MenuItem value="">-- Select --</MenuItem>
            {contracts.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {c.contract_number} -- {c.counterparty?.name} ({c.commodity?.name}, {fmt(c.contracted_mt)} MT)
              </MenuItem>
            ))}
          </TextField>
        )}

        {type === 'transloading' && (
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              select
              fullWidth
              size="small"
              label="Counterparty"
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
              label="Handling Rate"
              type="number"
              value={handlingRate}
              onChange={e => setHandlingRate(e.target.value)}
              sx={{ width: 160 }}
              InputProps={{ startAdornment: <InputAdornment position="start">$/MT</InputAdornment> }}
            />
          </Box>
        )}

        {/* Eligible tickets */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Eligible Tickets ({tickets.length} available, {selectedTicketIds.length} selected)
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
                <TableCell>Source</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Grade</TableCell>
                <TableCell align="right">Net (MT)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tickets.map(t => (
                <TableRow
                  key={t.id}
                  hover
                  onClick={() => handleTicketToggle(t.id)}
                  sx={{ cursor: 'pointer' }}
                  selected={selectedTicketIds.includes(t.id)}
                >
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={selectedTicketIds.includes(t.id)} />
                  </TableCell>
                  <TableCell>{t.ticket_number || '---'}</TableCell>
                  <TableCell>{t.delivery_date ? new Date(t.delivery_date).toLocaleDateString('en-CA') : '---'}</TableCell>
                  <TableCell>{t.grower_name || '---'}</TableCell>
                  <TableCell>{t.product || '---'}</TableCell>
                  <TableCell>{t.grade || '---'}</TableCell>
                  <TableCell align="right">{t.weight_kg ? fmt(t.weight_kg / 1000) : '---'}</TableCell>
                </TableRow>
              ))}
              {tickets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary">No eligible tickets found</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Lines with overrides */}
        {lines.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Settlement Lines</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300, mb: 2 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Ticket #</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Product</TableCell>
                    <TableCell sx={{ width: 120 }}>Grade</TableCell>
                    <TableCell align="right">Net MT</TableCell>
                    <TableCell sx={{ width: 110 }}>$/MT</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map(l => (
                    <TableRow key={l.ticket_id}>
                      <TableCell>{l.ticket.ticket_number || '---'}</TableCell>
                      <TableCell>{l.ticket.delivery_date ? new Date(l.ticket.delivery_date).toLocaleDateString('en-CA') : '---'}</TableCell>
                      <TableCell>{l.ticket.grower_name || '---'}</TableCell>
                      <TableCell>{l.ticket.product || '---'}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          variant="standard"
                          value={lineOverrides[l.ticket_id]?.grade ?? l.ticket.grade ?? ''}
                          onChange={e => handleOverride(l.ticket_id, 'grade', e.target.value)}
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell align="right">{fmt(l.net_weight_mt)}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          variant="standard"
                          type="number"
                          value={lineOverrides[l.ticket_id]?.price_per_mt ?? (l.price_per_mt ?? '')}
                          onChange={e => handleOverride(l.ticket_id, 'price_per_mt', e.target.value)}
                          sx={{ width: 90 }}
                          InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {l.amount != null ? fmtDollar(l.amount) : '---'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow sx={{ '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } }}>
                    <TableCell colSpan={5}>Totals</TableCell>
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
          fullWidth
          multiline
          rows={2}
          size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || lines.length === 0}
        >
          {loading ? 'Creating...' : 'Create Settlement'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
