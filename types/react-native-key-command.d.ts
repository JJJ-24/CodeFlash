// react-native-key-command は型定義を同梱しないため最小限の宣言を置く（034）。
declare module 'react-native-key-command' {
  export const constants: {
    keyInputEscape: string;
    keyInputUpArrow: string;
    keyInputDownArrow: string;
    keyInputLeftArrow: string;
    keyInputRightArrow: string;
    keyModifierCommand: number;
    keyModifierShift: number;
    keyModifierControl: number;
    [key: string]: string | number;
  };

  export interface KeyCommandObject {
    input: string;
    modifierFlags: number;
  }

  export interface KeyCommandPayload {
    input: string;
    modifierFlags: number;
  }

  export interface Subscription {
    remove(): void;
  }

  export function registerKeyCommands(commands: KeyCommandObject[]): void;
  export function unregisterKeyCommands(commands: KeyCommandObject[]): void;

  export const eventEmitter: {
    addListener(
      event: 'onKeyCommand',
      callback: (payload: KeyCommandPayload) => void,
    ): Subscription;
  };

  export function addListener(
    command: KeyCommandObject,
    callback: (payload: KeyCommandPayload) => void,
  ): Subscription;
}
