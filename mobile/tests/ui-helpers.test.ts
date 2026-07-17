import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';

import { buttonAccessibilityLabel } from '../src/components/ui/button-utils';

import {
  addMonths,
  buildCalendarMonth,
  isDateInRange,
  selectCalendarDate,
} from '../src/components/ui/calendar-utils';
import { getControllableValue } from '../src/components/ui/controllable-state';
import { getOtpSlots, normalizeOtpValue } from '../src/components/ui/input-otp-utils';
import {
  createOptionRegistryController,
  getRegisteredOptions,
  getValueAfterOptionRegistrySettles,
  getValueAfterOptionUnregister,
  hasRegisteredOption,
  unregisterRegisteredOptionEntry,
  unregisterRegisteredOption,
  upsertRegisteredOptionEntry,
  upsertRegisteredOption,
} from '../src/components/ui/option-registry';
import {
  getRadioGroupItemState,
  shouldHandleMenuRadioRowPress,
} from '../src/components/ui/radio-utils';
import { clampSliderValue, normalizeSliderValues } from '../src/components/ui/slider-utils';
import { mapTextChildren } from '../src/components/ui/text-utils';
import { createMinTouchTargetStyle, MIN_TOUCH_TARGET } from '../src/components/ui/touch-target';

test('controlled state prefers explicit values over defaults', () => {
  expect(getControllableValue('controlled', 'fallback')).toBe('controlled');
  expect(getControllableValue(undefined, 'fallback')).toBe('fallback');
});

test('text child renderer wraps mixed raw strings for native containers', () => {
  const rendered = React.Children.toArray(
    mapTextChildren(
      [
        'Profile',
        React.createElement(React.Fragment, { key: 'shortcut' }, [
          'Shortcut',
          React.createElement(React.Fragment, { key: 'nested' }, 7),
        ]),
      ],
      (child) => React.createElement('Text', null, child),
    ),
  );
  const fragmentChildren = React.Children.toArray(
    (rendered[1] as React.ReactElement<{ children?: React.ReactNode }>).props.children,
  );
  const nestedFragment = fragmentChildren[1] as React.ReactElement<{ children?: React.ReactNode }>;
  const nestedFragmentChildren = React.Children.toArray(nestedFragment.props.children);

  expect(rendered).toHaveLength(2);
  expect(typeof rendered[0]).not.toBe('string');
  expect(typeof fragmentChildren[0]).not.toBe('string');
  expect(typeof fragmentChildren[1]).not.toBe('number');
  expect(nestedFragmentChildren).toHaveLength(1);
  expect(typeof nestedFragmentChildren[0]).not.toBe('number');
  expect(React.isValidElement(nestedFragmentChildren[0])).toBe(true);
  expect(React.isValidElement(rendered[0])).toBe(true);
});

test('minimum touch target follows mobile accessibility baseline', () => {
  expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  expect(createMinTouchTargetStyle()).toEqual({ minHeight: 44, minWidth: 44 });
  expect(createMinTouchTargetStyle('height')).toEqual({ minHeight: 44 });
  expect(createMinTouchTargetStyle('width')).toEqual({ minWidth: 44 });
});

test('loading buttons preserve a readable accessibility label', () => {
  expect(buttonAccessibilityLabel('Save changes')).toBe('Save changes');
  expect(buttonAccessibilityLabel(42)).toBe('42');
  expect(buttonAccessibilityLabel(React.createElement('Icon'))).toBeUndefined();

  const source = readFileSync(resolve(import.meta.dir, '../src/components/ui/button.tsx'), 'utf8');
  expect(source).toContain('busy: Boolean(loading)');
});

test('overlay primitives expose modal escape semantics without an accessible backdrop control', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/components/ui/primitives.tsx'), 'utf8');
  expect(source).toContain('accessibilityViewIsModal');
  expect(source).toContain('onAccessibilityEscape={onRequestClose}');
  expect(source).toContain('importantForAccessibility="no"');
});

test('interactive primitives use the shared touch target constant', () => {
  const uiRoot = resolve(import.meta.dir, '../src/components/ui');
  const interactiveFiles = [
    'button.tsx',
    'calendar.tsx',
    'checkbox.tsx',
    'command.tsx',
    'menu-primitives.tsx',
    'navigation-menu.tsx',
    'radio-group.tsx',
    'select.tsx',
    'switch.tsx',
  ];

  for (const file of interactiveFiles) {
    const source = readFileSync(resolve(uiRoot, file), 'utf8');
    expect(source).toMatch(/MIN_TOUCH_TARGET|createMinTouchTargetStyle|getControlHeight/);
  }
});

test('content primitives wrap raw text children before native containers render them', () => {
  const uiRoot = resolve(import.meta.dir, '../src/components/ui');
  const contentFiles = ['aspect-ratio.tsx', 'overlay.tsx', 'scroll-area.tsx', 'tabs.tsx'];

  for (const file of contentFiles) {
    const source = readFileSync(resolve(uiRoot, file), 'utf8');
    expect(source).toContain('renderTextChild(children');
  }
});

test('button-like primitives keep textStyle customization in the native API', () => {
  const uiRoot = resolve(import.meta.dir, '../src/components/ui');

  for (const file of ['button.tsx', 'badge.tsx', 'toggle.tsx']) {
    const source = readFileSync(resolve(uiRoot, file), 'utf8');
    expect(source).toContain('textStyle');
  }
});

test('select option registry updates labels and removes unmounted values', () => {
  const first = upsertRegisteredOption([], { value: 'a', label: 'Alpha', disabled: false });
  const updated = upsertRegisteredOption(first, { value: 'a', label: 'Archived alpha', disabled: true });
  const removed = unregisterRegisteredOption(updated, 'a');

  expect(first).toEqual([{ value: 'a', label: 'Alpha', disabled: false }]);
  expect(updated).toEqual([{ value: 'a', label: 'Archived alpha', disabled: true }]);
  expect(removed).toEqual([]);
  expect(hasRegisteredOption(updated, 'a')).toBe(true);
  expect(hasRegisteredOption(removed, 'a')).toBe(false);
  expect(getValueAfterOptionUnregister('b', 'a')).toBe('b');
  expect(getValueAfterOptionUnregister('a', 'a')).toBe('');
});

test('select option entry registry preserves same-value replacements after settling', () => {
  const initial = upsertRegisteredOptionEntry([], 'old-a', {
    value: 'a',
    label: 'Alpha',
    disabled: false,
  });
  const afterCleanup = unregisterRegisteredOptionEntry(initial, 'old-a');
  const afterReplacement = upsertRegisteredOptionEntry(afterCleanup, 'new-a', {
    value: 'a',
    label: 'Alpha reloaded',
    disabled: true,
  });
  const afterInPlaceValueChange = upsertRegisteredOptionEntry(initial, 'old-a', {
    value: 'b',
    label: 'Beta',
    disabled: false,
  });

  expect(getValueAfterOptionRegistrySettles('a', afterReplacement)).toBe('a');
  expect(getValueAfterOptionRegistrySettles('a', afterCleanup)).toBe('');
  expect(getValueAfterOptionRegistrySettles('a', afterInPlaceValueChange)).toBe('');
  expect(getRegisteredOptions(afterReplacement)).toEqual([
    { value: 'a', label: 'Alpha reloaded', disabled: true },
  ]);
});

test('select option registry controller follows component lifecycle timers', async () => {
  let currentValue = 'a';
  const valueChanges: string[] = [];
  const entrySnapshots: unknown[] = [];
  const controller = createOptionRegistryController({
    getCurrentValue: () => currentValue,
    onEntriesChange: (entries) => entrySnapshots.push(entries),
    setValue: (nextValue) => {
      currentValue = nextValue;
      valueChanges.push(nextValue);
    },
  });

  controller.register('old-a', { value: 'a', label: 'Alpha' });
  await waitForOptionRegistryTimer();
  expect(valueChanges).toEqual([]);

  controller.unregister('old-a');
  controller.register('new-a', { value: 'a', label: 'Alpha reloaded' });
  await waitForOptionRegistryTimer();
  expect(currentValue).toBe('a');
  expect(valueChanges).toEqual([]);

  controller.register('new-a', { value: 'b', label: 'Beta' });
  await waitForOptionRegistryTimer();
  expect(currentValue).toBe('');
  expect(valueChanges).toEqual(['']);
  expect(entrySnapshots.length).toBeGreaterThanOrEqual(4);

  controller.dispose();
});

test('select option registry controller ignores child cleanup after dispose', async () => {
  let currentValue = 'a';
  const valueChanges: string[] = [];
  const controller = createOptionRegistryController({
    getCurrentValue: () => currentValue,
    onEntriesChange: () => undefined,
    setValue: (nextValue) => {
      currentValue = nextValue;
      valueChanges.push(nextValue);
    },
  });

  controller.register('option-a', { value: 'a', label: 'Alpha' });
  await waitForOptionRegistryTimer();

  controller.dispose();
  controller.unregister('option-a');
  await waitForOptionRegistryTimer();

  expect(currentValue).toBe('a');
  expect(valueChanges).toEqual([]);
});

test('menu radio row decisions preserve selection and disabled behavior', () => {
  expect(
    getRadioGroupItemState({
      currentValue: 'compact',
      value: 'compact',
      disabled: false,
      groupDisabled: false,
    }),
  ).toEqual({ isDisabled: false, isSelected: true });

  expect(
    getRadioGroupItemState({
      currentValue: 'compact',
      value: 'comfortable',
      disabled: true,
      groupDisabled: false,
    }),
  ).toEqual({ isDisabled: true, isSelected: false });

  expect(shouldHandleMenuRadioRowPress(false)).toBe(true);
  expect(shouldHandleMenuRadioRowPress(true)).toBe(false);
});

function waitForOptionRegistryTimer() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('OTP helper normalizes whitespace and caps slot count', () => {
  expect(normalizeOtpValue('12 34 56', 4)).toBe('1234');
  expect(getOtpSlots('12', 4)).toEqual(['1', '2', '', '']);
});

test('slider helper clamps and snaps values to step', () => {
  expect(clampSliderValue(11.2, 0, 10, 0.5)).toBe(10);
  expect(clampSliderValue(4.3, 0, 10, 2)).toBe(4);
  expect(normalizeSliderValues([9, 2, 11], 0, 10, 1)).toEqual([2, 9, 10]);
});

test('calendar helper builds a six-week grid and selects ranges', () => {
  const month = buildCalendarMonth(new Date(2026, 4, 1));
  expect(month).toHaveLength(42);
  expect(month[0]?.date.getDay()).toBe(0);
  expect(addMonths(new Date(2026, 4, 14), 1)).toEqual(new Date(2026, 5, 1));

  const first = new Date(2026, 4, 14);
  const second = new Date(2026, 4, 18);
  const partial = selectCalendarDate('range', undefined, first);
  const complete = selectCalendarDate('range', partial, second);

  expect(isDateInRange(new Date(2026, 4, 16), complete as { from: Date; to: Date })).toBe(true);
});
