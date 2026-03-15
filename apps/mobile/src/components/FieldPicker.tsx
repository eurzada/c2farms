import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, TextInput,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { C2_TEAL, C2_DARK, SURFACE, BACKGROUND, BORDER, TEXT_MUTED } from '../theme/colors';

export interface PickerItem {
  id: string;
  label: string;
  subtitle?: string;
}

interface Props {
  label: string;
  items: PickerItem[];
  selectedId: string | null;
  onSelect: (id: string, item: PickerItem) => void;
  required?: boolean;
  placeholder?: string;
}

export default function FieldPicker({ label, items, selectedId, onSelect, required, placeholder }: Props) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => items.find((i) => i.id === selectedId), [items, selectedId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.subtitle?.toLowerCase().includes(q),
    );
  }, [items, search]);

  const handleSelect = (item: PickerItem) => {
    onSelect(item.id, item);
    setVisible(false);
    setSearch('');
  };

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={() => setVisible(true)}>
        <Text style={styles.label}>
          {label}{required ? '*' : ''}
        </Text>
        <Text style={[styles.value, !selected && styles.placeholder]}>
          {selected?.label || placeholder || 'Select'}
        </Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.header}>
              <TouchableOpacity onPress={() => { setVisible(false); setSearch(''); }}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>{label}</Text>
              <View style={{ width: 60 }} />
            </View>

            {items.length > 5 && (
              <TextInput
                style={styles.search}
                placeholder={`Search ${label.toLowerCase()}...`}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.id === selectedId && styles.optionSelected]}
                  onPress={() => handleSelect(item)}
                >
                  <Text style={[styles.optionLabel, item.id === selectedId && styles.optionLabelSelected]}>
                    {item.label}
                  </Text>
                  {item.subtitle && (
                    <Text style={styles.optionSubtitle}>{item.subtitle}</Text>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {search ? 'No matches' : `No ${label.toLowerCase()} available`}
                </Text>
              }
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: SURFACE,
  },
  label: { fontSize: 15, color: C2_DARK },
  value: { fontSize: 15, color: C2_TEAL, fontWeight: '600' },
  placeholder: { color: C2_TEAL },
  modal: { flex: 1, backgroundColor: BACKGROUND },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  cancel: { fontSize: 16, color: C2_TEAL },
  headerTitle: { fontSize: 17, fontWeight: '600', color: C2_DARK },
  search: {
    margin: 12,
    padding: 12,
    backgroundColor: SURFACE,
    borderRadius: 8,
    fontSize: 15,
    borderWidth: 1,
    borderColor: BORDER,
  },
  option: {
    padding: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  optionSelected: { backgroundColor: '#e6f4f8' },
  optionLabel: { fontSize: 16, color: C2_DARK },
  optionLabelSelected: { color: C2_TEAL, fontWeight: '600' },
  optionSubtitle: { fontSize: 13, color: TEXT_MUTED, marginTop: 2 },
  empty: { textAlign: 'center', padding: 24, color: TEXT_MUTED, fontSize: 15 },
});
