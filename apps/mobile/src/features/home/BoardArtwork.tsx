import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import mountains from '../../../assets/board-backgrounds/mountains.jpg';
import forest from '../../../assets/board-backgrounds/forest.jpg';
import coast from '../../../assets/board-backgrounds/coast.jpg';
import lake from '../../../assets/board-backgrounds/lake.jpg';
import boardsIcon from '../../../assets/navigation/boards.png';
import { radius, useTheme } from '../../ui';
import { boardPresetColor, isBoardPreset } from './presets';

const photos = { mountains, forest, coast, lake };

export function BoardArtwork({ preset }: { preset: string }) {
  // Remount on preset changes so a failed decode cannot hide a new photo.
  return <PresetArtwork key={preset} preset={preset} />;
}

function PresetArtwork({ preset }: { preset: string }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const photo = Object.hasOwn(photos, preset)
    ? photos[preset as keyof typeof photos]
    : undefined;
  const color = boardPresetColor(preset, c.primaryTint);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.thumbnail, { backgroundColor: color }]}
    >
      <Image
        source={boardsIcon}
        style={{
          width: 21,
          height: 21,
          tintColor:
            preset === 'amber'
              ? '#171A35'
              : isBoardPreset(preset)
                ? '#FFFFFF'
                : c.text,
        }}
      />
      {photo && !failed && (
        <Image
          source={photo}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: 42,
    height: 42,
    borderRadius: radius.control,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
