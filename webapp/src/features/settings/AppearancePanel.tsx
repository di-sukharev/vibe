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
import { Typography } from '@/components/ui/typography'

const themes = ['system', 'light', 'dark'] as const
type Theme = typeof themes[number]

const themeIcons = {
  system: ComputerIcon,
  light: Sun01Icon,
  dark: Moon02Icon,
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
                <SelectItem className="capitalize" key={item} value={item}>
                  <HugeiconsIcon aria-hidden icon={themeIcons[item]} strokeWidth={2} />
                  {item}
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
