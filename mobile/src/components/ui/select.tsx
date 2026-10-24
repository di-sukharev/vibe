import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Button, type ButtonProps } from './button';
import { useControllableState } from './controllable-state';
import { OverlayNoop } from './overlay';
import {
  createOptionRegistrationId,
  createOptionRegistryController,
  getRegisteredOptions,
  type RegisteredOption,
  type RegisteredOptionEntry,
} from './option-registry';
import { Separator } from './separator';
import { OverlayFrame, UiPressable, Typography } from './primitives';
import { createMinTouchTargetStyle } from './touch-target';

type SelectOption = RegisteredOption;

type SelectContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  value?: string;
  setValue: (value: string) => void;
  options: SelectOption[];
  registerOption: (id: string, option: SelectOption) => void;
  unregisterOption: (id: string) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

export function Select({
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });
  const [currentOpen, setOpen] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  const [optionEntries, setOptionEntries] = useState<RegisteredOptionEntry[]>([]);
  const currentValueRef = useRef(currentValue);
  const setValueRef = useRef(setValue);
  const registryRef = useRef<ReturnType<typeof createOptionRegistryController> | null>(null);
  currentValueRef.current = currentValue;
  setValueRef.current = setValue;
  const options = useMemo(() => getRegisteredOptions(optionEntries), [optionEntries]);

  if (!registryRef.current) {
    registryRef.current = createOptionRegistryController({
      getCurrentValue: () => currentValueRef.current,
      onEntriesChange: setOptionEntries,
      setValue: (nextValue) => setValueRef.current(nextValue),
    });
  }

  const registerOption = useCallback((id: string, option: SelectOption) => {
    registryRef.current?.register(id, option);
  }, []);
  const unregisterOption = useCallback((id: string) => {
    registryRef.current?.unregister(id);
  }, []);

  useEffect(() => {
    return () => registryRef.current?.dispose();
  }, []);

  const context = useMemo<SelectContextValue>(
    () => ({
      open: currentOpen,
      setOpen,
      value: currentValue,
      setValue,
      options,
      registerOption,
      unregisterOption,
    }),
    [currentOpen, currentValue, options, registerOption, setOpen, setValue, unregisterOption],
  );

  return <SelectContext.Provider value={context}>{children}</SelectContext.Provider>;
}

export function SelectTrigger({ children, ...props }: ButtonProps) {
  const context = useContext(SelectContext);
  return (
    <Button
      {...props}
      variant={props.variant ?? 'outline'}
      onPress={(event) => {
        props.onPress?.(event);
        context?.setOpen(true);
      }}>
      {children ?? <SelectValue />}
    </Button>
  );
}

export function SelectValue({ placeholder = 'Select' }: { placeholder?: ReactNode }) {
  const context = useContext(SelectContext);
  const selected = context?.options.find((option) => option.value === context.value);
  return (
    <Typography variant="bodySm" muted={!selected}>
      {selected?.label ?? placeholder}
    </Typography>
  );
}

export function SelectContent({ children, ...props }: ViewProps & { children?: ReactNode }) {
  const context = useContext(SelectContext);
  return (
    <>
      <View style={styles.hidden}>{children}</View>
      <OverlayFrame
        visible={Boolean(context?.open)}
        scrollable
        onRequestClose={() => context?.setOpen(false)}>
        <View {...props} style={[styles.list, props.style]}>
          {context?.options.map((option) => (
            <SelectOptionRow key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectOptionRow>
          ))}
        </View>
      </OverlayFrame>
    </>
  );
}

export function SelectGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function SelectItem({
  value,
  children,
  disabled,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  value: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const context = useContext(SelectContext);
  const isDisabled = disabled === true;
  const optionIdRef = useRef(createOptionRegistrationId());
  const registerOption = context?.registerOption;
  const unregisterOption = context?.unregisterOption;

  useEffect(() => {
    registerOption?.(optionIdRef.current, { value, label: children ?? value, disabled: isDisabled });
  }, [children, isDisabled, registerOption, value]);

  useEffect(() => {
    const optionId = optionIdRef.current;
    return () => unregisterOption?.(optionId);
  }, [unregisterOption]);

  return (
    <SelectOptionRow {...props} value={value} disabled={isDisabled} style={style}>
      {children}
    </SelectOptionRow>
  );
}

function SelectOptionRow({
  value,
  children,
  disabled,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  value: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const context = useContext(SelectContext);
  const isDisabled = disabled === true;

  return (
    <UiPressable
      {...props}
      disabled={isDisabled}
      style={[styles.item, style]}
      onPress={(event) => {
        props.onPress?.(event);
        if (!isDisabled) {
          context?.setValue(value);
          context?.setOpen(false);
        }
      }}>
      <Typography variant="bodySm" weight={context?.value === value ? '700' : '500'}>
        {children}
      </Typography>
    </UiPressable>
  );
}

export function SelectLabel({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="caption" weight="700" muted style={[styles.label, style]}>
      {children}
    </Typography>
  );
}

export const SelectScrollDownButton = OverlayNoop;
export const SelectScrollUpButton = OverlayNoop;
export const SelectSeparator = Separator;

const styles = StyleSheet.create({
  group: {
    gap: 4,
  },
  hidden: {
    display: 'none',
  },
  item: {
    ...createMinTouchTargetStyle('height'),
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    paddingHorizontal: 10,
  },
  list: {
    gap: 4,
  },
});
