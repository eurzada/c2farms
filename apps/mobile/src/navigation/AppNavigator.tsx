import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import NewTicketScreen from '../screens/NewTicketScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

// Type definitions
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  NewTicket: undefined;
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
        name="NewTicket"
        component={NewTicketScreen}
        options={{
          title: 'New Ticket',
          tabBarIcon: ({ color, size }) => (
            <View style={{
              width: size, height: size, borderRadius: 4,
              borderWidth: 2, borderColor: color,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <View style={{ width: size * 0.5, height: 2, backgroundColor: color, position: 'absolute' }} />
              <View style={{ width: 2, height: size * 0.5, backgroundColor: color, position: 'absolute' }} />
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
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
