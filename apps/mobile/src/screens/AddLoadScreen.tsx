import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { File, Paths } from 'expo-file-system/next';
import { useAuth } from '../contexts/AuthContext';
import { useLookup } from '../contexts/LookupContext';
import { useSync } from '../contexts/SyncContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { enqueue } from '../services/sync';
import api from '../services/api';
import FieldPicker, { PickerItem } from '../components/FieldPicker';
import WeightFields from '../components/WeightFields';
import PhotoCapture from '../components/PhotoCapture';
import {
  C2_TEAL, C2_TEAL_DARK, C2_DARK, C2_CHARCOAL,
  BACKGROUND, SURFACE, BORDER, TEXT_MUTED, TEXT_SECONDARY,
  SUCCESS, ERROR,
} from '../theme/colors';

const LAST_LOAD_FILE = new File(Paths.document, 'last_load.json');

interface ExtractionResult {
  ticket_number?: string;
  buyer?: string;
  destination?: string;
  gross_weight_kg?: number;
  tare_weight_kg?: number;
  net_weight_kg?: number;
  moisture_pct?: number;
  grade?: string;
  dockage_pct?: number;
  protein_pct?: number;
}

function saveLastLoad(data: Record<string, string | null>) {
  try { LAST_LOAD_FILE.write(JSON.stringify(data)); } catch {}
}

function loadLastLoad(): Record<string, string | null> | null {
  try {
    if (!LAST_LOAD_FILE.exists) return null;
    return JSON.parse(LAST_LOAD_FILE.text());
  } catch { return null; }
}

export default function AddLoadScreen({ route, navigation }: { route: any; navigation: any }) {
  const { user, farm } = useAuth();
  const { commodities, locations, getBinsForLocation, contracts, getContractsForCommodity } = useLookup();
  const { triggerSync, refreshStats } = useSync();
  const isOnline = useNetworkStatus();

  // Origin fields
  const [cropYear, setCropYear] = useState(String(new Date().getFullYear()));
  const [commodityId, setCommodityId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [binId, setBinId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [operator, setOperator] = useState(user?.name || '');
  const [equipment, setEquipment] = useState('');

  // Destination fields
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [ticketNumber, setTicketNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [net, setNet] = useState('');

  // Quality (collapsible)
  const [showQuality, setShowQuality] = useState(false);
  const [moisture, setMoisture] = useState('');
  const [grade, setGrade] = useState('');
  const [dockage, setDockage] = useState('');
  const [protein, setProtein] = useState('');

  // Notes & state
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Receive photo URI from CaptureScreen
  useEffect(() => {
    const uri = route.params?.photoUri;
    if (uri && uri !== photoUri) {
      setPhotoUri(uri);
      runExtraction(uri);
    }
  }, [route.params?.photoUri]);

  // Reset bin when location changes
  useEffect(() => { setBinId(null); }, [locationId]);

  // Build picker items
  const commodityItems: PickerItem[] = commodities.map((c) => ({
    id: c.id, label: c.name, subtitle: c.code,
  }));

  const locationItems: PickerItem[] = locations.map((l) => ({
    id: l.id, label: l.name, subtitle: l.code,
  }));

  const binItems: PickerItem[] = locationId
    ? getBinsForLocation(locationId).map((b) => ({ id: b.id, label: b.bin_number }))
    : [];

  const contractItems: PickerItem[] = commodityId
    ? getContractsForCommodity(commodityId).map((c) => ({
        id: c.id,
        label: c.contract_number,
        subtitle: `${c.counterparty.name} — ${c.commodity.name}`,
      }))
    : contracts.map((c) => ({
        id: c.id,
        label: c.contract_number,
        subtitle: `${c.counterparty.name} — ${c.commodity.name}`,
      }));

  const runExtraction = async (uri: string) => {
    if (!farm || !isOnline) return;
    setExtracting(true);

    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'ticket.jpg';
      formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as unknown as Blob);

      const res = await api.post(`/farms/${farm.id}/mobile/tickets/extract`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      const ext = res.data.extraction as ExtractionResult;
      const conf = res.data.confidence as number;
      setExtraction(ext);
      setConfidence(conf);

      // Auto-fill fields from extraction
      if (ext.ticket_number) setTicketNumber(ext.ticket_number);
      if (ext.destination || ext.buyer) setDestination(ext.destination || ext.buyer || '');
      if (ext.gross_weight_kg) setGross(String(ext.gross_weight_kg));
      if (ext.tare_weight_kg) setTare(String(ext.tare_weight_kg));
      if (ext.net_weight_kg) setNet(String(ext.net_weight_kg));
      if (ext.moisture_pct) setMoisture(String(ext.moisture_pct));
      if (ext.grade) setGrade(ext.grade);
      if (ext.dockage_pct) setDockage(String(ext.dockage_pct));
      if (ext.protein_pct) setProtein(String(ext.protein_pct));
    } catch (err) {
      console.warn('Extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleCapture = () => {
    navigation.navigate('Capture');
  };

  const handleRetake = () => {
    setPhotoUri(null);
    setExtraction(null);
    setConfidence(null);
    navigation.navigate('Capture');
  };

  const handleReusePrevious = () => {
    const last = loadLastLoad();
    if (!last) {
      Alert.alert('No Previous Load', 'Submit a load first to reuse its origin fields.');
      return;
    }
    if (last.commodityId) setCommodityId(last.commodityId);
    if (last.locationId) setLocationId(last.locationId);
    if (last.binId) setBinId(last.binId);
    if (last.contractId) setContractId(last.contractId);
    if (last.equipment) setEquipment(last.equipment);
    if (last.cropYear) setCropYear(last.cropYear);
  };

  const handleSave = async () => {
    // Validate required fields
    if (!commodityId) {
      Alert.alert('Missing Field', 'Please select a crop.');
      return;
    }
    if (!locationId) {
      Alert.alert('Missing Field', 'Please select an origin location.');
      return;
    }
    const netVal = parseFloat(net);
    const grossVal = parseFloat(gross);
    const tareVal = parseFloat(tare);
    if (isNaN(netVal) && (isNaN(grossVal) || isNaN(tareVal))) {
      Alert.alert('Missing Weight', 'Please enter net weight, or both gross and tare.');
      return;
    }

    if (!farm) return;
    setSaving(true);

    const clientId = uuidv4();
    const commodity = commodities.find((c) => c.id === commodityId);
    const location = locations.find((l) => l.id === locationId);
    const contract = contracts.find((c) => c.id === contractId);

    const overrides: Record<string, unknown> = {
      ticket_number: ticketNumber || undefined,
      delivery_date: new Date().toISOString(),
      crop: commodity?.name,
      crop_year: parseInt(cropYear) || new Date().getFullYear(),
      commodity_id: commodityId,
      location_id: locationId,
      bin_id: binId || undefined,
      contract_number: contract?.contract_number || undefined,
      marketing_contract_id: contractId || undefined,
      operator_name: operator || user?.name,
      equipment: equipment || undefined,
      destination: destination || undefined,
      gross_weight_kg: grossVal || undefined,
      tare_weight_kg: tareVal || undefined,
      net_weight_kg: !isNaN(netVal) ? netVal : (grossVal - tareVal),
      moisture_pct: parseFloat(moisture) || undefined,
      grade: grade || undefined,
      dockage_pct: parseFloat(dockage) || undefined,
      protein_pct: parseFloat(protein) || undefined,
      notes: notes || undefined,
    };

    // Save origin info for "Reuse Previous"
    saveLastLoad({
      commodityId, locationId, binId, contractId, equipment, cropYear,
    });

    if (isOnline) {
      try {
        const formData = new FormData();
        if (photoUri) {
          const filename = photoUri.split('/').pop() || 'ticket.jpg';
          formData.append('photo', { uri: photoUri, name: filename, type: 'image/jpeg' } as unknown as Blob);
        }
        formData.append('data', JSON.stringify({
          client_id: clientId,
          extraction_json: extraction,
          extraction_confidence: confidence,
          overrides,
          device_timestamp: new Date().toISOString(),
        }));

        await api.post(`/farms/${farm.id}/mobile/tickets`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        });

        Alert.alert('Saved', 'Ticket submitted successfully.', [
          { text: 'Add Another', onPress: () => resetForm(true) },
          { text: 'View Tickets', onPress: () => navigation.navigate('Tickets') },
        ]);
      } catch (err) {
        console.warn('Submit failed, queueing offline:', err);
        await enqueueOffline(clientId, overrides);
        Alert.alert('Saved Offline', 'Ticket queued — will sync when connected.');
        resetForm(true);
      }
    } else {
      await enqueueOffline(clientId, overrides);
      Alert.alert('Saved Offline', 'Ticket queued — will sync when connected.');
      resetForm(true);
    }

    setSaving(false);
  };

  const enqueueOffline = async (clientId: string, overrides: Record<string, unknown>) => {
    await enqueue({
      id: uuidv4(),
      client_id: clientId,
      farm_id: farm!.id,
      image_uri: photoUri || '',
      extraction_json: extraction as Record<string, unknown> | null,
      overrides,
      device_timestamp: new Date().toISOString(),
    });
    await refreshStats();
  };

  const resetForm = (keepOrigin: boolean) => {
    if (!keepOrigin) {
      setCommodityId(null);
      setLocationId(null);
      setBinId(null);
      setContractId(null);
      setEquipment('');
    }
    setPhotoUri(null);
    setExtraction(null);
    setConfidence(null);
    setTicketNumber('');
    setDestination('');
    setGross('');
    setTare('');
    setNet('');
    setMoisture('');
    setGrade('');
    setDockage('');
    setProtein('');
    setNotes('');
    setShowQuality(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Reuse Previous */}
        <TouchableOpacity style={styles.reuseButton} onPress={handleReusePrevious}>
          <Text style={styles.reuseText}>Reuse Previous Load Info</Text>
        </TouchableOpacity>

        {/* Origin Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Origin</Text>
        </View>

        <FieldPicker
          label="Crop Year"
          items={Array.from({ length: 5 }, (_, i) => {
            const y = new Date().getFullYear() - i;
            return { id: String(y), label: String(y) };
          })}
          selectedId={cropYear}
          onSelect={(id) => setCropYear(id)}
        />
        <FieldPicker
          label="Crop"
          items={commodityItems}
          selectedId={commodityId}
          onSelect={(id) => setCommodityId(id)}
          required
          placeholder="Select crop"
        />
        <FieldPicker
          label="Origin"
          items={locationItems}
          selectedId={locationId}
          onSelect={(id) => setLocationId(id)}
          required
          placeholder="Select location"
        />
        {locationId && binItems.length > 0 && (
          <FieldPicker
            label="Bin"
            items={binItems}
            selectedId={binId}
            onSelect={(id) => setBinId(id)}
            placeholder="Select bin"
          />
        )}

        <View style={styles.textFieldRow}>
          <Text style={styles.textFieldLabel}>Operator</Text>
          <TextInput
            style={styles.textFieldInput}
            value={operator}
            onChangeText={setOperator}
            placeholder={user?.name || 'Operator name'}
            placeholderTextColor={TEXT_MUTED}
          />
        </View>

        <View style={styles.textFieldRow}>
          <Text style={styles.textFieldLabel}>Equipment</Text>
          <TextInput
            style={styles.textFieldInput}
            value={equipment}
            onChangeText={setEquipment}
            placeholder="Truck / trailer"
            placeholderTextColor={TEXT_MUTED}
          />
        </View>

        <FieldPicker
          label="Contract"
          items={contractItems}
          selectedId={contractId}
          onSelect={(id) => setContractId(id)}
          placeholder="Select contract"
        />

        {/* Destination Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Destination</Text>
        </View>

        <PhotoCapture
          photoUri={photoUri}
          extracting={extracting}
          confidence={confidence}
          onCapture={handleCapture}
          onRetake={handleRetake}
        />

        <View style={styles.textFieldRow}>
          <Text style={styles.textFieldLabel}>Ticket #</Text>
          <TextInput
            style={styles.textFieldInput}
            value={ticketNumber}
            onChangeText={setTicketNumber}
            placeholder="--"
            placeholderTextColor={TEXT_MUTED}
          />
        </View>

        <View style={styles.textFieldRow}>
          <Text style={styles.textFieldLabel}>Destination</Text>
          <TextInput
            style={styles.textFieldInput}
            value={destination}
            onChangeText={setDestination}
            placeholder="Buyer / destination"
            placeholderTextColor={TEXT_MUTED}
          />
        </View>

        <WeightFields
          gross={gross}
          tare={tare}
          net={net}
          onGrossChange={setGross}
          onTareChange={setTare}
          onNetChange={setNet}
        />

        {/* Quality Metrics (collapsible) */}
        <TouchableOpacity
          style={styles.qualityToggle}
          onPress={() => setShowQuality(!showQuality)}
        >
          <Text style={styles.qualityToggleText}>
            {showQuality ? '▾' : '▸'} Quality Metrics
          </Text>
        </TouchableOpacity>

        {showQuality && (
          <View>
            <QualityField label="Moisture %" value={moisture} onChange={setMoisture} />
            <QualityField label="Grade" value={grade} onChange={setGrade} keyboard="default" />
            <QualityField label="Dockage %" value={dockage} onChange={setDockage} />
            <QualityField label="Protein %" value={protein} onChange={setProtein} />
          </View>
        )}

        {/* Notes */}
        <View style={styles.notesContainer}>
          <Text style={styles.textFieldLabel}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes..."
            placeholderTextColor={TEXT_MUTED}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Load</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function QualityField({ label, value, onChange, keyboard }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.textFieldRow}>
      <Text style={styles.textFieldLabel}>{label}</Text>
      <TextInput
        style={styles.textFieldInput}
        value={value}
        onChangeText={onChange}
        placeholder="--"
        placeholderTextColor={TEXT_MUTED}
        keyboardType={keyboard || 'decimal-pad'}
        returnKeyType="done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BACKGROUND },
  scroll: { paddingBottom: 20 },
  reuseButton: {
    margin: 16,
    marginBottom: 0,
    padding: 12,
    backgroundColor: SURFACE,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  reuseText: { fontSize: 14, color: C2_TEAL, fontWeight: '600' },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  textFieldLabel: { fontSize: 15, color: C2_DARK },
  textFieldInput: {
    fontSize: 15,
    color: C2_CHARCOAL,
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
    padding: 4,
  },
  qualityToggle: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    marginTop: 8,
  },
  qualityToggleText: { fontSize: 15, color: C2_TEAL, fontWeight: '600' },
  notesContainer: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    marginTop: 8,
  },
  notesInput: {
    fontSize: 15,
    color: C2_CHARCOAL,
    marginTop: 8,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  saveButton: {
    margin: 16,
    backgroundColor: C2_TEAL,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { backgroundColor: C2_TEAL_DARK, opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
