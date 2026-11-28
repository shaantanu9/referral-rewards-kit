// The demo test runs on React Native's jest preset without Expo's native runtime: the Expo modules are stubbed.
export const isPasteButtonAvailable = false;
export const setStringAsync = async (): Promise<boolean> => true;
export const getStringAsync = async (): Promise<string> => '';
export const ClipboardPasteButton = (): null => null;
