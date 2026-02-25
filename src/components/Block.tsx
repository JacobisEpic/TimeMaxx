import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { UI_COLORS, getCategoryColor, getCategoryTint } from '@/src/constants/uiTheme';
import type { Lane } from '@/src/types/blocks';

export const PIXELS_PER_MINUTE = 1;

const MINUTES_PER_DAY = 24 * 60;
const SNAP_INTERVAL_MINUTES = 15;

function formatAmPm(min: number): string {
  const rounded = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  const safe = rounded === MINUTES_PER_DAY ? 0 : rounded;
  const hours24 = Math.floor(safe / 60);
  const minutes = safe % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

type BlockProps = {
  id: string;
  startMin: number;
  endMin: number;
  previewStartMin?: number;
  previewEndMin?: number;
  title: string;
  tags: string[];
  lane: Lane;
  onPress: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, proposedStartMin: number) => void;
  onDragRelease: (id: string) => void;
  onDragStep?: (id: string) => void;
  onDragPreview?: (id: string, previewStartMin: number, previewEndMin: number) => void;
  onFocusStart?: (id: string) => void;
  onFocusEnd?: (id: string) => void;
  categoryColorMap?: Record<string, string>;
  interactive?: boolean;
  dimmed?: boolean;
};

export function Block({
  id,
  startMin,
  endMin,
  previewStartMin,
  previewEndMin,
  title,
  tags,
  lane,
  onPress,
  onDragStart,
  onDragEnd,
  onDragRelease,
  onDragStep,
  onDragPreview,
  onFocusStart,
  onFocusEnd,
  categoryColorMap,
  interactive = true,
  dimmed = false,
}: BlockProps) {
  const durationMin = Math.max(1, endMin - startMin);
  const height = durationMin * PIXELS_PER_MINUTE;
  const primaryTag = tags[0];
  const overrideColor = primaryTag ? categoryColorMap?.[primaryTag.toLowerCase()] : undefined;
  const categoryColor = overrideColor ?? getCategoryColor(primaryTag);
  const tintedFill = getCategoryTint(primaryTag);

  const dragDeltaMin = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const gestureStarted = useSharedValue(false);
  const lastStepDeltaMin = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .enabled(interactive)
    .activateAfterLongPress(320)
    .onStart(() => {
      gestureStarted.value = true;
      isDragging.value = true;
      lastStepDeltaMin.value = 0;
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
      if (onDragPreview) {
        runOnJS(onDragPreview)(id, startMin + dragDeltaMin.value, endMin + dragDeltaMin.value);
      }

      if (dragDeltaMin.value !== lastStepDeltaMin.value) {
        lastStepDeltaMin.value = dragDeltaMin.value;
        if (onDragStep) {
          runOnJS(onDragStep)(id);
        }
      }
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
      if (onDragPreview) {
        runOnJS(onDragPreview)(id, startMin, endMin);
      }
    });

  const tapGesture = Gesture.Tap()
    .enabled(interactive)
    .onEnd((_event, success) => {
      if (success) {
        runOnJS(onPress)(id);
      }
    });

  const focusGesture = Gesture.LongPress()
    .enabled(interactive)
    .minDuration(220)
    .maxDistance(8)
    .onStart(() => {
      if (onFocusStart) {
        runOnJS(onFocusStart)(id);
      }
    })
    .onFinalize(() => {
      if (onFocusEnd && !isDragging.value) {
        runOnJS(onFocusEnd)(id);
      }
    });

  const composedGesture = Gesture.Simultaneous(Gesture.Exclusive(panGesture, tapGesture), focusGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    top: (startMin + dragDeltaMin.value) * PIXELS_PER_MINUTE,
    opacity: isDragging.value ? 0.93 : dimmed ? 0.3 : 1,
    zIndex: isDragging.value ? 30 : 1,
    elevation: isDragging.value ? 4 : 0,
  }));
  const shownStartMin = previewStartMin ?? startMin;
  const shownEndMin = previewEndMin ?? endMin;
  const blockView = (
    <Animated.View
      accessible
      accessibilityLabel={`${lane} block ${title}`}
      style={[
        styles.block,
        animatedStyle,
        {
          height,
          backgroundColor: tintedFill,
          borderColor: UI_COLORS.glassStrokeSoft,
        },
      ]}>
      <Animated.View style={[styles.spine, { backgroundColor: categoryColor }]} />
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.tag}>
        {primaryTag ?? 'uncategorized'}
      </Text>
      <Text numberOfLines={1} style={[styles.timeText, { color: categoryColor }]}>
        {formatAmPm(shownStartMin)}-{formatAmPm(shownEndMin)}
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
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  spine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  tag: {
    marginTop: 1,
    fontSize: 10,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  timeText: {
    marginTop: 1,
    fontSize: 9,
    fontWeight: '500',
  },
});
