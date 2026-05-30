// デッキアイコンのキュレーション。Ionicons から単色ベクター（カラー連動可）を選定。
// 文化的にニュートラルなものに限定し、学習以外（日記・TODO 等）にも使える汎用性を持たせる。

import type { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface DeckIconCategory {
  key: string;
  icons: IoniconName[];
}

export const DECK_ICON_CATEGORIES: DeckIconCategory[] = [
  {
    key: 'study',
    icons: [
      'book',
      'book-outline',
      'school',
      'library',
      'glasses',
      'newspaper',
      'document-text',
    ],
  },
  {
    key: 'code',
    icons: [
      'code-slash',
      'terminal',
      'git-branch',
      'git-merge',
      'logo-github',
      'cube',
      'construct',
    ],
  },
  {
    key: 'science',
    icons: [
      'flask',
      'magnet',
      'planet',
      'leaf',
      'thermometer',
      'rocket',
      'telescope',
    ],
  },
  {
    key: 'language',
    icons: [
      'language',
      'chatbubbles',
      'text',
      'mic',
      'megaphone',
    ],
  },
  {
    key: 'life',
    icons: [
      'bulb',
      'medkit',
      'musical-notes',
      'briefcase',
      'heart',
      'star',
      'trophy',
      'calendar',
      'time',
      'restaurant',
      'fitness',
      'paw',
      'airplane',
      'car',
      'home',
      'cash',
    ],
  },
];

export const DECK_ICONS: IoniconName[] = DECK_ICON_CATEGORIES.flatMap((c) => c.icons);

export type DeckIconName = IoniconName;
