import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleProp,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';

/**
 * Screen wrapper that shrinks to the space above the on-screen keyboard.
 *
 * Android 16+ (API 36) always draws apps edge-to-edge, and there the system no
 * longer resizes the app for the keyboard (android:windowSoftInputMode=
 * "adjustResize" is ignored) — so we add bottom padding ourselves. On older
 * Android versions the system still resizes the window, and adding padding
 * too would leave a gap, so this does nothing there.
 *
 * (React Native's KeyboardAvoidingView isn't used: it measures from the top of
 * the navigator, and the S.P.I.K.E logo header sits above it, so it came up
 * short by the header's height.) Here we measure where the screen really is on
 * the phone and pad by exactly how much of it the keyboard covers.
 *
 * Pair it with useKeyboardScroll() on the screen's ScrollView so the field
 * being typed in is scrolled into view.
 */
const NEEDS_PADDING =
  Platform.OS === 'ios' ||
  (Platform.OS === 'android' && Number(Platform.Version) >= 36);

const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** Top edge of the keyboard, in the same coordinates as measureInWindow */
function keyboardTop(e: KeyboardEvent): number {
  const {screenY, height} = e.endCoordinates;
  if (screenY > 0) return screenY;
  return Dimensions.get('screen').height - height;
}

export default function KeyboardSafeView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const [padding, setPadding] = useState(0);

  useEffect(() => {
    if (!NEEDS_PADDING) return;
    const show = Keyboard.addListener(SHOW_EVENT, e => {
      const top = keyboardTop(e);
      // The outer view never shrinks, so this is the full screen area
      ref.current?.measureInWindow((_x, y, _w, h) => {
        setPadding(Math.max(0, y + h - top));
      });
    });
    const hide = Keyboard.addListener(HIDE_EVENT, () => setPadding(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View ref={ref} style={[{flex: 1}, style]}>
      <View style={{flex: 1, marginBottom: padding}}>{children}</View>
    </View>
  );
}

/** Space left between the field and the top of the keyboard */
const MARGIN = 24;

/**
 * Keeps the focused text box visible above the keyboard.
 * Spread the result onto a ScrollView: <ScrollView {...keyboardScroll}>
 *
 * Runs when the keyboard opens, and when the user taps another box while it's
 * already open.
 */
export function useKeyboardScroll() {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const keyboardOpen = useRef(false);
  const kbTop = useRef(Infinity);
  // Screens further back in the stack stay mounted — only the one on top reacts
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;

  const ensureFocusedVisible = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput?.() as any;
    const scroll = ref.current as any;
    if (!focusedRef.current) return;
    if (!input || !scroll || typeof input.measureInWindow !== 'function') return;
    scroll.measureInWindow((_sx: number, sy: number, _sw: number, sh: number) => {
      input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        // Whichever is higher: the bottom of the scroll area or the keyboard's top
        const visibleBottom = Math.min(sy + sh, kbTop.current) - MARGIN;
        const visibleTop = sy + MARGIN;
        let delta = 0;
        if (y + h > visibleBottom) delta = y + h - visibleBottom;
        else if (y < visibleTop) delta = y - visibleTop;
        if (Math.abs(delta) > 1) {
          ref.current?.scrollTo({y: Math.max(0, offset.current + delta), animated: true});
        }
      });
    });
  }, []);

  // Wait for the screen to finish shrinking before measuring
  const ensureSoon = useCallback(() => {
    setTimeout(ensureFocusedVisible, 200);
  }, [ensureFocusedVisible]);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, e => {
      keyboardOpen.current = true;
      kbTop.current = keyboardTop(e);
      ensureSoon();
    });
    const hide = Keyboard.addListener(HIDE_EVENT, () => {
      keyboardOpen.current = false;
      kbTop.current = Infinity;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ensureSoon]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Tapping another box while the keyboard is already open
  const onTouchEnd = useCallback(() => {
    if (keyboardOpen.current) setTimeout(ensureFocusedVisible, 250);
  }, [ensureFocusedVisible]);

  return {ref, onScroll, onTouchEnd, scrollEventThrottle: 16};
}
