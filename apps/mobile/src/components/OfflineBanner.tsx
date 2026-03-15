import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { ERROR } from '../theme/colors';

export default function OfflineBanner() {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No connection — tickets will sync when back online</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: ERROR,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '500' },
});
