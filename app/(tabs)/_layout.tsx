import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, size }: { name: IoniconsName; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: t('tabs.study'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="book-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabs.stats'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="bar-chart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
