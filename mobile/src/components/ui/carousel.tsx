import type { ReactNode } from 'react';
import React, { createContext, useContext, useRef } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance, type ScrollViewProps, type ViewProps } from 'react-native';

import { Button } from './button';

export type CarouselApi = {
  scrollPrev: () => void;
  scrollNext: () => void;
};

type CarouselContextValue = {
  orientation: 'horizontal' | 'vertical';
  scrollRef: React.RefObject<ScrollViewInstance | null>;
  pageSize: number;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

export function useCarousel() {
  const context = useContext(CarouselContext);
  if (!context) throw new Error('useCarousel must be used within Carousel');
  return context;
}

export function Carousel({
  children,
  orientation = 'horizontal',
  setApi,
  pageSize = 280,
  style,
  ...props
}: ViewProps & {
  children?: ReactNode;
  orientation?: 'horizontal' | 'vertical';
  setApi?: (api: CarouselApi) => void;
  pageSize?: number;
}) {
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const context = { orientation, scrollRef, pageSize };

  React.useEffect(() => {
    setApi?.({
      scrollPrev: () => scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true }),
      scrollNext: () =>
        scrollRef.current?.scrollTo({
          x: orientation === 'horizontal' ? pageSize : 0,
          y: orientation === 'vertical' ? pageSize : 0,
          animated: true,
        }),
    });
  }, [orientation, pageSize, setApi]);

  return (
    <CarouselContext.Provider value={context}>
      <View {...props} accessibilityRole="adjustable" style={[styles.root, style]}>
        {children}
      </View>
    </CarouselContext.Provider>
  );
}

export function CarouselContent({ children, style, ...props }: ScrollViewProps & { children?: ReactNode }) {
  const context = useCarousel();
  const isHorizontal = context.orientation === 'horizontal';

  return (
    <ScrollView
      {...props}
      ref={context.scrollRef}
      horizontal={isHorizontal}
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        isHorizontal ? styles.row : styles.column,
        props.contentContainerStyle,
      ]}
      style={style}>
      {children}
    </ScrollView>
  );
}

export function CarouselItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const context = useCarousel();
  return (
    <View
      {...props}
      style={[
        context.orientation === 'horizontal' ? { width: context.pageSize } : { height: context.pageSize },
        style,
      ]}>
      {children}
    </View>
  );
}

export function CarouselPrevious() {
  const context = useCarousel();
  return (
    <Button size="icon-sm" variant="outline" onPress={() => context.scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true })}>
      {'<'}
    </Button>
  );
}

export function CarouselNext() {
  const context = useCarousel();
  return (
    <Button
      size="icon-sm"
      variant="outline"
      onPress={() =>
        context.scrollRef.current?.scrollTo({
          x: context.orientation === 'horizontal' ? context.pageSize : 0,
          y: context.orientation === 'vertical' ? context.pageSize : 0,
          animated: true,
        })
      }>
      {'>'}
    </Button>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: 12,
  },
  root: {
    gap: 12,
    width: '100%',
  },
  row: {
    gap: 12,
  },
});
