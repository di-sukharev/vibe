import { useId, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Typography } from '@/components/ui/typography'
import { LoginForm } from './LoginForm'
import { emptyDraft, type AuthDraft, type AuthMode } from './form-model'
import { RegisterForm } from './RegisterForm'

export function AuthForm() {
  const headingId = useId()
  const [mode, setMode] = useState<AuthMode>('register')
  const [draft, setDraft] = useState<AuthDraft>(emptyDraft)

  function updateDraft(nextDraft: Partial<AuthDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...nextDraft }))
  }

  return (
    <Card
      aria-labelledby={headingId}
      className="w-full shadow-sm"
      role="region"
    >
      <CardHeader>
        <Typography as="h2" id={headingId} variant="h4">
          Account access
        </Typography>
        <CardDescription>Create an account or continue with an existing session.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(nextMode) => {
            if (nextMode === 'login' || nextMode === 'register') setMode(nextMode)
          }}
          className="gap-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="login">Login</TabsTrigger>
          </TabsList>
          <TabsContent value="register" forceMount hidden={mode !== 'register'}>
            {mode === 'register' && <RegisterForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
          <TabsContent value="login" forceMount hidden={mode !== 'login'}>
            {mode === 'login' && <LoginForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
