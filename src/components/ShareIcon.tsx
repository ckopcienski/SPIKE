import React from 'react';
import {View, StyleSheet} from 'react-native';

/**
 * The standard Android "share" glyph (three connected dots),
 * drawn with plain Views so no icon library is needed.
 */
export default function ShareIcon({
  size = 20,
  color = 'white',
}: {
  size?: number;
  color?: string;
}) {
  const s = size / 20; // drawn on a 20×20 grid
  const dot = 6 * s;
  const line = 1.8 * s;
  const lineLength = 13.4 * s; // distance between the left dot and each right dot
  const angle = 26.57; // degrees

  const dotStyle = (cx: number, cy: number) => ({
    position: 'absolute' as const,
    width: dot,
    height: dot,
    borderRadius: dot / 2,
    backgroundColor: color,
    left: cx * s - dot / 2,
    top: cy * s - dot / 2,
  });

  const lineStyle = (cx: number, cy: number, deg: number) => ({
    position: 'absolute' as const,
    width: lineLength,
    height: line,
    backgroundColor: color,
    left: cx * s - lineLength / 2,
    top: cy * s - line / 2,
    transform: [{rotate: `${deg}deg`}],
  });

  return (
    <View style={[styles.box, {width: size, height: size}]}>
      <View style={lineStyle(10, 7, -angle)} />
      <View style={lineStyle(10, 13, angle)} />
      <View style={dotStyle(16, 4)} />
      <View style={dotStyle(4, 10)} />
      <View style={dotStyle(16, 16)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {position: 'relative'},
});
