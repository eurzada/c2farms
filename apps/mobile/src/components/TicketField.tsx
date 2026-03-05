import React from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions } from 'react-native';

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: KeyboardTypeOptions;
  confidence?: number;
}

export default function TicketField({ label, value, onChangeText, keyboardType = 'default', confidence }: Props) {
  // Confidence dot color: green >= 0.7, yellow >= 0.4, red < 0.4, gray if no data
  const dotColor = confidence === undefined
    ? undefined
    : confidence >= 0.7
      ? '#4CAF50'
      : confidence >= 0.4
        ? '#FF9800'
        : '#f44336';

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        {dotColor && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
        <Text style={styles.label}>{label}</Text>
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={`Enter ${label.toLowerCase()}`}
        placeholderTextColor="#bbb"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  label: { fontSize: 13, color: '#666', fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fff',
  },
});
