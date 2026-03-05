import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../contexts/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import api from '../services/api';
import OfflineBanner from '../components/OfflineBanner';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Main'>;

export default function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const navigation = useNavigation<NavigationProp>();
  const { farm } = useAuth();
  const isOnline = useNetworkStatus();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera access is needed to photograph delivery tickets.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

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

      // Resize to max 2000px width to reduce upload size
      const manipulated = await manipulateAsync(
        photo.uri,
        [{ resize: { width: 2000 } }],
        { compress: 0.85, format: SaveFormat.JPEG },
      );

      // Try online extraction if connected
      let extraction = null;
      let confidence = null;

      if (isOnline && farm) {
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
          extraction = data.extraction;
          confidence = data.confidence;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          console.warn('Online extraction failed:', msg);
          Alert.alert('Extraction failed', `Will proceed with manual entry.\n\nFarm: ${farm?.id}\nError: ${msg}`);
        }
      }

      navigation.navigate('Review', {
        imageUri: manipulated.uri,
        extraction,
        confidence,
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
      console.error(err);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
      >
        {/* Viewfinder overlay */}
        <View style={styles.overlay}>
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>

        <Text style={styles.hint}>
          Position the delivery ticket within the frame
        </Text>

        {/* Capture button */}
        <View style={styles.captureRow}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            disabled={capturing}
          >
            {capturing ? (
              <ActivityIndicator color="#1B5E20" size="large" />
            ) : (
              <View style={styles.captureInner} />
            )}
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
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
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#1B5E20',
  },
  permissionText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#1B5E20',
    fontSize: 16,
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
    margin: 40,
  },
  cornerTL: { ...cornerBase, top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerTR: { ...cornerBase, top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerBL: { ...cornerBase, bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: '#fff' },
  cornerBR: { ...cornerBase, bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: '#fff' },
  hint: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 40,
    borderRadius: 8,
  },
  captureRow: {
    alignItems: 'center',
    paddingBottom: 30,
    paddingTop: 20,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#ccc',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1B5E20',
  },
});
