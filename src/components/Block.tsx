import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { type UIColors, getCategoryColor, getCategoryLabel, getCategoryTint, useUIColors } from '@/src/constants/uiTheme';
import type { Lane } from '@/src/types/blocks';
import { formatMinutesAmPm } from '@/src/utils/time';

export const PIXELS_PER_MINUTE = 1;

const MINUTES_PER_DAY = 24 * 60;
const SNAP_INTERVAL_MINUTES = 15;
const CHECKBOX_HIT_SIZE = 24;
const LAYOUT_QUANTIZATION_FACTOR = 2;

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
  showCopyCheckbox?: boolean;
  copyCheckboxChecked?: boolean;
  onCopyCheckboxPress?: (id: string) => void;
  categoryColorMap?: Record<string, string>;
  categoryLabelMap?: Record<string, string>;
  interactive?: boolean;
  dragEnabled?: boolean;
  dimmed?: boolean;
  pixelsPerMinute?: number;
  suppressText?: boolean;
  isActive?: boolean;
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
  showCopyCheckbox = false,
  copyCheckboxChecked = false,
  onCopyCheckboxPress,
  categoryColorMap,
  categoryLabelMap,
  interactive = true,
  dragEnabled = true,
  dimmed = false,
  pixelsPerMinute = PIXELS_PER_MINUTE,
  suppressText = false,
  isActive = false,
}: BlockProps) {
  const colors = useUIColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const effectivePixelsPerMinute = Math.max(0.01, pixelsPerMinute);
  const durationMin = Math.max(1, endMin - startMin);
  const top = Math.round(startMin * effectivePixelsPerMinute * LAYOUT_QUANTIZATION_FACTOR) / LAYOUT_QUANTIZATION_FACTOR;
  const height = Math.max(
    1,
    Math.round(durationMin * effectivePixelsPerMinute * LAYOUT_QUANTIZATION_FACTOR) / LAYOUT_QUANTIZATION_FACTOR
  );
  const primaryTag = tags[0];
  const overrideColor = primaryTag ? categoryColorMap?.[primaryTag.toLowerCase()] : undefined;
  const categoryColor = overrideColor ?? getCategoryColor(primaryTag);
  const tintedFill = getCategoryTint(primaryTag);
  const categoryLabel = getCategoryLabel(primaryTag, categoryLabelMap);

  const dragDeltaMin = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const gestureStarted = useSharedValue(false);
  const lastStepDeltaMin = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .enabled(interactive && dragEnabled)
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

      const rawDeltaMin = event.translationY / effectivePixelsPerMinute;
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
    });

  const tapGesture = Gesture.Tap()
    .enabled(interactive)
    .onEnd((event, success) => {
      if (success) {
        if (showCopyCheckbox && onCopyCheckboxPress && event.x <= CHECKBOX_HIT_SIZE && event.y <= CHECKBOX_HIT_SIZE) {
          runOnJS(onCopyCheckboxPress)(id);
          return;
        }
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

  const animatedStyle = useAnimatedStyle(() => {
    const translateY =
      Math.round(dragDeltaMin.value * effectivePixelsPerMinute * LAYOUT_QUANTIZATION_FACTOR) /
      LAYOUT_QUANTIZATION_FACTOR;
    return {
      transform: [{ translateY }],
      opacity: isDragging.value ? 0.93 : dimmed ? 0.3 : 1,
      zIndex: isDragging.value ? 30 : 1,
      elevation: isDragging.value ? 4 : 0,
    };
  });
  const shownStartMin = previewStartMin ?? startMin;
  const shownEndMin = previewEndMin ?? endMin;
  const blockView = (
    <Animated.View
      accessible
      accessibilityLabel={`${lane} block ${title}`}
      style={[
        styles.block,
        showCopyCheckbox && styles.blockWithCheckbox,
        animatedStyle,
        {
          top,
          height,
          backgroundColor: tintedFill,
          borderColor: isActive ? colors.done : colors.glassStrokeSoft,
          borderWidth: isActive ? 1.5 : 1,
        },
        ]}>
      <Animated.View style={[styles.spine, { backgroundColor: categoryColor }]} />
      {isActive ? <Text style={styles.activeBadge}>Now</Text> : null}
      {showCopyCheckbox ? (
        <Animated.View style={styles.checkboxWrap}>
          <Ionicons
            name={copyCheckboxChecked ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={copyCheckboxChecked ? colors.done : colors.neutralTextSoft}
          />
        </Animated.View>
      ) : null}
      {!suppressText ? (
        <>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.tag}>
            {categoryLabel}
          </Text>
          <Text numberOfLines={1} style={[styles.timeText, { color: categoryColor }]}>
            {formatMinutesAmPm(shownStartMin)}-{isActive ? 'Now' : formatMinutesAmPm(shownEndMin)}
          </Text>
        </>
      ) : null}
    </Animated.View>
  );

  if (!interactive) {
    return blockView;
  }

  return <GestureDetector gesture={composedGesture}>{blockView}</GestureDetector>;
}

function createStyles(colors: UIColors) {
  return StyleSheet.create({
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
    blockWithCheckbox: {
      paddingLeft: 28,
    },
    checkboxWrap: {
      position: 'absolute',
      top: 5,
      left: 8,
      width: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    spine: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
    },
    activeBadge: {
      position: 'absolute',
      top: 6,
      right: 8,
      borderRadius: 999,
      paddingHorizontal: 6,
      paddingVertical: 2,
      fontSize: 9,
      fontWeight: '700',
      color: '#FFFFFF',
      backgroundColor: colors.done,
      overflow: 'hidden',
    },
    title: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.neutralText,
    },
    tag: {
      marginTop: 1,
      fontSize: 10,
      color: colors.neutralTextSoft,
      textTransform: 'capitalize',
    },
    timeText: {
      marginTop: 1,
      fontSize: 9,
      fontWeight: '500',
    },
  });
}
