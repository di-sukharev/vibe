import { useTheme } from 'next-themes'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const themes = ['system', 'light', 'dark'] as const

export function AppearanceSettings() {
  const { theme = 'system', setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Follow your device preference or keep a consistent light or dark theme.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger aria-label="Theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themes.map((item) => (
              <SelectItem className="capitalize" key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}
