import { useTheme } from 'next-themes'

import {
  Moon02Icon,
  Sun01Icon,
  ComputerIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Typography } from '@/components/typography'

const themes = ['system', 'light', 'dark'] as const
type Theme = typeof themes[number]

const themeOptions = {
  system: { icon: ComputerIcon, label: 'System' },
  light: { icon: Sun01Icon, label: 'Light' },
  dark: { icon: Moon02Icon, label: 'Dark' },
} as const

export function AppearancePanel() {
  const { theme = 'system', setTheme } = useTheme()
  const selectedTheme = isTheme(theme) ? theme : 'system'

  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          Appearance
        </Typography>
        <CardDescription>
          Follow your device preference or keep a consistent light or dark theme.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="appearance-theme">Theme</FieldLabel>
          <Select
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value)
            }}
            value={selectedTheme}
          >
            <SelectTrigger className="w-full sm:w-52" id="appearance-theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themes.map((item) => (
                <SelectItem key={item} value={item}>
                  <HugeiconsIcon aria-hidden icon={themeOptions[item].icon} strokeWidth={2} />
                  {themeOptions[item].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Changes are saved in this browser and applied immediately.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  )
}

function isTheme(value: string): value is Theme {
  return themes.some((theme) => theme === value)
}
