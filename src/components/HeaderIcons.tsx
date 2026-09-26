import React from 'react';
import {View, Image} from 'react-native';

// Simple icons drawn with plain Views, so no icon library is needed.

/** Settings gear. `background` is the colour behind the icon (used for the centre hole). */
export function GearIcon({
  size = 24,
  color = 'white',
  background = '#4D4D61',
}: {
  size?: number;
  color?: string;
  background?: string;
}) {
  const tooth = size * 0.22; // thickness of each pair of teeth
  const body = size * 0.72; // solid centre of the gear
  const hole = size * 0.3;
  const centered = (w: number, h: number) => ({
    position: 'absolute' as const,
    width: w,
    height: h,
    left: (size - w) / 2,
    top: (size - h) / 2,
  });

  return (
    <View style={{width: size, height: size}}>
      {/* 4 bars at 45° steps make 8 teeth */}
      {[0, 45, 90, 135].map(deg => (
        <View
          key={deg}
          style={[
            centered(tooth, size),
            {
              backgroundColor: color,
              borderRadius: tooth * 0.25,
              transform: [{rotate: `${deg}deg`}],
            },
          ]}
        />
      ))}
      <View
        style={[centered(body, body), {backgroundColor: color, borderRadius: body / 2}]}
      />
      <View
        style={[centered(hole, hole), {backgroundColor: background, borderRadius: hole / 2}]}
      />
    </View>
  );
}

/** Profile / account symbol: head and shoulders inside a circle. */
export function ProfileIcon({
  size = 26,
  color = 'white',
}: {
  size?: number;
  color?: string;
}) {
  const ring = Math.max(1.5, size * 0.08);
  const head = size * 0.34;
  const bodyW = size * 0.66;
  const bodyH = size * 0.42;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ring,
        borderColor: color,
        overflow: 'hidden',
        alignItems: 'center',
      }}>
      <View
        style={{
          width: head,
          height: head,
          borderRadius: head / 2,
          backgroundColor: color,
          marginTop: size * 0.16,
        }}
      />
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderTopLeftRadius: bodyW / 2,
          borderTopRightRadius: bodyW / 2,
          backgroundColor: color,
          marginTop: size * 0.07,
        }}
      />
    </View>
  );
}

/**
 * The user's profile picture in a circle, or the profile symbol if they
 * haven't set one.
 */
export function ProfileAvatar({
  size = 30,
  photoPath,
  color = 'white',
  background,
}: {
  size?: number;
  photoPath?: string;
  color?: string;
  /** If set (and there's no photo), the symbol sits smaller inside a filled circle */
  background?: string;
}) {
  if (!photoPath) {
    if (!background) return <ProfileIcon size={size} color={color} />;
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <ProfileIcon size={size * 0.5} color={color} />
      </View>
    );
  }
  return (
    <Image
      source={{uri: `file://${photoPath}`}}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(1.5, size * 0.06),
        borderColor: color,
      }}
      accessibilityLabel="Profile picture"
    />
  );
}
