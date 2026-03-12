import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>デッキ一覧</Text>
      <Text style={styles.sub}>（002 チケットで実装）</Text>
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
