import { forwardRef } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

interface Props {
  onKeyPress: (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
}

export const HiddenKeyboardInput = forwardRef<TextInput, Props>(
  ({ onKeyPress, onBlur, onSubmitEditing }, ref) => (
    <TextInput
      ref={ref}
      style={styles.input}
      caretHidden
      keyboardType="ascii-capable"
      showSoftInputOnFocus={false}
      disableKeyboardShortcuts={true}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      onKeyPress={onKeyPress}
      onBlur={onBlur}
      onSubmitEditing={onSubmitEditing}
    />
  )
);
HiddenKeyboardInput.displayName = 'HiddenKeyboardInput';

const styles = StyleSheet.create({
  input: { position: 'absolute', width: 0, height: 0, opacity: 0 },
});
