import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { getTagColor } from '@/src/constants/tags';
import type { Lane } from '@/src/types/blocks';

export const PIXELS_PER_MINUTE = 1;

const MINUTES_PER_DAY = 24 * 60;
const SNAP_INTERVAL_MINUTES = 15;

type BlockProps = {
  id: string;
  startMin: number;
  endMin: number;
  title: string;
  tags: string[];
  lane: Lane;
  onPress: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, proposedStartMin: number) => void;
  onDragRelease: (id: string) => void;
  interactive?: boolean;
  dimmed?: boolean;
};

export function Block({
  id,
  startMin,
  endMin,
  title,
  tags,
  lane,
  onPress,
  onDragStart,
  onDragEnd,
  onDragRelease,
  interactive = true,
  dimmed = false,
}: BlockProps) {
  const durationMin = Math.max(1, endMin - startMin);
  const height = durationMin * PIXELS_PER_MINUTE;
  const primaryTag = tags[0];

  const dragDeltaMin = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const gestureStarted = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .enabled(interactive)
    .activateAfterLongPress(220)
    .onStart(() => {
      gestureStarted.value = true;
      isDragging.value = true;
      runOnJS(onDragStart)(id);
    })
    .onUpdate((event) => {
      if (!gestureStarted.value) {
        return;
      }

      const rawDeltaMin = event.translationY / PIXELS_PER_MINUTE;
      const snappedDeltaMin = Math.round(rawDeltaMin / SNAP_INTERVAL_MINUTES) * SNAP_INTERVAL_MINUTES;
      const minDelta = -startMin;
      const maxDelta = MINUTES_PER_DAY - durationMin - startMin;

      dragDeltaMin.value = Math.max(minDelta, Math.min(maxDelta, snappedDeltaMin));
    })
    .onEnd(() => {
      if (!gestureStarted.value) {
        return;
      }

      runOnJS(onDragEnd)(id, startMin + dragDeltaMin.value);
    })
    .onFinalize(() => {
      if (gestureStarted.value) {
        runOnJS(onDragRelease)(id);
      }

      gestureStarted.value = false;
      isDragging.value = false;
      dragDeltaMin.value = 0;
    });

  const tapGesture = Gesture.Tap()
    .enabled(interactive)
    .onEnd((_event, success) => {
      if (success) {
        runOnJS(onPress)(id);
      }
    });

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    top: (startMin + dragDeltaMin.value) * PIXELS_PER_MINUTE,
    opacity: isDragging.value ? 0.88 : dimmed ? 0.28 : 1,
    zIndex: isDragging.value ? 30 : 1,
    elevation: isDragging.value ? 10 : 0,
  }));
  const blockView = (
    <Animated.View
      accessible
      accessibilityLabel={`${lane} block ${title}`}
      style={[
        styles.block,
        animatedStyle,
        {
          height,
          backgroundColor: getTagColor(primaryTag),
          borderColor: lane === 'planned' ? '#94A3B8' : '#64748B',
        },
      ]}>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.tag}>
        {primaryTag ?? 'untagged'}
      </Text>
    </Animated.View>
  );

  if (!interactive) {
    return blockView;
  }

  return <GestureDetector gesture={composedGesture}>{blockView}</GestureDetector>;
}

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  tag: {
    marginTop: 2,
    fontSize: 10,
    color: '#334155',
    textTransform: 'capitalize',
  },
});
