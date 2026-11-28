import { configure, render } from '@testing-library/react-native';
import { ActivityIndicator, Modal, ScrollView, Switch, Text, TextInput, View } from 'react-native';

// Dates are formatted and days counted in UTC, like the cores' tests.
process.env['TZ'] = 'UTC';
// findBy* waits up to 10 s: generous for a loaded CI machine; a passing test never waits that long.
configure({ asyncUtilTimeout: 10_000 });

// React Native loads (and jest transforms) its components lazily on first use. Do that once here, outside every
// test's own timeout, so a cold cache on a busy machine does not fail the first test of a file.
beforeAll(async () => {
  const s = await render(
    <ScrollView>
      <View>
        <Text>warm</Text>
        <TextInput />
        <Switch />
        <ActivityIndicator />
        <Modal visible={false} />
      </View>
    </ScrollView>,
  );
  await s.unmount();
}, 300_000);
