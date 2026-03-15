import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, FlatList, TextInput as RNTextInput,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useAuth } from '../contexts/AuthContext';
import { useSync } from '../contexts/SyncContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { enqueue } from '../services/sync';
import api from '../services/api';
import TicketField from '../components/TicketField';
import OfflineBanner from '../components/OfflineBanner';

interface Location {
  id: string;
  name: string;
  code: string;
}

interface Bin {
  id: string;
  bin_number: string;
  bin_type: string;
  location_id: string;
  commodity_name: string | null;
  commodity_code: string | null;
  commodity_id: string | null;
  status: string;
}

// Origin fields after the dropdowns (contract, buyer, operator, vehicle)
const ORIGIN_EXTRA_FIELDS = [
  { key: 'contract_number', label: 'Contract #' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'operator_name', label: 'Operator / Driver' },
  { key: 'vehicle', label: 'Vehicle / Unit #' },
] as const;

// Destination fields — filled from ticket photo or manual entry
const DESTINATION_FIELDS = [
  { key: 'ticket_number', label: 'Ticket #', required: true },
  { key: 'destination', label: 'Destination (Elevator)' },
  { key: 'delivery_date', label: 'Date' },
  { key: 'gross_weight_kg', label: 'Gross (kg)', numeric: true },
  { key: 'tare_weight_kg', label: 'Tare (kg)', numeric: true },
  { key: 'net_weight_kg', label: 'Net (kg)', numeric: true, required: true },
  { key: 'moisture_pct', label: 'Moisture %', numeric: true },
  { key: 'grade', label: 'Grade' },
  { key: 'dockage_pct', label: 'Dockage %', numeric: true },
  { key: 'protein_pct', label: 'Protein %', numeric: true },
  { key: 'notes', label: 'Notes' },
] as const;

const ALL_FIELD_KEYS = [
  'origin_location', 'origin_bin', 'crop', 'grade',
  ...ORIGIN_EXTRA_FIELDS.map(f => f.key),
  ...DESTINATION_FIELDS.map(f => f.key),
];

export default function NewTicketScreen() {
  const { farm } = useAuth();
  const { refreshStats } = useSync();
  const isOnline = useNetworkStatus();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Record<string, unknown> | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Cascading dropdown state
  const [locations, setLocations] = useState<Location[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showBinPicker, setShowBinPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [gradeIndex, setGradeIndex] = useState<Record<string, { grade: string; protein_pct?: number; moisture_pct?: number; dockage_pct?: number }>>({});

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  // Pre-fill today's date
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setValues((prev) => ({ delivery_date: today, ...prev }));
  }, []);

  // Load locations on mount
  const loadLocations = useCallback(async () => {
    if (!farm) return;
    try {
      const { data } = await api.get(`/farms/${farm.id}/inventory/locations`);
      setLocations(data.locations || []);
    } catch (err) {
      console.warn('Failed to load locations:', err);
    }
  }, [farm]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  // Load bin grade index
  const loadGrades = useCallback(async () => {
    if (!farm) return;
    try {
      const { data } = await api.get(`/farms/${farm.id}/inventory/grades`);
      const idx: Record<string, { grade: string; protein_pct?: number; moisture_pct?: number; dockage_pct?: number }> = {};
      for (const g of (data.grades || [])) {
        idx[g.bin_id] = { grade: g.grade, protein_pct: g.protein_pct, moisture_pct: g.moisture_pct, dockage_pct: g.dockage_pct };
      }
      setGradeIndex(idx);
    } catch { /* grades are optional */ }
  }, [farm]);

  useEffect(() => { loadGrades(); }, [loadGrades]);

  // Load bins when location is selected
  const loadBins = useCallback(async (locationId: string) => {
    if (!farm) return;
    try {
      const { data } = await api.get(`/farms/${farm.id}/inventory/bins`, {
        params: { location: locationId, enterprise: 'true' },
      });
      setBins(data.bins || []);
    } catch (err) {
      console.warn('Failed to load bins:', err);
    }
  }, [farm]);

  const handleSelectLocation = (loc: Location) => {
    setSelectedLocationId(loc.id);
    setValue('origin_location', loc.name);
    // Reset bin selection
    setSelectedBinId(null);
    setValue('origin_bin', '');
    setValue('crop', '');
    setBins([]);
    setShowLocationPicker(false);
    setPickerSearch('');
    // Load bins for this location
    loadBins(loc.id);
  };

  const handleSelectBin = (bin: Bin) => {
    setSelectedBinId(bin.id);
    setValue('origin_bin', bin.bin_number);
    // Auto-populate commodity from bin
    if (bin.commodity_name) {
      setValue('crop', bin.commodity_name);
    }
    // Auto-populate grade from grading index
    const binGrade = gradeIndex[bin.id];
    if (binGrade?.grade) {
      setValue('grade', binGrade.grade);
    }
    setShowBinPicker(false);
    setPickerSearch('');
  };

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        Alert.alert('Error', 'Failed to capture photo');
        return;
      }

      const manipulated = await manipulateAsync(
        photo.uri,
        [{ resize: { width: 2000 } }],
        { compress: 0.85, format: SaveFormat.JPEG },
      );

      setImageUri(manipulated.uri);
      setShowCamera(false);

      // Try AI extraction if online
      if (isOnline && farm) {
        setExtracting(true);
        try {
          const formData = new FormData();
          formData.append('photo', {
            uri: manipulated.uri,
            name: 'ticket.jpg',
            type: 'image/jpeg',
          } as unknown as Blob);

          const { data } = await api.post(
            `/farms/${farm.id}/mobile/tickets/extract`,
            formData,
            {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 30000,
            },
          );

          setExtraction(data.extraction);
          setConfidence(data.confidence);

          // Merge extracted destination fields (don't overwrite origin fields the user already filled)
          if (data.extraction) {
            setValues((prev) => {
              const merged = { ...prev };
              for (const field of DESTINATION_FIELDS) {
                const val = data.extraction[field.key];
                if (val !== null && val !== undefined && !merged[field.key]) {
                  merged[field.key] = String(val);
                }
              }
              // Also fill crop/buyer if extracted and user hasn't set them
              if (data.extraction.crop && !merged.crop) merged.crop = String(data.extraction.crop);
              if (data.extraction.buyer && !merged.buyer) merged.buyer = String(data.extraction.buyer);
              if (data.extraction.contract_number && !merged.contract_number) merged.contract_number = String(data.extraction.contract_number);
              return merged;
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.warn('Extraction failed:', msg);
          Alert.alert('Extraction failed', 'Fill in destination details manually.');
        } finally {
          setExtracting(false);
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to capture photo.');
      console.error(err);
    } finally {
      setCapturing(false);
    }
  };

  const handleRetakePhoto = () => {
    setImageUri(null);
    setExtraction(null);
    setConfidence(null);
    setShowCamera(true);
  };

  const handleSubmit = async () => {
    if (!farm) {
      Alert.alert('Error', 'No farm selected');
      return;
    }
    if (!values.ticket_number?.trim()) {
      Alert.alert('Required', 'Ticket number is required');
      return;
    }

    const numericKeys = new Set<string>(DESTINATION_FIELDS.filter(f => 'numeric' in f && f.numeric).map(f => f.key));
    const overrides: Record<string, unknown> = {};
    for (const key of ALL_FIELD_KEYS) {
      const val = values[key];
      if (val !== undefined && val !== '') {
        overrides[key] = numericKeys.has(key) ? parseFloat(val) || null : val;
      }
    }
    // Include selected IDs for backend linking
    if (selectedLocationId) overrides.location_id = selectedLocationId;
    if (selectedBinId) overrides.bin_id = selectedBinId;

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setSubmitting(true);

    if (isOnline) {
      try {
        const formData = new FormData();
        if (imageUri) {
          formData.append('photo', {
            uri: imageUri,
            name: 'ticket.jpg',
            type: 'image/jpeg',
          } as unknown as Blob);
        }
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

        Alert.alert('Success', 'Ticket submitted', [
          { text: 'OK', onPress: resetForm },
        ]);
        return;
      } catch (err) {
        console.warn('Direct upload failed, queuing:', err);
      }
    }

    // Queue offline
    try {
      await enqueue({
        id: clientId,
        client_id: clientId,
        farm_id: farm.id,
        image_uri: imageUri || '',
        extraction_json: extraction,
        overrides,
        device_timestamp: new Date().toISOString(),
      });
      await refreshStats();
      Alert.alert('Queued', 'Ticket saved — will sync when connected', [
        { text: 'OK', onPress: resetForm },
      ]);
    } catch (err) {
      Alert.alert('Error', 'Failed to save ticket');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    // Keep origin fields for next ticket (same truck, same route)
    setValues((prev) => ({
      origin_location: prev.origin_location || '',
      origin_bin: prev.origin_bin || '',
      crop: prev.crop || '',
      contract_number: prev.contract_number || '',
      buyer: prev.buyer || '',
      operator_name: prev.operator_name || '',
      vehicle: prev.vehicle || '',
      delivery_date: today,
    }));
    // Keep location/bin selection
    setImageUri(null);
    setExtraction(null);
    setConfidence(null);
    setShowCamera(false);
    setSubmitting(false);
  };

  // ── Camera fullscreen view ──
  if (showCamera) {
    if (!permission?.granted) {
      return (
        <View style={styles.cameraPermission}>
          <Text style={styles.cameraPermissionText}>
            Camera access is needed to photograph the delivery ticket.
          </Text>
          <TouchableOpacity style={styles.cameraPermissionBtn} onPress={requestPermission}>
            <Text style={styles.cameraPermissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cameraCancelBtn} onPress={() => setShowCamera(false)}>
            <Text style={styles.cameraCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.cameraOverlay}>
            <View style={styles.cornerTL} />
            <View style={styles.cornerTR} />
            <View style={styles.cornerBL} />
            <View style={styles.cornerBR} />
          </View>
          <Text style={styles.cameraHint}>Position the delivery ticket within the frame</Text>
          <View style={styles.cameraButtons}>
            <TouchableOpacity style={styles.cameraCancelCircle} onPress={() => setShowCamera(false)}>
              <Text style={styles.cameraCancelX}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureButton} onPress={handleCapture} disabled={capturing}>
              {capturing ? (
                <ActivityIndicator color="#1B5E20" size="large" />
              ) : (
                <View style={styles.captureInner} />
              )}
            </TouchableOpacity>
            <View style={{ width: 50 }} />
          </View>
        </CameraView>
      </View>
    );
  }

  // ── Main form view ──
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OfflineBanner />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ── Origin Section ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>📍</Text>
          <Text style={styles.sectionTitle}>Origin</Text>
        </View>
        <View style={styles.sectionCard}>
          {/* Farm (location) dropdown */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Farm *</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => { setPickerSearch(''); setShowLocationPicker(true); }}
            >
              <Text style={values.origin_location ? styles.pickerValue : styles.pickerPlaceholder}>
                {values.origin_location || 'Select farm...'}
              </Text>
              <Text style={styles.pickerArrow}>▼</Text>
            </TouchableOpacity>
          </View>

          {/* Bin dropdown (filtered by selected farm) */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Bin</Text>
            <TouchableOpacity
              style={[styles.pickerButton, !selectedLocationId && styles.pickerDisabled]}
              onPress={() => {
                if (!selectedLocationId) {
                  Alert.alert('Select Farm First', 'Choose a farm to see available bins.');
                  return;
                }
                setPickerSearch('');
                setShowBinPicker(true);
              }}
            >
              <Text style={values.origin_bin ? styles.pickerValue : styles.pickerPlaceholder}>
                {values.origin_bin || 'Select bin...'}
              </Text>
              <Text style={styles.pickerArrow}>▼</Text>
            </TouchableOpacity>
          </View>

          {/* Commodity (auto-filled from bin, read-only appearance but editable) */}
          <TicketField
            label="Commodity"
            value={values.crop || ''}
            onChangeText={(text) => setValue('crop', text)}
            keyboardType="default"
          />

          {/* Remaining origin fields */}
          {ORIGIN_EXTRA_FIELDS.map((field) => (
            <TicketField
              key={field.key}
              label={field.label}
              value={values[field.key] || ''}
              onChangeText={(text) => setValue(field.key, text)}
              keyboardType="default"
            />
          ))}
        </View>

        {/* ── Ticket Photo Section ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>📷</Text>
          <Text style={styles.sectionTitle}>Destination Ticket</Text>
        </View>

        {!imageUri ? (
          <TouchableOpacity style={styles.cameraCard} onPress={() => setShowCamera(true)}>
            <Text style={styles.cameraCardIcon}>📸</Text>
            <Text style={styles.cameraCardText}>Tap to photograph ticket</Text>
            <Text style={styles.cameraCardHint}>AI will extract weights, grade, and ticket details</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.photoCard}>
            <Image source={{ uri: imageUri }} style={styles.photoPreview} resizeMode="contain" />
            {extracting && (
              <View style={styles.extractingOverlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.extractingText}>Extracting ticket data...</Text>
              </View>
            )}
            {confidence !== null && !extracting && (
              <View style={styles.confidenceRow}>
                <View style={[
                  styles.confidenceDot,
                  { backgroundColor: confidence >= 0.7 ? '#4CAF50' : confidence >= 0.4 ? '#FF9800' : '#f44336' },
                ]} />
                <Text style={styles.confidenceText}>
                  {Math.round(confidence * 100)}% confidence
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.retakeBtn} onPress={handleRetakePhoto}>
              <Text style={styles.retakeBtnText}>Retake Photo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Destination Details Section ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🏭</Text>
          <Text style={styles.sectionTitle}>Destination Details</Text>
        </View>
        <View style={styles.sectionCard}>
          {DESTINATION_FIELDS.map((field) => (
            <TicketField
              key={field.key}
              label={field.label + ('required' in field && field.required ? ' *' : '')}
              value={values[field.key] || ''}
              onChangeText={(text) => setValue(field.key, text)}
              keyboardType={'numeric' in field && field.numeric ? 'decimal-pad' : 'default'}
              confidence={extraction ? (
                (extraction as Record<string, unknown>)[field.key] != null ? (confidence ?? 0) : undefined
              ) : undefined}
            />
          ))}
        </View>

        {/* ── Submit ── */}
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

      {/* ── Location Picker Modal ── */}
      <Modal visible={showLocationPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Farm</Text>
              <TouchableOpacity onPress={() => setShowLocationPicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <RNTextInput
              style={styles.modalSearch}
              placeholder="Search farms..."
              placeholderTextColor="#999"
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoFocus
            />
            <FlatList
              data={locations.filter(l =>
                l.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
                l.code.toLowerCase().includes(pickerSearch.toLowerCase())
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item.id === selectedLocationId && styles.modalItemSelected]}
                  onPress={() => handleSelectLocation(item)}
                >
                  <Text style={styles.modalItemText}>{item.name}</Text>
                  <Text style={styles.modalItemCode}>{item.code}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.modalEmpty}>No farms found</Text>}
            />
          </View>
        </View>
      </Modal>

      {/* ── Bin Picker Modal ── */}
      <Modal visible={showBinPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Bin</Text>
              <TouchableOpacity onPress={() => setShowBinPicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <RNTextInput
              style={styles.modalSearch}
              placeholder="Search bins..."
              placeholderTextColor="#999"
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoFocus
            />
            <FlatList
              data={bins.filter(b =>
                b.bin_number.toLowerCase().includes(pickerSearch.toLowerCase()) ||
                (b.commodity_name || '').toLowerCase().includes(pickerSearch.toLowerCase())
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item.id === selectedBinId && styles.modalItemSelected]}
                  onPress={() => handleSelectBin(item)}
                >
                  <View>
                    <Text style={styles.modalItemText}>{item.bin_number}</Text>
                    <Text style={styles.modalItemSub}>
                      {item.commodity_name || 'Empty'} · {item.bin_type}
                    </Text>
                  </View>
                  {item.status === 'active' && (
                    <View style={styles.modalItemDot} />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.modalEmpty}>No bins at this location</Text>}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const CORNER_SIZE = 30;
const CORNER_WIDTH = 3;
const cornerBase = {
  position: 'absolute' as const,
  width: CORNER_SIZE,
  height: CORNER_SIZE,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Sections
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionIcon: { fontSize: 18, marginRight: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  // Camera card (tap to open)
  cameraCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1B5E20',
    borderStyle: 'dashed',
    marginBottom: 4,
  },
  cameraCardIcon: { fontSize: 40, marginBottom: 8 },
  cameraCardText: { fontSize: 16, fontWeight: '600', color: '#1B5E20', marginBottom: 4 },
  cameraCardHint: { fontSize: 12, color: '#888', textAlign: 'center' },

  // Photo preview
  photoCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  photoPreview: { width: '100%', height: 180, backgroundColor: '#eee' },
  extractingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  extractingText: { color: '#fff', marginTop: 8, fontSize: 14 },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  confidenceDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  confidenceText: { fontSize: 13, color: '#666' },
  retakeBtn: { padding: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eee' },
  retakeBtnText: { color: '#1B5E20', fontWeight: '600', fontSize: 14 },

  // Fullscreen camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, margin: 40 },
  cornerTL: { ...cornerBase, top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerTR: { ...cornerBase, top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerBL: { ...cornerBase, bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerBR: { ...cornerBase, bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: '#fff' },
  cameraHint: {
    color: '#fff', fontSize: 14, textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 8, paddingHorizontal: 16,
    marginHorizontal: 40, borderRadius: 8,
  },
  cameraButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 30,
    paddingTop: 20,
  },
  cameraCancelCircle: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  cameraCancelX: { color: '#fff', fontSize: 22, fontWeight: '700' },
  captureButton: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: '#ccc',
  },
  captureInner: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#1B5E20',
  },
  cameraPermission: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 24, backgroundColor: '#1B5E20',
  },
  cameraPermissionText: { color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 20 },
  cameraPermissionBtn: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginBottom: 12 },
  cameraPermissionBtnText: { color: '#1B5E20', fontSize: 16, fontWeight: '600' },
  cameraCancelBtn: { paddingHorizontal: 24, paddingVertical: 12 },
  cameraCancelBtnText: { color: '#fff', fontSize: 16 },

  // Picker dropdowns
  fieldContainer: { marginBottom: 10 },
  fieldLabel: { fontSize: 13, color: '#666', fontWeight: '500', marginBottom: 4 },
  pickerButton: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, backgroundColor: '#fff',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  pickerDisabled: { backgroundColor: '#f5f5f5', borderColor: '#eee' },
  pickerValue: { fontSize: 15, color: '#333' },
  pickerPlaceholder: { fontSize: 15, color: '#bbb' },
  pickerArrow: { fontSize: 12, color: '#999' },

  // Picker modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '70%', paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  modalClose: { fontSize: 22, color: '#999', padding: 4 },
  modalSearch: {
    margin: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 10, fontSize: 15, backgroundColor: '#f9f9f9',
  },
  modalItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalItemSelected: { backgroundColor: '#E8F5E9' },
  modalItemText: { fontSize: 16, color: '#333' },
  modalItemCode: { fontSize: 14, color: '#888' },
  modalItemSub: { fontSize: 13, color: '#888', marginTop: 2 },
  modalItemDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50',
  },
  modalEmpty: { textAlign: 'center', color: '#999', padding: 24, fontSize: 15 },

  // Submit
  submitButton: {
    backgroundColor: '#1B5E20', borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 20,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
