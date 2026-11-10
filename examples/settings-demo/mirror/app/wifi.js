import { Text, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Screen, NavBar, Group, Row, Switch, useStoredBool, colors } from '../components/ui';

export default function Wifi() {
  const [on, setOn] = useStoredBool('wifi', true);
  const nets = useAnimatedStyle(() => ({
    maxHeight: withTiming(on ? 300 : 0, { duration: 300 }),
    opacity: withTiming(on ? 1 : 0, { duration: 300 }),
  }), [on]);
  return (
    <Screen slide>
      <NavBar title="Wi-Fi" />
      <View style={{ height: 12 }} />
      <Group><Row first label="Wi-Fi" right={<Switch value={on} onChange={setOn} />} /></Group>
      <Animated.View style={[{ overflow: 'hidden' }, nets]}>
        <Text style={styles.head}>NETWORKS</Text>
        <Group>
          <Row first label="Home" right={<Text style={styles.check}>✓</Text>} />
          <Row label="Cafe Guest" />
          <Row label="Office 5G" />
        </Group>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginHorizontal: 32, marginBottom: 8, fontSize: 13, color: colors.muted },
  check: { marginLeft: 'auto', fontSize: 20, color: colors.accent },
});
