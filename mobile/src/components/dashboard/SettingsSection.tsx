import type { ReactNode } from 'react';

import { SectionCard } from './SectionCard';

type SettingsSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function SettingsSection({
  action,
  children,
  description,
  title,
}: SettingsSectionProps) {
  return (
    <SectionCard action={action} description={description} title={title}>
      {children}
    </SectionCard>
  );
}
