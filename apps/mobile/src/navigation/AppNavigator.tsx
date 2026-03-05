import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import CameraScreen from '../screens/CameraScreen';
import ReviewScreen from '../screens/ReviewScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

// Type definitions
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  Review: {
    imageUri: string;
    extraction: Record<string, unknown> | null;
    confidence: number | null;
  };
};

export type MainTabParamList = {
  Capture: undefined;
  Tickets: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#1B5E20',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { paddingBottom: 4 },
        headerStyle: { backgroundColor: '#1B5E20' },
        headerTintColor: '#fff',
      }}
    >
      <Tab.Screen
        name="Capture"
        component={CameraScreen}
        options={{
          title: 'Capture',
          tabBarIcon: ({ color, size }) => (
            <View style={{
              width: size, height: size, borderRadius: size / 2,
              backgroundColor: color, opacity: 0.3,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <View style={{
                width: size * 0.5, height: size * 0.5,
                borderRadius: size * 0.25, backgroundColor: color,
              }} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Tickets"
        component={HistoryScreen}
        options={{
          title: 'Tickets',
          tabBarIcon: ({ color, size }) => (
            <View style={{ width: size, height: size, justifyContent: 'center' }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{
                  height: 2, backgroundColor: color,
                  marginVertical: 1.5, borderRadius: 1,
                }} />
              ))}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <View style={{
              width: size, height: size, borderRadius: size / 2,
              borderWidth: 2, borderColor: color,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1B5E20" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="Review"
              component={ReviewScreen}
              options={{
                headerShown: true,
                title: 'Review Ticket',
                headerStyle: { backgroundColor: '#1B5E20' },
                headerTintColor: '#fff',
              }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
