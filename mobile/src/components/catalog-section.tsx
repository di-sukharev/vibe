import type { ReactNode } from 'react';

import { SectionCard } from '@/components/dashboard/SectionCard';

type CatalogSectionProps = {
  children: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function CatalogSection({
  children,
  description,
  title,
}: CatalogSectionProps) {
  return (
    <SectionCard description={description} title={title}>
      {children}
    </SectionCard>
  );
}
