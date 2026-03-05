import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSync } from '../contexts/SyncContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import SyncStatusBar from '../components/SyncStatusBar';

export default function SettingsScreen() {
  const { user, farm, logout } = useAuth();
  const { pending, failed, isSyncing, triggerSync } = useSync();
  const isOnline = useNetworkStatus();

  const handleLogout = () => {
    if (pending > 0) {
      Alert.alert(
        'Unsent Tickets',
        `You have ${pending} ticket${pending !== 1 ? 's' : ''} waiting to sync. Logging out won't delete them, but they can't sync until you log back in.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout Anyway', style: 'destructive', onPress: logout },
        ],
      );
    } else {
      Alert.alert('Logout', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', onPress: logout },
      ]);
    }
  };

  const handleForceSync = () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Cannot sync while offline');
      return;
    }
    triggerSync();
  };

  return (
    <View style={styles.container}>
      <SyncStatusBar />

      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user?.name || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Farm</Text>
          <Text style={styles.value}>{farm?.name || '—'}</Text>
        </View>
      </View>

      {/* Sync */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sync</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Pending</Text>
          <Text style={styles.value}>{pending}</Text>
        </View>
        {failed > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>Failed</Text>
            <Text style={[styles.value, { color: '#f44336' }]}>{failed}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.syncButton, (!isOnline || isSyncing || pending === 0) && styles.buttonDisabled]}
          onPress={handleForceSync}
          disabled={!isOnline || isSyncing || pending === 0}
        >
          <Text style={styles.syncButtonText}>
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>1.0.0</Text>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  label: { fontSize: 15, color: '#333' },
  value: { fontSize: 15, color: '#666' },
  syncButton: {
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.4 },
  syncButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  logoutButton: {
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f44336',
  },
  logoutText: { color: '#f44336', fontSize: 16, fontWeight: '600' },
});
