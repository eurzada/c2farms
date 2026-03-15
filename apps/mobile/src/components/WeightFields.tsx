import React, { useEffect } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { C2_DARK, SURFACE, BORDER, TEXT_MUTED, C2_TEAL } from '../theme/colors';

interface Props {
  gross: string;
  tare: string;
  net: string;
  onGrossChange: (v: string) => void;
  onTareChange: (v: string) => void;
  onNetChange: (v: string) => void;
}

export default function WeightFields({ gross, tare, net, onGrossChange, onTareChange, onNetChange }: Props) {
  // Auto-calc net when gross and tare both have values
  useEffect(() => {
    const g = parseFloat(gross);
    const t = parseFloat(tare);
    if (!isNaN(g) && !isNaN(t) && g > 0 && t > 0) {
      const computed = g - t;
      if (computed >= 0) {
        onNetChange(computed.toFixed(1));
      }
    }
  }, [gross, tare]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View>
      <WeightInput label="Gross" value={gross} onChange={onGrossChange} unit="kg" />
      <WeightInput label="Tare" value={tare} onChange={onTareChange} unit="kg" />
      <WeightInput label="Net" value={net} onChange={onNetChange} unit="kg" highlight />
    </View>
  );
}

function WeightInput({ label, value, onChange, unit, highlight }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, highlight && styles.labelHighlight]}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, highlight && styles.inputHighlight]}
          value={value}
          onChangeText={onChange}
          placeholder="--"
          placeholderTextColor={TEXT_MUTED}
          keyboardType="decimal-pad"
          returnKeyType="done"
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  label: { fontSize: 15, color: C2_DARK },
  labelHighlight: { fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    fontSize: 16,
    color: C2_DARK,
    textAlign: 'right',
    minWidth: 80,
    padding: 4,
  },
  inputHighlight: { color: C2_TEAL, fontWeight: '600' },
  unit: { fontSize: 13, color: TEXT_MUTED, marginLeft: 4, width: 20 },
});
