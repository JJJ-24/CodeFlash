import { StyleSheet, Text, View } from 'react-native';

export default function StatsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>統計</Text>
      <Text style={styles.sub}>（012 チケットで実装）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  sub: {
    fontSize: 14,
    color: '#999',
  },
});
