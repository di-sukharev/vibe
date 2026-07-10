import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoginForm } from './LoginForm'
import { emptyDraft, type AuthDraft, type AuthMode } from './form-model'
import { RegisterForm } from './RegisterForm'

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [draft, setDraft] = useState<AuthDraft>(emptyDraft)

  function updateDraft(nextDraft: Partial<AuthDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...nextDraft }))
  }

  return (
    <Card aria-label="Authentication">
      <CardHeader>
        <CardTitle>Account access</CardTitle>
        <CardDescription>Create an account or continue with an existing session.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(nextMode) => {
            if (nextMode === 'login' || nextMode === 'register') setMode(nextMode)
          }}
        >
          <TabsList layout="equal">
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="login">Login</TabsTrigger>
          </TabsList>
          <TabsContent value="register" forceMount hidden={mode !== 'register'} spacing="comfortable">
            {mode === 'register' && <RegisterForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
          <TabsContent value="login" forceMount hidden={mode !== 'login'} spacing="comfortable">
            {mode === 'login' && <LoginForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
