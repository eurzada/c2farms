import React, { useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { C2_TEAL, C2_DARK, SURFACE } from '../theme/colors';

export default function CaptureScreen({ navigation }: { navigation: any }) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access is needed to photograph delivery tickets.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo) {
        setCapturing(false);
        return;
      }

      // Compress: max 2000px wide, 85% JPEG
      const manipulated = await manipulateAsync(
        photo.uri,
        [{ resize: { width: 2000 } }],
        { compress: 0.85, format: SaveFormat.JPEG },
      );

      navigation.navigate('Main', {
        screen: 'AddLoad',
        params: { photoUri: manipulated.uri },
      });
    } catch (err) {
      console.warn('Capture failed:', err);
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* Viewfinder overlay */}
        <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom}>
            <Text style={styles.hint}>Center the ticket in the frame</Text>
            <TouchableOpacity
              style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
              onPress={handleCapture}
              disabled={capturing}
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: { flex: 1 },
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  overlayMiddle: { flexDirection: 'row' },
  overlaySide: { flex: 0.1, backgroundColor: 'rgba(0,0,0,0.5)' },
  viewfinder: {
    flex: 0.8,
    aspectRatio: 1.5,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: SURFACE,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  overlayBottom: {
    flex: 1.5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  hint: { color: SURFACE, fontSize: 15 },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonDisabled: { opacity: 0.4 },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: SURFACE,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: C2_DARK,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionText: {
    color: SURFACE,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: C2_TEAL,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: SURFACE,
    fontSize: 16,
    fontWeight: '600',
  },
});
