import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import AddLoadScreen from '../screens/AddLoadScreen';
import CaptureScreen from '../screens/CaptureScreen';
import TicketsScreen from '../screens/TicketsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { C2_TEAL, C2_TEAL_DARK, TEXT_MUTED, SURFACE } from '../theme/colors';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  Capture: undefined;
};

export type MainTabParamList = {
  AddLoad: { photoUri?: string } | undefined;
  Tickets: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: C2_TEAL,
        tabBarInactiveTintColor: TEXT_MUTED,
        tabBarStyle: { paddingBottom: 4 },
        headerStyle: { backgroundColor: C2_TEAL_DARK },
        headerTintColor: '#fff',
      }}
    >
      <Tab.Screen
        name="AddLoad"
        component={AddLoadScreen}
        options={{
          title: 'Add Load',
          tabBarIcon: ({ color, size }) => (
            <View style={{
              width: size, height: size,
              justifyContent: 'center', alignItems: 'center',
            }}>
              {/* Truck + plus icon */}
              <View style={{
                width: size * 0.7, height: size * 0.45,
                borderWidth: 2, borderColor: color, borderRadius: 3,
              }} />
              <View style={{
                position: 'absolute', top: 0, right: 0,
                width: size * 0.4, height: size * 0.4,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <View style={{ width: 2, height: size * 0.3, backgroundColor: color, position: 'absolute' }} />
                <View style={{ width: size * 0.3, height: 2, backgroundColor: color, position: 'absolute' }} />
              </View>
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Tickets"
        component={TicketsScreen}
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
        <ActivityIndicator size="large" color={C2_TEAL} />
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
              name="Capture"
              component={CaptureScreen}
              options={{
                presentation: 'fullScreenModal',
                headerShown: true,
                title: 'Capture Ticket',
                headerStyle: { backgroundColor: C2_TEAL_DARK },
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
