// Expo's preset for Metro; jest uses React Native's preset (see jest.config.cjs) so the test needs no Expo runtime.
module.exports = (api) => {
  const jest = api.env('test');
  api.cache.using(() => jest);
  return { presets: [jest ? 'module:@react-native/babel-preset' : 'babel-preset-expo'] };
};
