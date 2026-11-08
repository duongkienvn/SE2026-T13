import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import logo from '../../assets/brand/kanvexa-logo-v1.png';

export default function BootstrapScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <Image
            source={logo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Kanvexa logo"
          />
          <Text accessibilityRole="header" style={styles.title}>
            Kanvexa
          </Text>
          <Text style={styles.subtitle}>Mobile foundation</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8F9FE' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  brand: { alignItems: 'center', gap: 16, width: '100%', maxWidth: 360 },
  logo: { width: 96, height: 96 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#171A35',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5E6685',
    textAlign: 'center',
  },
});
