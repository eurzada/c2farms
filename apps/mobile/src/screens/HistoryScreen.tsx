import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useSync } from '../contexts/SyncContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import api from '../services/api';
import TicketCard from '../components/TicketCard';
import SyncStatusBar from '../components/SyncStatusBar';
import OfflineBanner from '../components/OfflineBanner';

interface TicketSummary {
  id: string;
  ticket_number: string;
  delivery_date: string;
  net_weight_mt: number;
  grade: string | null;
  moisture_pct: number | null;
  photo_thumbnail_url: string | null;
  source_system: string;
  created_at: string;
  commodity: { name: string } | null;
  counterparty: { name: string } | null;
  location: { name: string } | null;
}

export default function HistoryScreen() {
  const { farm } = useAuth();
  const { pending } = useSync();
  const isOnline = useNetworkStatus();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!farm || !isOnline) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.get(`/farms/${farm.id}/mobile/tickets/mine`);
      setTickets(data.tickets);
    } catch (err) {
      console.warn('Failed to load tickets:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [farm, isOnline]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadTickets();
    }, [loadTickets]),
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadTickets();
  };

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <SyncStatusBar />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1B5E20" />
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TicketCard ticket={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#1B5E20']} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {!isOnline
                  ? `${pending} ticket${pending !== 1 ? 's' : ''} waiting to sync`
                  : 'No tickets submitted yet'}
              </Text>
              <Text style={styles.emptyHint}>
                Use the Capture tab to photograph a delivery ticket
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { padding: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#999', textAlign: 'center' },
});
