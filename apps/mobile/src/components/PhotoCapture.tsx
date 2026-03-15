import React from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { C2_TEAL, C2_TEAL_LIGHT, SURFACE, BORDER, TEXT_MUTED, SUCCESS, WARNING, ERROR } from '../theme/colors';

interface Props {
  photoUri: string | null;
  extracting: boolean;
  confidence: number | null;
  onCapture: () => void;
  onRetake: () => void;
}

export default function PhotoCapture({ photoUri, extracting, confidence, onCapture, onRetake }: Props) {
  if (!photoUri) {
    return (
      <TouchableOpacity style={styles.captureButton} onPress={onCapture}>
        <Text style={styles.captureIcon}>📷</Text>
        <View>
          <Text style={styles.captureText}>Snap Destination Ticket</Text>
          <Text style={styles.captureHint}>Auto-fills weights & ticket #</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const confidenceColor = confidence === null ? TEXT_MUTED
    : confidence >= 0.7 ? SUCCESS
    : confidence >= 0.4 ? WARNING
    : ERROR;

  return (
    <View style={styles.previewContainer}>
      <Image source={{ uri: photoUri }} style={styles.preview} />
      <View style={styles.previewInfo}>
        {extracting ? (
          <View style={styles.extractingRow}>
            <ActivityIndicator size="small" color={C2_TEAL} />
            <Text style={styles.extractingText}>Reading ticket...</Text>
          </View>
        ) : confidence !== null ? (
          <View style={styles.confidenceRow}>
            <View style={[styles.confidenceDot, { backgroundColor: confidenceColor }]} />
            <Text style={styles.confidenceText}>
              {confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Medium' : 'Low'} confidence
            </Text>
          </View>
        ) : null}
        <TouchableOpacity onPress={onRetake}>
          <Text style={styles.retakeText}>Retake</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    margin: 16,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C2_TEAL_LIGHT,
    borderStyle: 'dashed',
  },
  captureIcon: { fontSize: 28 },
  captureText: { fontSize: 16, fontWeight: '600', color: C2_TEAL },
  captureHint: { fontSize: 13, color: TEXT_MUTED, marginTop: 2 },
  previewContainer: {
    margin: 16,
    backgroundColor: SURFACE,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  preview: { width: '100%', height: 120, resizeMode: 'cover' },
  previewInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  extractingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  extractingText: { fontSize: 14, color: C2_TEAL },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceText: { fontSize: 14, color: TEXT_MUTED },
  retakeText: { fontSize: 14, color: C2_TEAL, fontWeight: '600' },
});
