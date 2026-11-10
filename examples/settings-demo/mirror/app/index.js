import { router } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { Screen, Group, Row, colors } from '../components/ui';

export default function Home() {
  return (
    <Screen>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.search}><Text style={styles.searchText}>Search</Text></View>
      <Group>
        <Row first icon="#007aff" label="Wi-Fi" value="Home" chevron onPress={() => router.push('/wifi')} />
        <Row icon="#5856d6" label="Bluetooth" value="On" chevron />
        <Row icon="#34c759" label="Cellular" chevron />
      </Group>
      <Group>
        <Row first icon="#ff3b30" label="Notifications" chevron onPress={() => router.push('/notifications')} />
        <Row icon="#ff2d55" label="Sounds" chevron />
        <Row icon="#5856d6" label="Focus" chevron />
      </Group>
      <Group>
        <Row first icon="#8e8e93" label="General" chevron />
        <Row icon="#007aff" label="Display" chevron />
        <Row icon="#ff9500" label="Battery" chevron />
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 34, fontWeight: '700', color: colors.text, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  search: { marginHorizontal: 16, marginBottom: 18, height: 36, borderRadius: 10, backgroundColor: colors.searchBar, justifyContent: 'center', paddingLeft: 12 },
  searchText: { fontSize: 17, color: colors.muted },
});
