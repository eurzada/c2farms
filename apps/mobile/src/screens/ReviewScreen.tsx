import React, { useState } from 'react';
import {
  View, Text, Image, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../contexts/AuthContext';
import { useSync } from '../contexts/SyncContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { enqueue } from '../services/sync';
import api from '../services/api';
import TicketField from '../components/TicketField';

type ReviewRouteProp = RouteProp<RootStackParamList, 'Review'>;
type ReviewNavProp = NativeStackNavigationProp<RootStackParamList, 'Review'>;

// Fields to display in the review form
const FIELDS = [
  { key: 'ticket_number', label: 'Ticket #', required: true },
  { key: 'delivery_date', label: 'Date', required: true },
  { key: 'crop', label: 'Crop', required: false },
  { key: 'gross_weight_kg', label: 'Gross (kg)', numeric: true },
  { key: 'tare_weight_kg', label: 'Tare (kg)', numeric: true },
  { key: 'net_weight_kg', label: 'Net (kg)', numeric: true, required: true },
  { key: 'moisture_pct', label: 'Moisture %', numeric: true },
  { key: 'grade', label: 'Grade' },
  { key: 'dockage_pct', label: 'Dockage %', numeric: true },
  { key: 'protein_pct', label: 'Protein %', numeric: true },
  { key: 'operator_name', label: 'Operator' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'destination', label: 'Destination' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'contract_number', label: 'Contract #' },
  { key: 'notes', label: 'Notes' },
] as const;

export default function ReviewScreen() {
  const route = useRoute<ReviewRouteProp>();
  const navigation = useNavigation<ReviewNavProp>();
  const { farm } = useAuth();
  const { refreshStats } = useSync();
  const isOnline = useNetworkStatus();

  const { imageUri, extraction, confidence } = route.params;

  // Initialize form with extracted values
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (extraction) {
      for (const field of FIELDS) {
        const val = (extraction as Record<string, unknown>)[field.key];
        if (val !== null && val !== undefined) {
          initial[field.key] = String(val);
        }
      }
    }
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!farm) {
      Alert.alert('Error', 'No farm selected');
      return;
    }

    // Validate required fields
    if (!values.ticket_number?.trim()) {
      Alert.alert('Error', 'Ticket number is required');
      return;
    }

    // Build overrides from edited fields
    const overrides: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const val = values[field.key];
      if (val !== undefined && val !== '') {
        overrides[field.key] = 'numeric' in field && field.numeric ? parseFloat(val) || null : val;
      }
    }

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    setSubmitting(true);

    if (isOnline) {
      // Try direct upload
      try {
        const formData = new FormData();
        formData.append('photo', {
          uri: imageUri,
          name: 'ticket.jpg',
          type: 'image/jpeg',
        } as unknown as Blob);
        formData.append('data', JSON.stringify({
          client_id: clientId,
          extraction_json: extraction,
          overrides,
          device_timestamp: new Date().toISOString(),
        }));

        await api.post(`/farms/${farm.id}/mobile/tickets`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        });

        Alert.alert('Success', 'Ticket submitted successfully', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      } catch (err) {
        console.warn('Direct upload failed, queuing offline:', err);
      }
    }

    // Queue for offline sync
    try {
      await enqueue({
        id: clientId,
        client_id: clientId,
        farm_id: farm.id,
        image_uri: imageUri,
        extraction_json: extraction as Record<string, unknown> | null,
        overrides,
        device_timestamp: new Date().toISOString(),
      });
      await refreshStats();

      Alert.alert(
        'Queued',
        'Ticket saved and will sync when connected',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to save ticket. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Photo preview */}
        <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="contain" />

        {/* Confidence indicator */}
        {confidence !== null && (
          <View style={styles.confidenceRow}>
            <View style={[
              styles.confidenceDot,
              { backgroundColor: confidence >= 0.7 ? '#4CAF50' : confidence >= 0.4 ? '#FF9800' : '#f44336' },
            ]} />
            <Text style={styles.confidenceText}>
              Extraction confidence: {Math.round((confidence ?? 0) * 100)}%
            </Text>
          </View>
        )}

        {!extraction && (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineNoticeText}>
              Offline — please fill in fields manually
            </Text>
          </View>
        )}

        {/* Fields */}
        {FIELDS.map((field) => (
          <TicketField
            key={field.key}
            label={field.label}
            value={values[field.key] || ''}
            onChangeText={(text) => setValue(field.key, text)}
            keyboardType={'numeric' in field && field.numeric ? 'decimal-pad' : 'default'}
            confidence={extraction ? (
              (extraction as Record<string, unknown>)[field.key] != null ? (confidence ?? 0) : 0
            ) : undefined}
          />
        ))}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              {isOnline ? 'Submit Ticket' : 'Save Offline'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#ddd',
    marginBottom: 12,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  confidenceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  confidenceText: {
    fontSize: 13,
    color: '#666',
  },
  offlineNotice: {
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  offlineNoticeText: {
    color: '#E65100',
    fontSize: 14,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
