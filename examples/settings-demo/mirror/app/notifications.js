import { Text, StyleSheet, View } from 'react-native';
import { Screen, NavBar, Group, Row, Switch, useStoredBool, colors } from '../components/ui';

export default function Notifications() {
  const [allow, setAllow] = useStoredBool('notif-allow', true);
  const [badges, setBadges] = useStoredBool('notif-badges', true);
  const [sounds, setSounds] = useStoredBool('notif-sounds', false);
  return (
    <Screen slide>
      <NavBar title="Notifications" />
      <View style={{ height: 12 }} />
      <Group>
        <Row first label="Allow Notifications" right={<Switch value={allow} onChange={setAllow} />} />
        <Row label="Badges" right={<Switch value={badges} onChange={setBadges} />} />
        <Row label="Sounds" right={<Switch value={sounds} onChange={setSounds} />} />
      </Group>
      <Text style={styles.foot}>Choose which apps can send you alerts.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  foot: { marginHorizontal: 32, marginTop: -14, fontSize: 13, color: colors.muted },
});
