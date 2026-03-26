import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Autocomplete, TextField, Paper } from '@mui/material';

const ContractCellEditor = forwardRef((props, ref) => {
  const { contracts = [], data } = props;
  const [value, setValue] = useState(null);
  const inputRef = useRef(null);

  // Group contracts: same counterparty first, then others
  const settlementCounterpartyId = data?.counterparty_id;
  const options = contracts.map(c => ({
    id: c.id,
    contract_number: c.contract_number,
    label: `${c.contract_number} — ${c.counterparty?.name || '?'} — ${c.commodity?.name || '?'} (${Math.round(c.contracted_mt || 0)} MT)`,
    group: (settlementCounterpartyId && c.counterparty_id === settlementCounterpartyId)
      ? 'Same Buyer'
      : 'Other Contracts',
    counterparty_id: c.counterparty_id,
  }));

  // Sort so "Same Buyer" group appears first
  options.sort((a, b) => {
    if (a.group === b.group) return a.label.localeCompare(b.label);
    return a.group === 'Same Buyer' ? -1 : 1;
  });

  useEffect(() => {
    // Focus the input on mount
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useImperativeHandle(ref, () => ({
    getValue() {
      return value?.contract_number || props.value;
    },
    isCancelAfterEnd() {
      return !value;
    },
  }));

  return (
    <Autocomplete
      options={options}
      groupBy={(opt) => opt.group}
      getOptionLabel={(opt) => opt.label || ''}
      value={value}
      onChange={(_, newVal) => {
        setValue(newVal);
        // Stop editing after selection
        setTimeout(() => props.api.stopEditing(), 0);
      }}
      openOnFocus
      autoHighlight
      size="small"
      PaperComponent={(paperProps) => <Paper {...paperProps} sx={{ minWidth: 420 }} />}
      sx={{ width: 420 }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          placeholder="Search contracts..."
          variant="outlined"
          size="small"
          autoFocus
        />
      )}
    />
  );
});

ContractCellEditor.displayName = 'ContractCellEditor';

export default ContractCellEditor;
