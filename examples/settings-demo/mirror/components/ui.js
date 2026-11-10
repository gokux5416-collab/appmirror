import { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { Easing, SlideInRight, SlideOutRight, useAnimatedStyle, withTiming } from 'react-native-reanimated';

const PUSH = Easing.bezierFn(0.3, 0.7, 0.2, 1); // fast start, soft landing (read from the recording)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

export const colors = {
  background: '#f2f2f7', card: '#ffffff', text: '#111111', muted: '#8a8a8e',
  separator: '#e5e5ea', accent: '#007aff', switchOn: '#34c759', searchBar: '#e3e3e8',
};

// A boolean that survives app restarts (AsyncStorage).
export function useStoredBool(key, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    AsyncStorage.getItem(key).then((v) => { if (v !== null) setValue(v === '1'); }).catch(() => {});
  }, [key]);
  const set = (next) => { setValue(next); AsyncStorage.setItem(key, next ? '1' : '0').catch(() => {}); };
  return [value, set];
}

// Web has no native slide between screens, so it is done here with Reanimated
// (the same code runs on iOS and Android, where the stack animation is turned off).
export function Screen({ children, slide }) {
  return (
    <Animated.View
      style={styles.screen}
      entering={slide ? SlideInRight.duration(320).easing(PUSH) : undefined}
      exiting={slide ? SlideOutRight.duration(320).easing(PUSH) : undefined}
    >
      {children}
    </Animated.View>
  );
}

export function NavBar({ title }) {
  return (
    <View style={styles.nav}>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.back}>‹ Settings</Text>
      </Pressable>
      <Text style={styles.navTitle} pointerEvents="none">{title}</Text>
    </View>
  );
}

export function Group({ children }) {
  return <View style={styles.group}>{children}</View>;
}

export function Row({ label, icon, value, chevron, onPress, right, first }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      {!first && <View style={[styles.sep, { left: icon ? 52 : 14 }]} />}
      {icon && <View style={[styles.icon, { backgroundColor: icon }]} />}
      <Text style={styles.rowText}>{label}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {chevron ? <Text style={[styles.chev, value ? null : { marginLeft: 'auto' }]}>›</Text> : null}
      {right}
    </Pressable>
  );
}

export function Switch({ value, onChange }) {
  const track = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? colors.switchOn : colors.separator, { duration: 220 }),
  }), [value]);
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(value ? 20 : 0, { duration: 220 }) }],
  }), [value]);
  return (
    <Pressable onPress={() => onChange(!value)} style={{ marginLeft: 'auto' }}>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
  nav: { height: 44, justifyContent: 'center', paddingHorizontal: 8 },
  back: { color: colors.accent, fontSize: 17 },
  navTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text },
  group: { marginHorizontal: 16, marginBottom: 22, backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  row: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  sep: { position: 'absolute', top: 0, right: 0, height: 1, backgroundColor: colors.separator },
  icon: { width: 30, height: 30, borderRadius: 7, marginRight: 12 },
  rowText: { fontSize: 17, color: colors.text },
  value: { marginLeft: 'auto', fontSize: 17, color: colors.muted },
  chev: { marginLeft: 6, fontSize: 20, color: '#c4c4c7' },
  track: { width: 51, height: 31, borderRadius: 16, justifyContent: 'center' },
  knob: { position: 'absolute', top: 2, left: 2, width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.25)' },
});
