import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSync } from '../contexts/SyncContext';

export default function SyncStatusBar() {
  const { pending, isSyncing } = useSync();

  if (pending === 0 && !isSyncing) return null;

  return (
    <View style={styles.bar}>
      {isSyncing && <ActivityIndicator size="small" color="#fff" style={styles.spinner} />}
      <Text style={styles.text}>
        {isSyncing
          ? 'Syncing tickets...'
          : `${pending} ticket${pending !== 1 ? 's' : ''} pending sync`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#FF9800',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  spinner: { marginRight: 8 },
  text: { color: '#fff', fontSize: 13, fontWeight: '500' },
});
